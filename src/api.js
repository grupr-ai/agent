// Tiny HTTP client. No deps — Node 18+ has global fetch.
//
// All methods return parsed JSON on 2xx, throw on non-2xx with a
// .status and .body attached so callers can switch on api error codes.

const DEFAULT_API_BASE = 'https://api.grupr.ai';

export function apiBase() {
  return process.env.GRUPR_API_BASE || DEFAULT_API_BASE;
}

export async function apiFetch(path, { method = 'GET', headers = {}, body, timeoutMs = 30_000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetch(apiBase() + path, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  const text = await resp.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!resp.ok) {
    const code = json?.errors?.[0]?.code || json?.error || `http_${resp.status}`;
    const message = json?.errors?.[0]?.message || json?.error || `HTTP ${resp.status}`;
    const err = new Error(`api ${path}: ${code} — ${message}`);
    err.status = resp.status;
    err.code = code;
    err.body = json;
    throw err;
  }
  return json;
}

// Convenience wrappers — `data` envelope is unwrapped here so callers
// see the inner object directly.
export async function apiGet(path, opts) {
  const r = await apiFetch(path, { ...opts, method: 'GET' });
  return r?.data ?? r;
}
export async function apiPost(path, body, opts) {
  const r = await apiFetch(path, { ...opts, method: 'POST', body });
  return r?.data ?? r;
}

// deviceAuth builds the Authorization: Device <id>:<token> header value.
export function deviceAuth(deviceId, token) {
  return { Authorization: `Device ${deviceId}:${token}` };
}
