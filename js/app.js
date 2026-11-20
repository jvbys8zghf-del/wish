import { CONFIG } from './config.js';
import * as api from './api.js';
import * as vault from './crypto.js';
import { h, icon, toast, openSheet, avatar, busy } from './ui.js';

const root = document.getElementById('app');
const RECOVERY_PENDING = 'wish.recoveryPending';
const BROWSER_OK = 'wish.browserOk';

const state = {
  members: [],
  me: null,
  persons: [],
  occasions: [],
  tab: 'soon'
};

// ---------------------------------------------------------------- Start

function render(...nodes) {
  root.replaceChildren(...nodes);
  window.scrollTo(0, 0);
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;
}

async function route() {
  try {
    if (isIOS() && !isStandalone() && localStorage.getItem(BROWSER_OK) !== '1') {
      return showInstall();
    }
    if (!api.hasSession()) await api.signInAnonymously();

    state.members = await api.select('members', 'select=user_id,display_name,created_at&order=created_at.asc');
    state.me = state.members.find((m) => m.user_id === api.currentUserId()) || null;
    if (!state.me) return showWelcome();

    if (localStorage.getItem(RECOVERY_PENDING) === '1') {
      const code = await api.rpc('renew_recovery_code');
      return showRecoveryCode(code, false);
    }

    const rows = await api.rpc('my_key_material');
    const km = Array.isArray(rows) ? rows[0] : rows;
    if (!km || !km.key_salt || !km.key_check) return showSetSecret(false);

    const key = await vault.loadKey(state.me.user_id);
    if (!key) return showUnlock(km);

    await loadHousehold();
    return showMain();
  } catch (err) {
    return showError(err);
  }
}

async function loadHousehold() {
  const [persons, occasions] = await Promise.all([
    api.select('persons', 'select=id,name,emoji,color,birth_month,birth_day,birth_year,member_id,archived&archived=eq.false&order=name.asc'),
    api.select('occasions', 'select=id,person_id,title,kind,month,day,year,recurring')
  ]);
  state.persons = persons;
  state.occasions = occasions;
}

// ---------------------------------------------------------------- Fehler

function errorText(err) {
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

function showError(err) {
  if (err && err.code === 'session_lost') {
    toast('Die Anmeldung auf diesem Gerät ist abgelaufen.');
    return route();
  }
  const retry = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { render(spinnerView()); route(); } }, 'Erneut versuchen');
  render(h('section', { class: 'screen center' },
    h('div', { class: 'stack' },
      h('h1', { class: 'title-m', text: 'Das hat nicht geklappt' }),
      h('p', { class: 'muted', text: errorText(err) }),
      retry
    )
  ));
}

function spinnerView() {
  return h('div', { class: 'boot', role: 'status' },
    h('span', { class: 'spinner', 'aria-hidden': 'true' }),
    h('span', { class: 'visually-hidden', text: 'Lädt' }));
}

// ---------------------------------------------------------------- Installation

function showInstall() {
  render(h('section', { class: 'screen' },
    brand(),
    h('div', { class: 'stack' },
      h('h1', { class: 'title-m', text: 'Erst installieren' }),
      h('p', { class: 'muted', text: 'Wish funktioniert nur als App auf dem Home-Bildschirm zuverlässig. Nur dort bleibt deine Anmeldung erhalten.' })
    ),
    h('ol', { class: 'card steps' },
      h('li', null, h('span', { class: 'step-icon' }, icon('share')), h('span', null, 'Unten in Safari auf ', h('strong', { text: 'Teilen' }), ' tippen.')),
      h('li', null, h('span', { class: 'step-icon' }, icon('plusSquare')), h('span', null, h('strong', { text: 'Zum Home-Bildschirm' }), ' wählen und hinzufügen.')),
      h('li', null, h('span', { class: 'step-icon' }, icon('star')), h('span', null, 'Wish ', h('strong', { text: 'vom Home-Bildschirm' }), ' aus öffnen.'))
    ),
    h('button', {
      class: 'btn btn-plain', type: 'button',
      onclick: () => { localStorage.setItem(BROWSER_OK, '1'); render(spinnerView()); route(); }
    }, 'Trotzdem im Browser testen')
  ));
}

function brand() {
  return h('div', { class: 'brand' },
    h('img', { src: './icons/icon-192.png', alt: '', width: 72, height: 72, class: 'brand-icon' }),
    h('span', { class: 'brand-name', text: 'Wish' }));
}

// ---------------------------------------------------------------- Beitritt

function formatHex(value) {
  const hex = value.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 12);
  return hex.replace(/(.{4})(?=.)/g, '$1-');
}

function codeInput(id) {
  const input = h('input', {
    id, class: 'input code-input', type: 'text', inputmode: 'text', autocomplete: 'off',
    autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false',
    placeholder: '0000-0000-0000', maxlength: 14, required: true
  });
  input.addEventListener('input', () => {
    const pos = input.selectionStart;
    const before = input.value.length;
    input.value = formatHex(input.value);
    const diff = input.value.length - before;
    input.setSelectionRange(Math.max(0, pos + diff), Math.max(0, pos + diff));
  });
  return input;
}

function statusMessage(status) {
  switch (status) {
    case 'invalid': return 'Dieser Code passt nicht. Bitte genau prüfen.';
    case 'locked': return 'Zu viele Fehlversuche. Bitte in einer Stunde erneut versuchen.';
    case 'full': return 'Dieser Haushalt ist bereits vollständig.';
    default: return 'Das hat nicht geklappt.';
  }
}

function showWelcome() {
  const code = codeInput('household-code');
  const name = h('input', { id: 'my-name', class: 'input', type: 'text', autocomplete: 'given-name', maxlength: 40, required: true, placeholder: 'Dein Vorname' });
  const error = h('p', { class: 'form-error', role: 'alert' });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Haushalt beitreten');

  const form = h('form', { class: 'stack', novalidate: true },
    h('div', { class: 'field' }, h('label', { for: 'household-code', text: 'Haushaltscode' }), code,
      h('span', { class: 'hint', text: '12 Zeichen, 0–9 und A–F' })),
    h('div', { class: 'field' }, h('label', { for: 'my-name', text: 'Dein Name' }), name),
    error,
    submit
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    const hex = code.value.replace(/-/g, '');
    if (hex.length !== 12) { error.textContent = 'Der Code hat 12 Zeichen.'; code.focus(); return; }
    if (!name.value.trim()) { error.textContent = 'Bitte deinen Namen eingeben.'; name.focus(); return; }
    busy(submit, true, 'Prüfe Code …');
    try {
      const res = await api.rpc('join_household', { p_code: hex, p_name: name.value.trim(), p_emoji: null });
      if (res && res.status === 'ok') {
        localStorage.setItem(RECOVERY_PENDING, '1');
        return showRecoveryCode(res.recovery_code, true);
      }
      if (res && res.status === 'member') return route();
      error.textContent = statusMessage(res && res.status);
    } catch (err) {
      error.textContent = errorText(err);
    }
    busy(submit, false);
  });

  render(h('section', { class: 'screen' },
    brand(),
    h('div', { class: 'stack' },
      h('h1', { class: 'title-m', text: 'Willkommen' }),
      h('p', { class: 'muted', text: 'Gib den Haushaltscode ein, um eurer gemeinsamen Wunschliste beizutreten.' })
    ),
    form,
    h('button', { class: 'btn btn-plain', type: 'button', onclick: showRecover }, 'Ich habe einen Wiederherstellungscode')
  ));
  code.focus();
}

function showRecover() {
  const code = codeInput('recovery-code');
  const error = h('p', { class: 'form-error', role: 'alert' });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Auf dieses iPhone holen');
  const form = h('form', { class: 'stack', novalidate: true },
    h('div', { class: 'field' }, h('label', { for: 'recovery-code', text: 'Wiederherstellungscode' }), code),
    error, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    const hex = code.value.replace(/-/g, '');
    if (hex.length !== 12) { error.textContent = 'Der Code hat 12 Zeichen.'; return; }
    busy(submit, true, 'Prüfe Code …');
    try {
      const res = await api.rpc('recover_membership', { p_code: hex });
      if (res && res.status === 'ok') {
        localStorage.setItem(RECOVERY_PENDING, '1');
        return showRecoveryCode(res.recovery_code, true);
      }
      if (res && res.status === 'member') return route();
      error.textContent = statusMessage(res && res.status);
    } catch (err) {
      error.textContent = errorText(err);
    }
    busy(submit, false);
  });

  render(h('section', { class: 'screen' },
    h('div', { class: 'stack' },
      h('h1', { class: 'title-m', text: 'Neues iPhone' }),
      h('p', { class: 'muted', text: 'Mit deinem persönlichen Wiederherstellungscode ziehst du auf dieses Gerät um. Das alte Gerät verliert dabei sofort den Zugriff.' })
    ),
    form,
    h('button', { class: 'btn btn-plain', type: 'button', onclick: showWelcome }, 'Zurück')
  ));
  code.focus();
}

// ---------------------------------------------------------------- Wiederherstellungscode

function codeBlock(code) {
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
    h('div', { class: 'code-display', 'aria-label': 'Wiederherstellungscode ' + code.split('').join(' ') }, code),
    copy);
}

function showRecoveryCode(code, fresh) {
  const ack = h('input', { type: 'checkbox', id: 'ack' });
  const next = h('button', { class: 'btn btn-primary', type: 'button', disabled: true }, 'Weiter');
  ack.addEventListener('change', () => { next.disabled = !ack.checked; });
  next.addEventListener('click', () => {
    localStorage.removeItem(RECOVERY_PENDING);
    render(spinnerView());
    route();
  });
  render(h('section', { class: 'screen' },
    h('div', { class: 'stack' },
      h('span', { class: 'eyebrow', text: fresh ? 'Geschafft' : 'Bitte neu sichern' }),
      h('h1', { class: 'title-m', text: 'Dein Wiederherstellungscode' }),
      h('p', { class: 'muted', text: 'Er wird nur jetzt angezeigt. Damit holst du Wish auf ein neues iPhone, falls dieses verloren geht oder die App gelöscht wird. Ohne ihn ist dein Platz im Haushalt verloren.' })
    ),
    codeBlock(code),
    h('div', { class: 'card note' }, icon('key', 20),
      h('span', { text: 'Am besten in der Passwörter-App speichern: Neuer Eintrag, Titel „Wish“, Code als Passwort.' })),
    h('label', { class: 'check', for: 'ack' }, ack, h('span', { text: 'Ich habe den Code sicher gespeichert.' })),
    next
  ));
}

// ---------------------------------------------------------------- Geheimwort

function showSetSecret(isReset) {
  const p1 = h('input', { id: 'pw1', class: 'input', type: 'password', autocomplete: 'new-password', required: true });
  const p2 = h('input', { id: 'pw2', class: 'input', type: 'password', autocomplete: 'new-password', required: true });
  const error = h('p', { class: 'form-error', role: 'alert' });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Geheimwort festlegen');
  const form = h('form', { class: 'stack', novalidate: true },
    h('div', { class: 'field' }, h('label', { for: 'pw1', text: 'Geheimwort' }), p1,
      h('span', { class: 'hint', text: 'Mindestens 10 Zeichen. Ein kurzer Satz ist ideal.' })),
    h('div', { class: 'field' }, h('label', { for: 'pw2', text: 'Wiederholen' }), p2),
    error, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    const problem = vault.passphraseProblem(p1.value);
    if (problem) { error.textContent = problem; p1.focus(); return; }
    if (p1.value !== p2.value) { error.textContent = 'Die beiden Eingaben unterscheiden sich.'; p2.focus(); return; }
    busy(submit, true, 'Schlüssel wird erzeugt …');
    try {
      const km = await vault.createKeyMaterial(p1.value);
      await api.update('members', 'user_id=eq.' + encodeURIComponent(state.me.user_id), { key_salt: km.salt, key_check: km.check });
      const stored = await vault.rememberKey(state.me.user_id, km.key);
      if (!stored) toast('Hinweis: Dieses Gerät merkt sich den Schlüssel nicht dauerhaft.');
      render(spinnerView());
      return route();
    } catch (err) {
      error.textContent = errorText(err);
      busy(submit, false);
    }
  });

  render(h('section', { class: 'screen' },
    h('div', { class: 'stack' },
      h('span', { class: 'eyebrow', text: isReset ? 'Neu festlegen' : 'Letzter Schritt' }),
      h('h1', { class: 'title-m', text: 'Dein Geheimwort' }),
      h('p', { class: 'muted', text: 'Es verschlüsselt alles, was du heimlich für deinen Partner planst – direkt auf diesem iPhone. Niemand sonst kann es lesen, auch nicht über die Datenbank.' })
    ),
    h('div', { class: 'card note note-dark' }, icon('lock', 20),
      h('span', { text: 'Vergisst du das Geheimwort, sind deine geheimen Ideen unwiederbringlich verloren. Es gibt keine Zurücksetzung.' })),
    form
  ));
  p1.focus();
}

function showUnlock(km) {
  const pw = h('input', { id: 'pw', class: 'input', type: 'password', autocomplete: 'current-password', required: true });
  const error = h('p', { class: 'form-error', role: 'alert' });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Entsperren');
  const form = h('form', { class: 'stack', novalidate: true },
    h('div', { class: 'field' }, h('label', { for: 'pw', text: 'Geheimwort' }), pw),
    error, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    if (!pw.value) { pw.focus(); return; }
    busy(submit, true, 'Prüfe …');
    try {
      const key = await vault.unlock(pw.value, km.key_salt, km.key_check);
      if (!key) {
        error.textContent = 'Das Geheimwort stimmt nicht.';
        busy(submit, false);
        pw.select();
        return;
      }
      await vault.rememberKey(state.me.user_id, key);
      render(spinnerView());
      return route();
    } catch (err) {
      error.textContent = errorText(err);
      busy(submit, false);
    }
  });

  const forgot = h('button', { class: 'btn btn-plain', type: 'button' }, 'Geheimwort vergessen?');
  forgot.addEventListener('click', () => {
    const confirmBtn = h('button', { class: 'btn btn-danger', type: 'button' }, 'Neues Geheimwort festlegen');
    const close = openSheet('Geheimwort vergessen', h('div', { class: 'stack' },
      h('p', { text: 'Ein vergessenes Geheimwort lässt sich nicht wiederherstellen. Du kannst ein neues festlegen – deine bisherigen geheimen Ideen für deinen Partner bleiben dann aber unlesbar.' }),
      confirmBtn));
    confirmBtn.addEventListener('click', () => { close(); showSetSecret(true); });
  });

  render(h('section', { class: 'screen' },
    brand(),
    h('div', { class: 'stack' },
      h('h1', { class: 'title-m', text: 'Entsperren' }),
      h('p', { class: 'muted', text: 'Gib dein Geheimwort ein, um deine geheimen Ideen auf diesem iPhone lesen zu können.' })
    ),
    form, forgot
  ));
  pw.focus();
}

// ---------------------------------------------------------------- Termine

function startOfToday() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function easterSunday(year) {
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

function daysUntil(date, today) {
  return Math.round((date - today) / 86400000);
}

const fmtDate = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtToday = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

function upcoming() {
  const today = startOfToday();
  const byId = new Map(state.persons.map((p) => [p.id, p]));
  const items = [];

  for (const o of state.occasions) {
    let date = null;
    if (o.kind === 'easter') {
      date = easterSunday(today.getFullYear());
      if (date < today) date = easterSunday(today.getFullYear() + 1);
    } else if (o.recurring) {
      date = nextYearly(o.month, o.day, today);
    } else if (o.year) {
      date = dateIn(o.year, o.month, o.day);
      if (date < today) date = null;
    }
    if (!date) continue;
    const person = o.person_id ? byId.get(o.person_id) : null;
    if (o.person_id && !person) continue;
    items.push({
      key: 'o:' + o.id,
      title: person ? person.name + ' · ' + o.title : o.title,
      person,
      kind: o.kind === 'easter' ? 'easter' : (o.title === 'Weihnachten' && !person ? 'christmas' : 'custom'),
      date
    });
  }

  for (const p of state.persons) {
    if (!p.birth_month || !p.birth_day) continue;
    const date = nextYearly(p.birth_month, p.birth_day, today);
    const age = p.birth_year ? date.getFullYear() - p.birth_year : null;
    items.push({ key: 'b:' + p.id, title: p.name + ' · Geburtstag', person: p, kind: 'birthday', date, age });
  }

  return items
    .map((it) => Object.assign(it, { days: daysUntil(it.date, today) }))
    .filter((it) => it.days <= 400)
    .sort((a, b) => a.days - b.days);
}

// ---------------------------------------------------------------- Hauptansicht

const TABS = [
  { id: 'soon', label: 'Bald', icon: 'calendar' },
  { id: 'people', label: 'Personen', icon: 'people' },
  { id: 'bought', label: 'Gekauft', icon: 'bag' },
  { id: 'wishes', label: 'Wünsche', icon: 'heart' }
];

function showMain() {
  const content = h('div', { class: 'tab-content' });
  const nav = h('nav', { class: 'tabbar', 'aria-label': 'Bereiche' },
    TABS.map((t) => {
      const b = h('button', {
        type: 'button', class: 'tab', 'aria-current': state.tab === t.id ? 'page' : null,
        onclick: () => { state.tab = t.id; showMain(); }
      }, icon(t.icon, 24), h('span', { text: t.label }));
      return b;
    }));

  if (state.tab === 'soon') content.append(viewSoon());
  else if (state.tab === 'people') content.append(viewPeople());
  else if (state.tab === 'bought') content.append(viewBought());
  else content.append(viewWishes());

  render(h('div', { class: 'app-shell' }, content, nav));
}

function header(title, sub) {
  return h('header', { class: 'page-head' },
    h('div', null,
      sub ? h('span', { class: 'eyebrow', text: sub }) : null,
      h('h1', { class: 'title-l', text: title })),
    h('button', { class: 'icon-btn round', type: 'button', 'aria-label': 'Einstellungen', onclick: showSettings }, icon('person', 20)));
}

function partnerMissingCard() {
  if (state.members.length >= 2) return null;
  return h('div', { class: 'card note' }, icon('people', 20),
    h('span', { text: 'Noch allein im Haushalt. Dein Partner installiert Wish und gibt denselben Haushaltscode ein.' }));
}

function viewSoon() {
  const today = startOfToday();
  const list = upcoming();
  return h('div', { class: 'page' },
    header('Bald', fmtToday.format(today)),
    partnerMissingCard(),
    h('h2', { class: 'section-title', text: 'Nächste Anlässe' }),
    h('ul', { class: 'cards' }, list.map((it) => h('li', { class: 'card occasion' },
      it.person ? avatar(it.person.name, it.person.color)
        : h('span', { class: 'occ-icon occ-' + it.kind, 'aria-hidden': 'true' }, icon(it.kind === 'easter' ? 'egg' : it.kind === 'christmas' ? 'tree' : 'star')),
      h('div', { class: 'occ-text' },
        h('span', { class: 'occ-title', text: it.title }),
        h('span', { class: 'occ-sub', text: fmtDate.format(it.date) + (it.age ? ' · wird ' + it.age : '') })),
      h('div', { class: 'occ-days', 'aria-label': it.days === 0 ? 'heute' : 'in ' + it.days + ' Tagen' },
        h('span', { class: 'occ-num', text: it.days === 0 ? 'Heute' : String(it.days) }),
        it.days === 0 ? null : h('span', { class: 'occ-unit', text: it.days === 1 ? 'Tag' : 'Tage' }))
    )))
  );
}

function viewPeople() {
  const sorted = state.persons.slice().sort((a, b) => {
    const am = a.member_id ? 0 : 1;
    const bm = b.member_id ? 0 : 1;
    return am - bm || a.name.localeCompare(b.name, 'de');
  });
  return h('div', { class: 'page' },
    header('Personen'),
    partnerMissingCard(),
    h('ul', { class: 'list card' }, sorted.map((p) => h('li', { class: 'row' },
      avatar(p.name, p.color),
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title', text: p.name }),
        h('span', { class: 'row-sub', text: p.member_id === state.me.user_id ? 'Du' : p.member_id ? 'Partner' : 'Beschenkte Person' }))
    ))),
    h('p', { class: 'muted small', text: 'Kinder, Familie und Freunde legst du im nächsten Ausbauschritt an.' })
  );
}

function viewBought() {
  return h('div', { class: 'page' },
    header('Gekauft'),
    h('div', { class: 'empty' },
      h('span', { class: 'empty-icon', 'aria-hidden': 'true' }, icon('bag', 28)),
      h('p', { class: 'empty-title', text: 'Noch nichts gekauft' }),
      h('p', { class: 'muted', text: 'Hier stehen später alle besorgten Geschenke – mit Summen je Person und Anlass.' }))
  );
}

function viewWishes() {
  return h('div', { class: 'page' },
    header('Meine Wünsche'),
    h('div', { class: 'card note note-rose' }, icon('heart', 20),
      h('span', { text: 'Dein Partner sieht diese Liste. Ob er etwas davon besorgt, erfährst du nicht – das bleibt die Überraschung.' })),
    h('div', { class: 'empty' },
      h('p', { class: 'empty-title', text: 'Noch keine Wünsche' }),
      h('p', { class: 'muted', text: 'Eigene Wünsche eintragen kommt im nächsten Ausbauschritt.' }))
  );
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
      state.me.display_name = v;
      await loadHousehold();
      toast('Gespeichert.');
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
    close();
    render(spinnerView());
    route();
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

// ---------------------------------------------------------------- Start

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

route();
