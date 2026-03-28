import { queryVisible } from '../dom/query.js';
import { getCurrentModelRaw } from '../features/model/switch_model.js';
import { getComposerStatus } from '../features/prompt/fill_prompt.js';

export function buildCapabilities(catalog, { bridgeReady }) {
  const tasks = Object.values(catalog.capabilities.tasks || {});
  const features = [
    catalog.capabilities.features.new_chat,
    catalog.capabilities.features.switch_model,
    catalog.capabilities.features.upload_reference_images,
  ];
  return [...tasks, ...features];
}

export function createHeartbeatSender({ baseUrl, workerId, taskTimeoutMs, selectors, catalog, request, captureController, busyState }) {
  return async function sendHeartbeat() {
    const capabilities = buildCapabilities(catalog, { bridgeReady: captureController.isBridgeReady() });
    const status = getComposerStatus(selectors);
    const model = getCurrentModelRaw(selectors);

    await request(baseUrl, 'POST', '/api/worker/heartbeat', {
      worker_id: workerId,
      page_url: location.href,
      ready: !!queryVisible(selectors.promptInput) && status.status !== 'unknown',
      model,
      title: document.title,
      meta: {
        version: '0.1.0',
        capabilities,
        status: status.status,
        busy: busyState.busy,
        bridge_ready: captureController.isBridgeReady(),
      },
    }, taskTimeoutMs);
  };
}
