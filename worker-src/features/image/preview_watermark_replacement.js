import { getImageContainer, getLatestImageElement, extractImageDataUrl } from './extract_image.js';
import { dataUrlToBlob, processWatermarkDataUrl } from './watermark_runtime.js';

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

export function createPreviewWatermarkReplacementController({
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
