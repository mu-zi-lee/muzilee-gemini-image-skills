import test from 'node:test';
import assert from 'node:assert/strict';

import { getEmbeddedAlphaMap } from '../../worker-src/features/image/embedded_alpha_maps.js';
import {
  calculateWatermarkPosition,
  cloneImageData,
  computeSpatialCorrelation,
  detectBestWatermarkMatch,
  detectWatermarkConfig,
  generateCandidateWatermarkConfigs,
  interpolateAlphaMap,
  processWatermarkImageData,
  refineWatermarkPosition,
  removeWatermark,
} from '../../worker-src/features/image/remove_watermark.js';

function createImageDataLike(width, height, fill = 0) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const idx = i * 4;
    data[idx] = fill;
    data[idx + 1] = fill;
    data[idx + 2] = fill;
    data[idx + 3] = 255;
  }
  return { width, height, data };
}

function createTexturedImageData(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const value = Math.max(
        0,
        Math.min(255, Math.round(90 + 40 * Math.sin(x / 11) + 35 * Math.cos(y / 13) + ((x * y) % 17))),
      );
      data[idx] = value;
      data[idx + 1] = value;
      data[idx + 2] = value;
      data[idx + 3] = 255;
    }
  }
  return { width, height, data };
}

function applySyntheticWatermark(imageData, alphaMap, position) {
  const watermarked = cloneImageData(imageData);
  for (let row = 0; row < position.height; row += 1) {
    for (let col = 0; col < position.width; col += 1) {
      const alpha = alphaMap[row * position.width + col];
      const idx = ((position.y + row) * watermarked.width + (position.x + col)) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const originalValue = watermarked.data[idx + channel];
        const mixed = Math.max(
          0,
          Math.min(255, Math.round(alpha * 255 + (1 - alpha) * originalValue)),
        );
        watermarked.data[idx + channel] = mixed;
      }
    }
  }
  return watermarked;
}

test('getEmbeddedAlphaMap decodes known maps and returns clones', () => {
  const alpha48a = getEmbeddedAlphaMap(48);
  const alpha48b = getEmbeddedAlphaMap(48);
  const alpha96 = getEmbeddedAlphaMap(96);

  assert.equal(alpha48a.length, 48 * 48);
  assert.equal(alpha96.length, 96 * 96);
  assert.notEqual(alpha48a, alpha48b);

  const original = alpha48b[0];
  alpha48a[0] = 123;
  assert.equal(alpha48b[0], original);
});

test('interpolateAlphaMap preserves same-size maps and resizes arbitrary targets', () => {
  const source = new Float32Array([0, 1, 1, 0]);
  const sameSize = interpolateAlphaMap(source, 2, 2);
  const resized = interpolateAlphaMap(source, 2, 3);

  assert.deepEqual(Array.from(sameSize), Array.from(source));
  assert.equal(resized.length, 9);
  assert.equal(resized[0], 0);
  assert.equal(resized[8], 0);
});

test('detectWatermarkConfig and calculateWatermarkPosition match known preview sizes', () => {
  const small = detectWatermarkConfig(512, 512);
  const large = detectWatermarkConfig(2048, 2048);

  assert.deepEqual(small, { logoSize: 48, marginRight: 32, marginBottom: 32 });
  assert.deepEqual(large, { logoSize: 96, marginRight: 64, marginBottom: 64 });
  assert.deepEqual(
    calculateWatermarkPosition(512, 512, small),
    { x: 432, y: 432, width: 48, height: 48 },
  );
});

test('generateCandidateWatermarkConfigs includes multiple plausible right-bottom candidates', () => {
  const configs = generateCandidateWatermarkConfigs(1024, 559);
  assert.ok(configs.length > 4);
  assert.ok(configs.some((item) => item.logoSize === 48));
});

test('processWatermarkImageData skips out-of-bounds watermark regions', () => {
  const imageData = createImageDataLike(40, 40, 90);
  const original = new Uint8ClampedArray(imageData.data);
  const result = processWatermarkImageData(
    imageData,
    getEmbeddedAlphaMap(48),
    getEmbeddedAlphaMap(96),
  );

  assert.equal(result.applied, false);
  assert.deepEqual(Array.from(result.imageData.data), Array.from(original));
});

test('removeWatermark leaves low-alpha regions unchanged', () => {
  const imageData = createImageDataLike(8, 8, 120);
  const original = new Uint8ClampedArray(imageData.data);

  removeWatermark(
    imageData,
    new Float32Array([0, 0.01, 0.015, 0.02]),
    { x: 1, y: 1, width: 2, height: 2 },
  );

  assert.deepEqual(Array.from(imageData.data), Array.from(original));
});

test('refineWatermarkPosition finds a nearby offset watermark', () => {
  const alpha48 = getEmbeddedAlphaMap(48);
  const imageData = createTexturedImageData(256, 256);
  const basePosition = { x: 176, y: 176, width: 48, height: 48 };
  const actualPosition = { x: 194, y: 201, width: 48, height: 48 };
  const watermarked = applySyntheticWatermark(imageData, alpha48, actualPosition);

  const baseScore = Math.abs(computeSpatialCorrelation(watermarked, alpha48, basePosition));
  const refined = refineWatermarkPosition(watermarked, alpha48, basePosition);
  const actualScore = Math.abs(computeSpatialCorrelation(watermarked, alpha48, actualPosition));

  assert.ok(refined.score >= baseScore);
  assert.ok(refined.score <= actualScore);
  assert.equal(refined.position.width, actualPosition.width);
  assert.equal(refined.position.height, actualPosition.height);
});

test('detectBestWatermarkMatch safely skips ambiguous synthetic matches', () => {
  const alpha48 = getEmbeddedAlphaMap(48);
  const alpha96 = getEmbeddedAlphaMap(96);
  const imageData = createTexturedImageData(1024, 559);
  const actualConfig = { logoSize: 48, marginRight: 16, marginBottom: 8 };
  const actualPosition = calculateWatermarkPosition(imageData.width, imageData.height, actualConfig);
  const watermarked = applySyntheticWatermark(imageData, alpha48, actualPosition);

  const detected = detectBestWatermarkMatch(watermarked, alpha48, alpha96);

  assert.equal(detected, null);
});

test('processWatermarkImageData reduces watermark correlation on synthetic preview data', () => {
  const alpha48 = getEmbeddedAlphaMap(48);
  const alpha96 = getEmbeddedAlphaMap(96);
  const baseImage = createTexturedImageData(128, 128);
  const config = detectWatermarkConfig(baseImage.width, baseImage.height);
  const position = calculateWatermarkPosition(baseImage.width, baseImage.height, config);
  const watermarked = applySyntheticWatermark(baseImage, alpha48, position);

  const beforeScore = Math.abs(computeSpatialCorrelation(watermarked, alpha48, position));
  const result = processWatermarkImageData(watermarked, alpha48, alpha96);

  if (result.applied) {
    const afterScore = Math.abs(computeSpatialCorrelation(result.imageData, alpha48, result.position));
    assert.ok(afterScore < beforeScore, `expected ${afterScore} to be less than ${beforeScore}`);
  } else {
    assert.equal(result.applied, false);
  }
});
