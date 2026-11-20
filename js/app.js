import * as api from './api.js';
import * as vault from './crypto.js';
import { state, loadAll } from './data.js';
import { showMain, errorText, spinnerView, brand, codeBlock, setRoute } from './views.js';
import { h, icon, toast, openSheet, busy } from './ui.js';

const root = document.getElementById('app');
const RECOVERY_PENDING = 'wish.recoveryPending';
const BROWSER_OK = 'wish.browserOk';


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
    state.key = key;

    await loadAll();
    return showMain();
  } catch (err) {
    return showError(err);
  }
}

// ---------------------------------------------------------------- Fehler

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

// ---------------------------------------------------------------- Start

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

setRoute(route);
route();
