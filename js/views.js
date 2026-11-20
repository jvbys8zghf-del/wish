// Hauptansicht mit Tabs, Personen-Seiten, Ideen-Details und Einstellungen.
import { CONFIG } from './config.js';
import * as api from './api.js';
import * as vault from './crypto.js';
import * as data from './data.js';
import { state } from './data.js';
import { openIdeaForm, openPersonForm, openOccasionForm, setOnChange } from './forms.js';
import { h, icon, toast, openSheet, avatar, busy } from './ui.js';

const root = document.getElementById('app');
let routeFn = () => {};
export function setRoute(fn) { routeFn = fn; }

const fmtDate = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtToday = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtCreated = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });

setOnChange(() => showMain(true));

// ---------------------------------------------------------------- Gemeinsame Bausteine

export function errorText(err) {
  const msg = String(err && err.message || err || '');
  if (err && err.code === 'offline') return 'Keine Verbindung. Bitte Internet prüfen und erneut versuchen.';
  if (/anonymous sign-ins are disabled/i.test(msg)) {
    return 'Anonyme Anmeldung ist im Supabase-Projekt ausgeschaltet. Unter Authentication → Sign In / Providers „Allow anonymous sign-ins“ einschalten.';
  }
  if (/signups not allowed/i.test(msg)) {
    return 'Registrierung ist im Supabase-Projekt ausgeschaltet. Unter Authentication → Sign In / Providers „Allow new users to sign up“ einschalten.';
  }
  if (/rate limit/i.test(msg)) return 'Zu viele Anmeldungen in kurzer Zeit. Bitte in einer Stunde erneut versuchen.';
  return msg || 'Unbekannter Fehler.';
}

export function spinnerView() {
  return h('div', { class: 'boot', role: 'status' },
    h('span', { class: 'spinner', 'aria-hidden': 'true' }),
    h('span', { class: 'visually-hidden', text: 'Lädt' }));
}

export function brand() {
  return h('div', { class: 'brand' },
    h('img', { src: './icons/icon-192.png', alt: '', width: 72, height: 72, class: 'brand-icon' }),
    h('span', { class: 'brand-name', text: 'Wish' }));
}

export function codeBlock(code) {
  const copy = h('button', { class: 'btn btn-secondary', type: 'button' }, icon('copy', 18), 'Kopieren');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast('Code kopiert. Jetzt in der Passwörter-App sichern.');
    } catch (e) {
      toast('Kopieren nicht möglich. Bitte abschreiben.');
    }
  });
  return h('div', { class: 'stack' },
    h('div', { class: 'code-display', 'aria-label': 'Code ' + code.split('').join(' ') }, code),
    copy);
}

function pill(text, kind) {
  return h('span', { class: 'pill' + (kind ? ' pill-' + kind : ''), text });
}

function ideaMeta(i) {
  const parts = [];
  if (i.price_cents !== null && i.price_cents !== undefined) parts.push(data.formatPrice(i.price_cents));
  if (i.details) parts.push(i.details);
  if (i.shop) parts.push(i.shop);
  if (!parts.length && i.note) parts.push(i.note);
  return parts.join(' · ');
}

const STATUS_LABEL = { reserved: ['Reserviert', 'warn'], bought: ['Gekauft', 'ok'], given: ['Verschenkt', null] };

function ideaRow(i, trailing) {
  const st = i.status && STATUS_LABEL[i.status];
  return h('li', { class: 'row-wrap' },
    h('button', { type: 'button', class: 'row row-btn', onclick: () => openIdeaSheet(i.id) },
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title' + (i.retracted ? ' struck' : ''), text: i.title }),
        ideaMeta(i) ? h('span', { class: 'row-sub', text: ideaMeta(i) }) : null),
      st ? pill(st[0], st[1]) : null,
      trailing ? null : h('span', { class: 'chev' }, icon('chevron', 16))),
    trailing ? h('span', { class: 'row-trailing' }, trailing) : null);
}

function fab(label, onclick, dark) {
  return h('button', { class: 'fab' + (dark ? ' fab-dark' : ''), type: 'button', 'aria-label': label, onclick }, icon('plus', 26));
}

// ---------------------------------------------------------------- Hülle mit Tabs

const TABS = [
  { id: 'soon', label: 'Bald', icon: 'calendar' },
  { id: 'people', label: 'Personen', icon: 'people' },
  { id: 'bought', label: 'Gekauft', icon: 'bag' },
  { id: 'wishes', label: 'Wünsche', icon: 'heart' }
];

export function showMain(keepScroll) {
  const y = window.scrollY;
  const content = h('div', { class: 'tab-content' });
  const nav = h('nav', { class: 'tabbar', 'aria-label': 'Bereiche' },
    TABS.map((t) => h('button', {
      type: 'button', class: 'tab', 'aria-current': state.tab === t.id ? 'page' : null,
      onclick: () => { state.tab = t.id; state.personId = null; showMain(); }
    }, icon(t.icon, 24), h('span', { text: t.label }))));

  if (state.personId && data.personById(state.personId)) content.append(personPage(data.personById(state.personId)));
  else if (state.tab === 'soon') content.append(viewSoon());
  else if (state.tab === 'people') content.append(viewPeople());
  else if (state.tab === 'bought') content.append(viewBought());
  else content.append(viewWishes());

  root.replaceChildren(h('div', { class: 'app-shell' }, content, nav));
  window.scrollTo(0, keepScroll ? y : 0);
}

function header(title, sub, action) {
  return h('header', { class: 'page-head' },
    h('div', null,
      sub ? h('span', { class: 'eyebrow', text: sub }) : null,
      h('h1', { class: 'title-l', text: title })),
    action || h('button', { class: 'icon-btn round', type: 'button', 'aria-label': 'Einstellungen', onclick: showSettings }, icon('person', 20)));
}

function partnerMissingCard() {
  if (state.members.length >= 2) return null;
  return h('div', { class: 'card note' }, icon('people', 20),
    h('span', { text: 'Noch allein im Haushalt. Dein Partner installiert Wish und gibt denselben Haushaltscode ein.' }));
}

function openPerson(person) {
  if (data.isMe(person)) { state.tab = 'wishes'; state.personId = null; }
  else state.personId = person.id;
  showMain();
}

// ---------------------------------------------------------------- Bald

function viewSoon() {
  const list = data.upcoming();
  return h('div', { class: 'page' },
    header('Bald', fmtToday.format(data.startOfToday())),
    partnerMissingCard(),
    h('h2', { class: 'section-title', text: 'Nächste Anlässe' }),
    h('ul', { class: 'cards' }, list.map((it) => {
      const secret = it.person && data.isPartner(it.person);
      const inner = [
        it.person ? avatar(it.person.name, it.person.color)
          : h('span', { class: 'occ-icon occ-' + it.kind, 'aria-hidden': 'true' }, icon(it.kind === 'easter' ? 'egg' : it.kind === 'christmas' ? 'tree' : 'star')),
        h('span', { class: 'occ-text' },
          h('span', { class: 'occ-title', text: it.title }),
          h('span', { class: 'occ-sub', text: fmtDate.format(it.date) + (it.age ? ' · wird ' + it.age : '') + (it.ideaCount ? ' · ' + it.ideaCount + (it.ideaCount === 1 ? ' Idee' : ' Ideen') : '') })),
        h('span', { class: 'occ-days', 'aria-label': it.days === 0 ? 'heute' : 'in ' + it.days + ' Tagen' },
          h('span', { class: 'occ-num', text: it.days === 0 ? 'Heute' : String(it.days) }),
          it.days === 0 ? null : h('span', { class: 'occ-unit', text: it.days === 1 ? 'Tag' : 'Tage' }))
      ];
      return h('li', null, it.person
        ? h('button', { type: 'button', class: 'card occasion row-btn' + (secret ? ' occasion-dark' : ''), onclick: () => openPerson(it.person) }, inner)
        : h('div', { class: 'card occasion' }, inner));
    })),
    fab('Idee hinzufügen', () => openIdeaForm({}))
  );
}

// ---------------------------------------------------------------- Personen

function viewPeople() {
  const sorted = state.persons.slice().sort((a, b) => {
    const ra = data.isMe(a) ? 0 : data.isPartner(a) ? 1 : 2;
    const rb = data.isMe(b) ? 0 : data.isPartner(b) ? 1 : 2;
    return ra - rb || a.name.localeCompare(b.name, 'de');
  });
  const today = data.startOfToday();
  const add = h('button', { class: 'icon-btn round accent', type: 'button', 'aria-label': 'Person hinzufügen', onclick: () => openPersonForm(null) }, icon('plus', 22));
  return h('div', { class: 'page' },
    header('Personen', null, add),
    partnerMissingCard(),
    h('ul', { class: 'list card' }, sorted.map((p) => {
      const count = data.ideasFor(p.id).filter((i) => !i.retracted).length;
      const bd = data.birthdayDate(p, today);
      const sub = data.isMe(p) ? 'Du · deine Wünsche'
        : data.isPartner(p) ? 'Partner · Wünsche und geheime Ideen'
          : (bd ? 'Geburtstag ' + fmtDate.format(bd) : 'Kein Geburtstag eingetragen');
      return h('li', null, h('button', { type: 'button', class: 'row row-btn', onclick: () => openPerson(p) },
        avatar(p.name, p.color),
        h('span', { class: 'row-main' },
          h('span', { class: 'row-title', text: p.name }),
          h('span', { class: 'row-sub', text: sub })),
        count ? pill(String(count)) : null,
        h('span', { class: 'chev' }, icon('chevron', 16))));
    })),
    state.persons.length <= 2
      ? h('p', { class: 'muted small center-text', text: 'Lege Kinder, Familie und Freunde über das Plus oben rechts an.' })
      : null
  );
}

function backBar(label) {
  return h('div', { class: 'back-bar' },
    h('button', { class: 'btn-back', type: 'button', onclick: () => { state.personId = null; showMain(); } }, icon('back', 22), label));
}

function groupByOccasion(ideas, person) {
  const opts = data.occasionOptions(person);
  const groups = [];
  for (const opt of opts) {
    const items = ideas.filter((i) => i.occasion === opt.value);
    if (items.length) groups.push({ title: opt.label, date: opt.date, items });
  }
  const known = new Set(opts.map((o) => o.value));
  const rest = ideas.filter((i) => !i.occasion || !known.has(i.occasion));
  if (rest.length) groups.push({ title: 'Irgendwann', date: null, items: rest });
  return groups;
}

function personHead(person, sub) {
  return h('div', { class: 'person-head' },
    avatar(person.name, person.color, 'l'),
    h('h1', { class: 'title-m', text: person.name }),
    sub ? h('span', { class: 'muted', text: sub }) : null);
}

function birthdayLine(person) {
  if (!person.birth_month) return null;
  const today = data.startOfToday();
  const bd = data.birthdayDate(person, today);
  const age = person.birth_year ? bd.getFullYear() - person.birth_year : null;
  return 'Geburtstag ' + new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long' }).format(bd) + (age ? ' · wird ' + age : '');
}

function occasionsSection(person) {
  const own = state.occasions.filter((o) => o.person_id === person.id);
  const today = data.startOfToday();
  return h('section', { class: 'stack-s' },
    h('div', { class: 'section-row' },
      h('h2', { class: 'caps', text: 'Eigene Anlässe' }),
      h('button', { class: 'link-btn', type: 'button', onclick: () => openOccasionForm(person.id) }, 'Hinzufügen')),
    own.length ? h('ul', { class: 'list card' }, own.map((o) => {
      const d = data.occasionDate(o, today);
      return h('li', { class: 'row' },
        h('span', { class: 'row-main' },
          h('span', { class: 'row-title', text: o.title }),
          h('span', { class: 'row-sub', text: (d ? fmtDate.format(d) : 'vorbei') + (o.recurring ? ' · jährlich' : ' · einmalig') })),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': o.title + ' löschen', onclick: () => confirmDeleteOccasion(o) }, icon('trash', 18)));
    })) : null);
}

function confirmDeleteOccasion(o) {
  const go = h('button', { class: 'btn btn-danger', type: 'button' }, 'Anlass löschen');
  const close = openSheet('„' + o.title + '“ löschen?', h('div', { class: 'stack' },
    h('p', { text: 'Ideen, die für diesen Anlass gedacht waren, bleiben erhalten und stehen danach unter „Irgendwann“.' }), go));
  go.addEventListener('click', async () => {
    busy(go, true);
    try { await data.deleteOccasion(o.id); close(); showMain(true); } catch (err) { toast(errorText(err)); busy(go, false); }
  });
}

function personPage(person) {
  if (data.isPartner(person)) return partnerPage(person);
  const ideas = data.ideasFor(person.id);
  const edit = h('button', { class: 'link-btn', type: 'button', onclick: () => openPersonForm(person.id) }, 'Bearbeiten');
  return h('div', { class: 'page' },
    h('div', { class: 'page-top' }, backBar('Personen'), edit),
    personHead(person, birthdayLine(person)),
    ideas.length ? groupByOccasion(ideas, person).map((g) => h('section', { class: 'stack-s' },
      h('h2', { class: 'caps', text: g.title + (g.date ? ' · ' + fmtDate.format(g.date) : '') }),
      h('ul', { class: 'list card' }, g.items.map((i) => ideaRow(i)))))
      : h('div', { class: 'empty' },
        h('p', { class: 'empty-title', text: 'Noch keine Ideen für ' + person.name }),
        h('p', { class: 'muted', text: 'Tippe auf das Plus, sobald dir etwas einfällt.' })),
    occasionsSection(person),
    fab('Idee für ' + person.name + ' hinzufügen', () => openIdeaForm({ personId: person.id }))
  );
}

function partnerPage(person) {
  const wishes = data.partnerWishes();
  const secrets = data.mySecretsForPartner();
  const taken = new Set(secrets.map((s) => s.fromWishId).filter(Boolean));
  const edit = h('button', { class: 'link-btn', type: 'button', onclick: () => openPersonForm(person.id) }, 'Geburtstag');

  const wishRows = wishes.map((w) => {
    let trailing;
    if (w.retracted) {
      trailing = h('button', { class: 'mini-btn', type: 'button', onclick: () => removeRetracted(w) }, 'Entfernen');
    } else if (taken.has(w.id)) {
      trailing = h('span', { class: 'mini-tag' }, icon('check', 14), 'Übernommen');
    } else {
      trailing = h('button', { class: 'mini-btn mini-btn-on', type: 'button', onclick: () => openIdeaForm({ fromWish: w }) }, 'Übernehmen');
    }
    return ideaRow(w, trailing);
  });

  return h('div', { class: 'page' },
    h('div', { class: 'page-top' }, backBar('Personen'), edit),
    personHead(person, birthdayLine(person)),
    h('div', { class: 'card note note-dark' }, icon('lock', 20),
      h('span', { text: 'Verschlüsselt auf deinem iPhone. ' + person.name + ' sieht nichts davon – auch nicht, ob du etwas übernommen hast.' })),
    h('section', { class: 'stack-s' },
      h('h2', { class: 'caps rose', text: 'Von ' + person.name + ' gewünscht' }),
      wishRows.length ? h('ul', { class: 'list card' }, wishRows)
        : h('p', { class: 'muted small', text: person.name + ' hat noch keine Wünsche eingetragen.' })),
    h('section', { class: 'stack-s' },
      h('h2', { class: 'caps', text: 'Deine geheimen Ideen' }),
      secrets.length ? groupByOccasion(secrets, person).map((g) => h('div', { class: 'stack-s' },
        h('h3', { class: 'caps small-caps', text: g.title + (g.date ? ' · ' + fmtDate.format(g.date) : '') }),
        h('ul', { class: 'list card' }, g.items.map((i) => ideaRow(i)))))
        : h('p', { class: 'muted small', text: 'Noch keine. Tippe auf das Plus oder übernimm einen Wunsch.' })),
    occasionsSection(person),
    fab('Geheime Idee hinzufügen', () => openIdeaForm({ personId: person.id }), true)
  );
}

async function removeRetracted(w) {
  try {
    await data.deleteIdea(w.id);
    showMain(true);
  } catch (err) {
    toast(errorText(err));
  }
}

// ---------------------------------------------------------------- Gekauft

function viewBought() {
  return h('div', { class: 'page' },
    header('Gekauft'),
    h('div', { class: 'empty' },
      h('span', { class: 'empty-icon', 'aria-hidden': 'true' }, icon('bag', 28)),
      h('p', { class: 'empty-title', text: 'Noch nichts gekauft' }),
      h('p', { class: 'muted', text: 'Hier stehen später alle besorgten Geschenke – mit Summen je Person und Anlass.' }))
  );
}

// ---------------------------------------------------------------- Meine Wünsche

function viewWishes() {
  const me = data.myPerson();
  const wishes = data.myWishes();
  const partner = data.partnerMember();
  return h('div', { class: 'page' },
    header('Meine Wünsche'),
    h('div', { class: 'card note note-rose' }, icon('heart', 20),
      h('span', { text: (partner ? partner.display_name : 'Dein Partner') + ' sieht diese Liste. Ob etwas davon besorgt wird, erfährst du nicht – das bleibt die Überraschung.' })),
    wishes.length
      ? h('ul', { class: 'list card' }, wishes.map((w) => ideaRow(w)))
      : h('div', { class: 'empty' },
        h('p', { class: 'empty-title', text: 'Noch keine Wünsche' }),
        h('p', { class: 'muted', text: 'Was wünschst du dir? Größe, Farbe oder Link helfen beim Besorgen.' })),
    me ? h('button', { class: 'btn btn-rose', type: 'button', onclick: () => openIdeaForm({ personId: me.id }) }, icon('plus', 20), 'Wunsch hinzufügen') : null
  );
}

// ---------------------------------------------------------------- Idee im Detail

function openIdeaSheet(id) {
  const i = state.ideas.find((x) => x.id === id);
  if (!i) return;
  const person = data.personById(i.personId);
  const mine = i.createdBy === state.me.user_id;
  const isOwnWish = data.isMe(person) && mine;
  const isPartnerWish = data.isPartner(person) && !mine;
  const canEdit = !i.retracted && !i.unreadable && (mine || (!data.isMe(person) && !data.isPartner(person)));

  const rows = [];
  rows.push(['Für', data.isMe(person) ? 'Dich' : person.name]);
  const occ = data.occasionLabel(i.occasion, person);
  if (occ) rows.push(['Anlass', occ]);
  if (i.price_cents !== null && i.price_cents !== undefined) rows.push(['Preis', data.formatPrice(i.price_cents)]);
  if (i.details) rows.push(['Größe, Farbe', i.details]);
  if (i.status) {
    const buyer = state.members.find((m) => m.user_id === i.buyer);
    rows.push(['Status', STATUS_LABEL[i.status][0] + (buyer ? ' von ' + (buyer.user_id === state.me.user_id ? 'dir' : buyer.display_name) : '')
      + (i.paid_cents !== null && i.paid_cents !== undefined ? ' · ' + data.formatPrice(i.paid_cents) : '')]);
  }
  const creator = state.members.find((m) => m.user_id === i.createdBy);
  rows.push(['Angelegt', (mine ? 'von dir' : 'von ' + (creator ? creator.display_name : 'Partner')) + ' · ' + fmtCreated.format(new Date(i.createdAt))]);

  const actions = h('div', { class: 'stack' });
  let close = null;

  if (isPartnerWish && !i.retracted) {
    const taken = data.mySecretsForPartner().some((s) => s.fromWishId === i.id);
    actions.append(taken
      ? h('p', { class: 'muted small center-text', text: 'Du hast diesen Wunsch bereits übernommen.' })
      : h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { close(); openIdeaForm({ fromWish: i }); } }, 'Übernehmen'));
  }
  if (canEdit) {
    actions.append(h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { close(); openIdeaForm({ ideaId: i.id }); } }, icon('edit', 18), 'Bearbeiten'));
  }
  if (isOwnWish) {
    const retract = h('button', { class: 'btn btn-plain danger', type: 'button' }, 'Wunsch zurückziehen');
    retract.addEventListener('click', () => confirmRetract(i, close));
    actions.append(retract);
  } else if (mine || (!data.isMe(person) && !data.isPartner(person)) || (isPartnerWish && i.retracted)) {
    const del = h('button', { class: 'btn btn-plain danger', type: 'button' }, icon('trash', 18), 'Löschen');
    del.addEventListener('click', () => confirmDeleteIdea(i, close));
    actions.append(del);
  }

  const body = h('div', { class: 'stack' },
    i.unreadable ? h('div', { class: 'card note note-dark' }, icon('lock', 18),
      h('span', { text: 'Diese Idee wurde mit einem früheren Geheimwort verschlüsselt und ist nicht mehr lesbar.' })) : null,
    i.retracted ? h('div', { class: 'card note' }, icon('heart', 18),
      h('span', { text: 'Zurückgezogen. Falls du ihn schon besorgt hast, entscheide selbst, ob du ihn trotzdem schenkst.' })) : null,
    h('h3', { class: 'detail-title', text: i.title }),
    i.url ? h('a', { class: 'detail-link', href: i.url, target: '_blank', rel: 'noopener noreferrer' }, icon('external', 16), i.shop || 'Link öffnen') : null,
    h('dl', { class: 'facts card' }, rows.map(([k, v]) => h('div', { class: 'fact' }, h('dt', { text: k }), h('dd', { text: v })))),
    i.note ? h('div', { class: 'card note-plain' }, h('span', { class: 'caps', text: 'Notiz' }), h('p', { class: 'pre', text: i.note })) : null,
    data.isPartner(person) && mine ? h('p', { class: 'muted small', text: 'Kaufen und Verschenken markierst du ab dem nächsten Ausbauschritt.' }) : null,
    actions);
  close = openSheet(isPartnerWish ? 'Wunsch' : isOwnWish ? 'Dein Wunsch' : 'Idee', body);
}

function confirmRetract(i, closeParent) {
  const go = h('button', { class: 'btn btn-danger', type: 'button' }, 'Zurückziehen');
  const close = openSheet('Wunsch zurückziehen?', h('div', { class: 'stack' },
    h('p', { text: 'Der Wunsch verschwindet aus deiner Liste. Hat dein Partner ihn schon besorgt, sieht er einen Hinweis statt einer Lücke.' }), go));
  go.addEventListener('click', async () => {
    busy(go, true);
    try { await data.retractWish(i.id); close(); closeParent(); showMain(true); } catch (err) { toast(errorText(err)); busy(go, false); }
  });
}

function confirmDeleteIdea(i, closeParent) {
  const go = h('button', { class: 'btn btn-danger', type: 'button' }, 'Löschen');
  const close = openSheet('Idee löschen?', h('div', { class: 'stack' },
    h('p', { text: '„' + i.title + '“ wird gelöscht.' }), go));
  go.addEventListener('click', async () => {
    busy(go, true);
    try { await data.deleteIdea(i.id); close(); closeParent(); showMain(true); } catch (err) { toast(errorText(err)); busy(go, false); }
  });
}

// ---------------------------------------------------------------- Einstellungen

function showSettings() {
  const name = h('input', { id: 'set-name', class: 'input', type: 'text', maxlength: 40, value: state.me.display_name });
  const saveName = h('button', { class: 'btn btn-secondary', type: 'button' }, 'Namen speichern');
  saveName.addEventListener('click', async () => {
    const v = name.value.trim();
    if (!v) { toast('Bitte einen Namen eingeben.'); return; }
    busy(saveName, true);
    try {
      await api.update('members', 'user_id=eq.' + encodeURIComponent(state.me.user_id), { display_name: v });
      await api.update('persons', 'member_id=eq.' + encodeURIComponent(state.me.user_id), { name: v });
      await data.loadAll();
      toast('Gespeichert.');
      showMain(true);
    } catch (err) {
      toast(errorText(err));
    }
    busy(saveName, false);
  });

  const renewOut = h('div');
  const renew = h('button', { class: 'btn btn-secondary', type: 'button' }, 'Neuen Wiederherstellungscode erzeugen');
  renew.addEventListener('click', async () => {
    busy(renew, true);
    try {
      const code = await api.rpc('renew_recovery_code');
      renewOut.replaceChildren(h('p', { class: 'muted small', text: 'Der alte Code ist ab sofort ungültig. Bitte diesen sichern:' }), codeBlock(code));
      renew.remove();
    } catch (err) {
      toast(errorText(err));
      busy(renew, false);
    }
  });

  const lock = h('button', { class: 'btn btn-secondary', type: 'button' }, 'Geheimwort auf diesem Gerät sperren');
  lock.addEventListener('click', async () => {
    await vault.forgetKeys();
    state.key = null;
    close();
    root.replaceChildren(spinnerView());
    routeFn();
  });

  const close = openSheet('Einstellungen', h('div', { class: 'stack' },
    h('div', { class: 'field' }, h('label', { for: 'set-name', text: 'Dein Name' }), name), saveName,
    h('hr', { class: 'sep' }),
    h('h3', { class: 'sub-title', text: 'Wiederherstellung' }),
    h('p', { class: 'muted small', text: 'Hast du deinen Code nicht mehr? Erzeuge einen neuen und speichere ihn sicher.' }),
    renew, renewOut,
    h('hr', { class: 'sep' }),
    h('h3', { class: 'sub-title', text: 'Geheimwort' }),
    h('p', { class: 'muted small', text: 'Auf diesem iPhone entsperrt. Sperren heißt: Beim nächsten Öffnen wird das Geheimwort abgefragt.' }),
    lock,
    h('p', { class: 'muted small center-text', text: 'Wish ' + CONFIG.appVersion + ' · ' + state.members.length + ' von 2 Mitgliedern' })
  ));
}

// ---------------------------------------------------------------- Aktualisieren

let lastRefresh = Date.now();
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !state.me || !state.key) return;
  if (Date.now() - lastRefresh < 15000) return;
  if (document.querySelector('.backdrop')) return;
  lastRefresh = Date.now();
  try {
    await data.loadAll();
    if (!document.querySelector('.backdrop')) showMain(true);
  } catch (err) {
    if (err && err.code === 'session_lost') routeFn();
  }
});
