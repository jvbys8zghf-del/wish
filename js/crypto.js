// Ende-zu-Ende-Verschlüsselung für Ideen an den Partner.
// - Schlüssel = PBKDF2(Geheimwort, Salz, 600.000 Runden, SHA-256) -> AES-GCM 256
// - Der Schlüssel verlässt das Gerät nie und ist nicht exportierbar.
// - Er liegt nach dem Entsperren in der IndexedDB dieses Geräts.

const ITERATIONS = 600000;
const CHECK_PLAIN = 'wish-key-check-v1';
const DB_NAME = 'wish';
const STORE = 'keys';
const enc = new TextEncoder();
const dec = new TextDecoder();

let memoryKey = null;

function toB64(bytes) {
  let s = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}

function fromB64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function deriveKey(passphrase, saltB64) {
  const base = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromB64(saltB64), iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptJSON(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value)));
  return 'v1.' + toB64(iv) + '.' + toB64(ct);
}

export async function decryptJSON(key, payload) {
  const parts = String(payload).split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') throw new Error('Unbekanntes Format');
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(parts[1]) }, key, fromB64(parts[2]));
  return JSON.parse(dec.decode(pt));
}

// Neues Schlüsselmaterial für ein neues Geheimwort
export async function createKeyMaterial(passphrase) {
  const salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
  const key = await deriveKey(passphrase, salt);
  const check = await encryptJSON(key, CHECK_PLAIN);
  return { key, salt, check };
}

// Prüft ein Geheimwort gegen das gespeicherte Material. Ergebnis: Schlüssel oder null
export async function unlock(passphrase, saltB64, check) {
  const key = await deriveKey(passphrase, saltB64);
  try {
    const plain = await decryptJSON(key, check);
    return plain === CHECK_PLAIN ? key : null;
  } catch (e) {
    return null;
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const result = fn(store);
    t.oncomplete = () => { db.close(); resolve(result && result.result); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error); };
  }));
}

// Speichert den Schlüssel auf dem Gerät. Klappt das nicht, bleibt er nur bis
// zum Schließen der App im Speicher (dann wird das Geheimwort erneut abgefragt).
export async function rememberKey(memberId, key) {
  memoryKey = { memberId, key };
  try {
    await tx('readwrite', (s) => s.put(key, 'master:' + memberId));
    return true;
  } catch (e) {
    return false;
  }
}

export async function loadKey(memberId) {
  if (memoryKey && memoryKey.memberId === memberId) return memoryKey.key;
  try {
    const key = await tx('readonly', (s) => s.get('master:' + memberId));
    if (key) memoryKey = { memberId, key };
    return key || null;
  } catch (e) {
    return null;
  }
}

export async function forgetKeys() {
  memoryKey = null;
  try {
    await tx('readwrite', (s) => s.clear());
  } catch (e) {
    // Speicher nicht verfügbar: es war nichts gespeichert
  }
}

export function passphraseProblem(p) {
  if (!p || p.length < 10) return 'Mindestens 10 Zeichen.';
  if (/^\d+$/.test(p)) return 'Bitte nicht nur Ziffern.';
  if (new Set(p).size < 5) return 'Bitte abwechslungsreicher.';
  return null;
}
