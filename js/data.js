// Zustand, Laden, Entschlüsseln und Speichern der Haushaltsdaten.
import * as api from './api.js';
import * as vault from './crypto.js';

export const state = {
  members: [],
  me: null,
  key: null,
  persons: [],
  occasions: [],
  ideas: [],        // aufbereitete Ideen (siehe toView)
  tab: 'soon',
  personId: null
};

const enc = encodeURIComponent;

// ---------------------------------------------------------------- Laden

export async function loadAll() {
  const [members, persons, occasions, ideas, statuses] = await Promise.all([
    api.select('members', 'select=user_id,display_name,created_at&order=created_at.asc'),
    api.select('persons', 'select=id,name,emoji,color,birth_month,birth_day,birth_year,member_id,archived,is_child,created_at&order=name.asc'),
    api.select('occasions', 'select=id,person_id,title,kind,month,day,year,recurring&order=month.asc,day.asc'),
    api.select('ideas', 'select=*&order=created_at.desc'),
    api.select('gift_status', 'select=idea_id,status,buyer,paid_cents,occasion_year')
  ]);
  const statusById = new Map(statuses.map((s) => [s.idea_id, s]));
  state.members = members;
  state.me = members.find((m) => m.user_id === api.currentUserId()) || state.me;
  state.persons = persons.filter((p) => !p.archived);
  state.occasions = occasions;
  state.ideas = await Promise.all(ideas.map(toView));
  for (const i of state.ideas) {
    const s = statusById.get(i.id);
    i.status = s ? s.status : null;
    i.paid_cents = s ? s.paid_cents : null;
    i.buyer = s ? s.buyer : null;
  }
}

async function toView(row) {
  const base = {
    id: row.id,
    personId: row.person_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    retracted: Boolean(row.retracted_at),
    secret: row.enc !== null && row.enc !== undefined,
    unreadable: false
  };
  if (!base.secret) {
    return Object.assign(base, {
      title: row.title,
      note: row.note,
      url: row.url,
      shop: row.shop,
      price_cents: row.price_cents,
      details: row.details,
      occasion: row.for_birthday ? 'birthday' : row.occasion_id || null,
      fromWishId: null
    });
  }
  try {
    const p = await vault.decryptJSON(state.key, row.enc);
    return Object.assign(base, {
      title: p.title,
      note: p.note || null,
      url: p.url || null,
      shop: p.shop || null,
      price_cents: Number.isInteger(p.price_cents) ? p.price_cents : null,
      details: p.details || null,
      occasion: p.occasion || null,
      fromWishId: p.from_wish_id || null
    });
  } catch (e) {
    return Object.assign(base, {
      title: 'Nicht lesbar', note: null, url: null, shop: null, price_cents: null,
      details: null, occasion: null, fromWishId: null, unreadable: true
    });
  }
}

// ---------------------------------------------------------------- Abfragen

export function personById(id) {
  return state.persons.find((p) => p.id === id) || null;
}

export function myPerson() {
  return state.persons.find((p) => p.member_id === state.me.user_id) || null;
}

export function partnerPerson() {
  return state.persons.find((p) => p.member_id && p.member_id !== state.me.user_id) || null;
}

export function partnerMember() {
  return state.members.find((m) => m.user_id !== state.me.user_id) || null;
}

export function isMe(person) {
  return Boolean(person && person.member_id === state.me.user_id);
}

export function isPartner(person) {
  return Boolean(person && person.member_id && person.member_id !== state.me.user_id);
}

export function ideasFor(personId) {
  return state.ideas.filter((i) => i.personId === personId);
}

export function myWishes() {
  const me = myPerson();
  return me ? state.ideas.filter((i) => i.personId === me.id && i.createdBy === state.me.user_id) : [];
}

export function partnerWishes() {
  const p = partnerPerson();
  return p ? state.ideas.filter((i) => i.personId === p.id && i.createdBy === p.member_id) : [];
}

export function mySecretsForPartner() {
  const p = partnerPerson();
  return p ? state.ideas.filter((i) => i.personId === p.id && i.createdBy === state.me.user_id) : [];
}

// ---------------------------------------------------------------- Termine

export function startOfToday() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const hh = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - hh - k) % 7;
  const m = Math.floor((a + 11 * hh + 22 * l) / 451);
  const month = Math.floor((hh + l - 7 * m + 114) / 31);
  const day = ((hh + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function dateIn(year, month, day) {
  const last = new Date(year, month, 0).getDate();
  return new Date(year, month - 1, Math.min(day, last));
}

function nextYearly(month, day, today) {
  const y = today.getFullYear();
  const d = dateIn(y, month, day);
  return d >= today ? d : dateIn(y + 1, month, day);
}

export function occasionDate(o, today) {
  if (o.kind === 'easter') {
    const d = easterSunday(today.getFullYear());
    return d >= today ? d : easterSunday(today.getFullYear() + 1);
  }
  if (o.recurring) return nextYearly(o.month, o.day, today);
  if (o.year) {
    const d = dateIn(o.year, o.month, o.day);
    return d >= today ? d : null;
  }
  return null;
}

export function birthdayDate(person, today) {
  if (!person.birth_month || !person.birth_day) return null;
  return nextYearly(person.birth_month, person.birth_day, today);
}

export function daysUntil(date, today) {
  return Math.round((date - today) / 86400000);
}

// Anlässe, die für eine Person in Frage kommen: Geburtstag, eigene, gemeinsame
export function occasionOptions(person) {
  const today = startOfToday();
  const opts = [];
  if (person && person.birth_month) {
    opts.push({ value: 'birthday', label: 'Geburtstag', date: birthdayDate(person, today) });
  }
  for (const o of state.occasions) {
    if (o.person_id && (!person || o.person_id !== person.id)) continue;
    const date = occasionDate(o, today);
    if (!date) continue;
    opts.push({ value: o.id, label: o.title, date });
  }
  return opts.sort((a, b) => a.date - b.date);
}

export function occasionLabel(value, person) {
  if (!value) return null;
  if (value === 'birthday') return 'Geburtstag';
  const o = state.occasions.find((x) => x.id === value);
  return o ? o.title : null;
}

export function upcoming() {
  const today = startOfToday();
  const items = [];
  for (const o of state.occasions) {
    const date = occasionDate(o, today);
    if (!date) continue;
    const person = o.person_id ? personById(o.person_id) : null;
    if (o.person_id && !person) continue;
    const ideas = state.ideas.filter((i) => i.occasion === o.id && !i.retracted);
    items.push({
      key: 'o:' + o.id,
      title: person ? person.name + ' · ' + o.title : o.title,
      person,
      kind: o.kind === 'easter' ? 'easter' : (!person && o.title === 'Weihnachten' ? 'christmas' : 'custom'),
      date,
      ideaCount: ideas.length
    });
  }
  for (const p of state.persons) {
    const date = birthdayDate(p, today);
    if (!date) continue;
    const ideas = state.ideas.filter((i) => i.personId === p.id && i.occasion === 'birthday' && !i.retracted);
    items.push({
      key: 'b:' + p.id,
      title: p.name + ' · Geburtstag',
      person: p,
      kind: 'birthday',
      date,
      age: p.birth_year ? date.getFullYear() - p.birth_year : null,
      ideaCount: ideas.length
    });
  }
  return items
    .map((it) => Object.assign(it, { days: daysUntil(it.date, today) }))
    .filter((it) => it.days <= 400)
    .sort((a, b) => a.days - b.days);
}

// ---------------------------------------------------------------- Hilfen

export function parsePrice(text) {
  const t = String(text || '').trim().replace(/€/g, '').replace(/\s/g, '');
  if (!t) return null;
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number(norm);
  if (!Number.isFinite(n) || n < 0 || n > 1000000) return undefined;
  return Math.round(n * 100);
}

export function formatPrice(cents) {
  if (cents === null || cents === undefined) return '';
  return new Intl.NumberFormat('de-DE', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2
  }).format(cents / 100);
}

export function normalizeUrl(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const withScheme = /^https?:\/\//i.test(t) ? t : 'https://' + t;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
    if (!u.hostname.includes('.')) return undefined;
    return u.href.slice(0, 2000);
  } catch (e) {
    return undefined;
  }
}

export function shopFromUrl(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '').slice(0, 100);
  } catch (e) {
    return null;
  }
}

export function firstUrlIn(text) {
  const m = String(text || '').match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0] : null;
}

// ---------------------------------------------------------------- Speichern: Personen

export async function createPerson(values) {
  const row = await api.insert('persons', {
    name: values.name,
    color: values.color,
    birth_month: values.birth_month,
    birth_day: values.birth_day,
    birth_year: values.birth_year,
    is_child: Boolean(values.is_child)
  });
  await loadAll();
  return row;
}

export async function updatePerson(id, values) {
  await api.update('persons', 'id=eq.' + enc(id), values);
  await loadAll();
}

export async function deletePerson(id) {
  const n = await api.remove('persons', 'id=eq.' + enc(id));
  if (n !== 1) throw new Error('Diese Person kann nicht gelöscht werden.');
  await loadAll();
}

// ---------------------------------------------------------------- Speichern: Anlässe

export async function createOccasion(values) {
  await api.insert('occasions', values);
  await loadAll();
}

export async function deleteOccasion(id) {
  const n = await api.remove('occasions', 'id=eq.' + enc(id));
  if (n !== 1) throw new Error('Dieser Anlass kann nicht gelöscht werden.');
  await loadAll();
}

// ---------------------------------------------------------------- Speichern: Ideen

// values: { personId, title, note, url, price_cents, details, occasion, fromWishId }
export async function saveIdea(values, existingId) {
  const person = personById(values.personId);
  if (!person) throw new Error('Person nicht gefunden.');
  const url = values.url || null;
  const fields = {
    title: values.title,
    note: values.note || null,
    url,
    shop: shopFromUrl(url),
    price_cents: values.price_cents === undefined ? null : values.price_cents,
    details: values.details || null
  };

  let row;
  if (isPartner(person)) {
    if (!state.key) throw new Error('Geheimwort nicht entsperrt.');
    const payload = Object.assign({}, fields, {
      occasion: values.occasion || null,
      from_wish_id: values.fromWishId || null,
      v: 1
    });
    const encText = await vault.encryptJSON(state.key, payload);
    row = existingId
      ? await api.update('ideas', 'id=eq.' + enc(existingId), { enc: encText })
      : await api.insert('ideas', { person_id: person.id, enc: encText });
  } else {
    const occ = values.occasion || null;
    const plain = Object.assign({}, fields, {
      occasion_id: occ && occ !== 'birthday' ? occ : null,
      for_birthday: occ === 'birthday'
    });
    row = existingId
      ? await api.update('ideas', 'id=eq.' + enc(existingId), plain)
      : await api.insert('ideas', Object.assign({ person_id: person.id }, plain));
  }
  await loadAll();
  return row;
}

export async function deleteIdea(id) {
  const n = await api.remove('ideas', 'id=eq.' + enc(id));
  if (n !== 1) throw new Error('Diese Idee kann nicht gelöscht werden.');
  await loadAll();
}

export async function retractWish(id) {
  await api.rpc('retract_wish', { p_idea: id });
  await loadAll();
}
