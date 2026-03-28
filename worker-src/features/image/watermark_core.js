import {
  calculateWatermarkPosition,
  detectWatermarkConfig,
  getGeminiAlphaMap,
  resolveGeminiWatermarkSearchConfigs,
} from './watermark_templates.js';

const WATERMARK_METHOD = 'gemini_template_unblend';
const LOGO_VALUE = 255;
const DETECTION_THRESHOLD = 0.18;
const LOW_CONFIDENCE_THRESHOLD = 0.1;
const ALPHA_GAIN_CANDIDATES = [1, 1.12, 1.24, 1.36, 1.48];
const SEARCH_SHIFTS = [-8, -4, 0, 4, 8];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function createEmptyWatermarkMeta(overrides = {}) {
  return {
    status: 'skipped',
    reason: 'not_detected',
    method: WATERMARK_METHOD,
    confidence: 0,
    ...overrides,
  };
}

function cloneImageDataLike(imageData) {
  if (typeof ImageData !== 'undefined' && imageData instanceof ImageData) {
    return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  }
  return {
    width: imageData.width,
    height: imageData.height,
    data: new Uint8ClampedArray(imageData.data),
  };
}

function toGrayscale(imageData) {
  const gray = new Float32Array(imageData.width * imageData.height);
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    gray[index] = (
      imageData.data[offset] * 0.2126 +
      imageData.data[offset + 1] * 0.7152 +
      imageData.data[offset + 2] * 0.0722
    ) / 255;
  }
  return gray;
}

function getRegion(data, width, x, y, size) {
  const output = new Float32Array(size * size);
  for (let row = 0; row < size; row += 1) {
    const sourceBase = (y + row) * width + x;
    const targetBase = row * size;
    for (let col = 0; col < size; col += 1) {
      output[targetBase + col] = data[sourceBase + col];
    }
  }
  return output;
}

function meanAndVariance(values) {
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index];
  }
  const mean = sum / values.length;
  let squareSum = 0;
  for (let index = 0; index < values.length; index += 1) {
    const delta = values[index] - mean;
    squareSum += delta * delta;
  }
  return {
    mean,
    variance: squareSum / values.length,
  };
}

function normalizedCrossCorrelation(left, right) {
  if (left.length !== right.length || left.length === 0) return 0;
  const leftStats = meanAndVariance(left);
  const rightStats = meanAndVariance(right);
  const denominator = Math.sqrt(leftStats.variance * rightStats.variance) * left.length;
  if (!Number.isFinite(denominator) || denominator < 1e-8) {
    return 0;
  }
  let numerator = 0;
  for (let index = 0; index < left.length; index += 1) {
    numerator += (left[index] - leftStats.mean) * (right[index] - rightStats.mean);
  }
  return numerator / denominator;
}

function sobelMagnitude(gray, width, height) {
  const output = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const gx = (
        -gray[index - width - 1] -
        2 * gray[index - 1] -
        gray[index + width - 1] +
        gray[index - width + 1] +
        2 * gray[index + 1] +
        gray[index + width + 1]
      );
      const gy = (
        -gray[index - width - 1] -
        2 * gray[index - width] -
        gray[index - width + 1] +
        gray[index + width - 1] +
        2 * gray[index + width] +
        gray[index + width + 1]
      );
      output[index] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return output;
}

function computeNearBlackRatio(imageData, position) {
  let nearBlack = 0;
  let total = 0;
  for (let row = 0; row < position.height; row += 1) {
    for (let col = 0; col < position.width; col += 1) {
      const offset = ((position.y + row) * imageData.width + (position.x + col)) * 4;
      if (
        imageData.data[offset] <= 5 &&
        imageData.data[offset + 1] <= 5 &&
        imageData.data[offset + 2] <= 5
      ) {
        nearBlack += 1;
      }
      total += 1;
    }
  }
  return total > 0 ? nearBlack / total : 0;
}

function buildCandidatePatches(gray, width, position) {
  const patch = getRegion(gray, width, position.x, position.y, position.width);
  const referenceTop = position.y >= position.height
    ? getRegion(gray, width, position.x, position.y - position.height, position.width)
    : null;
  return {
    patch,
    referenceTop,
  };
}

function computeCandidateScores(imageData, alphaMap, position, cache = null) {
  const gray = cache?.gray || toGrayscale(imageData);
  const gradient = cache?.gradient || sobelMagnitude(gray, imageData.width, imageData.height);
  const patches = buildCandidatePatches(gray, imageData.width, position);
  const patchGradient = sobelMagnitude(patches.patch, position.width, position.height);
  const alphaGradient = sobelMagnitude(alphaMap, position.width, position.height);

  const rawSpatial = normalizedCrossCorrelation(patches.patch, alphaMap);
  const referenceSpatial = patches.referenceTop
    ? normalizedCrossCorrelation(
      new Float32Array(patches.patch.map((value, index) => value - patches.referenceTop[index])),
      alphaMap,
    )
    : 0;
  const spatialScore = Math.max(rawSpatial, referenceSpatial);
  const gradientScore = normalizedCrossCorrelation(patchGradient, alphaGradient);
  const confidence = Math.max(0, spatialScore) * 0.72 + Math.max(0, gradientScore) * 0.28;

  const regionGradient = getRegion(gradient, imageData.width, position.x, position.y, position.width);
  const gradientEnergy = meanAndVariance(regionGradient).variance;

  return {
    spatialScore,
    gradientScore,
    confidence,
    gradientEnergy,
    cache: cache || { gray, gradient },
  };
}

function removeWatermarkPixels(imageData, alphaMap, position, alphaGain) {
  const output = cloneImageDataLike(imageData);
  const gain = Number.isFinite(alphaGain) && alphaGain > 0 ? alphaGain : 1;
  for (let row = 0; row < position.height; row += 1) {
    for (let col = 0; col < position.width; col += 1) {
      const alphaIndex = row * position.width + col;
      const rawAlpha = alphaMap[alphaIndex] * gain;
      if (rawAlpha <= 0.003) continue;
      const alpha = Math.min(rawAlpha, 0.99);
      const offset = ((position.y + row) * output.width + (position.x + col)) * 4;
      const oneMinusAlpha = 1 - alpha;
      for (let channel = 0; channel < 3; channel += 1) {
        const watermarked = output.data[offset + channel];
        const original = (watermarked - alpha * LOGO_VALUE) / oneMinusAlpha;
        output.data[offset + channel] = clamp(Math.round(original), 0, 255);
      }
    }
  }
  return output;
}

function buildCandidatePosition(imageWidth, imageHeight, config, dx = 0, dy = 0) {
  const base = calculateWatermarkPosition(imageWidth, imageHeight, config);
  const position = {
    x: base.x + dx,
    y: base.y + dy,
    width: base.width,
    height: base.height,
  };
  if (position.x < 0 || position.y < 0) return null;
  if (position.x + position.width > imageWidth || position.y + position.height > imageHeight) return null;
  return position;
}

function evaluateDetectionCandidate(imageData, config, dx, dy, cache) {
  const position = buildCandidatePosition(imageData.width, imageData.height, config, dx, dy);
  if (!position) return null;
  const alphaMap = getGeminiAlphaMap(position.width);
  const scores = computeCandidateScores(imageData, alphaMap, position, cache);
  return {
    config,
    position,
    alphaMap,
    ...scores,
  };
}

function detectWatermarkCandidate(imageData) {
  const baseConfig = detectWatermarkConfig(imageData.width, imageData.height);
  const searchConfigs = resolveGeminiWatermarkSearchConfigs(imageData.width, imageData.height, baseConfig);
  const gray = toGrayscale(imageData);
  const gradient = sobelMagnitude(gray, imageData.width, imageData.height);
  const cache = { gray, gradient };
  let best = null;

  for (const config of searchConfigs) {
    for (const dx of SEARCH_SHIFTS) {
      for (const dy of SEARCH_SHIFTS) {
        const candidate = evaluateDetectionCandidate(imageData, config, dx, dy, cache);
        if (!candidate) continue;
        if (!best || candidate.confidence > best.confidence) {
          best = candidate;
        }
      }
    }
  }

  if (!best) {
    return {
      detected: false,
      reason: 'not_detected',
      confidence: 0,
      config: baseConfig,
    };
  }

  const detected = (
    best.confidence >= DETECTION_THRESHOLD &&
    best.spatialScore >= 0.08 &&
    best.gradientScore >= 0.01 &&
    best.gradientEnergy >= 0.0004
  );
  const reason = detected
    ? null
    : best.confidence >= LOW_CONFIDENCE_THRESHOLD
      ? 'low_confidence'
      : 'not_detected';

  return {
    detected,
    reason,
    ...best,
  };
}

function evaluateRemovalCandidate(originalImageData, detection, alphaGain) {
  const processedImageData = removeWatermarkPixels(
    originalImageData,
    detection.alphaMap,
    detection.position,
    alphaGain,
  );
  const processedScores = computeCandidateScores(
    processedImageData,
    detection.alphaMap,
    detection.position,
  );
  const nearBlackIncrease = computeNearBlackRatio(processedImageData, detection.position)
    - computeNearBlackRatio(originalImageData, detection.position);
  const improvement = detection.spatialScore - processedScores.spatialScore;
  return {
    processedImageData,
    processedScores,
    alphaGain,
    nearBlackIncrease,
    improvement,
    accepted: (
      improvement >= 0.035 &&
      processedScores.spatialScore <= detection.spatialScore - 0.03 &&
      nearBlackIncrease <= 0.05
    ),
    cost: (
      Math.max(processedScores.spatialScore, 0) +
      Math.max(processedScores.gradientScore, 0) * 0.25 +
      Math.max(nearBlackIncrease, 0) * 2
    ),
  };
}

function pickBestRemovalCandidate(originalImageData, detection) {
  let best = null;
  for (const alphaGain of ALPHA_GAIN_CANDIDATES) {
    const candidate = evaluateRemovalCandidate(originalImageData, detection, alphaGain);
    if (!candidate.accepted) continue;
    if (!best || candidate.cost < best.cost) {
      best = candidate;
    }
  }
  return best;
}

export function processWatermarkImageData(imageData) {
  const originalImageData = cloneImageDataLike(imageData);
  const detection = detectWatermarkCandidate(originalImageData);
  if (!detection.detected) {
    return {
      imageData: originalImageData,
      watermark: createEmptyWatermarkMeta({
        status: 'skipped',
        reason: detection.reason || 'not_detected',
        confidence: detection.confidence || 0,
      }),
    };
  }

  const bestRemoval = pickBestRemovalCandidate(originalImageData, detection);
  if (!bestRemoval) {
    return {
      imageData: originalImageData,
      watermark: createEmptyWatermarkMeta({
        status: 'fallback_original',
        reason: 'low_confidence',
        confidence: detection.confidence,
        size: detection.position.width,
        position: detection.position,
      }),
    };
  }

  return {
    imageData: bestRemoval.processedImageData,
    watermark: {
      status: 'removed',
      reason: null,
      method: WATERMARK_METHOD,
      confidence: detection.confidence,
      size: detection.position.width,
      position: detection.position,
      originalSpatialScore: detection.spatialScore,
      originalGradientScore: detection.gradientScore,
      processedSpatialScore: bestRemoval.processedScores.spatialScore,
      processedGradientScore: bestRemoval.processedScores.gradientScore,
      alphaGain: bestRemoval.alphaGain,
    },
  };
}
