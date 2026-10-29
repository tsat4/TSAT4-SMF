// Shared shell: helpers, popup, api(), session screens, and the view router.
// Modules register into VIEWS / TITLES / ACCESS. Scripts share one global scope: never reuse a top-level name.
const RANK = { viewer: 1, user: 2, admin: 3 };
const PAGE = 50;
const TITLES = {
  main: ['TSAT4 SMF', 'หน้าหลัก']
};
// view name -> render(target)
const VIEWS = {};
// view name -> [moduleId, minimum rank]; below it the view opens as 'locked'
const ACCESS = {};
// render for view names not in VIEWS (set by units.js)
let viewFallback = null;

let me = null;
let view = 'main';

const $ = (id) => document.getElementById(id);
const onErr = (err) => toast(err.message, 'error');

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function button(id, label, kind = 'secondary', extra = '') {
  return `<button class="btn btn-${kind}" type="button"${id ? ` id="${id}"` : ''} ${extra}>${label}</button>`;
}

function field(label, control, extra = '') {
  return `<label class="field${extra ? ` ${extra}` : ''}">${label}${control}</label>`;
}

function squareJpeg(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const size = 512;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const side = Math.min(image.width, image.height);
      canvas.getContext('2d').drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('จัดรูปไม่ได้'));
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('อ่านรูปไม่ได้'));
        reader.readAsDataURL(blob);
      }, 'image/jpeg', 0.75);
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('เปิดรูปไม่ได้')); };
    image.src = url;
  });
}

function options(values, current, labelOf = (value) => value) {
  return values.map((value) => `<option value="${esc(value)}"${String(current) === String(value) ? ' selected' : ''}>${esc(labelOf(value))}</option>`).join('');
}

function searchSlot(label, inputId, buttonId, { placeholder = '', grow = false } = {}) {
  const hint = placeholder ? ` placeholder="${esc(placeholder)}"` : '';
  return `<div class="search-slot">${field(label, `<input id="${inputId}"${hint}>`, grow ? 'grow' : '')}${button(buttonId, 'ค้นหา')}</div>`;
}

function searchBlock(slot, listId) {
  return `<div class="search-block">${slot}<div class="search-list" id="${listId}"></div></div>`;
}

function crudBar(prefix) {
  return `<div class="action-bar">${button(`${prefix}-add`, 'เพิ่ม', 'primary')}${button(`${prefix}-edit`, 'แก้ไข', 'secondary', 'disabled')}${button(`${prefix}-del`, 'ลบ', 'danger', 'disabled')}</div>`;
}

function tableFoot(prefix) {
  return `<div class="table-foot">
      <div class="sum-meta" id="${prefix}-count"></div>
      <div class="pager">${button(`${prefix}-prev`, 'ก่อนหน้า')}<span class="pager-page" id="${prefix}-page"></span>${button(`${prefix}-next`, 'ถัดไป')}</div>
    </div>`;
}

function tablePage(prefix, toolbar) {
  return `<div class="toolbar">${toolbar}</div>
    <div class="table-wrap sheet" id="${prefix}-rows"></div>
    ${tableFoot(prefix)}`;
}

function setPager(prefix, offset, total) {
  const pages = Math.max(1, Math.ceil(Number(total) / PAGE) || 1);
  const page = total > 0 ? Math.min(pages, Math.floor(offset / PAGE) + 1) : 1;
  const label = $(`${prefix}-page`);
  if (label) label.textContent = `หน้า ${page.toLocaleString('en-US')} / ${pages.toLocaleString('en-US')}`;
  const prev = $(`${prefix}-prev`);
  const next = $(`${prefix}-next`);
  if (prev) prev.disabled = page <= 1;
  if (next) next.disabled = page >= pages || !(total > 0);
}

function listQuery(rows, head, valueOf) {
  const filters = head?.filters || {};
  const filtered = rows.filter((row) => Object.entries(filters).every(([key, term]) => {
    const want = String(term || '').trim().toLowerCase();
    if (!want) return true;
    return String(valueOf(row, key) ?? '').toLowerCase().includes(want);
  }));
  if (!head?.sort) return filtered;
  const dir = head.dir === 'desc' ? -1 : 1;
  const compare = (a, b) => {
    const as = String(a ?? '').trim();
    const bs = String(b ?? '').trim();
    if (!as && bs) return 1;
    if (as && !bs) return -1;
    if (/^-?\d+(\.\d+)?$/.test(as) && /^-?\d+(\.\d+)?$/.test(bs)) return Number(as) - Number(bs);
    return as.localeCompare(bs, 'th', { numeric: true, sensitivity: 'base' });
  };
  return [...filtered].sort((a, b) => dir * compare(valueOf(a, head.sort), valueOf(b, head.sort)));
}

function fillTable(id, headers, rows, emptyText, head) {
  const cells = headers.map((header) => {
    const label = typeof header === 'string' ? header : header.label;
    const key = typeof header === 'string' ? '' : header.key;
    const num = typeof header === 'object' && header.num ? ' num' : ''; // number column: header right-aligned like its values
    if (!head || !key) return `<th${num ? ' class="num"' : ''}>${esc(label)}</th>`;
    const asc = head.sort === key && head.dir !== 'desc';
    return `<th class="has-menu${num}"><div class="th-line"><span class="th-label">${esc(label)}</span><button class="th-tool${asc ? ' is-active' : ''}" type="button" data-col-sort="${esc(key)}" aria-label="${asc ? 'เรียง Z ไป A' : 'เรียง A ไป Z'}"><span class="material-symbols-rounded">sort_by_alpha</span></button></div></th>`;
  }).join('');
  const body = rows || `<tr><td class="empty" colspan="${Math.max(headers.length, 1)}">${emptyText}</td></tr>`;
  const node = $(id);
  if (!rows && !head) {
    node.innerHTML = `<p class="empty">${emptyText}</p>`;
    return;
  }
  node.innerHTML = `<table class="mo-data-table"><thead><tr>${cells}</tr></thead><tbody>${body}</tbody></table>`;
  if (!head) return;
  node.querySelectorAll('[data-col-sort]').forEach((btn) => {
    btn.onclick = (event) => {
      event.stopPropagation();
      const key = btn.dataset.colSort;
      const asc = head.sort === key && head.dir !== 'desc';
      head.onChange({ sort: key, dir: asc ? 'desc' : 'asc', filters: head.filters || {} });
    };
  });
}

// fillTable's `head`: keeps sort and filters in the given object and calls reload() after a change.
function headFor(head, reload) {
  return { ...head, onChange: (next) => { Object.assign(head, next); reload(); } };
}

// ---------- Charts: one look for every dashboard (CFO layout) ----------
// Tone by section: ระบบงาน warm (red/orange/yellow/brown/pink, neighbours different hues), ระบบกิจกรรม and the rest
// green family from the user palette (#1B5E20 #2E7D32 #43A047 #66BB6A) spread across forest / yellow-green / teal so
// neighbours stay apart. Base year = slate. Marks: solid edge + the same
// colour inside 60% transparent (AGENTS.md "หน้าจอ"). CSS: .ch-* in app.css.
const CHART_THEMES = {
  cool: { series: ['#1B5E20', '#7CB342', '#00897B', '#43A047', '#C5E1A5', '#4DB6AC', '#2E7D32', '#64748b'], base: ['#334155', '#64748b', '#94a3b8'], line: '#2E7D32', dark: '#1e293b', target: '#43A047' },
  warm: { series: ['#ea580c', '#dc2626', '#eab308', '#92400e', '#db2777', '#fb923c', '#a16207', '#78716c'], base: ['#44403c', '#78716c', '#a8a29e'], line: '#ea580c', dark: '#292524', target: '#b45309' }
};
// Read at render time, so the colours follow the page being drawn (openView sets body[data-zone]).
const CHART = {
  get theme() { return CHART_THEMES[document.body.dataset.zone === 'work' ? 'warm' : 'cool']; },
  get series() { return CHART.theme.series; },
  get base() { return CHART.theme.base; },
  get line() { return CHART.theme.line; },
  get dark() { return CHART.theme.dark; },
  get target() { return CHART.theme.target; }
};

function chartNum(value, digits = 3) {
  return Number(value || 0).toLocaleString('th-TH', { maximumFractionDigits: digits });
}

// Axis top: a round number at or above v, in 4 steps.
function chartNiceMax(v) {
  const step = Math.max(v, 1e-9) / 4;
  const mag = 10 ** Math.floor(Math.log10(step));
  return [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10].map((n) => n * mag).find((n) => n >= step) * 4;
}

// "ลดลง x%" / "เพิ่มขึ้น x%" of now against was. Lower is good (green) unless upGood.
function chartPill(now, was, suffix = '', upGood = false) {
  if (!was) return '';
  const pct = Math.round(((now - was) / was) * 1000) / 10;
  const good = upGood ? pct >= 0 : pct <= 0;
  return `<span class="ch-pill ${good ? 'is-good' : 'is-bad'}">${pct > 0 ? 'เพิ่มขึ้น' : 'ลดลง'} ${Math.abs(pct)}%${suffix}</span>`;
}

// KPI card, same frame everywhere: [pie or icon] label / value + unit / pill + note.
// pie = 0–100 share drawn in color; otherwise icon (Material Symbol name, default insights).
function chartKpi({ label, value, unit = '', pill = '', note = '', color = CHART.series[0], pie = null, icon = 'insights' }) {
  const lead = pie != null ? `<span class="ch-pie" style="--p:${Math.max(0, Math.min(100, pie))}%"></span>` : `<span class="ch-icon material-symbols-rounded">${icon}</span>`;
  return `<article class="ch-kpi" style="--c:${color}">${lead}<div class="ch-kpi-body"><div class="ch-kpi-label">${label}</div>
    <div class="ch-kpi-value"><strong>${value}</strong>${unit ? `<small>${unit}</small>` : ''}</div><div class="ch-kpi-foot">${pill}${note ? `<span>${note}</span>` : ''}</div></div></article>`;
}

// Chart card frame: title (left), optional small text (right), then the chart.
// A card holding a chart has no title (ผู้ใช้กำหนด 2026-10-28): only its small note on the right, if any.
// Table cards keep their title.
function chartCard(title, body, meta = '') {
  const chart = /class="(ch-plot|sto-donut-wrap)/.test(body);
  const head = chart ? (meta ? `<div class="ch-head is-meta"><div class="sum-meta">${meta}</div></div>` : '') : `<div class="ch-head"><div class="card-title">${title}</div>${meta ? `<div class="sum-meta">${meta}</div>` : ''}</div>`;
  return `<section class="card ch-card"${chart ? ` aria-label="${esc(String(title).replace(/<[^>]*>/g, ''))}"` : ''}>${head}${body}</section>`;
}

// Monthly (or any labelled) chart: bars on the left axis — each series one bar per label, a value or a stack
// [v1, v2, …] coloured by `colors` — and lines on the left or right axis, gridlines, and a legend.
// Axis titles sit above their axis (left / right), so the plot keeps the full width.
// legend: { line: color, dash, label } | { box: color, label } | { head: text }. Hover tip: chartTip(id, (i) => html).
function chartPlot({ id, labels, bars = [], lines = [], left = '', right = '', legend = [], leftMax = 0, digits = 0 }) {
  const n = labels.length;
  const sum = (v) => (Array.isArray(v) ? v.reduce((t, x) => t + (Number(x) || 0), 0) : Number(v) || 0);
  const leftLines = lines.filter((l) => l.axis !== 'right');
  const rightLines = lines.filter((l) => l.axis === 'right');
  const yL = leftMax || chartNiceMax(Math.max(...bars.flatMap((b) => b.values.map(sum)), ...leftLines.flatMap((l) => l.values.filter((v) => v != null)), 1) * 1.1);
  const yR = rightLines.length ? chartNiceMax(Math.max(...rightLines.flatMap((l) => l.values.filter((v) => v != null)), 1) * 1.05) : 0;
  const ticks = (max) => [4, 3, 2, 1, 0].map((k) => `<span>${chartNum((max / 4) * k, digits)}</span>`).join('');
  const x = (i) => ((i + 0.5) / n) * 100;
  const bar = (b, i) => {
    const v = b.values[i];
    const parts = Array.isArray(v) ? v : [v];
    const total = sum(v);
    return `<div class="ch-stack" style="height:${(total / yL) * 100}%">${total ? `<span class="ch-val">${chartNum(total, digits)}</span>` : ''}${total ? parts.map((p, k) => (p ? `<div style="flex:${p};--c:${(b.colors || CHART.series)[k]}"></div>` : '')).reverse().join('') : ''}</div>`;
  };
  const scale = (l) => (l.axis === 'right' ? yR : yL);
  const poly = (l) => {
    const pts = l.values.map((v, i) => (v == null ? null : `${x(i) * 12},${1000 - (v / scale(l)) * 1000}`)).filter(Boolean);
    return pts.length ? `<polyline points="${pts.join(' ')}" fill="none" stroke="${l.color}" stroke-width="2.5"${l.dash ? ' stroke-dasharray="7 5"' : ''} vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>` : '';
  };
  const dots = (l) => (l.dots === false ? '' : l.values.map((v, i) => (v == null ? '' : `<i class="ch-pt" style="left:${x(i)}%;bottom:${(v / scale(l)) * 100}%;--c:${l.color}"></i>`)).join(''));
  // Value above each point (below for a dashed line, so a target under its base line does not collide); labels: 'last' = only the latest point (lines that sit close to another line), false = none.
  // A target line (dashed, one value all year, or target: true) gets one label "Target : 80%" on the line at the right end (ผู้ใช้กำหนด 2026-10-29).
  const values = (l) => {
    if (l.labels === false) return '';
    const shown = l.values.filter((v) => v != null);
    if (l.target || (l.dash && shown.length > 1 && shown.every((v) => v === shown[0]))) {
      const v = shown[shown.length - 1];
      return v == null ? '' : `<span class="ch-target" style="bottom:${(v / scale(l)) * 100}%;--c:${l.color}">Target : ${chartNum(v, digits)}${esc(l.unit || '')}</span>`;
    }
    const last = l.values.reduce((k, v, i) => (v == null ? k : i), -1);
    return l.values.map((v, i) => (v == null || (l.labels === 'last' && i !== last) ? '' : `<span class="ch-lv${l.dash ? ' is-below' : ''}" style="left:${x(i)}%;bottom:${(v / scale(l)) * 100}%;--c:${l.color}">${chartNum(v, digits)}</span>`)).join('');
  };
  const key = (item) => (item.head ? `<b>${esc(item.head)}</b>` : item.line ? `<span><i class="ln${item.dash ? ' is-dash' : ''}" style="--c:${item.line}"></i>${esc(item.label)}</span>` : `<span><i class="sq" style="--c:${item.box}"></i>${esc(item.label)}</span>`);
  return `<div class="ch-plot${yR ? ' has-right' : ''}">
      <div class="ch-titles"><span>${esc(left)}</span>${legend.length ? `<div class="ch-legend">${legend.map(key).join('')}</div>` : ''}<span>${yR ? esc(right) : ''}</span></div>
      <div class="ch-yaxis">${ticks(yL)}</div>
      <div class="ch-area" id="${id}">
        ${[0, 1, 2, 3, 4].map((k) => `<i class="ch-grid" style="bottom:${k * 25}%"></i>`).join('')}
        <div class="ch-cols" style="grid-template-columns:repeat(${n},minmax(0,1fr))">${labels.map((_, i) => `<div class="ch-col" data-i="${i}"><div class="ch-pair">${bars.map((b) => bar(b, i)).join('')}</div></div>`).join('')}</div>
        <svg class="ch-lines" viewBox="0 0 1200 1000" preserveAspectRatio="none" aria-hidden="true">${lines.map(poly).join('')}</svg>
        ${lines.map(dots).join('')}${lines.map(values).join('')}
        <div class="ch-tip" hidden></div>
      </div>
      ${yR ? `<div class="ch-yaxis is-right">${ticks(yR)}</div>` : ''}
      <div class="ch-xaxis" style="grid-template-columns:repeat(${n},minmax(0,1fr))">${labels.map((l) => `<span>${esc(l)}</span>`).join('')}</div>
    </div>
    `;
}

// Every bar shows its total on top and every line point its value (AGENTS.md: chart rules).
// Hover box over a chartPlot column; html(i) returns its content (rows: <div class="ch-tip-row"><span>…</span><b>…</b></div>).
function chartTip(id, html) {
  const area = $(id);
  if (!area) return;
  const tip = area.querySelector('.ch-tip');
  const n = area.querySelectorAll('.ch-col').length;
  area.querySelectorAll('.ch-col').forEach((col) => {
    col.onmouseenter = () => {
      const i = Number(col.dataset.i);
      tip.innerHTML = html(i);
      tip.hidden = false;
      tip.style.left = `${Math.min(Math.max(((i + 0.5) / n) * 100, 14), 86)}%`;
    };
    col.onmouseleave = () => { tip.hidden = true; };
  });
}

function tableParams(query, head) {
  if (head?.sort) {
    query.set('sort', head.sort);
    query.set('dir', head.dir === 'desc' ? 'desc' : 'asc');
  }
  const filters = Object.fromEntries(Object.entries(head?.filters || {}).filter(([, value]) => String(value || '').trim()));
  if (Object.keys(filters).length) query.set('filters', JSON.stringify(filters));
  return query;
}

function countText(id, shown, total) {
  $(id).textContent = `แสดง ${Number(shown).toLocaleString('en-US')} จาก ${Number(total).toLocaleString('en-US')} แถว`;
}

function bindPager(prefix, state, load) {
  $(`${prefix}-search`).onclick = () => { state.offset = 0; load().catch(onErr); };
  $(`${prefix}-prev`).onclick = () => { state.offset = Math.max(0, state.offset - PAGE); load().catch(onErr); };
  $(`${prefix}-next`).onclick = () => { state.offset += PAGE; load().catch(onErr); };
}

function onEnter(id, run) {
  $(id)?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    run();
  });
}

// Page toolbar rule (AGENTS.md "หน้าจอ"): no title card (the header already names the page), one row:
// left = only buttons that open sub-pages (tabs, table picker), right = year → view switch (ปี/เดือน/สัปดาห์) and filters
// from large to small → search → create/edit/delete
// at the far right. `right` comes first (the year); a tab fills the slots <id>-left / <id>-tools after it.
function pageBar(left, right = '', id = 'page') {
  return `<div class="page-bar"><div class="page-bar-left">${left}<span class="page-bar-slot" id="${id}-left"></span></div><div class="page-bar-right">${right}<span class="page-bar-slot" id="${id}-tools"></span></div></div>`;
}

function cardView(title, meta, body = '') {
  return `<div class="view-body"><section class="card"><div class="card-title">${title}</div>${meta ? `<p class="sum-meta">${meta}</p>` : ''}${body}</section></div>`;
}

function closePopup() {
  document.removeEventListener('keydown', popupKey);
  $('popup')?.remove();
}

function popupKey(event) {
  if (event.key === 'Escape') closePopup();
}

function openPopup(title, body, onSave, saveLabel = 'บันทึก') {
  closePopup();
  const node = document.createElement('div');
  node.className = 'popup-back';
  node.id = 'popup';
  node.innerHTML = `<section class="popup" role="dialog" aria-modal="true">
    <div class="popup-title">${title}</div>
    <div class="popup-fields">${body}</div>
    <div class="popup-actions">
      ${button('popup-cancel', 'ยกเลิก')}
      ${button('popup-save', saveLabel, saveLabel === 'ลบ' ? 'danger' : 'primary')}
    </div>
  </section>`;
  document.body.appendChild(node);
  document.addEventListener('keydown', popupKey);
  $('popup-cancel').onclick = closePopup;
  node.addEventListener('click', (event) => { if (event.target === node) closePopup(); });
  $('popup-save').onclick = () => Promise.resolve(onSave()).catch(onErr);
  node.querySelector('input:not([readonly]):not([disabled]),select,textarea')?.focus();
}

function confirmPopup(title, text, onYes, saveLabel = 'ลบ') {
  openPopup(title, `<p class="sum-meta">${text}</p>`, async () => { await onYes(); closePopup(); }, saveLabel);
}

function toast(message, kind = 'success') {
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  $('toasts').appendChild(node);
  setTimeout(() => node.remove(), 3200);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { showLogin(); throw new Error(data.error || 'กรุณาเข้าสู่ระบบ'); }
  if (res.status === 403 && String(data.error || '').includes('90')) { showPassword(); throw new Error(data.error); }
  if (!res.ok) throw new Error(data.error || 'ไม่สำเร็จ');
  return data;
}

function bindRowSelect(container, onSelect) {
  const rows = [...container.querySelectorAll('tbody tr[data-pick]')];
  rows.forEach((row) => {
    row.classList.add('row-pick');
    row.onclick = () => {
      rows.forEach((item) => item.classList.toggle('is-selected', item === row));
      onSelect(row.dataset.pick, row);
    };
  });
}

function rankOf(moduleId = 'sto', user = me) {
  if (!user) return 0;
  if (user.creator) return RANK.admin;
  return RANK[user.roles?.[moduleId] ?? (moduleId === 'sto' ? user.usageRole : null)] || 0;
}

function showLogin() {
  me = null;
  $('login').classList.remove('d-none');
  $('password-gate').classList.add('d-none');
  $('shell').classList.add('d-none');
}

function showPassword() {
  $('login').classList.add('d-none');
  $('password-gate').classList.remove('d-none');
  $('shell').classList.add('d-none');
}

function showShell() {
  $('login').classList.add('d-none');
  $('password-gate').classList.add('d-none');
  $('shell').classList.remove('d-none');
  $('header-user').textContent = me.name || me.employeeId;
  const access = me.founder ? 'ผู้สร้างระบบ' : me.creator ? 'ผู้ช่วยดูแลระบบ' : me.executive ? 'ผู้บริหาร' : me.adminOf?.length ? 'ผู้ดูแลระบบ' : (USAGE_ROLE[me.usageRole] || 'ยังไม่เข้า Usage');
  $('header-role').textContent = `${access} · ${me.employeeId}`;
  document.querySelectorAll('[data-usage]').forEach((node) => node.classList.toggle('d-none', Number(node.dataset.usage) > rankOf('sto')));
  document.querySelectorAll('[data-system]').forEach((node) => node.classList.toggle('d-none', !me.creator));
  openView(view);
}

function zoneOf(name) {
  if (name === 'setup' || name === 'act-plan' || name === 'system') return 'setup';
  if (name === 'activity') return 'act';
  if (name === 'work' || name === 'store' || name === 'home' || name === 'edit' || name === 'setting' || name === 'locked') return 'work';
  if (typeof plantOf === 'function') {
    const unit = plantOf(name);
    if (unit) return unit.group === 'ระบบงาน' ? 'work' : 'act';
  }
  return '';
}

function openView(name) {
  const rule = ACCESS[name];
  if (rule && rankOf(rule[0]) < rule[1]) name = 'locked';
  if (name === 'system' && !me.creator) name = 'main';
  view = name;
  // Dashboard pages use the compact sizes (body[data-dash] in app.css).
  if (TITLES[name]?.[0] === 'Dashboard') document.body.dataset.dash = '1';
  else delete document.body.dataset.dash;
  const zone = zoneOf(view);
  if (zone) document.body.dataset.zone = zone;
  else delete document.body.dataset.zone;
  const [title, subtitle] = TITLES[name];
  $('header-page-title').textContent = title;
  $('header-page-subtitle').textContent = subtitle;
  document.querySelectorAll('.nav-btn').forEach((node) => node.classList.toggle('active', node.dataset.view === name && !node.classList.contains('nav-parent')));
  document.querySelectorAll('.nav-acc').forEach((acc) => {
    if (!acc.querySelector(`.nav-btn[data-view="${name}"]`)) return;
    acc.classList.remove('is-collapsed');
    acc.querySelector('[data-nav-toggle]')?.setAttribute('aria-expanded', 'true');
  });
  document.body.classList.remove('sidebar-open');
  const target = $('app-view');
  target.innerHTML = '<div class="empty">กำลังโหลด...</div>';
  const render = VIEWS[name] || viewFallback(name);
  render(target).catch((err) => { target.innerHTML = `<p class="form-error">${esc(err.message)}</p>`; });
}

function moduleCard(viewName, icon, title, text) {
  return `<button class="card module-card" type="button" data-go="${viewName}"><span class="material-symbols-rounded">${icon}</span><div class="card-title">${title}</div><div class="sum-meta">${text}</div></button>`;
}

function bindGo(target) {
  target.querySelectorAll('[data-go]').forEach((node) => { node.onclick = () => openView(node.dataset.go); });
}

function modulePage(target, title, meta, cards) {
  const grid = `<div class="module-grid">${cards.map((card) => moduleCard(...card)).join('')}</div>`;
  target.innerHTML = cardView(title, meta, grid);
  bindGo(target);
}

async function renderMain(target) {
  modulePage(target, 'TSAT4 SMF', 'เลือกส่วนที่ต้องการเข้า ตอนนี้มี 3 ส่วน และเพิ่มส่วนใหม่ได้ภายหลัง', [
    ['work', 'work', 'ระบบงาน', 'Work System'],
    ['activity', 'event', 'ระบบกิจกรรม', 'Activity'],
    ['setup', 'settings', 'ระบบตั้งค่า', 'ปฏิทิน']
  ]);
}

function bindHold(button, onDone) {
  const fill = button.querySelector('.hold-fill');
  let active = false;
  let finished = false;
  let frame = 0;
  const stop = (done) => {
    if (finished) return;
    active = false;
    cancelAnimationFrame(frame);
    if (!done) { fill.style.width = '0'; return; }
    finished = true;
    fill.style.width = '100%';
    onDone();
  };
  const tick = (now) => {
    if (!active) return;
    const ratio = Math.min(1, (now - button.dataset.holdStart) / 2000);
    fill.style.width = `${ratio * 100}%`;
    if (ratio >= 1) { stop(true); return; }
    frame = requestAnimationFrame(tick);
  };
  button.addEventListener('pointerdown', (event) => {
    if (button.disabled || active || finished) return;
    active = true;
    button.dataset.holdStart = String(performance.now());
    button.setPointerCapture?.(event.pointerId);
    frame = requestAnimationFrame(tick);
  });
  button.addEventListener('pointerup', () => { if (active) stop(false); });
  button.addEventListener('pointercancel', () => { if (active) stop(false); });
  button.addEventListener('contextmenu', (event) => event.preventDefault());
}

VIEWS.main = renderMain;

// Hovering a list thumbnail shows it large next to the pointer (ผู้ใช้กำหนด 2026-10-28). One floating box for the
// whole app, fixed position so table cells that clip overflow do not cut it. New thumbnails: add class img-zoom.
const ZOOM_THUMBS = 'img.tx-card-img, img.usage-thumb, img.img-zoom';
(() => {
  if (!window.matchMedia('(hover: hover)').matches) return;
  const box = document.createElement('div');
  box.className = 'img-zoom-box';
  box.hidden = true;
  box.innerHTML = '<img alt="">';
  document.body.appendChild(box);
  const place = (thumb) => {
    const r = thumb.getBoundingClientRect();
    const size = Math.min(200, window.innerWidth - 32, window.innerHeight - 32);
    const left = r.right + 12 + size <= window.innerWidth ? r.right + 12 : Math.max(16, r.left - 12 - size);
    const top = Math.min(Math.max(16, r.top + r.height / 2 - size / 2), window.innerHeight - 16 - size);
    Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${size}px`, height: `${size}px` });
  };
  document.addEventListener('mouseover', (event) => {
    const thumb = event.target.closest?.(ZOOM_THUMBS);
    if (!thumb || !thumb.getAttribute('src')) return;
    box.firstChild.src = thumb.src;
    place(thumb);
    box.hidden = false;
  });
  document.addEventListener('mouseout', (event) => { if (event.target.closest?.(ZOOM_THUMBS)) box.hidden = true; });
  window.addEventListener('scroll', () => { box.hidden = true; }, true);
})();
