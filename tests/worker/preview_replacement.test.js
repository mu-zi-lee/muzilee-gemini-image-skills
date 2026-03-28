import test from 'node:test';
import assert from 'node:assert/strict';

import { createPreviewWatermarkReplacementController } from '../../worker-src/features/image/preview_watermark_replacement.js';

class FakeImageElement {
  constructor(src = '') {
    this.src = src;
    this.currentSrc = src;
    this.parentElement = null;
    this.dataset = {};
    this.style = {};
    this.isConnected = true;
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: 100, height: 100 };
  }
}

class FakeContainer {
  constructor() {
    this.children = [];
    this.style = {};
    this.parentElement = null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    this.children = this.children.filter((item) => item !== child);
    child.parentNode = null;
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: 100, height: 100 };
  }
}

class FakeDocument {
  constructor(image) {
    this.body = {
      querySelectorAll: () => [image],
    };
    this.documentElement = this.body;
  }

  createElement() {
    return {
      dataset: {},
      style: {},
      parentNode: null,
    };
  }
}

class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback;
  }

  observe() {}

  disconnect() {}
}

test('preview replacement only applies overlay when watermark removal succeeds and revokes on dispose', async () => {
  const image = new FakeImageElement('https://example.com/image.png');
  const container = new FakeContainer();
  image.parentElement = container;
  container.appendChild(image);

  globalThis.HTMLImageElement = FakeImageElement;

  const createdUrls = [];
  const revokedUrls = [];
  const controller = createPreviewWatermarkReplacementController({
    selectors: { images: ['img.image.loaded'] },
    documentObject: new FakeDocument(image),
    MutationObserverClass: FakeMutationObserver,
    extractImageDataUrlImpl: async () => 'data:image/png;base64,aaa',
    processWatermarkDataUrlImpl: async () => ({
      imageDataUrl: 'data:image/png;base64,bbb',
      watermark: { status: 'removed' },
    }),
    createObjectURL: () => {
      const value = `blob:${createdUrls.length + 1}`;
      createdUrls.push(value);
      return value;
    },
    revokeObjectURL: (value) => revokedUrls.push(value),
  });

  await controller.processImage(image);
  assert.equal(container.children.length, 2);

  controller.dispose();
  assert.equal(revokedUrls.length, 1);
  assert.equal(container.children.length, 1);
});
