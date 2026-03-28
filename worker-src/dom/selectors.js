export const SELECTORS = {
  promptInput: [
    'div.ql-editor[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][aria-label*="Gemini"]',
    '[contenteditable="true"][data-placeholder*="Gemini"]',
    'div[contenteditable="true"][role="textbox"]',
  ],
  micContainer: ['div.mic-button-container'],
  sendBtnContainer: ['div.send-button-container'],
  sendBtn: ['.send-button-container button.send-button', '.send-button-container button'],
  responses: ['div.response-content'],
  images: ['img.image.loaded'],
  newChatBtn: [
    '[data-test-id="new-chat-button"] a',
    '[data-test-id="new-chat-button"]',
    'a[aria-label="发起新对话"]',
    'a[aria-label*="new chat" i]',
  ],
  modelBtn: [
    '[data-test-id="bard-mode-menu-button"]',
    'button[aria-label="打开模式选择器"]',
    'button[aria-label*="mode selector" i]',
    'button.mat-mdc-menu-trigger.input-area-switch',
  ],
  modelLabel: [
    '[data-test-id="logo-pill-label-container"] span',
    'div.logo-pill-label-container span',
  ],
  modelOptions: {
    pro: ['[data-test-id="bard-mode-option-pro"]'],
    quick: [
      '[data-test-id="bard-mode-option-快速"]',
      '[data-test-id="bard-mode-option-quick"]',
      '[data-test-id="bard-mode-option-fast"]',
      '[data-test-id="bard-mode-option-flash"]',
    ],
    think: [
      '[data-test-id="bard-mode-option-思考"]',
      '[data-test-id="bard-mode-option-think"]',
      '[data-test-id="bard-mode-option-thinking"]',
    ],
  },
  uploadPanelBtn: [
    'button.upload-card-button[aria-haspopup="menu"]',
    'button[aria-controls="upload-file-u"]',
    'button.upload-card-button',
  ],
  uploadFileBtn: [
    '[data-test-id="uploader-images-files-button-advanced"]',
    'images-files-uploader',
  ],
  imagePreviewLoading: ['.image-preview.loading'],
  imagePreview: ['.image-preview'],
  fullSizeDownloadBtn: ['button[data-test-id="download-generated-image-button"]'],
};

