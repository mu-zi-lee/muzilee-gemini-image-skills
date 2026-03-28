export function fetchBlob(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'GET',
      url,
      responseType: 'blob',
      timeout: timeoutMs,
      onload: (response) => {
        const blob = response.response;
        if (!blob) {
          reject(new Error('fetch_blob_empty'));
          return;
        }
        resolve(blob);
      },
      ontimeout: () => reject(new Error('fetch_blob_timeout')),
      onerror: (error) => reject(new Error(String(error.error || 'fetch_blob_error'))),
    });
  });
}

export function request(baseUrl, method, path, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method,
      url: `${baseUrl}${path}`,
      headers: { 'Content-Type': 'application/json' },
      data: payload ? JSON.stringify(payload) : undefined,
      timeout: timeoutMs,
      onload: (response) => {
        try {
          resolve(JSON.parse(response.responseText || '{}'));
        } catch (error) {
          reject(error);
        }
      },
      ontimeout: () => reject(new Error('request_timeout')),
      onerror: (error) => reject(error),
    });
  });
}

