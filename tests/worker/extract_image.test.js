import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPreviewImagePayload, createPreviewImagePayload } from '../../worker-src/features/image/extract_image.js';

test('buildPreviewImagePayload keeps original preview when processing is skipped', () => {
  const image = { src: 'blob:preview', naturalWidth: 512, naturalHeight: 512, width: 512, height: 512 };
  const payload = buildPreviewImagePayload(image, 'data:image/png;base64,orig', {
    image_data_url: 'data:image/png;base64,orig',
    watermark_removed: false,
  });

  assert.equal(payload.image_data_url, 'data:image/png;base64,orig');
  assert.equal(payload.watermark_removed, false);
  assert.equal(payload.source, 'preview');
});

test('createPreviewImagePayload returns processed preview metadata', async () => {
  const image = { src: 'blob:preview', naturalWidth: 1024, naturalHeight: 1024, width: 1024, height: 1024 };
  const payload = await createPreviewImagePayload(
    image,
    { images: ['img'] },
    {
      extractDataUrl: async () => 'data:image/png;base64,orig',
      processWatermark: async () => ({
        image_data_url: 'data:image/png;base64,clean',
        watermark_removed: true,
        watermark_position: { x: 864, y: 864, width: 96, height: 96 },
        watermark_config: { logoSize: 96, marginRight: 64, marginBottom: 64 },
      }),
    },
  );

  assert.equal(payload.image_data_url, 'data:image/png;base64,clean');
  assert.equal(payload.watermark_removed, true);
  assert.deepEqual(payload.watermark_position, { x: 864, y: 864, width: 96, height: 96 });
  assert.deepEqual(payload.watermark_config, { logoSize: 96, marginRight: 64, marginBottom: 64 });
});
