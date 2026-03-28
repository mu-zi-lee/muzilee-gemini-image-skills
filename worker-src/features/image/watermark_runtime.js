import { processWatermarkImageData } from './watermark_core.js';

function getCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function get2dContext(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('canvas_context_unavailable');
  }
  return context;
}

function canvasToBlob(canvas, type = 'image/png') {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error('canvas_to_blob_failed'));
    }, type);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('file_reader_error'));
    reader.readAsDataURL(blob);
  });
}

function loadImageFromSource(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image_decode_failed'));
    image.src = source;
  });
}

function inferMimeTypeFromDataUrl(dataUrl, fallback = 'image/png') {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return fallback;
  const separatorIndex = dataUrl.indexOf(';');
  if (separatorIndex <= 5) return fallback;
  return dataUrl.slice(5, separatorIndex) || fallback;
}

export function dataUrlToBlob(dataUrl) {
  const parts = String(dataUrl).split(',', 2);
  if (parts.length !== 2) {
    throw new Error('invalid_data_url');
  }
  const header = parts[0];
  const body = parts[1];
  const mimeType = inferMimeTypeFromDataUrl(dataUrl);
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

export async function processWatermarkDataUrl(dataUrl) {
  const image = await loadImageFromSource(dataUrl);
  const canvas = getCanvas(image.naturalWidth || image.width, image.naturalHeight || image.height);
  const context = get2dContext(canvas);
  context.drawImage(image, 0, 0);
  const originalImageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const result = processWatermarkImageData(originalImageData);

  if (result.watermark.status !== 'removed') {
    return {
      imageDataUrl: dataUrl,
      mimeType: inferMimeTypeFromDataUrl(dataUrl),
      watermark: result.watermark,
    };
  }

  context.putImageData(result.imageData, 0, 0);
  const processedBlob = await canvasToBlob(canvas, 'image/png');
  return {
    imageDataUrl: await blobToDataUrl(processedBlob),
    processedBlob,
    mimeType: 'image/png',
    watermark: result.watermark,
  };
}

export async function processWatermarkBlob(blob) {
  const dataUrl = await blobToDataUrl(blob);
  const result = await processWatermarkDataUrl(dataUrl);
  if (result.watermark.status !== 'removed') {
    return {
      processedBlob: blob,
      mimeType: blob.type || result.mimeType || 'image/png',
      watermark: result.watermark,
    };
  }
  return {
    processedBlob: result.processedBlob,
    mimeType: result.mimeType,
    watermark: result.watermark,
  };
}
