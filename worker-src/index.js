import { createDownloadCaptureController } from './bridge/download_capture.js';
import { SELECTORS } from './dom/selectors.js';
import { buildCapabilities, createHeartbeatSender } from './runtime/heartbeat.js';
import { createTaskExecutor } from './runtime/execute_task.js';
import { startTaskLoop } from './runtime/task_loop.js';
import { request } from './transport/http.js';

export function main({ catalog }) {
  if (window.top !== window.self) {
    return;
  }

  const config = {
    baseUrl: 'http://127.0.0.1:8765',
    heartbeatIntervalMs: 5000,
    idlePollIntervalMs: 2000,
    taskPollIntervalMs: 1200,
    taskTimeoutMs: 180000,
    hoverDelayMs: 500,
    workerId: `muzilee-worker-${Math.random().toString(36).slice(2, 10)}`,
  };

  const captureController = createDownloadCaptureController();
  captureController.injectPageBridge();

  const busyState = { busy: false };
  const executeTask = createTaskExecutor({
    selectors: SELECTORS,
    catalog,
    hoverDelayMs: config.hoverDelayMs,
    captureController,
    logger: console.warn,
  });
  const sendHeartbeat = createHeartbeatSender({
    baseUrl: config.baseUrl,
    workerId: config.workerId,
    taskTimeoutMs: config.taskTimeoutMs,
    selectors: SELECTORS,
    catalog,
    request,
    captureController,
    busyState,
  });

  sendHeartbeat().catch((error) => console.warn('[muzilee-worker] heartbeat error', error));
  setInterval(() => {
    sendHeartbeat().catch((error) => console.warn('[muzilee-worker] heartbeat error', error));
  }, config.heartbeatIntervalMs);

  startTaskLoop({
    baseUrl: config.baseUrl,
    workerId: config.workerId,
    request,
    busyState,
    executeTask,
    taskTimeoutMs: config.taskTimeoutMs,
    idlePollIntervalMs: config.idlePollIntervalMs,
    taskPollIntervalMs: config.taskPollIntervalMs,
  });
}

