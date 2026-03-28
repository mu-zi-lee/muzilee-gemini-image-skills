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

