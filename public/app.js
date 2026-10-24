const STATUS = {
  cart: 'ตะกร้า', submitted: 'ส่งแล้ว', accepted: 'รับออร์เดอร์', preparing: 'กำลังจัด',
  ready: 'พร้อมรับ', received: 'รับแล้ว', cancelled: 'ยกเลิก'
};
const RANK = { viewer: 1, user: 2, admin: 3 };
const USAGE_ROLE = { viewer: 'Viewer', user: 'User', admin: 'Admin' };
const USAGE = 'ระบบงาน > Store > Usage';
const PAGE = 50;
const CHOICES = {
  status: ['Active', 'Inactive'],
  group: ['Factory', 'Non', 'Center'],
  usage: ['viewer', 'user', 'admin'],
  level: ['S1', 'S2', 'S3', 'T1', 'T2', 'T3', 'T6', 'T7', 'T8'],
  req: Object.keys(STATUS)
};
const TITLES = {
  main: ['TSAT4 SMF', 'หน้าหลัก'],
  work: ['ระบบงาน', 'Work System'],
  store: ['Store', 'ระบบงาน > Store'],
  activity: ['ระบบกิจกรรม', 'Activity'],
  locked: ['Usage', USAGE],
  home: ['Dashboard', USAGE],
  edit: ['transaction', USAGE],
  setting: ['Setting', USAGE],
  system: ['Setting', 'ตารางทั้งระบบ']
};
const LINE_HEAD = ['หมายเลขเลขรายการ', 'ชื่อรายการ', 'หน่วย'];
const TX_PAGE = { issue: 'เบิกจ่าย', receive: 'รับเข้า', stock: 'Stock' };
const PLANTS = [
  ['pd1', 'PD1', 'factory'],
  ['pd2', 'PD2', 'factory'],
  ['pd3', 'PD3', 'factory'],
  ['pd4', 'PD4', 'factory'],
  ['mtn', 'MTN', 'build'],
  ['die-mtn', 'DIE MTN', 'build'],
  ['jig-mtn', 'JIG MTN', 'build'],
  ['pd-mtn', 'PD MTN', 'build']
];
const ACTIVITIES = [
  ['100p', '100P', 'event'],
  ['5s', '5S', 'event'],
  ['cfo', 'CFO', 'event'],
  ['e-day', 'E-DAY', 'event'],
  ['kaizen', 'KAIZEN', 'event'],
  ['lean', 'LEAN', 'event'],
  ['qcc', 'QCC', 'event'],
  ['safety', 'SAFETY', 'event'],
  ['smf', 'SMF', 'event']
];
const PLANT_PAGES = [
  ['home', 'monitoring', 'Dashboard', 'ภาพรวม'],
  ['edit', 'edit_note', 'transaction', 'รายการ'],
  ['setting', 'settings', 'Setting', 'ข้อมูลตั้งต้น']
];
for (const [id, label] of PLANTS) {
  const path = `ระบบงาน > ${label}`;
  TITLES[id] = [label, path];
  for (const [page, , title] of PLANT_PAGES) TITLES[`${id}-${page}`] = [title, path];
}
for (const [id, label] of ACTIVITIES) {
  const path = `ระบบกิจกรรม > ${label}`;
  TITLES[id] = [label, path];
  for (const [page, , title] of PLANT_PAGES) TITLES[`${id}-${page}`] = [title, path];
}

let me = null;
let view = 'main';
let editMode = 'list';
let txPage = 'issue';

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

function usageThumb(src) {
  return src ? `<img class="usage-thumb" src="${esc(src)}" alt="">` : '';
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

function tablePage(prefix, toolbar) {
  return `<div class="toolbar">${toolbar}</div>
    <div class="table-wrap sheet" id="${prefix}-rows"></div>
    <div class="table-foot">
      <div class="sum-meta" id="${prefix}-count"></div>
      <div class="action-bar">${button(`${prefix}-prev`, 'ก่อนหน้า')}${button(`${prefix}-next`, 'ถัดไป')}</div>
    </div>`;
}

function fillTable(id, headers, rows, emptyText) {
  $(id).innerHTML = rows
    ? `<table class="mo-data-table"><thead><tr>${headers.map((name) => `<th>${esc(name)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="empty">${emptyText}</p>`;
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

function badge(status) {
  const kind = status === 'ready' || status === 'received' ? 'badge-success' : status === 'cancelled' ? 'badge-danger' : status === 'cart' ? 'badge-warning' : 'badge-primary';
  return `<span class="badge ${kind}">${esc(STATUS[status] || status)}</span>`;
}

function rankOf(user = me) {
  if (!user) return 0;
  if (user.creator) return RANK.admin;
  return RANK[user.usageRole] || 0;
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
  document.querySelectorAll('[data-usage]').forEach((node) => node.classList.toggle('d-none', Number(node.dataset.usage) > rankOf()));
  document.querySelectorAll('[data-system]').forEach((node) => node.classList.toggle('d-none', !me.creator));
  openView(view);
}

function openView(name) {
  const need = { home: 1, edit: 1, setting: 3 }[name] || 0;
  if (need && rankOf() < need) name = 'locked';
  if (name === 'system' && !me.creator) name = 'main';
  view = name;
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
  const render = { main: renderMain, work: renderWork, store: renderStore, activity: renderActivity, locked: renderLocked, home: renderHome, edit: renderEdit, setting: renderUsers, system: renderSystem }[name] || plantRender(name);
  render(target).catch((err) => { target.innerHTML = `<p class="form-error">${esc(err.message)}</p>`; });
}

function plantOf(name) {
  const groups = [[PLANTS, 'ระบบงาน'], [ACTIVITIES, 'ระบบกิจกรรม']];
  for (const [list, group] of groups) {
    const row = list.find(([id]) => name === id || name.startsWith(`${id}-`));
    if (row) return { row, group };
  }
  return null;
}

function plantRender(name) {
  const unit = plantOf(name);
  if (!unit) return async (target) => { target.innerHTML = cardView('ไม่พบหน้า', '', '<p class="empty">ไม่มีหน้านี้</p>'); };
  const id = unit.row[0];
  const page = name === id ? '' : name.slice(id.length + 1);
  return async (target) => (page ? renderPlantPage(target, id, page) : renderPlant(target, id));
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
  modulePage(target, 'TSAT4 SMF', 'เลือกส่วนที่ต้องการเข้า ตอนนี้มี 2 ส่วน และเพิ่มส่วนใหม่ได้ภายหลัง', [
    ['work', 'work', 'ระบบงาน', 'Work System'],
    ['activity', 'event', 'ระบบกิจกรรม', 'Activity']
  ]);
}

async function renderWork(target) {
  modulePage(target, 'ระบบงาน', 'Work System', [
    ['store', 'warehouse', 'Store', 'คลังและรายการใช้งาน'],
    ...PLANTS.map(([id, label, icon]) => [id, icon, label, 'Dashboard, transaction, Setting'])
  ]);
}

function renderPlant(target, id) {
  const unit = plantOf(id);
  const label = unit.row[1];
  modulePage(target, label, `${unit.group} > ${label}`, PLANT_PAGES.map(([page, icon, title, text]) => [`${id}-${page}`, icon, title, text]));
}

function renderPlantPage(target, id, page) {
  const unit = plantOf(id);
  const found = PLANT_PAGES.find((row) => row[0] === page);
  const title = found ? found[2] : page;
  const text = page === 'edit' ? 'ยังไม่มีรายการในส่วนนี้' : page === 'setting' ? 'ยังไม่มีการตั้งค่าในส่วนนี้' : 'ยังไม่มีข้อมูลในส่วนนี้';
  target.innerHTML = cardView(title, `${unit.group} > ${unit.row[1]}`, `<p class="empty">${text}</p>`);
}

async function renderStore(target) {
  modulePage(target, 'Store', 'ระบบงาน > Store', [['home', 'inventory_2', 'Usage', 'Dashboard, transaction, Setting']]);
}

async function renderActivity(target) {
  modulePage(target, 'ระบบกิจกรรม', 'Activity', ACTIVITIES.map(([id, label, icon]) => [id, icon, label, 'Dashboard, transaction, Setting']));
}

async function renderLocked(target) {
  target.innerHTML = cardView('Usage', '', '<p class="empty">ยังไม่มีชื่อในรายการ Usage จึงยังเข้าส่วนนี้ไม่ได้</p>');
}

function columnControl(column, value) {
  const id = `sys-${column.name}`;
  if (column.type === 'password') return field(column.name, `<input id="${id}" type="password" autocomplete="new-password">`);
  if (column.type === 'bool') return field(column.name, `<select id="${id}"><option value="false">false</option><option value="true"${value ? ' selected' : ''}>true</option></select>`);
  if (CHOICES[column.type]) return field(column.name, `<select id="${id}">${options(CHOICES[column.type], value)}</select>`);
  const number = ['int', 'qty', 'money'].includes(column.type);
  const step = column.type === 'int' ? '1' : '0.001';
  return field(column.name, `<input id="${id}" ${number ? `type="number" step="${step}"` : ''} value="${esc(value ?? '')}">`);
}

async function renderSystem(target) {
  const catalog = await api('/api/system/tables');
  const state = { offset: 0, editing: null, rows: [], selected: null };
  target.innerHTML = tablePage('sys', `
    ${field('ตาราง', `<select id="sys-table">${catalog.tables.map((table) => `<option value="${esc(table.name)}">${esc(table.name)}</option>`).join('')}</select>`, 'grow')}
    ${searchSlot('ค้นหา', 'sys-q', 'sys-search', { grow: true })}
    ${crudBar('sys')}`);
  const tableOf = () => catalog.tables.find((table) => table.name === $('sys-table').value);
  const loadRows = async () => {
    const table = tableOf();
    const data = await api(`/api/system/tables/${encodeURIComponent(table.name)}?q=${encodeURIComponent($('sys-q').value.trim())}&offset=${state.offset}`);
    state.rows = data.rows;
    state.selected = null;
    $('sys-edit').disabled = true;
    $('sys-del').disabled = true;
    countText('sys-count', state.rows.length, data.total);
    const visible = table.columns.filter((column) => column.type !== 'password');
    fillTable('sys-rows', visible.map((column) => column.name), state.rows.map((row, index) => `<tr data-pick="${index}">${visible.map((column) => `<td>${esc(row[column.name] ?? '')}</td>`).join('')}</tr>`).join(''), 'ไม่มีแถว');
    bindRowSelect($('sys-rows'), (pick) => {
      state.selected = state.rows[Number(pick)];
      $('sys-edit').disabled = false;
      $('sys-del').disabled = false;
    });
  };
  const saveRow = async () => {
    const table = tableOf();
    const values = {};
    for (const column of table.columns) {
      if (column.type === 'read') continue;
      const input = $(`sys-${column.name}`);
      if (!input || input.disabled) continue;
      if (column.type === 'password') { if (input.value) values.password = input.value; continue; }
      values[column.name] = column.type === 'bool' ? input.value === 'true' : input.value;
    }
    if (state.editing) {
      const key = {};
      table.pk.forEach((column) => { key[column] = state.editing[column]; });
      await api(`/api/system/tables/${encodeURIComponent(table.name)}`, { method: 'PATCH', body: { key, values } });
    } else {
      await api(`/api/system/tables/${encodeURIComponent(table.name)}`, { method: 'POST', body: values });
    }
    toast('บันทึกแล้ว');
    state.editing = null;
    closePopup();
    await loadRows();
  };
  const drawForm = () => {
    const table = tableOf();
    const fields = table.columns.map((column) => (column.type === 'read' ? '' : columnControl(column, state.editing ? state.editing[column.name] : ''))).join('');
    openPopup(`${state.editing ? 'แก้ไขแถว' : 'เพิ่มแถว'} ${esc(table.name)}`, fields, saveRow);
  };
  $('sys-table').onchange = () => { state.offset = 0; state.editing = null; closePopup(); loadRows().catch(onErr); };
  $('sys-add').onclick = () => { state.editing = null; drawForm(); };
  $('sys-edit').onclick = () => { if (!state.selected) return toast('เลือกแถวก่อน', 'error'); state.editing = state.selected; drawForm(); };
  $('sys-del').onclick = () => {
    if (!state.selected) return toast('เลือกแถวก่อน', 'error');
    const table = tableOf();
    const key = {};
    table.pk.forEach((column) => { key[column] = state.selected[column]; });
    confirmPopup(`ลบแถว ${esc(table.name)}`, 'ตรวจแถวที่เลือกอีกครั้งก่อนลบ', async () => {
      await api(`/api/system/tables/${encodeURIComponent(table.name)}`, { method: 'DELETE', body: { key } });
      toast('ลบแล้ว');
      await loadRows();
    });
  };
  bindPager('sys', state, loadRows);
  await loadRows();
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

function postStatus(id, status, extra = {}) {
  return api(`/api/requisitions/${id}/status`, { method: 'POST', body: { status, ...extra } });
}

function selectedRow() {
  return $('edit-rows')?.querySelector('tr.is-selected') || null;
}

function showEdit(mode) {
  editMode = mode;
  openView('edit');
}

function stockBadge(min, current, max) {
  if (current < min) return '<span class="badge badge-danger">ต่ำกว่า Min</span>';
  if (current > max) return '<span class="badge badge-warning">เกิน Max</span>';
  return '<span class="badge badge-success">ในช่วง</span>';
}

async function renderEdit(target) {
  const state = { offset: 0 };
  const admin = rankOf() >= 3;
  target.innerHTML = tablePage('edit', `
    ${field('เลือกหน้าย่อย', `<select id="edit-page">${options(Object.keys(TX_PAGE), txPage, (value) => TX_PAGE[value])}</select>`, 'grow')}
    ${searchSlot('ค้นหา', 'edit-q', 'edit-search', { placeholder: 'เลขที่ costcenter หรือสถานะ', grow: true })}
    <div class="action-bar" id="edit-actions"></div>`);
  const setFoot = (shown, total) => {
    countText('edit-count', shown, total);
    $('edit-prev').disabled = state.offset <= 0;
    $('edit-next').disabled = state.offset + PAGE >= total;
  };
  const pageOf = (rows) => rows.slice(state.offset, state.offset + PAGE);
  const load = async () => {
    if (txPage === 'stock') await loadStock();
    else if (txPage === 'receive') await loadReceive();
    else if (editMode === 'summary') await loadSummary();
    else await loadList();
  };
  const loadReceive = async () => {
    $('edit-q').placeholder = 'เลขที่หรือรายการ';
    $('edit-actions').innerHTML = '';
    fillTable('edit-rows', ['เลขที่', 'รายการ', 'จำนวน', 'costcenter', 'สถานะ'], '', 'ยังไม่มีรายการรับเข้า');
    setFoot(0, 0);
  };
  const loadStock = async () => {
    $('edit-q').placeholder = 'หมายเลขหรือชื่อ';
    $('edit-actions').innerHTML = '';
    const data = await api(`/api/stock?q=${encodeURIComponent($('edit-q').value.trim())}&offset=${state.offset}`);
    const rows = data.stock || [];
    fillTable('edit-rows', ['costcenter', 'หมายเลขเลขรายการ', 'ชื่อรายการ', 'หน่วย', 'Min', 'Current', 'Max', 'สถานะ'], rows.map((row) => `<tr><td>${esc(row.costcenter)}</td><td>${esc(row.material)}</td><td>${esc(row.materialDescription)}</td><td>${esc(row.bun)}</td><td>${row.minQty}</td><td>${row.currentQty}</td><td>${row.maxQty}</td><td>${stockBadge(row.minQty, row.currentQty, row.maxQty)}</td></tr>`).join(''), 'ยังไม่มียอดในขอบเขตของคุณ');
    setFoot(rows.length, data.total || 0);
  };
  const loadList = async () => {
    const term = $('edit-q').value.trim().toLowerCase();
    const mine = await api('/api/requisitions?scope=mine');
    let rows = mine.requisitions;
    if (admin) {
      const queue = await api('/api/requisitions?scope=queue');
      const seen = new Set(rows.map((row) => row.id));
      rows = rows.concat(queue.requisitions.filter((row) => !seen.has(row.id)));
    }
    rows.sort((a, b) => Number(b.id) - Number(a.id));
    rows = rows.filter((row) => !term || `${row.id} ${row.requested_by} ${row.costcenter} ${row.costcenterName} ${STATUS[row.status] || ''}`.toLowerCase().includes(term));
    const page = pageOf(rows);
    $('edit-actions').innerHTML = [
      button('edit-withdraw', 'เบิก', 'primary'),
      button('edit-fix', 'แก้ไข', 'secondary', 'disabled'),
      button('edit-del', 'ลบ', 'danger', 'disabled'),
      admin ? button('edit-prepare', 'จัดเตรียม', 'secondary', 'disabled') + button('edit-issue', 'จ่าย', 'secondary', 'disabled') : '',
      button('edit-receive', 'รับ', 'primary', 'disabled')
    ].join('');
    fillTable('edit-rows', ['เลขที่', 'ผู้เบิก', 'costcenter', 'สถานะ'], page.map((row) => `<tr data-pick="${esc(row.id)}" data-status="${esc(row.status)}" data-own="${row.requested_by === me.employeeId ? '1' : '0'}"><td>#${row.id}</td><td>${esc(row.requested_by)}</td><td>${row.costcenter === '-' ? 'ยังไม่เลือก' : `${esc(row.costcenter)} · ${esc(row.costcenterName)}`}</td><td>${badge(row.status)}</td></tr>`).join(''), 'ไม่มีใบเบิก');
    setFoot(page.length, rows.length);
    bindRowSelect($('edit-rows'), (_id, row) => {
      const own = row.dataset.own === '1';
      const status = row.dataset.status;
      $('edit-fix').disabled = !(own && status === 'cart');
      $('edit-del').disabled = !(own && ['cart', 'submitted', 'accepted', 'preparing', 'ready'].includes(status));
      if ($('edit-prepare')) $('edit-prepare').disabled = !['submitted', 'accepted'].includes(status);
      if ($('edit-issue')) $('edit-issue').disabled = status !== 'preparing';
      $('edit-receive').disabled = !(own && status === 'ready');
    });
    $('edit-withdraw').onclick = () => openAddPopup().catch(onErr);
    $('edit-fix').onclick = () => showEdit('summary');
    $('edit-del').onclick = () => {
      const row = selectedRow();
      if (!row || row.dataset.own !== '1') return toast('ลบได้เฉพาะใบที่ตนเองสร้าง', 'error');
      confirmPopup('ลบใบเบิก', `ตรวจใบเบิก #${row.dataset.pick} อีกครั้งก่อนลบ`, async () => {
        await postStatus(row.dataset.pick, 'cancelled');
        toast('ลบแล้ว');
        showEdit('list');
      });
    };
    const moveStatus = (id, nextOf) => {
      const node = $(id);
      if (!node) return;
      node.onclick = async () => {
        const row = selectedRow();
        const next = row ? nextOf(row.dataset.status) : '';
        if (!next) return toast('เลือกใบที่ตรงขั้นตอนก่อน', 'error');
        try {
          await postStatus(row.dataset.pick, next);
          toast('อัปเดตสถานะแล้ว');
          showEdit('list');
        } catch (err) { onErr(err); }
      };
    };
    moveStatus('edit-prepare', (status) => ({ submitted: 'accepted', accepted: 'preparing' }[status]));
    moveStatus('edit-issue', (status) => (status === 'preparing' ? 'ready' : ''));
    $('edit-receive').onclick = async () => {
      const row = selectedRow();
      if (!row || row.dataset.own !== '1' || row.dataset.status !== 'ready') return toast('รับได้เฉพาะใบที่ตนเองเบิกและพร้อมรับ', 'error');
      try {
        await postStatus(row.dataset.pick, 'received');
        toast('ยืนยันแล้ว และตัดยอด Current');
        showEdit('list');
      } catch (err) { onErr(err); }
    };
  };
  const loadSummary = async () => {
    const mine = await api('/api/requisitions?scope=mine');
    const cartHeader = mine.requisitions.find((row) => row.status === 'cart' && row.requested_by === me.employeeId);
    if (!cartHeader) { editMode = 'list'; await loadList(); return; }
    const cart = (await api(`/api/requisitions/${cartHeader.id}`)).requisition;
    const term = $('edit-q').value.trim().toLowerCase();
    const allLines = cart.lines || [];
    const lines = allLines.filter((line) => !term || `${line.material} ${line.materialDescription}`.toLowerCase().includes(term));
    const page = pageOf(lines);
    let picked = null;
    $('edit-q').placeholder = 'รหัสหรือชื่อในสรุป';
    $('edit-actions').innerHTML = [
      button('edit-back', 'รายการ'),
      button('edit-add', 'เพิ่ม', 'primary'),
      button('edit-line', 'แก้ไข', 'secondary', 'disabled'),
      button('edit-line-del', 'ลบ', 'danger', 'disabled'),
      `<button class="btn btn-primary hold-btn" type="button" id="edit-hold" ${allLines.length ? '' : 'disabled'}><span class="hold-fill"></span><span class="hold-label">กดค้าง 2 วินาที</span></button>`
    ].join('');
    fillTable('edit-rows', [...LINE_HEAD, 'จำนวน', 'costcenter'], page.map((line) => `<tr data-pick="${esc(line.id)}" data-qty="${Number(line.qty)}" data-material="${esc(line.material)}" data-name="${esc(line.materialDescription)}" data-bun="${esc(line.bun)}"><td>${esc(line.material)}</td><td>${esc(line.materialDescription)}</td><td>${esc(line.bun)}</td><td>${Number(line.qty)}</td><td>${esc(line.costcenter === '-' ? cart.costcenter : line.costcenter)}</td></tr>`).join(''), 'ยังไม่มีรายการ กดเพิ่ม');
    setFoot(page.length, lines.length);
    bindRowSelect($('edit-rows'), (_id, row) => { picked = row; $('edit-line').disabled = false; $('edit-line-del').disabled = false; });
    $('edit-back').onclick = () => { $('edit-q').value = ''; state.offset = 0; showEdit('list'); };
    $('edit-add').onclick = () => openAddPopup().catch(onErr);
    $('edit-line').onclick = () => {
      if (!picked) return toast('เลือกแถวก่อน', 'error');
      openPopup('แก้ไขจำนวน', [
        field('หมายเลขเลขรายการ', `<input value="${esc(picked.dataset.material)}" readonly>`),
        field('ชื่อรายการ', `<input value="${esc(picked.dataset.name)}" readonly>`),
        field('หน่วย', `<input value="${esc(picked.dataset.bun)}" readonly>`),
        field('จำนวน', `<input id="line-qty" type="number" min="0.001" step="0.001" value="${esc(picked.dataset.qty)}">`)
      ].join(''), async () => {
        const qty = Number($('line-qty').value);
        if (!(qty > 0)) throw new Error('ระบุจำนวน');
        await api(`/api/requisitions/${cart.id}/lines/${picked.dataset.pick}`, { method: 'PATCH', body: { qty } });
        toast('แก้ไขแล้ว');
        closePopup();
        showEdit('summary');
      });
    };
    $('edit-line-del').onclick = () => {
      if (!picked) return toast('เลือกแถวก่อน', 'error');
      confirmPopup('ลบรายการ', `ตรวจ ${esc(picked.dataset.material)} อีกครั้งก่อนลบ`, async () => {
        await api(`/api/requisitions/${cart.id}/lines/${picked.dataset.pick}`, { method: 'DELETE' });
        showEdit('summary');
      });
    };
    if (allLines.length) {
      bindHold($('edit-hold'), async () => {
        try {
          await postStatus(cart.id, 'submitted', { costcenter: cart.costcenter });
          toast('บันทึกการเบิกแล้ว');
          showEdit('list');
        } catch (err) { onErr(err); showEdit('summary'); }
      });
    }
  };
  $('edit-page').onchange = () => {
    txPage = $('edit-page').value;
    editMode = 'list';
    state.offset = 0;
    $('edit-q').value = '';
    load().catch(onErr);
  };
  $('edit-search').onclick = () => { state.offset = 0; load().catch(onErr); };
  onEnter('edit-q', () => { state.offset = 0; load().catch(onErr); });
  $('edit-prev').onclick = () => { state.offset = Math.max(0, state.offset - PAGE); load().catch(onErr); };
  $('edit-next').onclick = () => { state.offset += PAGE; load().catch(onErr); };
  await load();
}

async function openAddPopup() {
  const [pay, mine] = await Promise.all([api('/api/pay-centers'), api('/api/requisitions?scope=mine')]);
  const centers = [...(pay.costcenters || [])].sort((a, b) => String(a.costcenter).localeCompare(String(b.costcenter)));
  const cartHeader = mine.requisitions.find((row) => row.status === 'cart');
  const chosen = cartHeader && cartHeader.costcenter !== '-' ? cartHeader.costcenter : (centers[0]?.costcenter || '');
  let picked = null;
  const centerField = centers.length
    ? `<select id="line-cc">${centers.map((row) => `<option value="${esc(row.costcenter)}"${row.costcenter === chosen ? ' selected' : ''}>${esc(row.costcenter)} · ${esc(row.objectName)}</option>`).join('')}</select>`
    : `<input readonly value="${pay.department ? 'หน่วยงานนี้ยังไม่มี costcenter' : 'พนักงานนี้ยังไม่มีหน่วยงาน'}">`;
  openPopup('เบิก', [
    searchBlock(searchSlot('รายการ', 'line-q', 'line-search', { placeholder: 'หมายเลข ชื่อ หรือ group' }), 'line-results'),
    field('หมายเลขเลขรายการ', '<input id="line-code" readonly>'),
    field('ชื่อรายการ', '<input id="line-name" readonly>'),
    field('หน่วย', '<input id="line-bun" readonly>'),
    field('จำนวน', '<input id="line-qty" type="number" min="0.001" step="0.001" value="1">'),
    `<label class="field d-none" id="line-cc-field">costcenter${centerField}</label>`
  ].join(''), async () => {
    if (!picked) throw new Error('เลือกรายการ');
    const qty = Number($('line-qty').value);
    const costcenter = $('line-cc')?.value || '';
    if (!(qty > 0)) throw new Error('ระบุจำนวน');
    if (!costcenter) throw new Error('เลือก costcenter');
    let id = cartHeader?.id;
    if (!id) id = (await api('/api/requisitions', { method: 'POST', body: { costcenter } })).id;
    await api(`/api/requisitions/${id}/lines`, { method: 'POST', body: { material: picked.material, qty, costcenter } });
    toast('ใส่ตะกร้าแล้ว');
    closePopup();
    showEdit('summary');
  }, 'ใส่ตะกร้า');
  const revealCenter = () => $('line-cc-field')?.classList.toggle('d-none', !(picked && Number($('line-qty').value) > 0));
  const searchLine = async () => {
    const materials = [...(await api(`/api/materials?q=${encodeURIComponent($('line-q').value.trim())}`)).materials]
      .sort((a, b) => String(a.material).localeCompare(String(b.material)));
    fillTable('line-results', ['รูป', ...LINE_HEAD.slice(0, 2), 'group', 'หน่วย'], materials.map((row) => `<tr data-pick="${esc(row.material)}" data-bun="${esc(row.bun)}" data-name="${esc(row.material_description)}"><td>${usageThumb(row.img)}</td><td>${esc(row.material)}</td><td>${esc(row.material_description)}</td><td>${esc(row.usage_group || '')}</td><td>${esc(row.bun)}</td></tr>`).join(''), 'ไม่พบรายการ');
    bindRowSelect($('line-results'), (id, row) => {
      picked = { material: id, bun: row.dataset.bun, name: row.dataset.name };
      $('line-code').value = id;
      $('line-name').value = row.dataset.name || '';
      $('line-bun').value = row.dataset.bun;
      revealCenter();
    });
  };
  $('line-qty').addEventListener('input', revealCenter);
  $('line-search').onclick = () => searchLine().catch(onErr);
  onEnter('line-q', () => searchLine().catch(onErr));
}

async function renderHome(target) {
  const summary = await api('/api/summary');
  target.innerHTML = `
    <div class="kpi-grid dash-kpis">
      <article class="kpi"><div class="kpi-label">ใบเบิกที่ยังไม่จบ</div><div class="kpi-value">${summary.open}</div></article>
      <article class="kpi"><div class="kpi-label">พร้อมให้รับของ</div><div class="kpi-value">${summary.ready}</div></article>
      <article class="kpi"><div class="kpi-label">คิวที่ต้องจัด</div><div class="kpi-value">${summary.queue}</div></article>
    </div>
    ${cardView('เริ่มเบิก', 'กดเบิก เลือกรายการ ชื่อและหน่วยขึ้นให้อัตโนมัติ ระบุจำนวน แล้วเลือก costcenter จากนั้นตรวจสรุปก่อนกดค้างยืนยัน', button('', 'ไปที่ transaction', 'primary', 'data-go="edit"'))}`;
  bindGo(target);
}

function centerText(row) {
  return (row.costcenters || []).map((center) => center.costcenter).join(', ');
}

async function renderUsers(target) {
  const state = { offset: 0, selected: null, rows: [], formMode: 'add' };
  target.innerHTML = tablePage('usage', `
    ${field('ตาราง', '<select id="usage-table"><option value="members">mt_sto_user</option><option value="materials">mt_sto_usage</option></select>', 'grow')}
    ${searchSlot('ค้นหา', 'usage-q', 'usage-search', { grow: true })}
    ${crudBar('usage')}`);
  const kind = () => $('usage-table').value;
  const statusField = (id, current) => field('สถานะ', `<select id="${id}">${options(['Active', 'Inactive'], current === 'Inactive' ? 'Inactive' : 'Active')}</select>`);
  const drawForm = () => {
    if (kind() === 'materials') {
      const row = state.formMode === 'edit' && state.selected ? state.selected : {};
      state.imgData = '';
      openPopup(`${row.material ? 'แก้ไขแถว' : 'เพิ่มแถว'} mt_sto_usage`, [
        field('รหัส', `<input id="mat-code" value="${esc(row.material || '')}">`),
        field('ชื่อรายการ', `<input id="mat-name" value="${esc(row.material_description || '')}">`),
        field('group', `<input id="mat-group" value="${esc(row.usage_group || '')}" maxlength="40">`),
        field('หน่วย', `<input id="mat-bun" value="${esc(row.bun || '')}">`),
        field('ราคา', `<input id="mat-price" type="number" min="0" step="0.01" value="${row.price ?? ''}">`),
        field('สกุลเงิน', `<input id="mat-crcy" value="${esc(row.crcy || 'THB')}">`),
        statusField('mat-status', row.status),
        field('รูป', `<input id="mat-img" type="file" accept="image/*">${usageThumb(row.img).replace('usage-thumb', 'usage-preview') || '<img id="mat-preview" class="usage-preview d-none" alt="">'}`)
      ].join(''), saveRow);
      const preview = document.querySelector('.usage-preview');
      if (preview) preview.id = 'mat-preview';
      $('mat-img').onchange = async () => {
        const file = $('mat-img').files?.[0];
        if (!file) return;
        try {
          state.imgData = await squareJpeg(file);
          $('mat-preview').src = state.imgData;
          $('mat-preview').classList.remove('d-none');
        } catch (err) { onErr(err); }
      };
      return;
    }
    const row = state.formMode === 'edit' && state.selected ? state.selected : null;
    openPopup(`${row ? 'แก้ไขแถว' : 'เพิ่มแถว'} mt_sto_user`, [
      row ? '' : searchBlock(searchSlot('ค้นพนักงาน', 'emp-q', 'emp-search', { placeholder: 'รหัสหรือชื่อจาก mt_main_employee' }), 'emp-results'),
      field('รหัสพนักงาน', `<input id="user-id" readonly value="${esc(row?.employeeId || '')}" placeholder="เลือกจากรายชื่อพนักงาน">`),
      field('หน่วยงาน', `<input id="user-dept" readonly value="${esc(row?.department || '')}">`),
      field('รหัสผ่าน', '<input id="user-password" type="password" minlength="8" autocomplete="new-password">'),
      field('บทบาท', `<select id="user-role">${options(['viewer', 'user', 'admin'], row?.role || 'viewer', (value) => USAGE_ROLE[value])}</select>`),
      statusField('user-status', row?.status)
    ].join(''), saveRow);
    if ($('emp-search')) {
      $('emp-search').onclick = searchEmployees;
      onEnter('emp-q', searchEmployees);
    }
  };
  const searchEmployees = async () => {
    const people = [...(await api(`/api/employees?q=${encodeURIComponent($('emp-q').value.trim())}`)).employees]
      .sort((a, b) => String(a.employee_id).localeCompare(String(b.employee_id)));
    fillTable('emp-results', ['รหัส', 'ชื่อ', 'หน่วยงาน'], people.map((person) => `<tr data-pick="${esc(person.employee_id)}" data-dept="${esc(person.department || '')}"><td>${esc(person.employee_id)}</td><td>${esc(person.name)}</td><td>${esc(person.department || '')}</td></tr>`).join(''), 'ไม่พบพนักงาน');
    bindRowSelect($('emp-results'), (id, row) => {
      $('user-id').value = id;
      $('user-dept').value = row.dataset.dept || '';
    });
  };
  const loadRows = async () => {
    state.selected = null;
    $('usage-edit').disabled = true;
    $('usage-del').disabled = true;
    if (kind() === 'materials') {
      const data = await api(`/api/usage-materials?q=${encodeURIComponent($('usage-q').value.trim())}&offset=${state.offset}`);
      state.rows = data.materials;
      countText('usage-count', state.rows.length, data.total);
      fillTable('usage-rows', ['รูป', 'รหัส', 'ชื่อรายการ', 'group', 'หน่วย', 'ราคา', 'สกุลเงิน', 'สถานะ'], state.rows.map((row, index) => `<tr data-pick="${index}"><td>${usageThumb(row.img)}</td><td>${esc(row.material)}</td><td>${esc(row.material_description)}</td><td>${esc(row.usage_group || '')}</td><td>${esc(row.bun)}</td><td>${Number(row.price)}</td><td>${esc(row.crcy)}</td><td>${esc(row.status)}</td></tr>`).join(''), 'ไม่มีรายการ');
    } else {
      const term = $('usage-q').value.trim().toLowerCase();
      const filtered = (await api('/api/users')).users.filter((row) => !term || [row.employeeId, row.name, row.department, centerText(row), row.role].join(' ').toLowerCase().includes(term));
      const page = filtered.slice(state.offset, state.offset + PAGE);
      state.rows = page;
      countText('usage-count', page.length, filtered.length);
      fillTable('usage-rows', ['รหัส', 'ชื่อ', 'หน่วยงาน', 'costcenter', 'บทบาท', 'สถานะ'], page.map((row, index) => `<tr data-pick="${index}" data-creator="${row.creator ? '1' : '0'}"><td>${esc(row.employeeId)}</td><td>${esc(row.name)}</td><td>${esc(row.department)}</td><td>${esc(centerText(row))}</td><td>${esc(USAGE_ROLE[row.role] || row.role)}${row.creator ? ' · ผู้สร้างระบบ' : ''}</td><td>${esc(row.status)}</td></tr>`).join(''), 'ไม่มีแถว');
    }
    bindRowSelect($('usage-rows'), (pick, row) => {
      state.selected = state.rows[Number(pick)];
      $('usage-edit').disabled = false;
      $('usage-del').disabled = kind() === 'members' && row.dataset.creator === '1';
    });
  };
  const saveRow = async () => {
    if (kind() === 'materials') {
      const body = { material: $('mat-code').value.trim(), materialDescription: $('mat-name').value.trim(), bun: $('mat-bun').value.trim(), price: Number($('mat-price').value), crcy: $('mat-crcy').value.trim(), status: $('mat-status').value, usageGroup: $('mat-group').value.trim() };
      if (state.imgData) body.img = state.imgData;
      if (state.formMode === 'edit' && state.selected) await api(`/api/usage-materials/${encodeURIComponent(state.selected.material)}`, { method: 'PATCH', body });
      else await api('/api/usage-materials', { method: 'POST', body });
    } else if (state.formMode === 'edit' && state.selected) {
      await api(`/api/users/${encodeURIComponent(state.selected.employeeId)}`, { method: 'PATCH', body: { role: $('user-role').value, status: $('user-status').value, password: $('user-password').value } });
    } else {
      if (!$('user-id').value.trim()) throw new Error('เลือกพนักงานจากรายชื่อก่อน');
      await api('/api/users', { method: 'POST', body: { employeeId: $('user-id').value.trim(), password: $('user-password').value, role: $('user-role').value, status: $('user-status').value } });
    }
    toast('บันทึกแล้ว');
    closePopup();
    await loadRows();
  };
  $('usage-table').onchange = () => { state.offset = 0; $('usage-q').value = ''; closePopup(); loadRows().catch(onErr); };
  $('usage-add').onclick = () => { state.selected = null; state.formMode = 'add'; drawForm(); };
  $('usage-edit').onclick = () => { if (!state.selected) return toast('เลือกแถวก่อน', 'error'); state.formMode = 'edit'; drawForm(); };
  $('usage-del').onclick = () => {
    if (!state.selected) return toast('เลือกแถวก่อน', 'error');
    const label = kind() === 'materials' ? state.selected.material : state.selected.employeeId;
    confirmPopup('ลบแถว', `ตรวจ ${esc(label)} อีกครั้งก่อนลบ`, async () => {
      if (kind() === 'materials') {
        await api(`/api/usage-materials/${encodeURIComponent(state.selected.material)}`, { method: 'DELETE' });
        toast('ลบแล้ว');
      } else {
        const result = await api(`/api/users/${encodeURIComponent(state.selected.employeeId)}`, { method: 'DELETE' });
        toast(result.inactive ? 'มีประวัติแล้ว จึงปิดเป็น Inactive' : 'นำออกจาก Usage แล้ว');
      }
      await loadRows();
    });
  };
  bindPager('usage', state, loadRows);
  await loadRows();
}

$('login-form').onsubmit = async (event) => {
  event.preventDefault();
  $('login-error').textContent = '';
  const form = new FormData(event.target);
  try {
    me = (await api('/api/login', { method: 'POST', body: { employeeId: form.get('employeeId'), password: form.get('password') } })).user;
    if (me.passwordExpired) showPassword();
    else showShell();
  } catch (err) { $('login-error').textContent = err.message; }
};

$('password-form').onsubmit = async (event) => {
  event.preventDefault();
  $('password-error').textContent = '';
  const form = new FormData(event.target);
  try {
    await api('/api/password', { method: 'POST', body: { current: form.get('current'), password: form.get('password') } });
    me = (await api('/api/me')).user;
    showShell();
  } catch (err) { $('password-error').textContent = err.message; }
};

function logout() {
  fetch('/api/logout', { method: 'POST' }).finally(showLogin);
}
$('logout').onclick = logout;
$('password-logout').onclick = logout;
const unitNav = (rows) => rows.map(([id, label, icon]) => `<div class="nav-acc is-collapsed" data-nav-acc="${id}">
  <div class="nav-split">
    <button class="nav-btn nav-parent" type="button" data-view="${id}" title="${label}"><span class="material-symbols-rounded">${icon}</span><span>${label}</span></button>
    <button class="nav-caret-btn" type="button" data-nav-toggle="${id}" aria-expanded="false" aria-label="ย่อ ${label}" title="ย่อ/ขยาย"><span class="material-symbols-rounded nav-caret">expand_more</span></button>
  </div>
  <div class="nav-sub" data-nav-panel="${id}">${PLANT_PAGES.map(([page, itemIcon, title]) => `<button class="nav-btn" data-view="${id}-${page}" title="${title}"><span class="material-symbols-rounded">${itemIcon}</span><span>${title}</span></button>`).join('')}</div>
</div>`).join('');
document.querySelector('[data-nav-panel="work"]').insertAdjacentHTML('beforeend', unitNav(PLANTS));
document.querySelector('[data-nav-panel="activity"]').insertAdjacentHTML('beforeend', unitNav(ACTIVITIES));
document.querySelectorAll('.nav-btn[data-view]').forEach((node) => { node.onclick = () => openView(node.dataset.view); });
document.querySelectorAll('[data-nav-toggle]').forEach((node) => {
  node.onclick = () => {
    const acc = node.closest('[data-nav-acc]');
    const open = acc.classList.contains('is-collapsed');
    acc.classList.toggle('is-collapsed', !open);
    node.setAttribute('aria-expanded', open ? 'true' : 'false');
    localStorage.setItem(`smf-nav-${node.dataset.navToggle}`, open ? 'open' : 'collapsed');
  };
});
document.querySelectorAll('[data-nav-acc]').forEach((acc) => {
  const name = acc.dataset.navAcc;
  const saved = localStorage.getItem(`smf-nav-${name}`);
  if (saved === 'collapsed') {
    acc.classList.add('is-collapsed');
    acc.querySelector('[data-nav-toggle]')?.setAttribute('aria-expanded', 'false');
  } else if (saved === 'open') {
    acc.classList.remove('is-collapsed');
    acc.querySelector('[data-nav-toggle]')?.setAttribute('aria-expanded', 'true');
  }
});
function updateSidebarIcon() {
  const icon = $('sidebar-toggle-icon');
  if (icon) icon.textContent = document.body.classList.contains('sidebar-collapsed') ? 'left_panel_open' : 'left_panel_close';
}
if (localStorage.getItem('smf-sidebar') === 'collapsed') document.body.classList.add('sidebar-collapsed');
updateSidebarIcon();
$('sidebar-toggle').onclick = () => {
  if (window.matchMedia('(max-width:650px)').matches) {
    document.body.classList.toggle('sidebar-open');
    return;
  }
  document.body.classList.toggle('sidebar-collapsed');
  localStorage.setItem('smf-sidebar', document.body.classList.contains('sidebar-collapsed') ? 'collapsed' : 'expanded');
  updateSidebarIcon();
};
$('sidebar-backdrop').onclick = () => document.body.classList.remove('sidebar-open');
$('user-menu-btn').onclick = (event) => {
  event.stopPropagation();
  $('user-menu').classList.toggle('open');
};
document.addEventListener('click', (event) => {
  if (!$('user-menu').contains(event.target)) $('user-menu').classList.remove('open');
  const toggle = event.target.closest('[data-pw-toggle]');
  if (!toggle) return;
  const input = toggle.closest('.pw-wrap')?.querySelector('input');
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  const icon = toggle.querySelector('.material-symbols-rounded');
  if (icon) icon.textContent = show ? 'visibility_off' : 'visibility';
});

const savedTheme = localStorage.getItem('smf-theme');
if (savedTheme === 'dark') document.documentElement.dataset.theme = 'dark';
function paintTheme() {
  const icon = document.documentElement.dataset.theme === 'dark' ? 'dark_mode' : 'light_mode';
  document.querySelectorAll('#theme-icon, .login-theme-icon').forEach((node) => { node.textContent = icon; });
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  if (next === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  localStorage.setItem('smf-theme', next);
  paintTheme();
}
paintTheme();
$('theme-toggle').onclick = toggleTheme;
document.querySelectorAll('[data-theme-login]').forEach((node) => { node.onclick = toggleTheme; });

api('/api/me').then((data) => {
  me = data.user;
  if (me.passwordExpired) showPassword();
  else showShell();
}).catch(() => showLogin());
