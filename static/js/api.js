// Fetch wrapper for the local JSON API, with a short-lived read cache.
// Views render instantly from cache when you move around; any write clears it,
// so what you see always reflects your own latest change.
const cache = new Map(); // url -> { at, promise }
const TTL = 30000;

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

function cachedGet(url, { fresh = false } = {}) {
  const hit = cache.get(url);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.promise.then(clone);
  const promise = request('GET', url);
  cache.set(url, { at: Date.now(), promise });
  promise.catch(() => cache.delete(url));
  return promise.then(clone);
}
const clone = (d) => (d == null ? d : structuredClone(d));
const write = (method) => async (u, b) => { const r = await request(method, u, b); cache.clear(); return r; };

export const api = {
  get: cachedGet,
  prefetch: (u) => { cachedGet(u).catch(() => {}); },
  post: (u, b) => write('POST')(u, b ?? {}),
  patch: write('PATCH'),
  put: write('PUT'),
  del: (u) => write('DELETE')(u),
  upload: async (u, file, fields = {}) => {
    const fd = new FormData();
    fd.append('file', file);
    for (const [k, v] of Object.entries(fields)) if (v != null) fd.append(k, v);
    const r = await request('POST', u, fd);
    cache.clear();
    return r;
  },
  invalidate: () => cache.clear(),
};

// Shared app state (settings/meta) loaded once at startup and after settings changes.
export const store = { meta: null };

export async function loadMeta() {
  store.meta = await api.get('/api/meta', { fresh: true });
  return store.meta;
}
