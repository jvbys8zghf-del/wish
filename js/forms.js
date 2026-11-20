// Eingabeblätter: Idee erfassen/bearbeiten, Person, Anlass.
import * as data from './data.js';
import { state } from './data.js';
import { h, icon, toast, openSheet, avatar, busy, PALETTE } from './ui.js';

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli',
  'August', 'September', 'Oktober', 'November', 'Dezember'];
const fmtShort = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });

let onChange = () => {};
export function setOnChange(fn) { onChange = fn; }

function field(id, label, input, hint) {
  return h('div', { class: 'field' },
    h('label', { for: id, text: label }), input,
    hint ? h('span', { class: 'hint', text: hint }) : null);
}

function errorBox() {
  return h('p', { class: 'form-error', role: 'alert' });
}

function errText(err) {
  return String(err && err.message || err || 'Das hat nicht geklappt.');
}

// ---------------------------------------------------------------- Idee

// opts: { ideaId, personId, fromWish }
export function openIdeaForm(opts) {
  const o = opts || {};
  const existing = o.ideaId ? state.ideas.find((i) => i.id === o.ideaId) : null;
  const src = existing || o.fromWish || null;
  let personId = existing ? existing.personId : o.fromWish ? data.partnerPerson().id : o.personId || null;
  let coIds = existing ? existing.coIds.slice() : [];
  let dupConfirmed = false;

  const title = h('input', { id: 'f-title', class: 'input input-l', type: 'text', maxlength: 200, autocomplete: 'off', value: src ? src.title : '' });
  const url = h('input', { id: 'f-url', class: 'input', type: 'url', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off', placeholder: 'https://…', value: src && src.url ? src.url : '' });
  const price = h('input', { id: 'f-price', class: 'input', type: 'text', inputmode: 'decimal', placeholder: 'z. B. 49,99', value: src && src.price_cents !== null && src.price_cents !== undefined ? String((src.price_cents / 100).toFixed(2)).replace('.', ',') : '' });
  const details = h('input', { id: 'f-details', class: 'input', type: 'text', maxlength: 500, placeholder: 'Größe, Farbe, Variante', value: src && src.details ? src.details : '' });
  const note = h('textarea', { id: 'f-note', class: 'input textarea', maxlength: 4000, rows: 3 });
  note.value = src && src.note ? src.note : '';
  const occasion = h('select', { id: 'f-occasion', class: 'input' });
  const error = errorBox();
  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, existing ? 'Speichern' : 'Sichern');

  const secretHint = h('div', { class: 'card note note-dark small-note' }, icon('lock', 18),
    h('span', { text: 'Wird verschlüsselt. Nur du kannst diese Idee lesen.' }));
  const wishHint = h('div', { class: 'card note note-rose small-note' }, icon('heart', 18),
    h('span', { text: 'Dein Wunsch. Dein Partner sieht ihn, du siehst nie, ob er ihn besorgt.' }));
  const hintSlot = h('div');

  function fillOccasions() {
    const person = data.personById(personId);
    const current = occasion.value || (src ? src.occasion || '' : '');
    occasion.replaceChildren(h('option', { value: '' }, 'Kein bestimmter Anlass'));
    for (const opt of data.occasionOptions(person)) {
      occasion.append(h('option', { value: opt.value }, opt.label + ' · ' + fmtShort.format(opt.date)));
    }
    occasion.value = Array.from(occasion.options).some((x) => x.value === current) ? current : '';
    hintSlot.replaceChildren(
      data.isPartner(person) ? secretHint : data.isMe(person) ? wishHint : '');
  }

  // Gemeinsames Geschenk für mehrere Personen ohne Login
  const coChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Gemeinsam mit' });
  const coField = h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Gemeinsam mit (optional)' }), coChips);
  function renderCo() {
    const main = data.personById(personId);
    if (!main || main.member_id) { coField.hidden = true; coIds = []; return; }
    coField.hidden = false;
    coIds = coIds.filter((id) => id !== personId);
    const others = state.persons.filter((p) => !p.member_id && p.id !== personId)
      .sort((a, b) => (b.is_child - a.is_child) || a.name.localeCompare(b.name, 'de'));
    coChips.replaceChildren(...others.map((p) => {
      const on = coIds.includes(p.id);
      return h('button', {
        type: 'button', class: 'chip chip-s' + (on ? ' chip-on' : ''), 'aria-pressed': on ? 'true' : 'false',
        onclick: () => { coIds = on ? coIds.filter((x) => x !== p.id) : coIds.concat(p.id); renderCo(); }
      }, p.name);
    }));
  }

  // Personenwahl
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Für wen?' });
  function renderChips() {
    const persons = state.persons.slice().sort((a, b) => {
      const ra = data.isMe(a) ? 2 : data.isPartner(a) ? 1 : 0;
      const rb = data.isMe(b) ? 2 : data.isPartner(b) ? 1 : 0;
      return ra - rb || a.name.localeCompare(b.name, 'de');
    });
    chips.replaceChildren(...persons.map((p) => {
      const selected = p.id === personId;
      const label = data.isMe(p) ? 'Ich' : p.name;
      return h('button', {
        type: 'button', class: 'chip' + (selected ? ' chip-on' : ''), 'aria-pressed': selected ? 'true' : 'false',
        onclick: () => { personId = p.id; renderChips(); fillOccasions(); renderCo(); }
      }, avatar(p.name, p.color, 's'), label, data.isPartner(p) ? icon('lock', 14) : null);
    }));
  }

  const paste = h('button', { class: 'btn btn-secondary', type: 'button' }, icon('clipboard', 18), 'Link aus Zwischenablage');
  paste.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      const found = data.firstUrlIn(text) || (data.normalizeUrl(text) ? text.trim() : null);
      if (!found) { toast('In der Zwischenablage ist kein Link.'); return; }
      url.value = found;
      if (!title.value.trim()) {
        const shop = data.shopFromUrl(data.normalizeUrl(found));
        if (shop) title.placeholder = 'Was ist es? (' + shop + ')';
        title.focus();
      }
    } catch (e) {
      toast('Kein Zugriff auf die Zwischenablage. Bitte ins Linkfeld einfügen.');
    }
  });

  const form = h('form', { class: 'stack', novalidate: true },
    field('f-title', 'Was?', title),
    !existing ? h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Für wen?' }), chips)
      : h('p', { class: 'muted small', text: 'Für ' + (data.isMe(data.personById(personId)) ? 'dich' : data.personById(personId).name) }),
    hintSlot,
    coField,
    field('f-occasion', 'Anlass', occasion),
    paste,
    field('f-url', 'Link', url),
    field('f-price', 'Preis', price),
    field('f-details', 'Größe, Farbe, Variante', details),
    field('f-note', 'Notiz', note),
    error,
    save
  );

  let close = null;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    const t = title.value.trim();
    if (!t) { error.textContent = 'Bitte eintragen, was es ist.'; title.focus(); return; }
    if (!personId) { error.textContent = 'Bitte auswählen, für wen.'; return; }
    const u = data.normalizeUrl(url.value);
    if (u === undefined) { error.textContent = 'Der Link sieht nicht gültig aus.'; url.focus(); return; }
    const pc = data.parsePrice(price.value);
    if (pc === undefined) { error.textContent = 'Bitte den Preis als Zahl eingeben, z. B. 49,99.'; price.focus(); return; }
    if (!dupConfirmed) {
      const similar = data.similarGifts(personId, t, u, existing ? existing.id : null);
      if (similar.length) {
        const s0 = similar[0];
        const when = s0.status === 'given' ? 'schon verschenkt' : 'schon gekauft';
        const occ = data.occasionLabel(s0.statusOccasion, data.personById(personId));
        error.textContent = 'Ähnliches ' + when + ': „' + s0.title + '“' + (occ ? ' (' + occ + (s0.statusYear ? ' ' + s0.statusYear : '') + ')' : '') + '. Trotzdem sichern?';
        dupConfirmed = true;
        save.textContent = 'Trotzdem sichern';
        return;
      }
    }
    busy(save, true, 'Speichere …');
    try {
      await data.saveIdea({
        personId, title: t, note: note.value.trim(), url: u, price_cents: pc,
        details: details.value.trim(), occasion: occasion.value || null,
        coIds: data.isPartner(data.personById(personId)) || data.isMe(data.personById(personId)) ? undefined : coIds,
        fromWishId: existing ? existing.fromWishId : o.fromWish ? o.fromWish.id : null
      }, existing ? existing.id : null);
      close();
      toast(existing ? 'Gespeichert.' : 'Idee gesichert.');
      onChange();
    } catch (err) {
      error.textContent = errText(err);
      busy(save, false);
    }
  });

  if (!existing) renderChips();
  fillOccasions();
  renderCo();
  close = openSheet(existing ? 'Idee bearbeiten' : o.fromWish ? 'Wunsch übernehmen' : 'Neue Idee', form);
  if (!existing && !o.fromWish) setTimeout(() => title.focus(), 250);
}

// ---------------------------------------------------------------- Person

export function openPersonForm(personId) {
  const existing = personId ? data.personById(personId) : null;
  const name = h('input', { id: 'p-name', class: 'input', type: 'text', maxlength: 60, autocomplete: 'off', value: existing ? existing.name : '' });
  const day = h('input', { id: 'p-day', class: 'input', type: 'text', inputmode: 'numeric', maxlength: 2, placeholder: 'Tag', value: existing && existing.birth_day ? String(existing.birth_day) : '' });
  const month = h('select', { id: 'p-month', class: 'input', 'aria-label': 'Monat' },
    h('option', { value: '' }, 'Monat'),
    MONTHS.map((m, i) => h('option', { value: String(i + 1) }, m)));
  month.value = existing && existing.birth_month ? String(existing.birth_month) : '';
  const year = h('input', { id: 'p-year', class: 'input', type: 'text', inputmode: 'numeric', maxlength: 4, placeholder: 'Jahr (optional)', value: existing && existing.birth_year ? String(existing.birth_year) : '' });
  let color = existing && existing.color ? existing.color : PALETTE[0][0];
  const colors = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Farbe' });
  function renderColors() {
    colors.replaceChildren(...PALETTE.map(([bg, fg]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': bg === color ? 'true' : 'false',
      'aria-label': 'Farbe', class: 'swatch' + (bg === color ? ' swatch-on' : ''),
      style: { background: bg, color: fg },
      onclick: () => { color = bg; renderColors(); }
    }, bg === color ? icon('check', 18) : '')));
  }
  renderColors();

  const error = errorBox();
  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, existing ? 'Speichern' : 'Person anlegen');
  const isMember = existing && existing.member_id;
  const child = h('input', { id: 'p-child', type: 'checkbox', checked: existing ? existing.is_child : false });

  const form = h('form', { class: 'stack', novalidate: true },
    isMember ? null : field('p-name', 'Name', name),
    h('div', { class: 'field' },
      h('span', { class: 'field-label', text: 'Geburtstag' }),
      h('div', { class: 'date-row' }, day, month, year)),
    h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Farbe' }), colors),
    isMember ? null : h('label', { class: 'check', for: 'p-child' }, child,
      h('span', { text: 'Unser Kind – zählt im Gerechtigkeits-Vergleich' })),
    error, save,
    existing && !isMember ? h('button', { class: 'btn btn-plain danger', type: 'button', onclick: () => confirmDeletePerson(existing, close) }, 'Person löschen') : null
  );

  let close = null;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    const n = isMember ? existing.name : name.value.trim();
    if (!n) { error.textContent = 'Bitte einen Namen eingeben.'; name.focus(); return; }
    const d = day.value.trim() ? Number(day.value) : null;
    const m = month.value ? Number(month.value) : null;
    const y = year.value.trim() ? Number(year.value) : null;
    if ((d === null) !== (m === null)) { error.textContent = 'Für den Geburtstag Tag und Monat angeben – oder beides leer lassen.'; return; }
    if (d !== null && (!Number.isInteger(d) || d < 1 || d > new Date(2024, m, 0).getDate())) { error.textContent = 'Diesen Tag gibt es im gewählten Monat nicht.'; return; }
    if (y !== null && (!Number.isInteger(y) || y < 1900 || y > new Date().getFullYear())) { error.textContent = 'Bitte ein gültiges Geburtsjahr eingeben.'; return; }
    busy(save, true, 'Speichere …');
    const values = { birth_day: d, birth_month: m, birth_year: d === null ? null : y, color };
    if (!isMember) values.is_child = child.checked;
    try {
      if (existing) {
        if (!isMember) values.name = n;
        await data.updatePerson(existing.id, values);
      } else {
        values.name = n;
        const row = await data.createPerson(values);
        state.personId = row && row.id ? row.id : null;
        state.tab = 'people';
      }
      close();
      onChange();
    } catch (err) {
      error.textContent = errText(err);
      busy(save, false);
    }
  });

  close = openSheet(existing ? (isMember ? existing.name : 'Person bearbeiten') : 'Neue Person', form);
  if (!existing) setTimeout(() => name.focus(), 250);
}

function confirmDeletePerson(person, closeParent) {
  const count = data.ideasFor(person.id).length;
  const go = h('button', { class: 'btn btn-danger', type: 'button' }, person.name + ' löschen');
  const close = openSheet('Wirklich löschen?', h('div', { class: 'stack' },
    h('p', { text: count
      ? person.name + ' und ' + count + (count === 1 ? ' Idee' : ' Ideen') + ' werden für euch beide gelöscht. Das lässt sich nicht rückgängig machen.'
      : person.name + ' wird für euch beide gelöscht.' }),
    go));
  go.addEventListener('click', async () => {
    busy(go, true);
    try {
      await data.deletePerson(person.id);
      close();
      closeParent();
      state.personId = null;
      onChange();
    } catch (err) {
      toast(errText(err));
      busy(go, false);
    }
  });
}

// ---------------------------------------------------------------- Anlass

export function openOccasionForm(personId) {
  const person = data.personById(personId);
  const title = h('input', { id: 'o-title', class: 'input', type: 'text', maxlength: 60, placeholder: 'z. B. Einschulung, Besuch, Jahrestag' });
  const day = h('input', { id: 'o-day', class: 'input', type: 'text', inputmode: 'numeric', maxlength: 2, placeholder: 'Tag' });
  const month = h('select', { id: 'o-month', class: 'input', 'aria-label': 'Monat' },
    h('option', { value: '' }, 'Monat'), MONTHS.map((m, i) => h('option', { value: String(i + 1) }, m)));
  const year = h('input', { id: 'o-year', class: 'input', type: 'text', inputmode: 'numeric', maxlength: 4, placeholder: 'Jahr' });
  const recurring = h('input', { id: 'o-rec', type: 'checkbox', checked: true });
  const error = errorBox();
  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Anlass anlegen');

  const form = h('form', { class: 'stack', novalidate: true },
    field('o-title', 'Anlass', title),
    h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Datum' }), h('div', { class: 'date-row' }, day, month, year)),
    h('label', { class: 'check', for: 'o-rec' }, recurring, h('span', { text: 'Jedes Jahr wiederkehrend' })),
    error, save);

  let close = null;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    const t = title.value.trim();
    const d = Number(day.value);
    const m = Number(month.value);
    const y = year.value.trim() ? Number(year.value) : null;
    if (!t) { error.textContent = 'Bitte den Anlass benennen.'; title.focus(); return; }
    if (!m || !Number.isInteger(d) || d < 1 || d > new Date(2024, m, 0).getDate()) { error.textContent = 'Bitte ein gültiges Datum angeben.'; return; }
    if (!recurring.checked && (y === null || !Number.isInteger(y) || y < new Date().getFullYear() || y > 2100)) {
      error.textContent = 'Für einen einmaligen Anlass bitte das Jahr angeben.'; return;
    }
    busy(save, true, 'Speichere …');
    try {
      await data.createOccasion({
        person_id: person ? person.id : null, title: t, kind: 'fixed', month: m, day: d,
        year: recurring.checked ? null : y, recurring: recurring.checked
      });
      close();
      onChange();
    } catch (err) {
      error.textContent = errText(err);
      busy(save, false);
    }
  });

  close = openSheet(person ? 'Anlass für ' + person.name : 'Neuer Anlass', form);
  setTimeout(() => title.focus(), 250);
}
