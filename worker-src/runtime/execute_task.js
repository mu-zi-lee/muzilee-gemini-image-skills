import { clickNewChat } from '../features/chat/new_chat.js';
import { getLatestImageTaskResult } from '../features/image/image_result.js';
import { switchModel } from '../features/model/switch_model.js';
import { fillPrompt, clickSend } from '../features/prompt/fill_prompt.js';
import { getLatestResponseText, waitUntilDone } from '../features/response/extract_text.js';
import { applyTaskSetup } from '../features/task/apply_setup.js';
import { uploadReferenceImages } from '../features/upload/reference_images.js';
import { sleep } from '../dom/wait.js';

export function createTaskExecutor({ selectors, catalog, hoverDelayMs, captureController, logger = console.warn }) {
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
      return getLatestImageTaskResult({
        selectors,
        captureController,
        hoverDelayMs,
        timeoutMs,
        requestedMode: 'auto',
      });
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
      const imageResult = await getLatestImageTaskResult({
        selectors,
        captureController,
        hoverDelayMs,
        timeoutMs,
        requestedMode: taskInput.output_mode || 'auto',
      });
      return { ...imageResult, setup };
    }

    throw new Error(`unsupported_task_type:${task.type}`);
  };
}
