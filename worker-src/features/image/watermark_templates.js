const WATERMARK_CONFIG_BY_TIER = Object.freeze({
  '0.5k': Object.freeze({ logoSize: 48, marginRight: 32, marginBottom: 32 }),
  '1k': Object.freeze({ logoSize: 96, marginRight: 64, marginBottom: 64 }),
  '2k': Object.freeze({ logoSize: 96, marginRight: 64, marginBottom: 64 }),
  '4k': Object.freeze({ logoSize: 96, marginRight: 64, marginBottom: 64 }),
});

function createEntries(modelFamily, resolutionTier, rows) {
  return rows.map(([aspectRatio, width, height]) => ({
    modelFamily,
    resolutionTier,
    aspectRatio,
    width,
    height,
  }));
}

const OFFICIAL_GEMINI_IMAGE_SIZES = Object.freeze([
  ...createEntries('gemini-3.x-image', '0.5k', [
    ['1:1', 512, 512],
    ['1:4', 256, 1024],
    ['1:8', 192, 1536],
    ['2:3', 424, 632],
    ['3:2', 632, 424],
    ['3:4', 448, 600],
    ['4:1', 1024, 256],
    ['4:3', 600, 448],
    ['4:5', 464, 576],
    ['5:4', 576, 464],
    ['8:1', 1536, 192],
    ['9:16', 384, 688],
    ['16:9', 688, 384],
    ['21:9', 792, 168],
  ]),
  ...createEntries('gemini-3.x-image', '1k', [
    ['1:1', 1024, 1024],
    ['2:3', 848, 1264],
    ['3:2', 1264, 848],
    ['3:4', 896, 1200],
    ['4:3', 1200, 896],
    ['4:5', 928, 1152],
    ['5:4', 1152, 928],
    ['9:16', 768, 1376],
    ['16:9', 1376, 768],
    ['21:9', 1584, 672],
  ]),
  ...createEntries('gemini-3.x-image', '2k', [
    ['1:1', 2048, 2048],
    ['1:4', 512, 2048],
    ['1:8', 384, 3072],
    ['2:3', 1696, 2528],
    ['3:2', 2528, 1696],
    ['3:4', 1792, 2400],
    ['4:1', 2048, 512],
    ['4:3', 2400, 1792],
    ['4:5', 1856, 2304],
    ['5:4', 2304, 1856],
    ['8:1', 3072, 384],
    ['9:16', 1536, 2752],
    ['16:9', 2752, 1536],
    ['21:9', 3168, 1344],
  ]),
  ...createEntries('gemini-3.x-image', '4k', [
    ['1:1', 4096, 4096],
    ['1:4', 2048, 8192],
    ['1:8', 1536, 12288],
    ['2:3', 3392, 5056],
    ['3:2', 5056, 3392],
    ['3:4', 3584, 4800],
    ['4:1', 8192, 2048],
    ['4:3', 4800, 3584],
    ['4:5', 3712, 4608],
    ['5:4', 4608, 3712],
    ['8:1', 12288, 1536],
    ['9:16', 3072, 5504],
    ['16:9', 5504, 3072],
    ['21:9', 6336, 2688],
  ]),
  ...createEntries('gemini-2.5-flash-image', '1k', [
    ['1:1', 1024, 1024],
    ['2:3', 832, 1248],
    ['3:2', 1248, 832],
    ['3:4', 864, 1184],
    ['4:3', 1184, 864],
    ['4:5', 896, 1152],
    ['5:4', 1152, 896],
    ['9:16', 768, 1344],
    ['16:9', 1344, 768],
    ['21:9', 1536, 672],
  ]),
]);

const OFFICIAL_GEMINI_IMAGE_SIZE_INDEX = new Map(
  OFFICIAL_GEMINI_IMAGE_SIZES.map((entry) => [`${entry.width}x${entry.height}`, entry]),
);

function normalizeDimension(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.round(numeric);
  return rounded > 0 ? rounded : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildConfigKey(config) {
  return `${config.logoSize}:${config.marginRight}:${config.marginBottom}`;
}

function getConfigForEntry(entry) {
  return WATERMARK_CONFIG_BY_TIER[entry.resolutionTier] || null;
}

export function resolveOfficialGeminiWatermarkConfig(width, height) {
  const normalizedWidth = normalizeDimension(width);
  const normalizedHeight = normalizeDimension(height);
  if (!normalizedWidth || !normalizedHeight) return null;
  const entry = OFFICIAL_GEMINI_IMAGE_SIZE_INDEX.get(`${normalizedWidth}x${normalizedHeight}`);
  if (!entry) return null;
  const config = getConfigForEntry(entry);
  return config ? { ...config } : null;
}

export function detectWatermarkConfig(imageWidth, imageHeight) {
  return (
    resolveOfficialGeminiWatermarkConfig(imageWidth, imageHeight) ||
    (imageWidth > 1024 && imageHeight > 1024
      ? { logoSize: 96, marginRight: 64, marginBottom: 64 }
      : { logoSize: 48, marginRight: 32, marginBottom: 32 })
  );
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

function createSearchCandidate(config, width, height) {
  const position = calculateWatermarkPosition(width, height, config);
  if (position.x < 0 || position.y < 0) return null;
  if (position.x + position.width > width || position.y + position.height > height) return null;
  return config;
}

function buildOfficialSearchConfigs(width, height, defaultConfig) {
  const normalizedWidth = normalizeDimension(width);
  const normalizedHeight = normalizeDimension(height);
  if (!normalizedWidth || !normalizedHeight) return defaultConfig ? [defaultConfig] : [];

  const targetAspectRatio = normalizedWidth / normalizedHeight;
  const candidates = [];
  for (const entry of OFFICIAL_GEMINI_IMAGE_SIZES) {
    const baseConfig = getConfigForEntry(entry);
    if (!baseConfig) continue;
    const scaleX = normalizedWidth / entry.width;
    const scaleY = normalizedHeight / entry.height;
    const scale = (scaleX + scaleY) / 2;
    const aspectRatioDelta = Math.abs(targetAspectRatio - entry.width / entry.height) / (entry.width / entry.height);
    const scaleMismatch = Math.abs(scaleX - scaleY) / Math.max(scaleX, scaleY);
    if (aspectRatioDelta > 0.03 || scaleMismatch > 0.16) continue;

    const config = {
      logoSize: clamp(Math.round(baseConfig.logoSize * scale), 40, 128),
      marginRight: Math.max(16, Math.round(baseConfig.marginRight * scaleX)),
      marginBottom: Math.max(16, Math.round(baseConfig.marginBottom * scaleY)),
    };
    if (!createSearchCandidate(config, normalizedWidth, normalizedHeight)) continue;
    candidates.push({
      config,
      score: aspectRatioDelta * 100 + scaleMismatch * 30 + Math.abs(Math.log2(Math.max(scale, 1e-6))),
    });
  }

  const deduped = [];
  const seen = new Set();
  const sourceConfigs = defaultConfig ? [{ config: defaultConfig, score: -1 }, ...candidates] : candidates;
  for (const candidate of sourceConfigs.sort((left, right) => left.score - right.score)) {
    const key = buildConfigKey(candidate.config);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate.config);
    if (deduped.length >= 4) break;
  }

  const alternateConfig = defaultConfig && defaultConfig.logoSize === 96
    ? { logoSize: 48, marginRight: 32, marginBottom: 32 }
    : { logoSize: 96, marginRight: 64, marginBottom: 64 };
  if (createSearchCandidate(alternateConfig, normalizedWidth, normalizedHeight)) {
    const key = buildConfigKey(alternateConfig);
    if (!seen.has(key)) {
      deduped.push(alternateConfig);
    }
  }

  return deduped;
}

export function resolveGeminiWatermarkSearchConfigs(width, height, defaultConfig) {
  return buildOfficialSearchConfigs(width, height, defaultConfig).filter((config) =>
    Boolean(createSearchCandidate(config, width, height)),
  );
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function rotate(dx, dy, radians) {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
  };
}

function geminiSparkleAlpha(dx, dy) {
  const rotated = rotate(dx, dy, Math.PI / 4);
  const ux = Math.abs(rotated.x);
  const uy = Math.abs(rotated.y);
  const primary = ux + uy * 0.54;
  const secondary = ux * 0.54 + uy;
  const primaryShape = smoothstep(0.66, 0.48, primary);
  const secondaryShape = smoothstep(0.66, 0.52, secondary) * 0.85;
  const center = smoothstep(0.25, 0.14, Math.hypot(rotated.x, rotated.y)) * 0.18;
  return Math.min(0.42, Math.max(primaryShape, secondaryShape) * 0.34 + center);
}

const alphaMapCache = new Map();

export function getGeminiAlphaMap(size) {
  const normalizedSize = normalizeDimension(size);
  if (!normalizedSize) {
    throw new Error('invalid_alpha_map_size');
  }
  if (alphaMapCache.has(normalizedSize)) {
    return new Float32Array(alphaMapCache.get(normalizedSize));
  }

  const output = new Float32Array(normalizedSize * normalizedSize);
  const center = (normalizedSize - 1) / 2;
  const scale = normalizedSize * 0.5;
  for (let y = 0; y < normalizedSize; y += 1) {
    for (let x = 0; x < normalizedSize; x += 1) {
      const dx = (x - center) / scale;
      const dy = (y - center) / scale;
      output[y * normalizedSize + x] = geminiSparkleAlpha(dx, dy);
    }
  }

  alphaMapCache.set(normalizedSize, output);
  return new Float32Array(output);
}
