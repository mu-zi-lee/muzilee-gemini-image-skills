import test from 'node:test';
import assert from 'node:assert/strict';

import { uploadSingleReferenceImage } from '../../worker-src/features/upload/reference_images.js';

test('uploadSingleReferenceImage falls back to file input when paste fails', async () => {
  const calls = [];
  const result = await uploadSingleReferenceImage({
    entry: { name: 'a.png' },
    index: 0,
    previousCount: 0,
    pasteUploader: async () => {
      calls.push('paste');
      throw new Error('paste_failed');
    },
    fileUploader: async () => {
      calls.push('file');
      return { ok: true, method: 'file_input' };
    },
    logger: () => {},
  });

  assert.deepEqual(calls, ['paste', 'file']);
  assert.equal(result.method, 'file_input');
});

test('uploadSingleReferenceImage keeps paste path when it succeeds', async () => {
  const result = await uploadSingleReferenceImage({
    entry: { name: 'a.png' },
    index: 0,
    previousCount: 0,
    pasteUploader: async () => ({ ok: true, method: 'paste' }),
    fileUploader: async () => ({ ok: true, method: 'file_input' }),
    logger: () => {},
  });

  assert.equal(result.method, 'paste');
});
