import { clickNewChat } from '../features/chat/new_chat.js';
import { getLatestImagePayload } from '../features/image/extract_image.js';
import { downloadLatestImageFullSize } from '../features/image/download_fullsize.js';
import { switchModel } from '../features/model/switch_model.js';
import { fillPrompt, clickSend } from '../features/prompt/fill_prompt.js';
import { getLatestResponseText, waitUntilDone } from '../features/response/extract_text.js';
import { applyTaskSetup } from '../features/task/apply_setup.js';
import { uploadReferenceImages } from '../features/upload/reference_images.js';
import { sleep } from '../dom/wait.js';

export function createTaskExecutor({
  selectors,
  catalog,
  hoverDelayMs,
  fetchBlob,
  captureController,
  getPreviewImagePayload = getLatestImagePayload,
  getFullSizeImagePayload = downloadLatestImageFullSize,
  logger = console.warn,
}) {
  async function getLatestImageResult() {
    if (captureController?.isBridgeReady()) {
      return getFullSizeImagePayload(selectors, fetchBlob, hoverDelayMs, 60000);
    }
    return getPreviewImagePayload(selectors);
  }

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
      return getLatestImageResult();
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
      const outputMode = taskInput.output_mode || 'preview';
      const imagePayload = outputMode === 'full_size'
        ? await getLatestImageResult()
        : await getPreviewImagePayload(selectors);
      return { ...imagePayload, setup };
    }

    throw new Error(`unsupported_task_type:${task.type}`);
  };
}
