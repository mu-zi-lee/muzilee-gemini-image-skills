import { sleep } from '../../dom/wait.js';

function inferMimeTypeFromDataUrl(dataUrl, fallback = 'image/png') {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return fallback;
  const separatorIndex = dataUrl.indexOf(';');
  if (separatorIndex <= 5) return fallback;
  return dataUrl.slice(5, separatorIndex) || fallback;
}

export function getLatestImageElement(selectors) {
  const selector = selectors.images[0];
  const images = Array.from(document.querySelectorAll(selector));
  if (!images.length) {
    throw new Error('no_image_found');
  }
  return images[images.length - 1];
}

export function getImageContainer(image) {
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

export async function extractImageDataUrl(selectors, url) {
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

export async function getLatestImagePayload(selectors) {
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
