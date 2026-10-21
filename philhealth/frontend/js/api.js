let csrfToken = '';

export async function api(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  if (method !== 'GET' && !csrfToken) await refreshCsrf();
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.body) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
  const response = await fetch(`/api${path}`, { ...options, method, headers, credentials: 'same-origin' });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  if (data?.csrfToken) csrfToken = data.csrfToken;
  return data;
}

export async function refreshCsrf() {
  const result = await api('/csrf');
  csrfToken = result.csrfToken;
  return csrfToken;
}

export function setCsrfToken(value) { csrfToken = value || ''; }
