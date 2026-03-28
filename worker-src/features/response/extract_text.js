import { sleep } from '../../dom/wait.js';
import { getComposerStatus } from '../prompt/fill_prompt.js';

export async function waitUntilDone(selectors, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(1000);
    const status = getComposerStatus(selectors);
    if (status.status === 'mic') {
      return;
    }
  }
  throw new Error('wait_timeout');
}

export function getLatestResponseText(selectors) {
  const selector = selectors.responses[0];
  const nodes = Array.from(document.querySelectorAll(selector));
  if (!nodes.length) {
    throw new Error('no_response_found');
  }
  return (nodes[nodes.length - 1].innerText || '').trim();
}

