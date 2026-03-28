export function buildPageBridgeScriptSource() {
  return `
      (() => {
        if (window.__MUZILEE_PAGE_BRIDGE_INSTALLED__) return;
        window.__MUZILEE_PAGE_BRIDGE_INSTALLED__ = true;

        let captureArmed = false;
        let blockNextAnchorClick = false;
        const originalCreateObjectURL = URL.createObjectURL.bind(URL);
        const originalAnchorClick = HTMLAnchorElement.prototype.click;

        function post(payload) {
          window.postMessage({ source: 'muzilee-page-bridge', ...payload }, '*');
        }

        async function emitBlob(blob, filename) {
          if (!blob || !(blob.type || '').startsWith('image/')) return;
          const reader = new FileReader();
          reader.onloadend = () => {
            post({
              type: 'download-captured',
              payload: {
                image_data_url: reader.result,
                filename: filename || '',
                mime_type: blob.type || 'image/png'
              }
            });
          };
          reader.onerror = () => {
            post({ type: 'download-error', payload: { error: 'bridge_file_reader_error' } });
          };
          reader.readAsDataURL(blob);
        }

        async function captureHref(href, filename) {
          if (!href) {
            captureArmed = false;
            post({ type: 'download-error', payload: { error: 'download_href_missing' } });
            return;
          }

          if (href.startsWith('data:image/')) {
            captureArmed = false;
            post({
              type: 'download-captured',
              payload: {
                image_data_url: href,
                filename,
                mime_type: href.slice(5, href.indexOf(';'))
              }
            });
            return;
          }

          try {
            const response = await fetch(href, { credentials: 'include' });
            if (!response.ok) {
              throw new Error('download_fetch_failed:' + response.status);
            }
            const blob = await response.blob();
            captureArmed = false;
            emitBlob(blob, filename);
          } catch (error) {
            captureArmed = false;
            post({ type: 'download-error', payload: { error: error.message || String(error) } });
          }
        }

        URL.createObjectURL = function(blob) {
          const url = originalCreateObjectURL(blob);
          if (captureArmed && blob && (blob.type || '').startsWith('image/')) {
            captureArmed = false;
            blockNextAnchorClick = true;
            emitBlob(blob, '');
          }
          return url;
        };

        HTMLAnchorElement.prototype.click = function(...args) {
          if (blockNextAnchorClick) {
            blockNextAnchorClick = false;
            return;
          }
          if (captureArmed) {
            const href = this.href || '';
            const filename = this.download || '';
            void captureHref(href, filename);
            return;
          }
          return originalAnchorClick.apply(this, args);
        };

        window.addEventListener('message', (event) => {
          if (event.source !== window || !event.data || event.data.source !== 'muzilee-worker') return;
          if (event.data.type === 'arm-download-capture') {
            captureArmed = true;
            blockNextAnchorClick = false;
          } else if (event.data.type === 'clear-download-capture') {
            captureArmed = false;
            blockNextAnchorClick = false;
          }
        });
      })();
    `;
}

export function createDownloadCaptureController({ windowObject = window, documentObject = document } = {}) {
  let bridgeInstallAttempted = false;
  let bridgeInstallSucceeded = false;
  let pendingDownloadCapture = null;

  function injectPageBridge() {
    if (bridgeInstallAttempted) {
      return bridgeInstallSucceeded;
    }
    bridgeInstallAttempted = true;

    if (documentObject.getElementById('__muzilee_page_bridge__')) {
      bridgeInstallSucceeded = true;
      return true;
    }

    const scriptSource = buildPageBridgeScriptSource();

    try {
      const script = documentObject.createElement('script');
      script.id = '__muzilee_page_bridge__';

      if (windowObject.trustedTypes && typeof windowObject.trustedTypes.createPolicy === 'function') {
        try {
          const policy = windowObject.trustedTypes.createPolicy('muzileeWorkerBridgePolicy', {
            createScript: (value) => value,
          });
          script.text = policy.createScript(scriptSource);
        } catch (error) {
          console.warn('[muzilee-worker] trustedTypes policy create failed', error);
          bridgeInstallSucceeded = false;
          return false;
        }
      } else {
        script.text = scriptSource;
      }

      documentObject.documentElement.appendChild(script);
      script.remove();
      bridgeInstallSucceeded = true;
      return true;
    } catch (error) {
      console.warn('[muzilee-worker] bridge inject failed', error);
      bridgeInstallSucceeded = false;
      return false;
    }
  }

  function armDownloadCapture(timeoutMs) {
    if (!injectPageBridge()) {
      throw new Error('download_capture_unavailable');
    }
    if (pendingDownloadCapture) {
      pendingDownloadCapture.reject(new Error('download_capture_replaced'));
      pendingDownloadCapture = null;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingDownloadCapture = null;
        windowObject.postMessage({ source: 'muzilee-worker', type: 'clear-download-capture' }, '*');
        reject(new Error('full_size_capture_timeout'));
      }, timeoutMs);

      pendingDownloadCapture = {
        resolve: (payload) => {
          clearTimeout(timer);
          resolve(payload);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };

      windowObject.postMessage({ source: 'muzilee-worker', type: 'arm-download-capture' }, '*');
    });
  }

  function handleMessage(event) {
    if (event.source !== windowObject || !event.data || event.data.source !== 'muzilee-page-bridge') {
      return;
    }
    if (!pendingDownloadCapture) {
      return;
    }
    if (event.data.type === 'download-captured') {
      const capture = pendingDownloadCapture;
      pendingDownloadCapture = null;
      capture.resolve(event.data.payload || {});
    } else if (event.data.type === 'download-error') {
      const capture = pendingDownloadCapture;
      pendingDownloadCapture = null;
      capture.reject(new Error((event.data.payload && event.data.payload.error) || 'download_capture_error'));
    }
  }

  windowObject.addEventListener('message', handleMessage);

  return {
    injectPageBridge,
    armDownloadCapture,
    isBridgeReady: () => bridgeInstallSucceeded,
    clearDownloadCapture: () => {
      if (pendingDownloadCapture) {
        pendingDownloadCapture.reject(new Error('download_capture_cleared'));
        pendingDownloadCapture = null;
      }
      windowObject.postMessage({ source: 'muzilee-worker', type: 'clear-download-capture' }, '*');
    },
  };
}
