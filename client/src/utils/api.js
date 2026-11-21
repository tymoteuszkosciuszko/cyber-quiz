import { BACKEND_URL } from '../constants';

let csrfToken = null;
let onUnauthorizedHandler = null;

export function setCsrfToken(token) {
  csrfToken = token || null;
}

export function getCsrfToken() {
  return csrfToken;
}

export function setUnauthorizedHandler(fn) {
  onUnauthorizedHandler = typeof fn === 'function' ? fn : null;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function apiFetch(path, options = {}) {
  const { skipAuthRedirect = false, headers: customHeaders = {}, ...rest } = options;
  const method = (rest.method || 'GET').toUpperCase();

  const headers = { ...customHeaders };
  if (MUTATING_METHODS.has(method) && csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  const url = path.startsWith('http') ? path : `${BACKEND_URL}${path}`;
  const res = await fetch(url, {
    ...rest,
    method,
    headers,
    credentials: 'include',
  });

  if (res.status === 401 && !skipAuthRedirect && onUnauthorizedHandler) {
    csrfToken = null;
    onUnauthorizedHandler();
  }

  return res;
}

export async function apiJson(path, options = {}) {
  const { body, headers = {}, ...rest } = options;
  const finalHeaders = { ...headers };
  let finalBody = body;

  if (body !== undefined && typeof body !== 'string') {
    finalHeaders['Content-Type'] = 'application/json';
    finalBody = JSON.stringify(body);
  }

  const res = await apiFetch(path, {
    ...rest,
    headers: finalHeaders,
    body: finalBody,
  });

  const data = await res.json().catch(() => ({}));
  return { res, data };
}

