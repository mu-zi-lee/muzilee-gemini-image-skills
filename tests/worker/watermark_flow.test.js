import test from 'node:test';
import assert from 'node:assert/strict';

import { getLatestImageTaskResult } from '../../worker-src/features/image/image_result.js';
import { processWatermarkImageData } from '../../worker-src/features/image/watermark_core.js';
import {
  calculateWatermarkPosition,
  detectWatermarkConfig,
  getGeminiAlphaMap,
} from '../../worker-src/features/image/watermark_templates.js';

function cloneImageDataLike(imageData) {
  return {
    width: imageData.width,
    height: imageData.height,
    data: new Uint8ClampedArray(imageData.data),
  };
}

function createBaseImageData(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const red = 40 + Math.round((x / Math.max(width - 1, 1)) * 120);
      const green = 55 + Math.round((y / Math.max(height - 1, 1)) * 110);
      const blue = 90 + Math.round((((x + y) / Math.max(width + height - 2, 1))) * 90);
      data[offset] = red;
      data[offset + 1] = green;
      data[offset + 2] = blue;
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
}

function applySyntheticWatermark(imageData, config) {
  const output = cloneImageDataLike(imageData);
  const position = calculateWatermarkPosition(imageData.width, imageData.height, config);
  const alphaMap = getGeminiAlphaMap(config.logoSize);
  for (let row = 0; row < position.height; row += 1) {
    for (let col = 0; col < position.width; col += 1) {
      const alpha = alphaMap[row * position.width + col];
      if (alpha <= 0) continue;
      const offset = ((position.y + row) * output.width + (position.x + col)) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        output.data[offset + channel] = Math.round(
          output.data[offset + channel] * (1 - alpha) + 255 * alpha,
        );
      }
    }
  }
  return { imageData: output, position };
}

function computeRegionMae(left, right, position) {
  let total = 0;
  let count = 0;
  for (let row = 0; row < position.height; row += 1) {
    for (let col = 0; col < position.width; col += 1) {
      const offset = ((position.y + row) * left.width + (position.x + col)) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        total += Math.abs(left.data[offset + channel] - right.data[offset + channel]);
        count += 1;
      }
    }
  }
  return total / Math.max(count, 1);
}

test('processWatermarkImageData removes the standard 48 watermark', () => {
  const base = createBaseImageData(512, 512);
  const config = detectWatermarkConfig(base.width, base.height);
  assert.equal(config.logoSize, 48);
  const watermarked = applySyntheticWatermark(base, config);

  const result = processWatermarkImageData(watermarked.imageData);

  assert.equal(result.watermark.status, 'removed');
  assert.ok(
    computeRegionMae(base, result.imageData, watermarked.position) <
      computeRegionMae(base, watermarked.imageData, watermarked.position),
  );
});

test('processWatermarkImageData removes the standard 96 watermark', () => {
  const base = createBaseImageData(1024, 1024);
  const config = detectWatermarkConfig(base.width, base.height);
  assert.equal(config.logoSize, 96);
  const watermarked = applySyntheticWatermark(base, config);

  const result = processWatermarkImageData(watermarked.imageData);

  assert.equal(result.watermark.status, 'removed');
  assert.ok(
    computeRegionMae(base, result.imageData, watermarked.position) <
      computeRegionMae(base, watermarked.imageData, watermarked.position),
  );
});

test('processWatermarkImageData skips images without a matching watermark', () => {
  const image = createBaseImageData(512, 512);
  const result = processWatermarkImageData(image);

  assert.equal(result.watermark.status, 'skipped');
  assert.match(result.watermark.reason, /not_detected|low_confidence/);
});

test('getLatestImageTaskResult uses preview-only path when requested', async () => {
  const calls = [];
  const result = await getLatestImageTaskResult({
    selectors: {},
    captureController: {},
    hoverDelayMs: 100,
    timeoutMs: 1000,
    requestedMode: 'preview',
    getLatestImagePayloadImpl: async () => {
      calls.push('preview');
      return { image_data_url: 'data:image/png;base64,aaa', source: 'preview' };
    },
    downloadLatestImageFullSizeImpl: async () => {
      calls.push('full_size');
      return { image_data_url: 'data:image/png;base64,bbb', source: 'full_size' };
    },
    processWatermarkDataUrlImpl: async (dataUrl) => ({
      imageDataUrl: dataUrl,
      mimeType: 'image/png',
      watermark: { status: 'skipped', reason: 'not_detected', method: 'gemini_template_unblend' },
    }),
  });

  assert.deepEqual(calls, ['preview']);
  assert.equal(result.watermark.requested_mode, 'preview');
  assert.equal(result.watermark.actual_source, 'preview');
});

test('getLatestImageTaskResult falls back from full-size to preview for auto/full_size', async () => {
  const calls = [];
  const result = await getLatestImageTaskResult({
    selectors: {},
    captureController: {},
    hoverDelayMs: 100,
    timeoutMs: 1000,
    requestedMode: 'auto',
    getLatestImagePayloadImpl: async () => {
      calls.push('preview');
      return { image_data_url: 'data:image/png;base64,aaa', source: 'preview' };
    },
    downloadLatestImageFullSizeImpl: async () => {
      calls.push('full_size');
      throw new Error('download_failed');
    },
    processWatermarkDataUrlImpl: async (dataUrl) => ({
      imageDataUrl: dataUrl,
      mimeType: 'image/png',
      watermark: { status: 'removed', reason: null, method: 'gemini_template_unblend' },
    }),
  });

  assert.deepEqual(calls, ['full_size', 'preview']);
  assert.equal(result.watermark.actual_source, 'preview');
  assert.equal(result.watermark.reason, 'full_size_unavailable');
});
