// Thin fetch wrapper around the local JSON API.
async function request(method, url, body) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b) => request('POST', u, b ?? {}),
  patch: (u, b) => request('PATCH', u, b),
  put: (u, b) => request('PUT', u, b),
  del: (u) => request('DELETE', u),
  upload: (u, file, fields = {}) => {
    const fd = new FormData();
    fd.append('file', file);
    for (const [k, v] of Object.entries(fields)) if (v != null) fd.append(k, v);
    return request('POST', u, fd);
  },
};

// Shared app state (settings/meta) loaded once at startup and after settings changes.
export const store = { meta: null };

export async function loadMeta() {
  store.meta = await api.get('/api/meta');
  return store.meta;
}
