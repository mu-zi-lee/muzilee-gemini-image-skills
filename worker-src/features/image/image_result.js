import { downloadLatestImageFullSize } from './download_fullsize.js';
import { getLatestImagePayload } from './extract_image.js';
import { processWatermarkDataUrl } from './watermark_runtime.js';

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

export async function getLatestImageTaskResult({
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
