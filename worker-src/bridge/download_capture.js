export function buildPageBridgeScriptSource() {
  return `
      (() => {
        if (window.__MUZILEE_PAGE_BRIDGE_INSTALLED__) return;
        window.__MUZILEE_PAGE_BRIDGE_INSTALLED__ = true;

        let captureArmed = false;
        let blockNextAnchorClick = false;
        const originalCreateObjectURL = URL.createObjectURL.bind(URL);
        const originalAnchorClick = HTMLAnchorElement.prototype.click;
        const originalWindowOpen = typeof window.open === 'function' ? window.open.bind(window) : null;

        function post(payload) {
          window.postMessage({ source: 'muzilee-page-bridge', ...payload }, '*');
        }

        function isLikelyDownloadHref(href) {
          if (!href || typeof href !== 'string') return false;
          if (href.startsWith('blob:') || href.startsWith('data:image/')) return true;
          try {
            const parsed = new URL(href, window.location.href);
            return (
              parsed.hostname === 'googleusercontent.com' ||
              parsed.hostname.endsWith('.googleusercontent.com')
            );
          } catch (_) {
            return false;
          }
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

          if (href.startsWith('blob:')) {
            try {
              const response = await fetch(href);
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
            return;
          }

          captureArmed = false;
          post({ type: 'download-requested', payload: { href, filename } });
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

        document.addEventListener('click', (event) => {
          if (!captureArmed) {
            return;
          }
          const target = event.target;
          const anchor = target && typeof target.closest === 'function'
            ? target.closest('a[href]')
            : null;
          if (!anchor) {
            return;
          }
          const href = anchor.href || '';
          const filename = anchor.download || '';
          if (!filename && !isLikelyDownloadHref(href)) {
            return;
          }
          event.preventDefault();
          event.stopImmediatePropagation();
          blockNextAnchorClick = false;
          void captureHref(href, filename);
        }, true);

        if (originalWindowOpen) {
          window.open = function(url, ...args) {
            if (captureArmed && typeof url === 'string' && isLikelyDownloadHref(url)) {
              void captureHref(url, '');
              return null;
            }
            return originalWindowOpen(url, ...args);
          };
        }

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

function getContentType(responseHeaders) {
  const match = String(responseHeaders || '').match(/^content-type:\s*([^\r\n;]+)/im);
  return match ? match[1].trim().toLowerCase() : '';
}

function blobToDataUrl(blob, fileReaderCtor = FileReader) {
  return new Promise((resolve, reject) => {
    const reader = new fileReaderCtor();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('bridge_file_reader_error'));
    reader.readAsDataURL(blob);
  });
}

function requestBlobViaUserscript(gmRequest, href, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (typeof gmRequest !== 'function') {
      reject(new Error('download_request_unavailable'));
      return;
    }

    gmRequest({
      method: 'GET',
      url: href,
      anonymous: false,
      responseType: 'arraybuffer',
      timeout: timeoutMs,
      onload: (response) => {
        const status = Number(response.status) || 0;
        if (status < 200 || status >= 300) {
          reject(new Error(`download_fetch_failed:${status || 'unknown'}`));
          return;
        }

        const mimeType = getContentType(response.responseHeaders) || 'image/png';
        const buffer = response.response;
        if (!(buffer instanceof ArrayBuffer)) {
          reject(new Error('download_response_invalid'));
          return;
        }

        resolve(new Blob([buffer], { type: mimeType }));
      },
      ontimeout: () => reject(new Error('download_fetch_timeout')),
      onerror: () => reject(new Error('download_fetch_error')),
    });
  });
}

export function createDownloadCaptureController({
  windowObject = window,
  documentObject = document,
  gmRequest = globalThis.GM_xmlhttpRequest,
} = {}) {
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
        timeoutMs,
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

  async function handleRemoteDownload(payload) {
    if (!pendingDownloadCapture) {
      return;
    }

    const capture = pendingDownloadCapture;

    try {
      const blob = await requestBlobViaUserscript(
        gmRequest,
        String(payload?.href || ''),
        capture.timeoutMs,
      );
      const imageDataUrl = await blobToDataUrl(blob);
      if (pendingDownloadCapture !== capture) {
        return;
      }
      pendingDownloadCapture = null;
      capture.resolve({
        image_data_url: imageDataUrl,
        filename: String(payload?.filename || ''),
        mime_type: blob.type || 'image/png',
      });
    } catch (error) {
      if (pendingDownloadCapture !== capture) {
        return;
      }
      pendingDownloadCapture = null;
      capture.reject(new Error(error.message || String(error)));
    }
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
    } else if (event.data.type === 'download-requested') {
      void handleRemoteDownload(event.data.payload || {});
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
