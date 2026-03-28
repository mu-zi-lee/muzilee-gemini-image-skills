import { clickElement, queryVisible } from '../../dom/query.js';
import { sleep, waitFor } from '../../dom/wait.js';

export async function clickNewChat(selectors) {
  const button = queryVisible(selectors.newChatBtn);
  if (!button) {
    throw new Error('new_chat_btn_not_found');
  }
  clickElement(button);
  await sleep(600);
  await waitFor(() => queryVisible(selectors.promptInput), 10000);
  return { ok: true };
}

