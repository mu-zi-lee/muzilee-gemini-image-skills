import { clickElement, queryVisible } from '../../dom/query.js';
import { sleep, waitFor } from '../../dom/wait.js';

export function findImageFileInput() {
  const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
  return inputs.find((input) => {
    const accept = (input.getAttribute('accept') || '').toLowerCase();
    return !accept || accept.includes('image');
  }) || null;
}

export async function dataUrlToFile(entry, index) {
  const response = await fetch(entry.data_url, { credentials: 'include' });
  const blob = await response.blob();
  const name = entry.name || `reference-${index + 1}.png`;
  return new File([blob], name, { type: entry.mime_type || blob.type || 'image/png' });
}

export function getPreviewCount(selectors) {
  const previews = new Set();
  selectors.imagePreview.forEach((selector) => {
    try {
      document.querySelectorAll(selector).forEach((node) => previews.add(node));
    } catch (_) {}
  });
  return previews.size;
}

export async function waitForPreviewIncrease(selectors, previousCount, timeoutMs) {
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

export async function pasteReferenceImage(selectors, entry, index, previousCount) {
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

export async function uploadReferenceImageViaFileInput(selectors, entry, index, previousCount) {
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

export async function uploadSingleReferenceImage({ entry, index, previousCount, pasteUploader, fileUploader, logger }) {
  try {
    return await pasteUploader(entry, index, previousCount);
  } catch (error) {
    if (logger) {
      logger('[muzilee-worker] paste upload failed, fallback to file input', error);
    }
  }
  return fileUploader(entry, index, previousCount);
}

export async function uploadReferenceImages(selectors, referenceImages, logger = console.warn) {
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

