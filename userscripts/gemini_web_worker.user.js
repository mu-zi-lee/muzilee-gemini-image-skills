// ==UserScript==
// @name         Muzilee Gemini Web Worker
// @namespace    https://muzilee.local
// @version      0.1.0
// @description  Modular Gemini page worker for the local Muzilee Gemini Skill daemon.
// @match        https://gemini.google.com/*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
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

        function post(payload) {
          window.postMessage({ source: 'muzilee-page-bridge', ...payload }, '*');
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

          try {
            const response = await fetch(href, { credentials: 'include' });
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

function createDownloadCaptureController({ windowObject = window, documentObject = document } = {}) {
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



// worker-src/features/image/extract_image.js

function getLatestImageElement(selectors) {
  const selector = selectors.images[0];
  const images = Array.from(document.querySelectorAll(selector));
  if (!images.length) {
    throw new Error('no_image_found');
  }
  return images[images.length - 1];
}

function getImageContainer(image) {
  let current = image;
  while (current && current !== document.body) {
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
    width: image.naturalWidth || image.width || 0,
    height: image.naturalHeight || image.height || 0,
    source: 'preview',
  };
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
      return getLatestImagePayload(selectors);
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
      const preview = await getLatestImagePayload(selectors);
      return { ...preview, setup };
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
