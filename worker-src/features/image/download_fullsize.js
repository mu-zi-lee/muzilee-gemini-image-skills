import { clickElement, queryVisible } from '../../dom/query.js';
import { sleep } from '../../dom/wait.js';
import { getImageContainer, getLatestImageElement } from './extract_image.js';

export async function downloadLatestImageFullSize(selectors, captureController, hoverDelayMs, timeoutMs) {
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
