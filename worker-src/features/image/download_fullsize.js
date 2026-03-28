import { queryVisible } from '../../dom/query.js';
import { sleep } from '../../dom/wait.js';
import { getImageContainer, getLatestImageElement } from './extract_image.js';

async function revealDownloadBtn(selectors, hoverDelayMs) {
  const image = getLatestImageElement(selectors);
  const container = getImageContainer(image);
  const rect = image.getBoundingClientRect();
  const hoverTarget = container || image;

  image.scrollIntoView({ behavior: 'instant', block: 'center' });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    ['mouseenter', 'mousemove', 'mouseover'].forEach((type) => {
      hoverTarget.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }));
    });
    await sleep(hoverDelayMs);
    const btn = queryVisible(selectors.fullSizeDownloadBtn);
    if (btn) return { image, btn };
  }
  return { image, btn: null };
}

function findDownloadUrl(btn, image) {
  let node = btn;
  while (node && node !== document.body) {
    if (node.tagName === 'A' && node.href) return node.href;
    node = node.parentElement;
  }
  return image.src || null;
}

export async function downloadLatestImageFullSize(selectors, fetchBlob, hoverDelayMs, timeoutMs) {
  const { image, btn } = await revealDownloadBtn(selectors, hoverDelayMs);

  const downloadUrl = btn ? findDownloadUrl(btn, image) : image.src;
  if (!downloadUrl) {
    throw new Error('full_size_download_url_not_found');
  }

  // Use GM_xmlhttpRequest-backed fetchBlob to bypass CSP/CORS
  const blob = await fetchBlob(downloadUrl, timeoutMs);
  const mimeType = blob.type || 'image/png';

  const imageDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('file_reader_error'));
    reader.readAsDataURL(blob);
  });

  return {
    image_url: downloadUrl,
    image_data_url: imageDataUrl,
    filename: '',
    mime_type: mimeType,
    width: image.naturalWidth || image.width || 0,
    height: image.naturalHeight || image.height || 0,
    source: 'full_size',
  };
}
