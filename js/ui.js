// DOM-Helfer. Alles wird über createElement/textContent gebaut, nie über
// innerHTML. Dadurch kann kein eingegebener Text als Code ausgeführt werden.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = Boolean(v);
      else if (k === 'disabled') el.disabled = Boolean(v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

const SVG = 'http://www.w3.org/2000/svg';
const ICONS = {
  calendar: ['M4 10h16M9 3v4M15 3v4', { rect: [4, 5, 16, 15, 3] }],
  people: ['M2.5 20c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5M17 14c2.3 0 4 1.2 4.7 4', { circles: [[9, 8, 3.5], [17, 9, 2.5]] }],
  bag: ['M5 8h14l-1 12H6z', 'M9 8V6a3 3 0 0 1 6 0v2'],
  heart: ['M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z'],
  person: ['M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6', { circles: [[12, 8, 4]] }],
  lock: ['M8 11V8a4 4 0 0 1 8 0v3', { rect: [5, 11, 14, 10, 2] }],
  tree: ['M12 3l4 6h-2.5l3.5 5h-3l4 6H6l4-6H7l3.5-5H8z', 'M12 20v1.5'],
  egg: ['M12 3c3.5 0 6 5.5 6 10a6 6 0 0 1-12 0c0-4.5 2.5-10 6-10z'],
  cake: ['M4 20h16M5 20v-7h14v7M8 13v-2M12 13v-2M16 13v-2M8 8.5c0-1 .8-1.5.8-2.5M12 8.5c0-1 .8-1.5.8-2.5M16 8.5c0-1 .8-1.5.8-2.5'],
  star: ['M12 4l2.4 5 5.6.6-4.2 3.8 1.2 5.5L12 16.2 7 18.9l1.2-5.5L4 9.6l5.6-.6z'],
  share: ['M12 15V4M8 8l4-4 4 4', 'M6 12H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1h-1'],
  plusSquare: ['M12 8v8M8 12h8', { rect: [4, 4, 16, 16, 4] }],
  copy: ['M8 8h11v12H8z', 'M5 16V4h11'],
  check: ['M5 12l5 5 9-10'],
  key: ['M14 10l7-7M18 6l2 2M16 8l2 2', { circles: [[9, 15, 5]] }],
  close: ['M6 6l12 12M18 6L6 18'],
  chevron: ['M9 5l7 7-7 7']
};

export function icon(name, size) {
  const spec = ICONS[name] || [];
  const s = size || 22;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('width', s);
  svg.setAttribute('height', s);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const part of spec) {
    if (typeof part === 'string') {
      const p = document.createElementNS(SVG, 'path');
      p.setAttribute('d', part);
      svg.appendChild(p);
    } else {
      if (part.rect) {
        const [x, y, w, hgt, r] = part.rect;
        const rect = document.createElementNS(SVG, 'rect');
        rect.setAttribute('x', x); rect.setAttribute('y', y);
        rect.setAttribute('width', w); rect.setAttribute('height', hgt);
        rect.setAttribute('rx', r);
        svg.appendChild(rect);
      }
      for (const [cx, cy, r] of part.circles || []) {
        const c = document.createElementNS(SVG, 'circle');
        c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r);
        svg.appendChild(c);
      }
    }
  }
  return svg;
}

let toastTimer = null;
export function toast(message) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = h('div', { class: 'toast', role: 'status' });
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// Blatt, das von unten hereinfährt. Gibt eine Funktion zum Schließen zurück.
export function openSheet(title, content) {
  const previousFocus = document.activeElement;
  const close = () => {
    backdrop.classList.remove('show');
    setTimeout(() => backdrop.remove(), 220);
    document.removeEventListener('keydown', onKey);
    if (previousFocus && previousFocus.focus) previousFocus.focus();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Schließen', onclick: close }, icon('close', 20));
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-grabber', 'aria-hidden': 'true' }),
    h('div', { class: 'sheet-head' }, h('h2', { text: title }), closeBtn),
    h('div', { class: 'sheet-body' }, content)
  );
  const backdrop = h('div', { class: 'backdrop', onclick: (e) => { if (e.target === backdrop) close(); } }, sheet);
  document.body.appendChild(backdrop);
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => {
    backdrop.classList.add('show');
    closeBtn.focus();
  });
  return close;
}

export function avatar(name, color, size) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const palette = [
    ['#F8E3E3', '#8C2F39'], ['#E4ECF7', '#2C4F80'], ['#E7E3F5', '#4B3C8C'],
    ['#EFE6F3', '#6A3E80'], ['#E2EFE8', '#1F6F55'], ['#F6E7D8', '#8A4B14']
  ];
  let hash = 0;
  for (const ch of name || '') hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  const [bg, fg] = palette[hash % palette.length];
  return h('span', {
    class: 'avatar' + (size === 'l' ? ' avatar-l' : ''),
    'aria-hidden': 'true',
    style: { background: color || bg, color: fg }
  }, initial);
}

export function busy(button, on, label) {
  if (on) {
    button.dataset.label = button.textContent;
    button.disabled = true;
    button.textContent = label || 'Einen Moment …';
  } else {
    button.disabled = false;
    if (button.dataset.label) button.textContent = button.dataset.label;
  }
}
