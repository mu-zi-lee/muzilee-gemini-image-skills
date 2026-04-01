import { getEmbeddedAlphaMap } from './embedded_alpha_maps.js';

export const ALPHA_NOISE_FLOOR = 0.02;
export const ALPHA_THRESHOLD = 0.03;
export const MAX_ALPHA = 0.98;
export const LOGO_VALUE = 255;

const OFFICIAL_WATERMARK_SIZES = {
  '512x512': { logoSize: 48, marginRight: 32, marginBottom: 32 },
  '1024x1024': { logoSize: 96, marginRight: 64, marginBottom: 64 },
};

const MAX_WATERMARK_PASSES = 4;
const TARGET_CORRELATION = 0.25;
const MIN_CORRELATION_IMPROVEMENT = 0.02;
const COARSE_SEARCH_STEP = 4;
const FINE_SEARCH_STEP = 1;
const MIN_DETECTION_SCORE = 0.08;
const MIN_DETECTION_GAP = 0.005;

function loadImageFromDataUrl(imageDataUrl) {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') {
      reject(new Error('image_constructor_unavailable'));
      return;
    }

    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image_load_failed'));
    image.src = imageDataUrl;
  });
}

export function cloneImageData(imageData) {
  if (typeof ImageData !== 'undefined' && imageData instanceof ImageData) {
    return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  }
  return {
    width: imageData.width,
    height: imageData.height,
    data: new Uint8ClampedArray(imageData.data),
  };
}

export function interpolateAlphaMap(sourceAlpha, sourceSize, targetSize) {
  if (targetSize <= 0) {
    return new Float32Array(0);
  }
  if (sourceSize === targetSize) {
    return new Float32Array(sourceAlpha);
  }

  const out = new Float32Array(targetSize * targetSize);
  const scale = (sourceSize - 1) / Math.max(1, targetSize - 1);

  for (let y = 0; y < targetSize; y += 1) {
    const sy = y * scale;
    const y0 = Math.floor(sy);
    const y1 = Math.min(sourceSize - 1, y0 + 1);
    const fy = sy - y0;

    for (let x = 0; x < targetSize; x += 1) {
      const sx = x * scale;
      const x0 = Math.floor(sx);
      const x1 = Math.min(sourceSize - 1, x0 + 1);
      const fx = sx - x0;

      const p00 = sourceAlpha[y0 * sourceSize + x0];
      const p10 = sourceAlpha[y0 * sourceSize + x1];
      const p01 = sourceAlpha[y1 * sourceSize + x0];
      const p11 = sourceAlpha[y1 * sourceSize + x1];
      const top = p00 + (p10 - p00) * fx;
      const bottom = p01 + (p11 - p01) * fx;

      out[y * targetSize + x] = top + (bottom - top) * fy;
    }
  }

  return out;
}

export function detectWatermarkConfig(imageWidth, imageHeight) {
  const key = `${imageWidth}x${imageHeight}`;
  if (OFFICIAL_WATERMARK_SIZES[key]) {
    return { ...OFFICIAL_WATERMARK_SIZES[key] };
  }

  if (imageWidth > 1024 && imageHeight > 1024) {
    return { logoSize: 96, marginRight: 64, marginBottom: 64 };
  }

  return { logoSize: 48, marginRight: 32, marginBottom: 32 };
}

export function generateCandidateWatermarkConfigs(imageWidth, imageHeight) {
  const minSide = Math.min(imageWidth, imageHeight);
  const exact = detectWatermarkConfig(imageWidth, imageHeight);
  const configs = [];
  const seen = new Set();

  function addConfig(config) {
    const key = `${config.logoSize}:${config.marginRight}:${config.marginBottom}`;
    if (seen.has(key)) {
      return;
    }
    if (
      config.logoSize <= 0
      || config.logoSize >= imageWidth
      || config.logoSize >= imageHeight
      || config.marginRight < 0
      || config.marginBottom < 0
    ) {
      return;
    }
    seen.add(key);
    configs.push(config);
  }

  addConfig(exact);

  const inferred48 = Math.round(minSide * 0.086);
  const inferred96 = Math.round(minSide * 0.172);
  const inferredWide = Math.round(minSide * 0.11);
  const inferredTall = Math.round(minSide * 0.135);
  [40, 44, 48, 52, 56, 60, inferred48, inferredWide, inferredTall, 72, 84, 96, inferred96]
    .filter((size) => size >= 24)
    .forEach((logoSize) => {
      const marginBase = Math.max(8, Math.round(logoSize * 2 / 3));
      [marginBase - 16, marginBase - 8, marginBase, marginBase + 8, marginBase + 16].forEach((marginRight) => {
        [marginBase - 24, marginBase - 16, marginBase - 8, marginBase, marginBase + 8].forEach((marginBottom) => {
          addConfig({
            logoSize,
            marginRight: Math.max(4, marginRight),
            marginBottom: Math.max(4, marginBottom),
          });
        });
      });
    });

  return configs;
}

export function calculateWatermarkPosition(imageWidth, imageHeight, config) {
  const { logoSize, marginRight, marginBottom } = config;
  return {
    x: imageWidth - marginRight - logoSize,
    y: imageHeight - marginBottom - logoSize,
    width: logoSize,
    height: logoSize,
  };
}

export function removeWatermark(imageData, alphaMap, position, options = {}) {
  const { x, y, width, height } = position;
  const alphaGain = Number.isFinite(options.alphaGain) && options.alphaGain > 0
    ? options.alphaGain
    : 1;

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const imgIdx = ((y + row) * imageData.width + (x + col)) * 4;
      const alphaIdx = row * width + col;
      const rawAlpha = alphaMap[alphaIdx];
      const signalAlpha = Math.max(0, rawAlpha - ALPHA_NOISE_FLOOR) * alphaGain;

      if (signalAlpha < ALPHA_THRESHOLD) {
        continue;
      }

      const alpha = Math.min(rawAlpha * alphaGain, MAX_ALPHA);
      const oneMinusAlpha = 1 - alpha;

      if (oneMinusAlpha <= 1e-6) {
        continue;
      }

      for (let channel = 0; channel < 3; channel += 1) {
        const watermarked = imageData.data[imgIdx + channel];
        const original = (watermarked - alpha * LOGO_VALUE) / oneMinusAlpha;
        imageData.data[imgIdx + channel] = Math.max(0, Math.min(255, Math.round(original)));
      }
    }
  }
}

export function computeSpatialCorrelation(imageData, alphaMap, position) {
  const size = position.width;
  const patch = new Float32Array(size * size);

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const idx = ((position.y + row) * imageData.width + (position.x + col)) * 4;
      patch[row * size + col] = (
        0.2126 * imageData.data[idx]
        + 0.7152 * imageData.data[idx + 1]
        + 0.0722 * imageData.data[idx + 2]
      ) / 255;
    }
  }

  let sumA = 0;
  let sumB = 0;
  let sqA = 0;
  let sqB = 0;
  let cross = 0;
  const n = patch.length;

  for (let i = 0; i < n; i += 1) {
    sumA += patch[i];
    sumB += alphaMap[i];
  }

  const meanA = sumA / n;
  const meanB = sumB / n;

  for (let i = 0; i < n; i += 1) {
    const da = patch[i] - meanA;
    const db = alphaMap[i] - meanB;
    sqA += da * da;
    sqB += db * db;
    cross += da * db;
  }

  const denom = Math.sqrt(sqA * sqB) * n;
  return denom < 1e-8 ? 0 : cross / denom;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function searchWatermarkPosition(imageData, alphaMap, basePosition, radius, step) {
  const maxX = imageData.width - basePosition.width;
  const maxY = imageData.height - basePosition.height;
  const minX = clamp(basePosition.x - radius, 0, maxX);
  const maxSearchX = clamp(basePosition.x + radius, 0, maxX);
  const minY = clamp(basePosition.y - radius, 0, maxY);
  const maxSearchY = clamp(basePosition.y + radius, 0, maxY);

  let bestPosition = basePosition;
  let bestScore = Math.abs(computeSpatialCorrelation(imageData, alphaMap, basePosition));

  for (let y = minY; y <= maxSearchY; y += step) {
    for (let x = minX; x <= maxSearchX; x += step) {
      const position = { x, y, width: basePosition.width, height: basePosition.height };
      const score = Math.abs(computeSpatialCorrelation(imageData, alphaMap, position));
      if (score > bestScore) {
        bestScore = score;
        bestPosition = position;
      }
    }
  }

  return { position: bestPosition, score: bestScore };
}

export function refineWatermarkPosition(imageData, alphaMap, basePosition) {
  const dynamicRadius = Math.max(
    12,
    Math.min(
      Math.round(Math.min(imageData.width, imageData.height) * 0.08),
      Math.round(basePosition.width * 1.5),
    ),
  );
  const coarse = searchWatermarkPosition(
    imageData,
    alphaMap,
    basePosition,
    dynamicRadius,
    COARSE_SEARCH_STEP,
  );
  const fine = searchWatermarkPosition(
    imageData,
    alphaMap,
    coarse.position,
    COARSE_SEARCH_STEP,
    FINE_SEARCH_STEP,
  );

  return {
    position: fine.position,
    score: fine.score,
  };
}

function getAlphaMapForSize(logoSize, alpha48, alpha96) {
  if (logoSize === 48) {
    return alpha48;
  }
  if (logoSize === 96) {
    return alpha96;
  }
  return interpolateAlphaMap(alpha96, 96, logoSize);
}

export function detectBestWatermarkMatch(imageData, alpha48, alpha96) {
  const candidates = generateCandidateWatermarkConfigs(imageData.width, imageData.height);
  let bestMatch = null;
  let secondBestScore = 0;

  for (const config of candidates) {
    const alphaMap = getAlphaMapForSize(config.logoSize, alpha48, alpha96);
    const basePosition = calculateWatermarkPosition(imageData.width, imageData.height, config);

    if (
      basePosition.x < 0
      || basePosition.y < 0
      || basePosition.x + basePosition.width > imageData.width
      || basePosition.y + basePosition.height > imageData.height
    ) {
      continue;
    }

    const refined = refineWatermarkPosition(imageData, alphaMap, basePosition);
    const score = refined.score;

    if (!bestMatch || score > bestMatch.score) {
      if (bestMatch) {
        secondBestScore = bestMatch.score;
      }
      bestMatch = {
        score,
        position: refined.position,
        config,
        alphaMap,
      };
    } else if (score > secondBestScore) {
      secondBestScore = score;
    }
  }

  if (!bestMatch) {
    return null;
  }

  if (bestMatch.score < MIN_DETECTION_SCORE) {
    return null;
  }

  if (bestMatch.score - secondBestScore < MIN_DETECTION_GAP) {
    return null;
  }

  return bestMatch;
}

export function processWatermarkImageData(imageData, alpha48, alpha96) {
  if (!alpha48 || !alpha96) {
    throw new Error('missing_alpha_maps');
  }

  const originalData = cloneImageData(imageData);
  const match = detectBestWatermarkMatch(originalData, alpha48, alpha96);
  if (!match) {
    return { imageData: originalData, applied: false };
  }

  const { position, config, alphaMap } = match;

  let currentData = cloneImageData(imageData);

  for (let pass = 0; pass < MAX_WATERMARK_PASSES; pass += 1) {
    const beforeScore = Math.abs(computeSpatialCorrelation(currentData, alphaMap, position));
    const candidate = cloneImageData(currentData);
    removeWatermark(candidate, alphaMap, position);
    const afterScore = Math.abs(computeSpatialCorrelation(candidate, alphaMap, position));

    currentData = candidate;

    if (afterScore <= TARGET_CORRELATION) {
      break;
    }
    if (beforeScore - afterScore < MIN_CORRELATION_IMPROVEMENT) {
      break;
    }
  }

  return {
    imageData: currentData,
    applied: true,
    position,
    config,
  };
}

export async function removeWatermarkFromImageElement(image, options = {}) {
  const originalImageDataUrl = options.originalImageDataUrl || '';

  if (typeof document === 'undefined' || !image) {
    return {
      image_data_url: originalImageDataUrl,
      watermark_removed: false,
    };
  }

  try {
    const width = image.naturalWidth || image.width || 0;
    const height = image.naturalHeight || image.height || 0;
    if (!width || !height) {
      return {
        image_data_url: originalImageDataUrl,
        watermark_removed: false,
      };
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return {
        image_data_url: originalImageDataUrl,
        watermark_removed: false,
      };
    }

    ctx.drawImage(image, 0, 0);

    const processed = processWatermarkImageData(
      ctx.getImageData(0, 0, width, height),
      getEmbeddedAlphaMap(48),
      getEmbeddedAlphaMap(96),
    );

    if (!processed.applied) {
      return {
        image_data_url: originalImageDataUrl || canvas.toDataURL('image/png'),
        watermark_removed: false,
      };
    }

    ctx.putImageData(processed.imageData, 0, 0);

    return {
      image_data_url: canvas.toDataURL('image/png'),
      watermark_removed: true,
      watermark_position: processed.position,
      watermark_config: processed.config,
    };
  } catch (error) {
    return {
      image_data_url: originalImageDataUrl,
      watermark_removed: false,
      watermark_error: error?.message || String(error),
    };
  }
}

export async function removeWatermarkFromDataUrl(imageDataUrl) {
  if (!imageDataUrl) {
    return {
      image_data_url: imageDataUrl,
      watermark_removed: false,
    };
  }

  try {
    const image = await loadImageFromDataUrl(imageDataUrl);
    return removeWatermarkFromImageElement(image, { originalImageDataUrl: imageDataUrl });
  } catch (error) {
    return {
      image_data_url: imageDataUrl,
      watermark_removed: false,
      watermark_error: error?.message || String(error),
    };
  }
}
