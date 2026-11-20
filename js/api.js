// Schlanker Supabase-Client ohne Fremdbibliothek:
// - anonyme Anmeldung (keine E-Mail) über die Auth-API
// - automatische Token-Erneuerung
// - Lesen/Schreiben über die REST-API; die Datenbank-Regeln (RLS) entscheiden,
//   was zurückkommt.
import { CONFIG } from './config.js';

const SESSION_KEY = 'wish.session';
const AUTH = CONFIG.supabaseUrl + '/auth/v1';
const REST = CONFIG.supabaseUrl + '/rest/v1';

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

let session = readSession();
let refreshing = null;

function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && s.access_token && s.refresh_token && s.user_id ? s : null;
  } catch (e) {
    return null;
  }
}

function storeSession(data) {
  const expiresAt = data.expires_at
    ? Number(data.expires_at)
    : Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600);
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: expiresAt,
    user_id: data.user && data.user.id ? data.user.id : session && session.user_id
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function clearSession() {
  session = null;
  localStorage.removeItem(SESSION_KEY);
}

export function currentUserId() {
  return session ? session.user_id : null;
}

export function hasSession() {
  return session !== null;
}

async function parseError(res) {
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  const msg = body && (body.message || body.msg || body.error_description || body.error)
    || 'Unerwartete Antwort (' + res.status + ')';
  const code = body && (body.code || body.error_code || body.error) || null;
  return new ApiError(String(msg), res.status, code);
}

async function rawFetch(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (e) {
    throw new ApiError('Keine Verbindung. Bitte Internet prüfen.', 0, 'offline');
  }
  return res;
}

export async function signInAnonymously() {
  const res = await rawFetch(AUTH + '/signup', {
    method: 'POST',
    headers: { apikey: CONFIG.publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: {} })
  });
  if (!res.ok) throw await parseError(res);
  const data = await res.json();
  if (!data.access_token) throw new ApiError('Anmeldung fehlgeschlagen.', res.status, 'no_session');
  return storeSession(data);
}

async function refreshSession() {
  if (!session) throw new ApiError('Nicht angemeldet.', 401, 'no_session');
  if (!refreshing) {
    const token = session.refresh_token;
    refreshing = (async () => {
      const res = await rawFetch(AUTH + '/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { apikey: CONFIG.publishableKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: token })
      });
      if (!res.ok) {
        const err = await parseError(res);
        if (res.status === 400 || res.status === 401) {
          clearSession();
          err.code = 'session_lost';
        }
        throw err;
      }
      return storeSession(await res.json());
    })();
    refreshing.finally(() => { refreshing = null; }).catch(() => {});
  }
  return refreshing;
}

async function accessToken() {
  if (!session) throw new ApiError('Nicht angemeldet.', 401, 'no_session');
  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at - now < 60) await refreshSession();
  return session.access_token;
}

async function authed(url, options, retried) {
  const token = await accessToken();
  const headers = Object.assign({
    apikey: CONFIG.publishableKey,
    Authorization: 'Bearer ' + token
  }, options.headers || {});
  const res = await rawFetch(url, Object.assign({}, options, { headers }));
  if (res.status === 401 && !retried) {
    await refreshSession();
    return authed(url, options, true);
  }
  if (!res.ok) throw await parseError(res);
  return res;
}

// GET /rest/v1/<table>?<query>
export async function select(table, query) {
  const res = await authed(REST + '/' + table + (query ? '?' + query : ''), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  });
  return res.json();
}

// PATCH /rest/v1/<table>?<filter>
export async function update(table, filter, values) {
  await authed(REST + '/' + table + '?' + filter, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(values)
  });
}

// POST /rest/v1/<table> – gibt die angelegte Zeile zurück
export async function insert(table, values) {
  const res = await authed(REST + '/' + table, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(values)
  });
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

// DELETE /rest/v1/<table>?<filter> – gibt die Zahl gelöschter Zeilen zurück
export async function remove(table, filter) {
  const res = await authed(REST + '/' + table + '?' + filter, {
    method: 'DELETE',
    headers: { Accept: 'application/json', Prefer: 'return=representation' }
  });
  const rows = await res.json();
  return Array.isArray(rows) ? rows.length : 0;
}

// POST /rest/v1/rpc/<fn>
export async function rpc(fn, args) {
  const res = await authed(REST + '/rpc/' + fn, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(args || {})
  });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Nach längerer Pause im Hintergrund: Token frühzeitig erneuern
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && session) {
    accessToken().catch(() => {});
  }
});
