import { sleep } from '../dom/wait.js';

export async function pollTask({ baseUrl, workerId, request, busyState, executeTask, taskTimeoutMs }) {
  if (busyState.busy) {
    return;
  }

  const response = await request(baseUrl, 'GET', `/api/worker/tasks/next?worker_id=${encodeURIComponent(workerId)}`, null, taskTimeoutMs);
  if (!response.ok || !response.task) {
    return;
  }

  busyState.busy = true;
  try {
    const payload = await executeTask(response.task);
    await request(baseUrl, 'POST', `/api/worker/tasks/${response.task.id}/result`, {
      worker_id: workerId,
      ok: true,
      payload,
    }, taskTimeoutMs);
  } catch (error) {
    await request(baseUrl, 'POST', `/api/worker/tasks/${response.task.id}/result`, {
      worker_id: workerId,
      ok: false,
      payload: {
        error: error && error.message ? error.message : String(error),
      },
    }, taskTimeoutMs);
  } finally {
    busyState.busy = false;
  }
}

export async function startTaskLoop({ idlePollIntervalMs, taskPollIntervalMs, busyState, ...runtime }) {
  while (true) {
    try {
      await pollTask({ busyState, ...runtime });
    } catch (error) {
      console.warn('[muzilee-worker] task loop error', error);
    }
    await sleep(busyState.busy ? taskPollIntervalMs : idlePollIntervalMs);
  }
}

