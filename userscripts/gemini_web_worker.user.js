// ==UserScript==
// @name         Muzilee Gemini Web Worker
// @namespace    https://muzilee.local
// @version      0.1.0
// @description  Modular Gemini page worker for the local Muzilee Gemini Skill daemon.
// @match        https://gemini.google.com/*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      googleusercontent.com
// @connect      *.googleusercontent.com
// ==/UserScript==

(() => {
  'use strict';

  const WORKER_PROTOCOL_CATALOG = {
  "service_name": "muzilee-gemini-image-skills",
  "task_types": [
    "send_message",
    "generate_image",
    "new_chat",
    "switch_model",
    "upload_reference_images",
    "download_latest_image"
  ],
  "output_modes": [
    "preview",
    "full_size",
    "auto"
  ],
  "models": {
    "canonical": [
      "pro",
      "quick",
      "think"
    ],
    "default_for_task": {
      "generate_image": "pro"
    },
    "aliases": {
      "pro": [
        "pro"
      ],
      "quick": [
        "quick",
        "fast",
        "flash"
      ],
      "think": [
        "think",
        "thinking"
      ]
    }
  },
  "capabilities": {
    "tasks": {
      "send_message": "task:send_message",
      "generate_image": "task:generate_image",
      "new_chat": "task:new_chat",
      "switch_model": "task:switch_model",
      "upload_reference_images": "task:upload_reference_images",
      "download_latest_image": "task:download_latest_image"
    },
    "features": {
      "new_chat": "feature:new_chat",
      "switch_model": "feature:switch_model",
      "upload_reference_images": "feature:upload_reference_images",
      "download_full_size": "feature:download_full_size"
    }
  }
};

// worker-src/bridge/download_capture.js
function buildPageBridgeScriptSource() {
  return `
      (() => {
        if (window.__MUZILEE_PAGE_BRIDGE_INSTALLED__) return;
        window.__MUZILEE_PAGE_BRIDGE_INSTALLED__ = true;

        let captureArmed = false;
        let blockNextAnchorClick = false;
        const originalCreateObjectURL = URL.createObjectURL.bind(URL);
        const originalAnchorClick = HTMLAnchorElement.prototype.click;
        const originalWindowOpen = typeof window.open === 'function' ? window.open.bind(window) : null;

        function post(payload) {
          window.postMessage({ source: 'muzilee-page-bridge', ...payload }, '*');
        }

        function isLikelyDownloadHref(href) {
          if (!href || typeof href !== 'string') return false;
          if (href.startsWith('blob:') || href.startsWith('data:image/')) return true;
          try {
            const parsed = new URL(href, window.location.href);
            return (
              parsed.hostname === 'googleusercontent.com' ||
              parsed.hostname.endsWith('.googleusercontent.com')
            );
          } catch (_) {
            return false;
          }
        }

        async function emitBlob(blob, filename) {
          if (!blob || !(blob.type || '').startsWith('image/')) return;
          const reader = new FileReader();
          reader.onloadend = () => {
            post({
              type: 'download-captured',
              payload: {
                image_data_url: reader.result,
                filename: filename || '',
                mime_type: blob.type || 'image/png'
              }
            });
          };
          reader.onerror = () => {
            post({ type: 'download-error', payload: { error: 'bridge_file_reader_error' } });
          };
          reader.readAsDataURL(blob);
        }

        async function captureHref(href, filename) {
          if (!href) {
            captureArmed = false;
            post({ type: 'download-error', payload: { error: 'download_href_missing' } });
            return;
          }

          if (href.startsWith('data:image/')) {
            captureArmed = false;
            post({
              type: 'download-captured',
              payload: {
                image_data_url: href,
                filename,
                mime_type: href.slice(5, href.indexOf(';'))
              }
            });
            return;
          }

          if (href.startsWith('blob:')) {
            try {
              const response = await fetch(href);
              if (!response.ok) {
                throw new Error('download_fetch_failed:' + response.status);
              }
              const blob = await response.blob();
              captureArmed = false;
              emitBlob(blob, filename);
            } catch (error) {
              captureArmed = false;
              post({ type: 'download-error', payload: { error: error.message || String(error) } });
            }
            return;
          }

          captureArmed = false;
          post({ type: 'download-requested', payload: { href, filename } });
        }

        URL.createObjectURL = function(blob) {
          const url = originalCreateObjectURL(blob);
          if (captureArmed && blob && (blob.type || '').startsWith('image/')) {
            captureArmed = false;
            blockNextAnchorClick = true;
            emitBlob(blob, '');
          }
          return url;
        };

        HTMLAnchorElement.prototype.click = function(...args) {
          if (blockNextAnchorClick) {
            blockNextAnchorClick = false;
            return;
          }
          if (captureArmed) {
            const href = this.href || '';
            const filename = this.download || '';
            void captureHref(href, filename);
            return;
          }
          return originalAnchorClick.apply(this, args);
        };

        document.addEventListener('click', (event) => {
          if (!captureArmed) {
            return;
          }
          const target = event.target;
          const anchor = target && typeof target.closest === 'function'
            ? target.closest('a[href]')
            : null;
          if (!anchor) {
            return;
          }
          const href = anchor.href || '';
          const filename = anchor.download || '';
          if (!filename && !isLikelyDownloadHref(href)) {
            return;
          }
          event.preventDefault();
          event.stopImmediatePropagation();
          blockNextAnchorClick = false;
          void captureHref(href, filename);
        }, true);

        if (originalWindowOpen) {
          window.open = function(url, ...args) {
            if (captureArmed && typeof url === 'string' && isLikelyDownloadHref(url)) {
              void captureHref(url, '');
              return null;
            }
            return originalWindowOpen(url, ...args);
          };
        }

        window.addEventListener('message', (event) => {
          if (event.source !== window || !event.data || event.data.source !== 'muzilee-worker') return;
          if (event.data.type === 'arm-download-capture') {
            captureArmed = true;
            blockNextAnchorClick = false;
          } else if (event.data.type === 'clear-download-capture') {
            captureArmed = false;
            blockNextAnchorClick = false;
          }
        });
      })();
    `;
}

function getContentType(responseHeaders) {
  const match = String(responseHeaders || '').match(/^content-type:\s*([^\r\n;]+)/im);
  return match ? match[1].trim().toLowerCase() : '';
}

function blobToDataUrl(blob, fileReaderCtor = FileReader) {
  return new Promise((resolve, reject) => {
    const reader = new fileReaderCtor();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('bridge_file_reader_error'));
    reader.readAsDataURL(blob);
  });
}

function requestBlobViaUserscript(gmRequest, href, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (typeof gmRequest !== 'function') {
      reject(new Error('download_request_unavailable'));
      return;
    }

    gmRequest({
      method: 'GET',
      url: href,
      anonymous: false,
      responseType: 'arraybuffer',
      timeout: timeoutMs,
      onload: (response) => {
        const status = Number(response.status) || 0;
        if (status < 200 || status >= 300) {
          reject(new Error(`download_fetch_failed:${status || 'unknown'}`));
          return;
        }

        const mimeType = getContentType(response.responseHeaders) || 'image/png';
        const buffer = response.response;
        if (!(buffer instanceof ArrayBuffer)) {
          reject(new Error('download_response_invalid'));
          return;
        }

        resolve(new Blob([buffer], { type: mimeType }));
      },
      ontimeout: () => reject(new Error('download_fetch_timeout')),
      onerror: () => reject(new Error('download_fetch_error')),
    });
  });
}

function createDownloadCaptureController({
  windowObject = window,
  documentObject = document,
  gmRequest = globalThis.GM_xmlhttpRequest,
} = {}) {
  let bridgeInstallAttempted = false;
  let bridgeInstallSucceeded = false;
  let pendingDownloadCapture = null;

  function injectPageBridge() {
    if (bridgeInstallAttempted) {
      return bridgeInstallSucceeded;
    }
    bridgeInstallAttempted = true;

    if (documentObject.getElementById('__muzilee_page_bridge__')) {
      bridgeInstallSucceeded = true;
      return true;
    }

    const scriptSource = buildPageBridgeScriptSource();

    try {
      const script = documentObject.createElement('script');
      script.id = '__muzilee_page_bridge__';

      if (windowObject.trustedTypes && typeof windowObject.trustedTypes.createPolicy === 'function') {
        try {
          const policy = windowObject.trustedTypes.createPolicy('muzileeWorkerBridgePolicy', {
            createScript: (value) => value,
          });
          script.text = policy.createScript(scriptSource);
        } catch (error) {
          console.warn('[muzilee-worker] trustedTypes policy create failed', error);
          bridgeInstallSucceeded = false;
          return false;
        }
      } else {
        script.text = scriptSource;
      }

      documentObject.documentElement.appendChild(script);
      script.remove();
      bridgeInstallSucceeded = true;
      return true;
    } catch (error) {
      console.warn('[muzilee-worker] bridge inject failed', error);
      bridgeInstallSucceeded = false;
      return false;
    }
  }

  function armDownloadCapture(timeoutMs) {
    if (!injectPageBridge()) {
      throw new Error('download_capture_unavailable');
    }
    if (pendingDownloadCapture) {
      pendingDownloadCapture.reject(new Error('download_capture_replaced'));
      pendingDownloadCapture = null;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingDownloadCapture = null;
        windowObject.postMessage({ source: 'muzilee-worker', type: 'clear-download-capture' }, '*');
        reject(new Error('full_size_capture_timeout'));
      }, timeoutMs);

      pendingDownloadCapture = {
        timeoutMs,
        resolve: (payload) => {
          clearTimeout(timer);
          resolve(payload);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };

      windowObject.postMessage({ source: 'muzilee-worker', type: 'arm-download-capture' }, '*');
    });
  }

  async function handleRemoteDownload(payload) {
    if (!pendingDownloadCapture) {
      return;
    }

    const capture = pendingDownloadCapture;

    try {
      const blob = await requestBlobViaUserscript(
        gmRequest,
        String(payload?.href || ''),
        capture.timeoutMs,
      );
      const imageDataUrl = await blobToDataUrl(blob);
      if (pendingDownloadCapture !== capture) {
        return;
      }
      pendingDownloadCapture = null;
      capture.resolve({
        image_data_url: imageDataUrl,
        filename: String(payload?.filename || ''),
        mime_type: blob.type || 'image/png',
      });
    } catch (error) {
      if (pendingDownloadCapture !== capture) {
        return;
      }
      pendingDownloadCapture = null;
      capture.reject(new Error(error.message || String(error)));
    }
  }

  function handleMessage(event) {
    if (event.source !== windowObject || !event.data || event.data.source !== 'muzilee-page-bridge') {
      return;
    }
    if (!pendingDownloadCapture) {
      return;
    }
    if (event.data.type === 'download-captured') {
      const capture = pendingDownloadCapture;
      pendingDownloadCapture = null;
      capture.resolve(event.data.payload || {});
    } else if (event.data.type === 'download-requested') {
      void handleRemoteDownload(event.data.payload || {});
    } else if (event.data.type === 'download-error') {
      const capture = pendingDownloadCapture;
      pendingDownloadCapture = null;
      capture.reject(new Error((event.data.payload && event.data.payload.error) || 'download_capture_error'));
    }
  }

  windowObject.addEventListener('message', handleMessage);

  return {
    injectPageBridge,
    armDownloadCapture,
    isBridgeReady: () => bridgeInstallSucceeded,
    clearDownloadCapture: () => {
      if (pendingDownloadCapture) {
        pendingDownloadCapture.reject(new Error('download_capture_cleared'));
        pendingDownloadCapture = null;
      }
      windowObject.postMessage({ source: 'muzilee-worker', type: 'clear-download-capture' }, '*');
    },
  };
}


// worker-src/dom/selectors.js
const SELECTORS = {
  promptInput: [
    'div.ql-editor[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][aria-label*="Gemini"]',
    '[contenteditable="true"][data-placeholder*="Gemini"]',
    'div[contenteditable="true"][role="textbox"]',
  ],
  micContainer: ['div.mic-button-container'],
  sendBtnContainer: ['div.send-button-container'],
  sendBtn: ['.send-button-container button.send-button', '.send-button-container button'],
  responses: ['div.response-content'],
  images: ['img.image.loaded'],
  newChatBtn: [
    '[data-test-id="new-chat-button"] a',
    '[data-test-id="new-chat-button"]',
    'a[aria-label="发起新对话"]',
    'a[aria-label*="new chat" i]',
  ],
  modelBtn: [
    '[data-test-id="bard-mode-menu-button"]',
    'button[aria-label="打开模式选择器"]',
    'button[aria-label*="mode selector" i]',
    'button.mat-mdc-menu-trigger.input-area-switch',
  ],
  modelLabel: [
    '[data-test-id="logo-pill-label-container"] span',
    'div.logo-pill-label-container span',
  ],
  modelOptions: {
    pro: ['[data-test-id="bard-mode-option-pro"]'],
    quick: [
      '[data-test-id="bard-mode-option-快速"]',
      '[data-test-id="bard-mode-option-quick"]',
      '[data-test-id="bard-mode-option-fast"]',
      '[data-test-id="bard-mode-option-flash"]',
    ],
    think: [
      '[data-test-id="bard-mode-option-思考"]',
      '[data-test-id="bard-mode-option-think"]',
      '[data-test-id="bard-mode-option-thinking"]',
    ],
  },
  uploadPanelBtn: [
    'button.upload-card-button[aria-haspopup="menu"]',
    'button[aria-controls="upload-file-u"]',
    'button.upload-card-button',
  ],
  uploadFileBtn: [
    '[data-test-id="uploader-images-files-button-advanced"]',
    'images-files-uploader',
  ],
  imagePreviewLoading: ['.image-preview.loading'],
  imagePreview: ['.image-preview'],
  fullSizeDownloadBtn: ['button[data-test-id="download-generated-image-button"]'],
};



// worker-src/dom/wait.js
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition, timeoutMs, intervalMs = 250) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await condition();
    if (result) {
      return result;
    }
    await sleep(intervalMs);
  }
  throw new Error('wait_timeout');
}



// worker-src/features/image/extract_image.js

function inferMimeTypeFromDataUrl(dataUrl, fallback = 'image/png') {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return fallback;
  const separatorIndex = dataUrl.indexOf(';');
  if (separatorIndex <= 5) return fallback;
  return dataUrl.slice(5, separatorIndex) || fallback;
}

function getLatestImageElement(selectors) {
  const selector = selectors.images[0];
  const images = Array.from(document.querySelectorAll(selector));
  if (!images.length) {
    throw new Error('no_image_found');
  }
  return images[images.length - 1];
}

function getImageContainer(image) {
  const documentBody = typeof document !== 'undefined' ? document.body : null;
  let current = image;
  while (current && current !== documentBody) {
    if (current.classList && current.classList.contains('image-container')) {
      return current;
    }
    current = current.parentElement;
  }
  return image.parentElement || image;
}

async function extractImageDataUrl(selectors, url) {
  if (url.startsWith('blob:')) {
    const images = Array.from(document.querySelectorAll(selectors.images[0]));
    const image = images.find((item) => item.src === url) || images[images.length - 1];
    if (!image) {
      throw new Error('image_not_found');
    }
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas.toDataURL('image/png');
  }

  const response = await fetch(url, { credentials: 'include' });
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('file_reader_error'));
    reader.readAsDataURL(blob);
  });
}

async function getLatestImagePayload(selectors) {
  await sleep(1500);
  const image = getLatestImageElement(selectors);
  const imageDataUrl = await extractImageDataUrl(selectors, image.src);
  return {
    image_url: image.src,
    image_data_url: imageDataUrl,
    mime_type: inferMimeTypeFromDataUrl(imageDataUrl),
    width: image.naturalWidth || image.width || 0,
    height: image.naturalHeight || image.height || 0,
    source: 'preview',
  };
}


// worker-src/features/image/watermark_templates.js
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

function resolveOfficialGeminiWatermarkConfig(width, height) {
  const normalizedWidth = normalizeDimension(width);
  const normalizedHeight = normalizeDimension(height);
  if (!normalizedWidth || !normalizedHeight) return null;
  const entry = OFFICIAL_GEMINI_IMAGE_SIZE_INDEX.get(`${normalizedWidth}x${normalizedHeight}`);
  if (!entry) return null;
  const config = getConfigForEntry(entry);
  return config ? { ...config } : null;
}

function detectWatermarkConfig(imageWidth, imageHeight) {
  return (
    resolveOfficialGeminiWatermarkConfig(imageWidth, imageHeight) ||
    (imageWidth > 1024 && imageHeight > 1024
      ? { logoSize: 96, marginRight: 64, marginBottom: 64 }
      : { logoSize: 48, marginRight: 32, marginBottom: 32 })
  );
}

function calculateWatermarkPosition(imageWidth, imageHeight, config) {
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

function resolveGeminiWatermarkSearchConfigs(width, height, defaultConfig) {
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

function getGeminiAlphaMap(size) {
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


// worker-src/features/image/watermark_core.js

const WATERMARK_METHOD = 'gemini_template_unblend';
const LOGO_VALUE = 255;
const DETECTION_THRESHOLD = 0.18;
const LOW_CONFIDENCE_THRESHOLD = 0.1;
const ALPHA_GAIN_CANDIDATES = [1, 1.12, 1.24, 1.36, 1.48];
const SEARCH_SHIFTS = [-8, -4, 0, 4, 8];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createEmptyWatermarkMeta(overrides = {}) {
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

function processWatermarkImageData(imageData) {
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


// worker-src/features/image/watermark_runtime.js

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

function dataUrlToBlob(dataUrl) {
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

async function processWatermarkDataUrl(dataUrl) {
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

async function processWatermarkBlob(blob) {
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


// worker-src/features/image/preview_watermark_replacement.js


function collectCandidateImages(root, selectors) {
  const images = [];
  const selector = selectors.images[0];
  if (root instanceof HTMLImageElement) {
    images.push(root);
  }
  if (typeof root?.querySelectorAll === 'function') {
    images.push(...root.querySelectorAll(selector));
  }
  return images.filter((image) => image instanceof HTMLImageElement);
}

function normalizeSourceUrl(image) {
  return String(image?.currentSrc || image?.src || '').trim();
}

function resolveOverlayBox(image, container) {
  const imageRect = image.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  return {
    left: imageRect.left - containerRect.left,
    top: imageRect.top - containerRect.top,
    width: imageRect.width,
    height: imageRect.height,
  };
}

function createPreviewWatermarkReplacementController({
  selectors,
  logger = console,
  documentObject = document,
  MutationObserverClass = MutationObserver,
  processWatermarkDataUrlImpl = processWatermarkDataUrl,
  extractImageDataUrlImpl = extractImageDataUrl,
  createObjectURL = (blob) => URL.createObjectURL(blob),
  revokeObjectURL = (url) => URL.revokeObjectURL(url),
} = {}) {
  const trackedImages = new Set();
  const imageState = new WeakMap();
  const pendingBySource = new Map();
  let observer = null;
  let scheduled = false;

  function cleanupImage(image) {
    const state = imageState.get(image);
    if (!state) return;
    if (state.overlay?.parentNode) {
      state.overlay.parentNode.removeChild(state.overlay);
    }
    if (state.objectUrl) {
      revokeObjectURL(state.objectUrl);
    }
    if (state.didSetRelative && state.container?.style?.position === 'relative') {
      state.container.style.position = state.previousPosition || '';
    }
    imageState.delete(image);
    trackedImages.delete(image);
  }

  function applyOverlay(image, sourceUrl, objectUrl) {
    cleanupImage(image);
    const container = getImageContainer(image) || image.parentElement;
    if (!container) return;
    const overlay = documentObject.createElement('div');
    const box = resolveOverlayBox(image, container);
    const previousPosition = container.style?.position || '';
    const didSetRelative = !previousPosition || previousPosition === 'static';
    if (didSetRelative) {
      container.style.position = 'relative';
    }
    overlay.dataset.muzileePreviewOverlay = 'true';
    Object.assign(overlay.style, {
      position: 'absolute',
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
      backgroundImage: `url("${objectUrl}")`,
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      backgroundSize: 'contain',
      pointerEvents: 'none',
      zIndex: '1',
    });
    container.appendChild(overlay);
    trackedImages.add(image);
    imageState.set(image, {
      sourceUrl,
      objectUrl,
      overlay,
      container,
      previousPosition,
      didSetRelative,
    });
  }

  function refreshTrackedImages() {
    for (const image of [...trackedImages]) {
      if (!image.isConnected) {
        cleanupImage(image);
        continue;
      }
      const state = imageState.get(image);
      const currentSourceUrl = normalizeSourceUrl(image);
      if (!state || !currentSourceUrl || state.sourceUrl !== currentSourceUrl) {
        cleanupImage(image);
        if (currentSourceUrl) {
          void processImage(image);
        }
        continue;
      }
      const box = resolveOverlayBox(image, state.container);
      if (state.overlay?.style) {
        state.overlay.style.left = `${box.left}px`;
        state.overlay.style.top = `${box.top}px`;
        state.overlay.style.width = `${box.width}px`;
        state.overlay.style.height = `${box.height}px`;
      }
    }
  }

  async function processSource(sourceUrl) {
    const imageDataUrl = await extractImageDataUrlImpl(selectors, sourceUrl);
    return processWatermarkDataUrlImpl(imageDataUrl);
  }

  async function processImage(image) {
    const sourceUrl = normalizeSourceUrl(image);
    if (!sourceUrl) return;
    const existingState = imageState.get(image);
    if (existingState?.sourceUrl === sourceUrl) {
      return;
    }

    let pending = pendingBySource.get(sourceUrl);
    if (!pending) {
      pending = processSource(sourceUrl)
        .finally(() => pendingBySource.delete(sourceUrl));
      pendingBySource.set(sourceUrl, pending);
    }

    try {
      const result = await pending;
      if (result.watermark?.status !== 'removed') {
        cleanupImage(image);
        return;
      }
      const processedBlob = result.processedBlob || dataUrlToBlob(result.imageDataUrl);
      applyOverlay(image, sourceUrl, createObjectURL(processedBlob));
    } catch (error) {
      logger.warn('[muzilee-worker] preview watermark replacement failed', error);
      cleanupImage(image);
    }
  }

  function flush() {
    scheduled = false;
    refreshTrackedImages();
    for (const image of collectCandidateImages(documentObject, selectors)) {
      void processImage(image);
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(flush);
      return;
    }
    setTimeout(flush, 16);
  }

  function install() {
    const root = documentObject.body || documentObject.documentElement;
    if (!root || observer) return;
    observer = new MutationObserverClass(() => {
      schedule();
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'srcset'],
    });
    schedule();
  }

  function dispose() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    for (const image of [...trackedImages]) {
      cleanupImage(image);
    }
  }

  return {
    install,
    dispose,
    processImage,
  };
}


// worker-src/dom/query.js
function isVisibleElement(element) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
}

function queryFirst(selectors) {
  for (const selector of selectors) {
    try {
      const node = document.querySelector(selector);
      if (node) return node;
    } catch (_) {}
  }
  return null;
}

function queryVisible(selectors) {
  for (const selector of selectors) {
    try {
      const nodes = Array.from(document.querySelectorAll(selector));
      const visibleNode = nodes.find((item) => isVisibleElement(item));
      if (visibleNode) return visibleNode;
    } catch (_) {}
  }
  return null;
}

function queryVisibleByText(match) {
  const candidates = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], button, div, li'));
  return candidates.find((node) => {
    if (!isVisibleElement(node)) return false;
    return match((node.textContent || '').trim().toLowerCase(), node);
  }) || null;
}

function clickElement(element) {
  if (!element) {
    throw new Error('element_not_found');
  }
  element.scrollIntoView({ behavior: 'instant', block: 'center' });
  element.click();
}



// worker-src/features/model/switch_model.js


function buildModelAliases(catalog) {
  const mapping = new Map();
  const aliases = catalog.models.aliases || {};
  Object.entries(aliases).forEach(([canonical, names]) => {
    mapping.set(canonical, canonical);
    names.forEach((name) => mapping.set(String(name).trim().toLowerCase(), canonical));
  });
  return mapping;
}

function normalizeModelName(model, catalog) {
  const normalized = String(model || '').trim().toLowerCase();
  if (!normalized) return '';
  const aliases = buildModelAliases(catalog);
  return aliases.get(normalized) || normalized;
}

function getCurrentModelRaw(selectors) {
  const label = queryVisible(selectors.modelLabel);
  return label ? (label.textContent || '').trim() : '';
}

function matchesModel(raw, targetModel, catalog) {
  const lower = String(raw || '').trim().toLowerCase();
  const target = normalizeModelName(targetModel, catalog);

  if (target === 'pro') return lower.includes('pro');
  if (target === 'quick') {
    return lower.includes('quick') || lower.includes('fast') || lower.includes('flash') || lower.includes('快速');
  }
  if (target === 'think') {
    return lower.includes('think') || lower.includes('thinking') || lower.includes('思考');
  }
  return false;
}

function findModelOption(selectors, model, catalog) {
  const normalizedModel = normalizeModelName(model, catalog);
  const direct = queryVisible(selectors.modelOptions[normalizedModel] || []);
  if (direct) {
    return direct;
  }

  return queryVisibleByText((text) => {
    if (!text) return false;
    if (normalizedModel === 'pro') {
      return text.includes('pro');
    }
    if (normalizedModel === 'quick') {
      return text.includes('quick') || text.includes('fast') || text.includes('flash') || text.includes('快速');
    }
    if (normalizedModel === 'think') {
      return text.includes('think') || text.includes('thinking') || text.includes('思考');
    }
    return false;
  });
}

async function switchModel(selectors, model, catalog) {
  const normalizedModel = normalizeModelName(model, catalog);
  if (!normalizedModel) {
    const currentModel = getCurrentModelRaw(selectors);
    return { ok: true, previous_model: currentModel, current_model: currentModel, changed: false };
  }

  const currentRaw = getCurrentModelRaw(selectors);
  if (matchesModel(currentRaw, normalizedModel, catalog)) {
    return { ok: true, previous_model: currentRaw, current_model: currentRaw, changed: false };
  }

  const modelButton = queryVisible(selectors.modelBtn);
  if (!modelButton) {
    throw new Error('model_btn_not_found');
  }

  clickElement(modelButton);
  await sleep(300);

  const target = findModelOption(selectors, normalizedModel, catalog);
  if (!target) {
    throw new Error(`model_option_${normalizedModel}_not_found`);
  }

  clickElement(target);
  await sleep(900);

  const finalRaw = getCurrentModelRaw(selectors);
  if (!matchesModel(finalRaw, normalizedModel, catalog)) {
    throw new Error(`model_switch_failed:${normalizedModel}`);
  }

  return { ok: true, previous_model: currentRaw, current_model: finalRaw, changed: true };
}



// worker-src/features/prompt/fill_prompt.js

function fillPrompt(selectors, text) {
  const input = queryVisible(selectors.promptInput);
  if (!input) {
    throw new Error('prompt_input_not_found');
  }
  input.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('insertText', false, text);
}

function clickSend(selectors) {
  const button = queryVisible(selectors.sendBtn);
  if (!button) {
    throw new Error('send_button_not_found');
  }
  button.click();
}

function getComposerStatus(selectors) {
  const mic = queryVisible(selectors.micContainer);
  const sendContainer = queryVisible(selectors.sendBtnContainer);
  const button = queryVisible(selectors.sendBtn);

  if (!mic && !sendContainer) {
    return { status: 'unknown' };
  }

  const micHidden = mic ? /\bhidden\b/.test(mic.className) : false;
  const sendVisible = sendContainer ? /\bvisible\b/.test(sendContainer.className) : false;
  const buttonClass = button ? button.className : '';

  if (sendVisible && /\bstop\b/.test(buttonClass)) return { status: 'stop' };
  if (sendVisible && /\bsubmit\b/.test(buttonClass)) return { status: 'submit' };
  if (!micHidden) return { status: 'mic' };
  if (/\bstop\b/.test(buttonClass)) return { status: 'stop' };
  return { status: 'unknown' };
}



// worker-src/runtime/heartbeat.js



function buildCapabilities(catalog, { bridgeReady }) {
  const tasks = Object.values(catalog.capabilities.tasks || {});
  const features = [
    catalog.capabilities.features.new_chat,
    catalog.capabilities.features.switch_model,
    catalog.capabilities.features.upload_reference_images,
  ];
  if (bridgeReady) {
    features.push(catalog.capabilities.features.download_full_size);
  }
  return [...tasks, ...features];
}

function createHeartbeatSender({ baseUrl, workerId, taskTimeoutMs, selectors, catalog, request, captureController, busyState }) {
  return async function sendHeartbeat() {
    const capabilities = buildCapabilities(catalog, { bridgeReady: captureController.isBridgeReady() });
    const status = getComposerStatus(selectors);
    const model = getCurrentModelRaw(selectors);

    await request(baseUrl, 'POST', '/api/worker/heartbeat', {
      worker_id: workerId,
      page_url: location.href,
      ready: !!queryVisible(selectors.promptInput) && status.status !== 'unknown',
      model,
      title: document.title,
      meta: {
        version: '0.1.0',
        capabilities,
        status: status.status,
        busy: busyState.busy,
        bridge_ready: captureController.isBridgeReady(),
      },
    }, taskTimeoutMs);
  };
}


// worker-src/features/chat/new_chat.js


async function clickNewChat(selectors) {
  const button = queryVisible(selectors.newChatBtn);
  if (!button) {
    throw new Error('new_chat_btn_not_found');
  }
  clickElement(button);
  await sleep(600);
  await waitFor(() => queryVisible(selectors.promptInput), 10000);
  return { ok: true };
}



// worker-src/features/image/download_fullsize.js



async function downloadLatestImageFullSize(selectors, captureController, hoverDelayMs, timeoutMs) {
  const image = getLatestImageElement(selectors);
  const container = getImageContainer(image);
  image.scrollIntoView({ behavior: 'instant', block: 'center' });

  const capturePromise = captureController.armDownloadCapture(timeoutMs);
  capturePromise.catch(() => {});
  const rect = image.getBoundingClientRect();
  const hoverTarget = container || image;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    ['mouseenter', 'mousemove', 'mouseover'].forEach((type) => {
      hoverTarget.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }));
    });

    await sleep(hoverDelayMs);

    const downloadBtn = queryVisible(selectors.fullSizeDownloadBtn);
    if (downloadBtn) {
      clickElement(downloadBtn);
      const captured = await capturePromise;
      return {
        image_url: image.src,
        image_data_url: captured.image_data_url,
        filename: captured.filename || '',
        mime_type: captured.mime_type || 'image/png',
        width: image.naturalWidth || image.width || 0,
        height: image.naturalHeight || image.height || 0,
        source: 'full_size',
      };
    }
  }

  captureController.clearDownloadCapture();
  throw new Error('full_size_download_btn_not_found');
}


// worker-src/features/image/image_result.js



const FULL_SIZE_CAPTURE_TIMEOUT_MS = 12000;

function buildWatermarkMeta({ requestedMode, actualSource, result, fallbackReason }) {
  const watermark = result.watermark || {};
  const reason = watermark.reason || fallbackReason || null;
  return {
    requested_mode: requestedMode,
    actual_source: actualSource,
    status: watermark.status || 'skipped',
    reason,
    method: watermark.method || 'gemini_template_unblend',
  };
}

async function processCapturedPayload(
  payload,
  { requestedMode, actualSource, fallbackReason },
  processWatermarkDataUrlImpl,
) {
  const processed = await processWatermarkDataUrlImpl(payload.image_data_url);
  const watermark = buildWatermarkMeta({
    requestedMode,
    actualSource,
    result: processed,
    fallbackReason,
  });

  return {
    ...payload,
    image_data_url: processed.imageDataUrl,
    mime_type: processed.mimeType || payload.mime_type || 'image/png',
    source: actualSource,
    watermark,
  };
}

async function getLatestImageTaskResult({
  selectors,
  captureController,
  hoverDelayMs,
  timeoutMs,
  requestedMode,
  getLatestImagePayloadImpl = getLatestImagePayload,
  downloadLatestImageFullSizeImpl = downloadLatestImageFullSize,
  processWatermarkDataUrlImpl = processWatermarkDataUrl,
}) {
  if (requestedMode === 'preview') {
    return processCapturedPayload(
      await getLatestImagePayloadImpl(selectors),
      { requestedMode, actualSource: 'preview', fallbackReason: null },
      processWatermarkDataUrlImpl,
    );
  }

  try {
    return processCapturedPayload(
      await downloadLatestImageFullSizeImpl(
        selectors,
        captureController,
        hoverDelayMs,
        Math.min(timeoutMs, FULL_SIZE_CAPTURE_TIMEOUT_MS),
      ),
      { requestedMode, actualSource: 'full_size', fallbackReason: null },
      processWatermarkDataUrlImpl,
    );
  } catch (fullSizeError) {
    return processCapturedPayload(
      await getLatestImagePayloadImpl(selectors),
      { requestedMode, actualSource: 'preview', fallbackReason: 'full_size_unavailable' },
      processWatermarkDataUrlImpl,
    );
  }
}


// worker-src/features/response/extract_text.js


async function waitUntilDone(selectors, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(1000);
    const status = getComposerStatus(selectors);
    if (status.status === 'mic') {
      return;
    }
  }
  throw new Error('wait_timeout');
}

function getLatestResponseText(selectors) {
  const selector = selectors.responses[0];
  const nodes = Array.from(document.querySelectorAll(selector));
  if (!nodes.length) {
    throw new Error('no_response_found');
  }
  return (nodes[nodes.length - 1].innerText || '').trim();
}



// worker-src/features/task/apply_setup.js
async function applyTaskSetup(task, { clickNewChat, switchModel, uploadReferenceImages, selectors, catalog, logger }) {
  const payload = task.payload || {};
  const setup = payload.setup || {};
  const result = {};

  if (setup.new_chat) {
    await clickNewChat(selectors);
    result.new_chat = true;
  }

  if (setup.model) {
    result.model = await switchModel(selectors, setup.model, catalog);
  }

  if (setup.reference_images && setup.reference_images.length) {
    result.upload = await uploadReferenceImages(selectors, setup.reference_images, logger);
  }

  return result;
}



// worker-src/features/upload/reference_images.js


function findImageFileInput() {
  const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
  return inputs.find((input) => {
    const accept = (input.getAttribute('accept') || '').toLowerCase();
    return !accept || accept.includes('image');
  }) || null;
}

async function dataUrlToFile(entry, index) {
  const response = await fetch(entry.data_url, { credentials: 'include' });
  const blob = await response.blob();
  const name = entry.name || `reference-${index + 1}.png`;
  return new File([blob], name, { type: entry.mime_type || blob.type || 'image/png' });
}

function getPreviewCount(selectors) {
  const previews = new Set();
  selectors.imagePreview.forEach((selector) => {
    try {
      document.querySelectorAll(selector).forEach((node) => previews.add(node));
    } catch (_) {}
  });
  return previews.size;
}

async function waitForPreviewIncrease(selectors, previousCount, timeoutMs) {
  await waitFor(() => {
    const loading = document.querySelector(selectors.imagePreviewLoading[0]);
    const previewCount = getPreviewCount(selectors);
    if (!loading && previewCount > previousCount) {
      return previewCount;
    }
    return null;
  }, timeoutMs);
}

function buildClipboardTransfer(file) {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  return transfer;
}

function createPasteEvent(transfer) {
  let pasteEvent = null;
  try {
    pasteEvent = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    });
  } catch (_) {
    pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
  }

  try {
    if (!pasteEvent.clipboardData) {
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: transfer,
        configurable: true,
      });
    }
  } catch (_) {}

  return pasteEvent;
}

function createBeforeInputEvent(transfer) {
  let event = null;
  try {
    event = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertFromPaste',
      dataTransfer: transfer,
    });
  } catch (_) {
    event = new Event('beforeinput', { bubbles: true, cancelable: true });
  }

  try {
    if (!event.dataTransfer) {
      Object.defineProperty(event, 'dataTransfer', {
        value: transfer,
        configurable: true,
      });
    }
  } catch (_) {}

  return event;
}

async function pasteReferenceImage(selectors, entry, index, previousCount) {
  const input = queryVisible(selectors.promptInput);
  if (!input) {
    throw new Error('prompt_input_not_found');
  }

  const file = await dataUrlToFile(entry, index);
  const transfer = buildClipboardTransfer(file);

  clickElement(input);
  input.focus();
  await sleep(120);

  const beforeInput = createBeforeInputEvent(transfer);
  input.dispatchEvent(beforeInput);

  const pasteEvent = createPasteEvent(transfer);
  input.dispatchEvent(pasteEvent);

  await waitForPreviewIncrease(selectors, previousCount, 8000);
  return { ok: true, method: 'paste', file_name: file.name };
}

async function uploadReferenceImageViaFileInput(selectors, entry, index, previousCount) {
  const panelBtn = queryVisible(selectors.uploadPanelBtn);
  if (!panelBtn) {
    throw new Error('upload_panel_btn_not_found');
  }

  clickElement(panelBtn);
  await sleep(300);

  const uploadBtn = queryVisible(selectors.uploadFileBtn);
  if (uploadBtn) {
    clickElement(uploadBtn);
    await sleep(300);
  }

  const input = await waitFor(() => findImageFileInput(), 5000);
  const file = await dataUrlToFile(entry, index);
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  await waitForPreviewIncrease(selectors, previousCount, 15000);
  return { ok: true, method: 'file_input', file_name: file.name };
}

async function uploadSingleReferenceImage({ entry, index, previousCount, pasteUploader, fileUploader, logger }) {
  try {
    return await pasteUploader(entry, index, previousCount);
  } catch (error) {
    if (logger) {
      logger('[muzilee-worker] paste upload failed, fallback to file input', error);
    }
  }
  return fileUploader(entry, index, previousCount);
}

async function uploadReferenceImages(selectors, referenceImages, logger = console.warn) {
  if (!referenceImages || !referenceImages.length) {
    return { ok: true, uploaded: 0, methods: [] };
  }

  const methods = [];
  for (let index = 0; index < referenceImages.length; index += 1) {
    const entry = referenceImages[index];
    const previousCount = getPreviewCount(selectors);
    const result = await uploadSingleReferenceImage({
      entry,
      index,
      previousCount,
      pasteUploader: (item, itemIndex, count) => pasteReferenceImage(selectors, item, itemIndex, count),
      fileUploader: (item, itemIndex, count) => uploadReferenceImageViaFileInput(selectors, item, itemIndex, count),
      logger,
    });
    methods.push(result.method);
  }

  return { ok: true, uploaded: referenceImages.length, methods };
}



// worker-src/runtime/execute_task.js








function createTaskExecutor({ selectors, catalog, hoverDelayMs, captureController, logger = console.warn }) {
  return async function executeTask(task) {
    const payload = task.payload || {};
    const taskInput = payload.input || {};
    const timeoutMs = (payload.timeout_seconds || 180) * 1000;

    if (task.type === 'new_chat') {
      await clickNewChat(selectors);
      return { status: 'ok', page_url: location.href };
    }

    if (task.type === 'switch_model') {
      return switchModel(selectors, taskInput.model, catalog);
    }

    if (task.type === 'upload_reference_images') {
      const uploadResult = await uploadReferenceImages(selectors, taskInput.reference_images || [], logger);
      return { ...uploadResult, page_url: location.href };
    }

    if (task.type === 'download_latest_image') {
      return getLatestImageTaskResult({
        selectors,
        captureController,
        hoverDelayMs,
        timeoutMs,
        requestedMode: 'auto',
      });
    }

    if (task.type === 'send_message') {
      if (!taskInput.message) {
        throw new Error('missing_message');
      }
      const setup = await applyTaskSetup(task, {
        clickNewChat,
        switchModel,
        uploadReferenceImages,
        selectors,
        catalog,
        logger,
      });
      fillPrompt(selectors, taskInput.message);
      await sleep(300);
      clickSend(selectors);
      await waitUntilDone(selectors, timeoutMs);
      return { text: getLatestResponseText(selectors), setup };
    }

    if (task.type === 'generate_image') {
      if (!taskInput.prompt) {
        throw new Error('missing_prompt');
      }
      const setup = await applyTaskSetup(task, {
        clickNewChat,
        switchModel,
        uploadReferenceImages,
        selectors,
        catalog,
        logger,
      });
      fillPrompt(selectors, taskInput.prompt);
      await sleep(300);
      clickSend(selectors);
      await waitUntilDone(selectors, timeoutMs);
      const imageResult = await getLatestImageTaskResult({
        selectors,
        captureController,
        hoverDelayMs,
        timeoutMs,
        requestedMode: taskInput.output_mode || 'auto',
      });
      return { ...imageResult, setup };
    }

    throw new Error(`unsupported_task_type:${task.type}`);
  };
}


// worker-src/runtime/task_loop.js

async function pollTask({ baseUrl, workerId, request, busyState, executeTask, taskTimeoutMs }) {
  if (busyState.busy) {
    return;
  }

  const response = await request(baseUrl, 'GET', `/api/worker/tasks/next?worker_id=${encodeURIComponent(workerId)}`, null, taskTimeoutMs);
  if (!response.ok || !response.task) {
    return;
  }

  busyState.busy = true;
  try {
    const payload = await executeTask(response.task);
    await request(baseUrl, 'POST', `/api/worker/tasks/${response.task.id}/result`, {
      worker_id: workerId,
      ok: true,
      payload,
    }, taskTimeoutMs);
  } catch (error) {
    await request(baseUrl, 'POST', `/api/worker/tasks/${response.task.id}/result`, {
      worker_id: workerId,
      ok: false,
      payload: {
        error: error && error.message ? error.message : String(error),
      },
    }, taskTimeoutMs);
  } finally {
    busyState.busy = false;
  }
}

async function startTaskLoop({ idlePollIntervalMs, taskPollIntervalMs, busyState, ...runtime }) {
  while (true) {
    try {
      await pollTask({ busyState, ...runtime });
    } catch (error) {
      console.warn('[muzilee-worker] task loop error', error);
    }
    await sleep(busyState.busy ? taskPollIntervalMs : idlePollIntervalMs);
  }
}



// worker-src/transport/http.js
function request(baseUrl, method, path, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method,
      url: `${baseUrl}${path}`,
      headers: { 'Content-Type': 'application/json' },
      data: payload ? JSON.stringify(payload) : undefined,
      timeout: timeoutMs,
      onload: (response) => {
        try {
          resolve(JSON.parse(response.responseText || '{}'));
        } catch (error) {
          reject(error);
        }
      },
      ontimeout: () => reject(new Error('request_timeout')),
      onerror: (error) => reject(error),
    });
  });
}



// worker-src/index.js







function main({ catalog }) {
  if (window.top !== window.self) {
    return;
  }

  const config = {
    baseUrl: 'http://127.0.0.1:8765',
    heartbeatIntervalMs: 5000,
    idlePollIntervalMs: 2000,
    taskPollIntervalMs: 1200,
    taskTimeoutMs: 180000,
    hoverDelayMs: 500,
    workerId: `muzilee-worker-${Math.random().toString(36).slice(2, 10)}`,
  };

  const captureController = createDownloadCaptureController();
  captureController.injectPageBridge();
  const previewReplacementController = createPreviewWatermarkReplacementController({
    selectors: SELECTORS,
    logger: console,
  });
  previewReplacementController.install();

  const busyState = { busy: false };
  const executeTask = createTaskExecutor({
    selectors: SELECTORS,
    catalog,
    hoverDelayMs: config.hoverDelayMs,
    captureController,
    logger: console.warn,
  });
  const sendHeartbeat = createHeartbeatSender({
    baseUrl: config.baseUrl,
    workerId: config.workerId,
    taskTimeoutMs: config.taskTimeoutMs,
    selectors: SELECTORS,
    catalog,
    request,
    captureController,
    busyState,
  });

  sendHeartbeat().catch((error) => console.warn('[muzilee-worker] heartbeat error', error));
  setInterval(() => {
    sendHeartbeat().catch((error) => console.warn('[muzilee-worker] heartbeat error', error));
  }, config.heartbeatIntervalMs);

  startTaskLoop({
    baseUrl: config.baseUrl,
    workerId: config.workerId,
    request,
    busyState,
    executeTask,
    taskTimeoutMs: config.taskTimeoutMs,
    idlePollIntervalMs: config.idlePollIntervalMs,
    taskPollIntervalMs: config.taskPollIntervalMs,
  });
}


  main({ catalog: WORKER_PROTOCOL_CATALOG });
})();
