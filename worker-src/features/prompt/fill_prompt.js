import { queryVisible } from '../../dom/query.js';

export function fillPrompt(selectors, text) {
  const input = queryVisible(selectors.promptInput);
  if (!input) {
    throw new Error('prompt_input_not_found');
  }
  input.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('insertText', false, text);
}

export function clickSend(selectors) {
  const button = queryVisible(selectors.sendBtn);
  if (!button) {
    throw new Error('send_button_not_found');
  }
  button.click();
}

export function getComposerStatus(selectors) {
  const mic = queryVisible(selectors.micContainer);
  const sendContainer = queryVisible(selectors.sendBtnContainer);
  const button = queryVisible(selectors.sendBtn);

  if (!mic && !sendContainer) {
    return { status: 'unknown' };
  }

  const micHidden = mic ? /\bhidden\b/.test(mic.className) : false;
  const sendVisible = sendContainer ? /\bvisible\b/.test(sendContainer.className) : false;
  const buttonClass = button ? button.className : '';

  if (sendVisible && /\bstop\b/.test(buttonClass)) return { status: 'stop' };
  if (sendVisible && /\bsubmit\b/.test(buttonClass)) return { status: 'submit' };
  if (!micHidden) return { status: 'mic' };
  if (/\bstop\b/.test(buttonClass)) return { status: 'stop' };
  return { status: 'unknown' };
}

