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
      <div class="table-foot-end"></div>
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
  if (label) label.textContent = `หน้า ${page} / ${pages}`;
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
  document.querySelector('.col-menu')?.remove();
  const cells = headers.map((header) => {
    const label = typeof header === 'string' ? header : header.label;
    const key = typeof header === 'string' ? '' : header.key;
    if (!head || !key) return `<th>${esc(label)}</th>`;
    const filtered = String(head.filters?.[key] || '').trim();
    const asc = head.sort === key && head.dir !== 'desc';
    const desc = head.sort === key && head.dir === 'desc';
    return `<th class="has-menu"><div class="th-line"><span class="th-label">${esc(label)}</span><button class="th-tool${filtered ? ' is-active' : ''}" type="button" data-col-filter="${esc(key)}" aria-label="กรอง"><span class="material-symbols-rounded">filter_alt</span></button><button class="th-tool${asc ? ' is-active' : ''}" type="button" data-col-sort="${esc(key)}" data-dir="asc" aria-label="เรียง A ไป Z">A-Z</button><button class="th-tool${desc ? ' is-active' : ''}" type="button" data-col-sort="${esc(key)}" data-dir="desc" aria-label="เรียง Z ไป A">Z-A</button></div></th>`;
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
      const dir = btn.dataset.dir === 'desc' ? 'desc' : 'asc';
      const same = head.sort === key && head.dir === dir;
      head.onChange({ sort: same ? '' : key, dir: same ? 'asc' : dir, filters: head.filters || {} });
    };
  });
  node.querySelectorAll('[data-col-filter]').forEach((btn) => {
    btn.onclick = (event) => {
      event.stopPropagation();
      openColumnFilter(btn, head);
    };
  });
}

function openColumnFilter(button, head) {
  document.querySelector('.col-menu')?.remove();
  const key = button.dataset.colFilter;
  const menu = document.createElement('div');
  menu.className = 'col-menu';
  menu.innerHTML = `<label class="field">กรอง<input id="col-filter-q" value="${esc(head.filters?.[key] || '')}"></label><div class="popup-actions">${button('col-filter-clear', 'ล้าง')}${button('col-filter-apply', 'กรอง', 'primary')}</div>`;
  document.body.appendChild(menu);
  const rect = button.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 220))}px`;
  const apply = (clear) => {
    const filters = { ...(head.filters || {}) };
    const term = clear ? '' : $('col-filter-q').value.trim();
    if (term) filters[key] = term;
    else delete filters[key];
    menu.remove();
    head.onChange({ sort: head.sort || '', dir: head.dir === 'desc' ? 'desc' : 'asc', filters });
  };
  $('col-filter-apply').onclick = () => apply(false);
  $('col-filter-clear').onclick = () => apply(true);
  onEnter('col-filter-q', () => apply(false));
  setTimeout(() => {
    const close = (event) => {
      if (menu.contains(event.target)) return;
      menu.remove();
      document.removeEventListener('mousedown', close);
    };
    document.addEventListener('mousedown', close);
  }, 0);
  $('col-filter-q')?.focus();
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
  $(id).textContent = `แสดง ${shown} จาก ${total} แถว`;
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
// left = tabs / sub-pages / table picker, right = year and filters from large to small → search → create/edit/delete
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
  const access = me.creator ? 'ผู้สร้างระบบ' : (USAGE_ROLE[me.usageRole] || 'ยังไม่เข้า Usage');
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
