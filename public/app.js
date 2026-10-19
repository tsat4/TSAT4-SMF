const STATUS = {
  cart: 'ตะกร้า',
  submitted: 'ส่งแล้ว',
  accepted: 'รับออร์เดอร์',
  preparing: 'กำลังจัด',
  ready: 'พร้อมรับ',
  received: 'รับแล้ว',
  cancelled: 'ยกเลิก'
};
const USAGE_ROLE = { viewer: 'Viewer', user: 'User', admin: 'Admin' };
const USAGE = 'ระบบงาน > Store > Usage';
const TITLES = {
  main: ['TSAT4 SMF', 'หน้าหลัก'],
  work: ['ระบบงาน', 'Work System'],
  store: ['Store', 'ระบบงาน > Store'],
  activity: ['ระบบกิจกรรม', 'Activity'],
  locked: ['Usage', USAGE],
  home: ['Dashboard', USAGE],
  edit: ['Edit Data', USAGE],
  requisition: ['เบิก', USAGE],
  queue: ['คิวจัดของ', USAGE],
  stock: ['Min / Current / Max', USAGE],
  setting: ['Setting', USAGE],
  system: ['Setting', 'ตารางทั้งระบบ']
};

let me = null;
let view = 'main';
let editMode = 'list';

const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
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
      <button class="btn btn-secondary" type="button" id="popup-cancel">ยกเลิก</button>
      <button class="btn ${saveLabel === 'ลบ' ? 'btn-danger' : 'btn-primary'}" type="button" id="popup-save">${saveLabel}</button>
    </div>
  </section>`;
  document.body.appendChild(node);
  document.addEventListener('keydown', popupKey);
  $('popup-cancel').onclick = closePopup;
  node.addEventListener('click', (event) => { if (event.target === node) closePopup(); });
  $('popup-save').onclick = () => Promise.resolve(onSave()).catch((err) => toast(err.message, 'error'));
  const first = node.querySelector('input:not([readonly]):not([disabled]),select,textarea');
  first?.focus();
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
  if (res.status === 401) {
    showLogin();
    throw new Error(data.error || 'กรุณาเข้าสู่ระบบ');
  }
  if (res.status === 403 && String(data.error || '').includes('90')) {
    showPassword();
    throw new Error(data.error);
  }
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

function rankOf(user = me) {
  if (!user) return 0;
  if (user.creator) return 3;
  return { viewer: 1, user: 2, admin: 3 }[user.usageRole] || 0;
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
  const render = {
    main: renderMain,
    work: renderWork,
    store: renderStore,
    activity: renderActivity,
    locked: renderLocked,
    home: renderHome,
    edit: renderEdit,
    setting: renderUsers,
    system: renderSystem
  }[name];
  render(target).catch((err) => { target.innerHTML = `<p class="form-error">${esc(err.message)}</p>`; });
}

function moduleCard(viewName, icon, title, text) {
  return `<button class="card module-card" type="button" data-go="${viewName}"><span class="material-symbols-rounded">${icon}</span><div class="card-title">${title}</div><div class="sum-meta">${text}</div></button>`;
}

function bindGo(target) {
  target.querySelectorAll('[data-go]').forEach((node) => { node.onclick = () => openView(node.dataset.go); });
}

async function renderMain(target) {
  target.innerHTML = `
    <div class="view-body">
      <section class="card">
        <div class="card-title">TSAT4 SMF</div>
        <p class="sum-meta">เลือกส่วนที่ต้องการเข้า ตอนนี้มี 2 ส่วน และเพิ่มส่วนใหม่ได้ภายหลัง</p>
        <div class="module-grid">
          ${moduleCard('work', 'work', 'ระบบงาน', 'Work System')}
          ${moduleCard('activity', 'event', 'ระบบกิจกรรม', 'Activity')}
        </div>
      </section>
    </div>`;
  bindGo(target);
}

async function renderWork(target) {
  target.innerHTML = `
    <div class="view-body">
      <section class="card">
        <div class="card-title">ระบบงาน</div>
        <p class="sum-meta">Work System</p>
        <div class="module-grid">
          ${moduleCard('store', 'warehouse', 'Store', 'คลังและรายการใช้งาน')}
        </div>
      </section>
    </div>`;
  bindGo(target);
}

async function renderStore(target) {
  target.innerHTML = `
    <div class="view-body">
      <section class="card">
        <div class="card-title">Store</div>
        <p class="sum-meta">ระบบงาน > Store</p>
        <div class="module-grid">
          ${moduleCard('home', 'inventory_2', 'Usage', 'Dashboard, Edit Data, Setting')}
        </div>
      </section>
    </div>`;
  bindGo(target);
}

async function renderActivity(target) {
  target.innerHTML = `
    <div class="view-body">
      <section class="card">
        <div class="card-title">ระบบกิจกรรม</div>
        <p class="sum-meta">Activity</p>
        <p class="empty">ยังไม่มีกิจกรรมในส่วนนี้</p>
      </section>
    </div>`;
}

async function renderSystem(target) {
  const catalog = await api('/api/system/tables');
  let offset = 0;
  let editing = null;
  let rows = [];
  let selected = null;
  target.innerHTML = `
    <div class="toolbar">
      <label class="field grow">ตาราง<select id="sys-table">${catalog.tables.map((table) => `<option value="${esc(table.name)}">${esc(table.name)}</option>`).join('')}</select></label>
      <div class="search-slot">
        <label class="field grow">ค้นหา<input id="sys-q"></label>
        <button class="btn btn-secondary" type="button" id="sys-search">ค้นหา</button>
      </div>
      <div class="action-bar">
        <button class="btn btn-primary" type="button" id="sys-add">เพิ่ม</button>
        <button class="btn btn-secondary" type="button" id="sys-edit" disabled>แก้ไข</button>
        <button class="btn btn-danger" type="button" id="sys-del" disabled>ลบ</button>
      </div>
    </div>
    <div class="table-wrap" id="sys-rows"></div>
    <div class="table-foot">
      <div class="sum-meta" id="sys-count"></div>
      <div class="action-bar">
        <button class="btn btn-secondary" type="button" id="sys-prev">ก่อนหน้า</button>
        <button class="btn btn-secondary" type="button" id="sys-next">ถัดไป</button>
      </div>
    </div>`;
  const tableOf = () => catalog.tables.find((table) => table.name === $('sys-table').value);
  const choices = { status: ['Active', 'Inactive'], group: ['Factory', 'Non', 'Center'], usage: ['viewer', 'user', 'admin'], req: ['cart', 'submitted', 'accepted', 'preparing', 'ready', 'received', 'cancelled'] };
  const drawForm = () => {
    const table = tableOf();
    const fields = table.columns.map((column) => {
      if (column.type === 'read') return '';
      const value = editing ? editing[column.name] : '';
      if (column.type === 'password') return `<label class="field">${column.name}<input id="sys-${column.name}" type="password" autocomplete="new-password"></label>`;
      if (column.type === 'bool') return `<label class="field">${column.name}<select id="sys-${column.name}"><option value="false">false</option><option value="true" ${value ? 'selected' : ''}>true</option></select></label>`;
      if (choices[column.type]) return `<label class="field">${column.name}<select id="sys-${column.name}">${choices[column.type].map((option) => `<option ${String(value) === option ? 'selected' : ''}>${esc(option)}</option>`).join('')}</select></label>`;
      const number = ['int', 'qty', 'money'].includes(column.type);
      return `<label class="field">${esc(column.name)}<input id="sys-${column.name}" ${number ? `type="number" step="${column.type === 'int' ? '1' : '0.001'}"` : ''} value="${esc(value ?? '')}" ${editing && column.pk ? 'readonly' : ''}></label>`;
    }).join('');
    openPopup(`${editing ? 'แก้ไขแถว' : 'เพิ่มแถว'} ${esc(table.name)}`, fields, saveRow);
  };
  const loadRows = async () => {
    const table = tableOf();
    const data = await api(`/api/system/tables/${encodeURIComponent(table.name)}?q=${encodeURIComponent($('sys-q').value.trim())}&offset=${offset}`);
    rows = data.rows;
    selected = null;
    $('sys-edit').disabled = true;
    $('sys-del').disabled = true;
    $('sys-count').textContent = `แสดง ${rows.length} จาก ${data.total} แถว`;
    const visible = table.columns.filter((column) => column.type !== 'password');
    $('sys-rows').innerHTML = rows.length ? `<table class="mo-data-table"><thead><tr>${visible.map((column) => `<th>${esc(column.name)}</th>`).join('')}</tr></thead><tbody>${rows.map((row, index) => `<tr data-pick="${index}">${visible.map((column) => `<td>${esc(row[column.name] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p class="empty">ไม่มีแถว</p>';
    bindRowSelect($('sys-rows'), (pick) => {
      selected = rows[Number(pick)];
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
      if (column.type === 'bool') { values[column.name] = input.value === 'true'; continue; }
      values[column.name] = input.value;
    }
    try {
      if (editing) {
        const key = {};
        table.pk.forEach((column) => { key[column] = editing[column]; });
        await api(`/api/system/tables/${encodeURIComponent(table.name)}`, { method: 'PATCH', body: { key, values } });
      } else {
        await api(`/api/system/tables/${encodeURIComponent(table.name)}`, { method: 'POST', body: values });
      }
      toast('บันทึกแล้ว');
      editing = null;
      closePopup();
      await loadRows();
    } catch (err) { toast(err.message, 'error'); }
  };
  const removeRow = async (row) => {
    const table = tableOf();
    const key = {};
    table.pk.forEach((column) => { key[column] = row[column]; });
    confirmPopup(`ลบแถว ${esc(table.name)}`, 'ตรวจแถวที่เลือกอีกครั้งก่อนลบ', async () => {
      await api(`/api/system/tables/${encodeURIComponent(table.name)}`, { method: 'DELETE', body: { key } });
      toast('ลบแล้ว');
      await loadRows();
    });
  };
  $('sys-table').onchange = () => { offset = 0; editing = null; closePopup(); loadRows().catch((err) => toast(err.message, 'error')); };
  $('sys-search').onclick = () => { offset = 0; loadRows().catch((err) => toast(err.message, 'error')); };
  $('sys-add').onclick = () => { editing = null; drawForm(); };
  $('sys-edit').onclick = () => {
    if (!selected) return toast('เลือกแถวก่อน', 'error');
    editing = selected;
    drawForm();
  };
  $('sys-del').onclick = () => {
    if (!selected) return toast('เลือกแถวก่อน', 'error');
    removeRow(selected);
  };
  $('sys-prev').onclick = () => { offset = Math.max(0, offset - 50); loadRows().catch((err) => toast(err.message, 'error')); };
  $('sys-next').onclick = () => { offset += 50; loadRows().catch((err) => toast(err.message, 'error')); };
  await loadRows();
}

async function renderLocked(target) {
  target.innerHTML = `
    <div class="view-body">
      <section class="card">
        <div class="card-title">Usage</div>
        <p class="empty">ยังไม่มีชื่อในรายการ Usage จึงยังเข้าส่วนนี้ไม่ได้</p>
      </section>
    </div>`;
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

async function renderEdit(target) {
  const pageSize = 50;
  let offset = 0;
  const admin = rankOf() >= 3;
  target.innerHTML = `
    <div class="toolbar">
      <div class="search-slot">
        <label class="field grow">ค้นหา<input id="edit-q" placeholder="เลขที่ ศูนย์ต้นทุน หรือสถานะ"></label>
        <button class="btn btn-secondary" type="button" id="edit-search">ค้นหา</button>
      </div>
      <div class="action-bar" id="edit-actions"></div>
    </div>
    <div class="table-wrap" id="edit-rows"></div>
    <div class="table-foot">
      <div class="sum-meta" id="edit-count"></div>
      <div class="action-bar">
        <button class="btn btn-secondary" type="button" id="edit-prev">ก่อนหน้า</button>
        <button class="btn btn-secondary" type="button" id="edit-next">ถัดไป</button>
      </div>
    </div>`;
  const setFoot = (shown, total) => {
    $('edit-count').textContent = `แสดง ${shown} จาก ${total} แถว`;
    $('edit-prev').disabled = offset <= 0;
    $('edit-next').disabled = offset + pageSize >= total;
  };
  const pageOf = (rows) => rows.slice(offset, offset + pageSize);
  const load = async () => {
    if (editMode === 'summary') await loadSummary();
    else await loadList();
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
    $('edit-actions').innerHTML = `
      <button class="btn btn-primary" type="button" id="edit-withdraw">เบิก</button>
      <button class="btn btn-secondary" type="button" id="edit-fix" disabled>แก้ไข</button>
      <button class="btn btn-danger" type="button" id="edit-del" disabled>ลบ</button>
      ${admin ? '<button class="btn btn-secondary" type="button" id="edit-prepare" disabled>จัดเตรียม</button><button class="btn btn-secondary" type="button" id="edit-issue" disabled>จ่าย</button>' : ''}
      <button class="btn btn-primary" type="button" id="edit-receive" disabled>รับ</button>`;
    $('edit-rows').innerHTML = page.length ? `<table class="mo-data-table"><thead><tr><th>เลขที่</th><th>ผู้เบิก</th><th>ศูนย์ต้นทุน</th><th>สถานะ</th></tr></thead><tbody>
      ${page.map((row) => `<tr data-pick="${esc(row.id)}" data-status="${esc(row.status)}" data-own="${row.requested_by === me.employeeId ? '1' : '0'}">
        <td>#${row.id}</td><td>${esc(row.requested_by)}</td>
        <td>${row.costcenter === '-' ? 'ยังไม่เลือก' : `${esc(row.costcenter)} · ${esc(row.costcenterName)}`}</td>
        <td>${badge(row.status)}</td></tr>`).join('')}
    </tbody></table>` : '<p class="empty">ไม่มีใบเบิก</p>';
    setFoot(page.length, rows.length);
    const paint = (row) => {
      const own = row?.dataset.own === '1';
      const status = row?.dataset.status || '';
      $('edit-fix').disabled = !(own && status === 'cart');
      $('edit-del').disabled = !(own && ['cart', 'submitted', 'accepted', 'preparing', 'ready'].includes(status));
      if ($('edit-prepare')) $('edit-prepare').disabled = !['submitted', 'accepted'].includes(status);
      if ($('edit-issue')) $('edit-issue').disabled = status !== 'preparing';
      $('edit-receive').disabled = !(own && status === 'ready');
    };
    bindRowSelect($('edit-rows'), (_id, row) => paint(row));
    $('edit-withdraw').onclick = () => openAddPopup().catch((err) => toast(err.message, 'error'));
    $('edit-fix').onclick = () => { editMode = 'summary'; openView('edit'); };
    $('edit-del').onclick = () => {
      const row = $('edit-rows').querySelector('tr.is-selected');
      if (!row || row.dataset.own !== '1') return toast('ลบได้เฉพาะใบที่ตนเองสร้าง', 'error');
      confirmPopup('ลบใบเบิก', `ตรวจใบเบิก #${row.dataset.pick} อีกครั้งก่อนลบ`, async () => {
        await api(`/api/requisitions/${row.dataset.pick}/status`, { method: 'POST', body: { status: 'cancelled' } });
        toast('ลบแล้ว');
        openView('edit');
      });
    };
    const moveStatus = (buttonId, nextOf) => {
      const button = $(buttonId);
      if (!button) return;
      button.onclick = async () => {
        const row = $('edit-rows').querySelector('tr.is-selected');
        const next = row ? nextOf(row.dataset.status) : '';
        if (!next) return toast('เลือกใบที่ตรงขั้นตอนก่อน', 'error');
        try {
          await api(`/api/requisitions/${row.dataset.pick}/status`, { method: 'POST', body: { status: next } });
          toast('อัปเดตสถานะแล้ว');
          openView('edit');
        } catch (err) { toast(err.message, 'error'); }
      };
    };
    moveStatus('edit-prepare', (status) => ({ submitted: 'accepted', accepted: 'preparing' }[status]));
    moveStatus('edit-issue', (status) => (status === 'preparing' ? 'ready' : ''));
    $('edit-receive').onclick = async () => {
      const row = $('edit-rows').querySelector('tr.is-selected');
      if (!row || row.dataset.own !== '1' || row.dataset.status !== 'ready') return toast('รับได้เฉพาะใบที่ตนเองเบิกและพร้อมรับ', 'error');
      try {
        await api(`/api/requisitions/${row.dataset.pick}/status`, { method: 'POST', body: { status: 'received' } });
        toast('ยืนยันแล้ว และตัดยอด Current');
        openView('edit');
      } catch (err) { toast(err.message, 'error'); }
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
    $('edit-actions').innerHTML = `
      <button class="btn btn-secondary" type="button" id="edit-back">รายการ</button>
      <button class="btn btn-primary" type="button" id="edit-add">เพิ่ม</button>
      <button class="btn btn-secondary" type="button" id="edit-line" disabled>แก้ไข</button>
      <button class="btn btn-danger" type="button" id="edit-line-del" disabled>ลบ</button>
      <button class="btn btn-primary hold-btn" type="button" id="edit-hold" ${allLines.length ? '' : 'disabled'}><span class="hold-fill"></span><span class="hold-label">กดค้าง 2 วินาที</span></button>`;
    $('edit-rows').innerHTML = page.length ? `<table class="mo-data-table"><thead><tr><th>รหัส</th><th>รายการ</th><th>หน่วย</th><th>จำนวน</th><th>ศูนย์ต้นทุน</th></tr></thead><tbody>
      ${page.map((line) => `<tr data-pick="${esc(line.id)}" data-qty="${Number(line.qty)}" data-material="${esc(line.material)}" data-name="${esc(line.materialDescription)}" data-bun="${esc(line.bun)}"><td>${esc(line.material)}</td><td>${esc(line.materialDescription)}</td><td>${esc(line.bun)}</td><td>${Number(line.qty)}</td><td>${esc(line.costcenter === '-' ? cart.costcenter : line.costcenter)}</td></tr>`).join('')}
    </tbody></table>` : '<p class="empty">ยังไม่มีรายการ กดเพิ่ม</p>';
    setFoot(page.length, lines.length);
    bindRowSelect($('edit-rows'), (_id, row) => { picked = row; $('edit-line').disabled = false; $('edit-line-del').disabled = false; });
    $('edit-back').onclick = () => { editMode = 'list'; $('edit-q').value = ''; offset = 0; openView('edit'); };
    $('edit-add').onclick = () => openAddPopup().catch((err) => toast(err.message, 'error'));
    $('edit-line').onclick = () => {
      if (!picked) return toast('เลือกแถวก่อน', 'error');
      openPopup('แก้ไขจำนวน', `
        <label class="field">รหัส<input value="${esc(picked.dataset.material)}" readonly></label>
        <label class="field">รายการ<input value="${esc(picked.dataset.name)}" readonly></label>
        <label class="field">หน่วย<input value="${esc(picked.dataset.bun)}" readonly></label>
        <label class="field">จำนวน<input id="line-qty" type="number" min="0.001" step="0.001" value="${esc(picked.dataset.qty)}"></label>
      `, async () => {
        const qty = Number($('line-qty').value);
        if (!(qty > 0)) throw new Error('ระบุจำนวน');
        await api(`/api/requisitions/${cart.id}/lines/${picked.dataset.pick}`, { method: 'PATCH', body: { qty } });
        toast('แก้ไขแล้ว');
        closePopup();
        editMode = 'summary';
        openView('edit');
      });
    };
    $('edit-line-del').onclick = () => {
      if (!picked) return toast('เลือกแถวก่อน', 'error');
      confirmPopup('ลบรายการ', `ตรวจ ${esc(picked.dataset.material)} อีกครั้งก่อนลบ`, async () => {
        await api(`/api/requisitions/${cart.id}/lines/${picked.dataset.pick}`, { method: 'DELETE' });
        editMode = 'summary';
        openView('edit');
      });
    };
    if (allLines.length) {
      bindHold($('edit-hold'), async () => {
        try {
          await api(`/api/requisitions/${cart.id}/status`, { method: 'POST', body: { status: 'submitted', costcenter: cart.costcenter } });
          toast('บันทึกการเบิกแล้ว');
          editMode = 'list';
          openView('edit');
        } catch (err) {
          toast(err.message, 'error');
          editMode = 'summary';
          openView('edit');
        }
      });
    }
  };
  $('edit-search').onclick = () => { offset = 0; load().catch((err) => toast(err.message, 'error')); };
  $('edit-q').addEventListener('keydown', (event) => { if (event.key === 'Enter') { offset = 0; load().catch((err) => toast(err.message, 'error')); } });
  $('edit-prev').onclick = () => { offset = Math.max(0, offset - pageSize); load().catch((err) => toast(err.message, 'error')); };
  $('edit-next').onclick = () => { offset += pageSize; load().catch((err) => toast(err.message, 'error')); };
  await load();
}

async function openAddPopup() {
  const [pay, mine] = await Promise.all([
    api('/api/pay-centers'),
    api('/api/requisitions?scope=mine')
  ]);
  const centers = [...(pay.costcenters || [])].sort((a, b) => String(a.costcenter).localeCompare(String(b.costcenter)));
  if (!centers.length) return toast('ไม่มีศูนย์ต้นทุนในขอบเขตของคุณ', 'error');
  const cartHeader = mine.requisitions.find((row) => row.status === 'cart');
  const chosen = cartHeader && cartHeader.costcenter !== '-' ? cartHeader.costcenter : centers[0].costcenter;
  let picked = null;
  openPopup('เบิก', `
    <div class="search-block">
      <div class="search-slot">
        <label class="field">รายการ<input id="line-q" placeholder="รหัสหรือชื่อ"></label>
        <button class="btn btn-secondary" type="button" id="line-search">ค้นหา</button>
      </div>
      <div class="search-list" id="line-results"></div>
    </div>
    <label class="field">รหัส<input id="line-code" readonly></label>
    <label class="field">หน่วย<input id="line-bun" readonly></label>
    <label class="field">จำนวน<input id="line-qty" type="number" min="0.001" step="0.001" value="1"></label>
    <label class="field">ศูนย์ต้นทุน<select id="line-cc">${centers.map((row) => `<option value="${esc(row.costcenter)}" ${row.costcenter === chosen ? 'selected' : ''}>${esc(row.costcenter)} · ${esc(row.objectName)}</option>`).join('')}</select></label>
  `, async () => {
    if (!picked) throw new Error('เลือกรายการ');
    const qty = Number($('line-qty').value);
    const costcenter = $('line-cc').value;
    if (!(qty > 0)) throw new Error('ระบุจำนวน');
    if (!costcenter) throw new Error('เลือกศูนย์ต้นทุน');
    let id = cartHeader?.id;
    if (!id) {
      const created = await api('/api/requisitions', { method: 'POST', body: { costcenter } });
      id = created.id;
    }
    await api(`/api/requisitions/${id}/lines`, { method: 'POST', body: { material: picked.material, qty, costcenter } });
    toast('ใส่ตะกร้าแล้ว');
    closePopup();
    editMode = 'summary';
    openView('edit');
  }, 'ใส่ตะกร้า');
  const searchLine = async () => {
    const data = await api(`/api/materials?q=${encodeURIComponent($('line-q').value.trim())}`);
    const materials = [...data.materials].sort((a, b) => String(a.material).localeCompare(String(b.material)));
    $('line-results').innerHTML = materials.length ? `<table class="mo-data-table"><thead><tr><th>รหัส</th><th>รายการ</th><th>หน่วย</th></tr></thead><tbody>
      ${materials.map((row) => `<tr data-pick="${esc(row.material)}" data-bun="${esc(row.bun)}" data-name="${esc(row.material_description)}"><td>${esc(row.material)}</td><td>${esc(row.material_description)}</td><td>${esc(row.bun)}</td></tr>`).join('')}
    </tbody></table>` : '<p class="empty">ไม่พบรายการ</p>';
    bindRowSelect($('line-results'), (id, row) => {
      picked = { material: id, bun: row.dataset.bun, name: row.dataset.name };
      $('line-code').value = id;
      $('line-bun').value = row.dataset.bun;
    });
  };
  $('line-search').onclick = () => searchLine().catch((err) => toast(err.message, 'error'));
  $('line-q').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); searchLine().catch((err) => toast(err.message, 'error')); } });
}

async function renderHome(target) {
  const summary = await api('/api/summary');
  target.innerHTML = `
    <div class="kpi-grid dash-kpis">
      <article class="kpi"><div class="kpi-label">ใบเบิกที่ยังไม่จบ</div><div class="kpi-value">${summary.open}</div></article>
      <article class="kpi"><div class="kpi-label">พร้อมให้รับของ</div><div class="kpi-value">${summary.ready}</div></article>
      <article class="kpi"><div class="kpi-label">คิวที่ต้องจัด</div><div class="kpi-value">${summary.queue}</div></article>
    </div>
    <div class="view-body">
      <section class="card">
        <div class="card-title">เริ่มเบิก</div>
        <p class="sum-meta">กดเบิก เลือกรายการ หน่วยขึ้นให้อัตโนมัติ ระบุจำนวนและศูนย์ต้นทุน แล้วตรวจสรุปก่อนกดค้างยืนยัน</p>
        <button class="btn btn-primary" type="button" data-go="edit">ไปที่ Edit Data</button>
      </section>
    </div>`;
  bindGo(target);
}

function centerText(row) {
  return (row.costcenters || []).map((center) => center.costcenter).join(', ');
}

async function renderUsers(target) {
  let offset = 0;
  let selected = null;
  let rows = [];
  target.innerHTML = `
    <div class="toolbar">
      <label class="field grow">ตาราง<select id="usage-table"><option value="members">mt_sto_user</option><option value="materials">mt_sto_usage</option></select></label>
      <div class="search-slot">
        <label class="field grow">ค้นหา<input id="usage-q"></label>
        <button class="btn btn-secondary" type="button" id="usage-search">ค้นหา</button>
      </div>
      <div class="action-bar">
        <button class="btn btn-primary" type="button" id="usage-add">เพิ่ม</button>
        <button class="btn btn-secondary" type="button" id="usage-edit" disabled>แก้ไข</button>
        <button class="btn btn-danger" type="button" id="usage-del" disabled>ลบ</button>
      </div>
    </div>
    <div class="table-wrap" id="usage-rows"></div>
    <div class="table-foot">
      <div class="sum-meta" id="usage-count"></div>
      <div class="action-bar">
        <button class="btn btn-secondary" type="button" id="usage-prev">ก่อนหน้า</button>
        <button class="btn btn-secondary" type="button" id="usage-next">ถัดไป</button>
      </div>
    </div>`;
  const kind = () => $('usage-table').value;
  let formMode = 'add';
  const drawForm = () => {
    if (kind() === 'materials') {
      const row = formMode === 'edit' && selected ? selected : {};
      openPopup(`${row.material ? 'แก้ไขแถว' : 'เพิ่มแถว'} mt_sto_usage`, `
        <label class="field">รหัส<input id="mat-code" value="${esc(row.material || '')}" ${row.material ? 'readonly' : ''}></label>
        <label class="field">ชื่อรายการ<input id="mat-name" value="${esc(row.material_description || '')}"></label>
        <label class="field">หน่วย<input id="mat-bun" value="${esc(row.bun || '')}"></label>
        <label class="field">ราคา<input id="mat-price" type="number" min="0" step="0.01" value="${row.price ?? ''}"></label>
        <label class="field">สกุลเงิน<input id="mat-crcy" value="${esc(row.crcy || 'THB')}"></label>
        <label class="field">สถานะ<select id="mat-status"><option ${row.status === 'Inactive' ? '' : 'selected'}>Active</option><option ${row.status === 'Inactive' ? 'selected' : ''}>Inactive</option></select></label>
      `, saveRow);
      return;
    }
    const row = formMode === 'edit' && selected ? selected : null;
    openPopup(`${row ? 'แก้ไขแถว' : 'เพิ่มแถว'} mt_sto_user`, `
      ${row ? '' : `<div class="search-block"><div class="search-slot"><label class="field">ค้นพนักงาน<input id="emp-q" placeholder="รหัสหรือชื่อจาก mt_main_employee"></label><button class="btn btn-secondary" type="button" id="emp-search">ค้นหา</button></div><div class="search-list" id="emp-results"></div></div>`}
      <label class="field">รหัสพนักงาน<input id="user-id" readonly value="${esc(row?.employeeId || '')}" placeholder="เลือกจากรายชื่อพนักงาน"></label>
      <label class="field">รหัสผ่าน<input id="user-password" type="password" minlength="8" autocomplete="new-password"></label>
      <label class="field">บทบาท<select id="user-role"><option value="viewer" ${row?.role === 'viewer' ? 'selected' : ''}>Viewer</option><option value="user" ${row?.role === 'user' ? 'selected' : ''}>User</option><option value="admin" ${row?.role === 'admin' ? 'selected' : ''}>Admin</option></select></label>
      <label class="field">สถานะ<select id="user-status"><option ${row?.status === 'Inactive' ? '' : 'selected'}>Active</option><option ${row?.status === 'Inactive' ? 'selected' : ''}>Inactive</option></select></label>
    `, saveRow);
    if ($('emp-search')) {
      $('emp-search').onclick = searchEmployees;
      $('emp-q').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); searchEmployees(); } });
    }
  };
  const searchEmployees = async () => {
    const data = await api(`/api/employees?q=${encodeURIComponent($('emp-q').value.trim())}`);
    const people = [...data.employees].sort((a, b) => String(a.employee_id).localeCompare(String(b.employee_id)));
    $('emp-results').innerHTML = people.length ? `<table class="mo-data-table"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>หน่วยงาน</th></tr></thead><tbody>
      ${people.map((person) => `<tr data-pick="${esc(person.employee_id)}"><td>${esc(person.employee_id)}</td><td>${esc(person.name)}</td><td>${esc(person.department || '')}</td></tr>`).join('')}
    </tbody></table>` : '<p class="empty">ไม่พบพนักงาน</p>';
    bindRowSelect($('emp-results'), (id) => { $('user-id').value = id; });
  };
  const loadRows = async () => {
    selected = null;
    $('usage-edit').disabled = true;
    $('usage-del').disabled = true;
    if (kind() === 'materials') {
      const data = await api(`/api/usage-materials?q=${encodeURIComponent($('usage-q').value.trim())}&offset=${offset}`);
      rows = data.materials;
      $('usage-count').textContent = `แสดง ${rows.length} จาก ${data.total} แถว`;
      $('usage-rows').innerHTML = rows.length ? `<table class="mo-data-table"><thead><tr><th>รหัส</th><th>ชื่อรายการ</th><th>หน่วย</th><th>ราคา</th><th>สกุลเงิน</th><th>สถานะ</th></tr></thead><tbody>
        ${rows.map((row, index) => `<tr data-pick="${index}"><td>${esc(row.material)}</td><td>${esc(row.material_description)}</td><td>${esc(row.bun)}</td><td>${Number(row.price)}</td><td>${esc(row.crcy)}</td><td>${esc(row.status)}</td></tr>`).join('')}
      </tbody></table>` : '<p class="empty">ไม่มีรายการ</p>';
    } else {
      const data = await api('/api/users');
      const term = $('usage-q').value.trim().toLowerCase();
      const filtered = data.users.filter((row) => !term || [row.employeeId, row.name, row.department, centerText(row), row.role].join(' ').toLowerCase().includes(term));
      const page = filtered.slice(offset, offset + 50);
      rows = page;
      $('usage-count').textContent = `แสดง ${page.length} จาก ${filtered.length} แถว`;
      $('usage-rows').innerHTML = page.length ? `<table class="mo-data-table"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>หน่วยงาน</th><th>ศูนย์ต้นทุน</th><th>บทบาท</th><th>สถานะ</th></tr></thead><tbody>
        ${page.map((row, index) => `<tr data-pick="${index}" data-creator="${row.creator ? '1' : '0'}"><td>${esc(row.employeeId)}</td><td>${esc(row.name)}</td><td>${esc(row.department)}</td><td>${esc(centerText(row))}</td><td>${esc(USAGE_ROLE[row.role] || row.role)}${row.creator ? ' · ผู้สร้างระบบ' : ''}</td><td>${esc(row.status)}</td></tr>`).join('')}
      </tbody></table>` : '<p class="empty">ไม่มีแถว</p>';
    }
    bindRowSelect($('usage-rows'), (pick, row) => {
      selected = rows[Number(pick)];
      const locked = kind() === 'members' && row.dataset.creator === '1';
      $('usage-edit').disabled = locked;
      $('usage-del').disabled = locked;
    });
  };
  const saveRow = async () => {
    try {
      if (kind() === 'materials') {
        const body = { material: $('mat-code').value.trim(), materialDescription: $('mat-name').value.trim(), bun: $('mat-bun').value.trim(), price: Number($('mat-price').value), crcy: $('mat-crcy').value.trim(), status: $('mat-status').value };
        if (formMode === 'edit' && selected) await api(`/api/usage-materials/${encodeURIComponent(selected.material)}`, { method: 'PATCH', body });
        else await api('/api/usage-materials', { method: 'POST', body });
      } else if (formMode === 'edit' && selected) {
        await api(`/api/users/${encodeURIComponent(selected.employeeId)}`, { method: 'PATCH', body: { role: $('user-role').value, status: $('user-status').value, password: $('user-password').value } });
      } else {
        if (!$('user-id').value.trim()) return toast('เลือกพนักงานจากรายชื่อก่อน', 'error');
        await api('/api/users', { method: 'POST', body: { employeeId: $('user-id').value.trim(), password: $('user-password').value, role: $('user-role').value, status: $('user-status').value } });
      }
      toast('บันทึกแล้ว');
      closePopup();
      await loadRows();
    } catch (err) { toast(err.message, 'error'); }
  };
  const removeRow = async () => {
    if (!selected) return toast('เลือกแถวก่อน', 'error');
    const label = kind() === 'materials' ? selected.material : selected.employeeId;
    confirmPopup('ลบแถว', `ตรวจ ${esc(label)} อีกครั้งก่อนลบ`, async () => {
      if (kind() === 'materials') {
        await api(`/api/usage-materials/${encodeURIComponent(selected.material)}`, { method: 'DELETE' });
        toast('ลบแล้ว');
      } else {
        const result = await api(`/api/users/${encodeURIComponent(selected.employeeId)}`, { method: 'DELETE' });
        toast(result.inactive ? 'มีประวัติแล้ว จึงปิดเป็น Inactive' : 'นำออกจาก Usage แล้ว');
      }
      await loadRows();
    });
  };
  $('usage-table').onchange = () => { offset = 0; $('usage-q').value = ''; closePopup(); loadRows().catch((err) => toast(err.message, 'error')); };
  $('usage-search').onclick = () => { offset = 0; loadRows().catch((err) => toast(err.message, 'error')); };
  $('usage-add').onclick = () => { selected = null; formMode = 'add'; drawForm(); };
  $('usage-edit').onclick = () => {
    if (!selected) return toast('เลือกแถวก่อน', 'error');
    formMode = 'edit';
    drawForm();
  };
  $('usage-del').onclick = () => { removeRow().catch((err) => toast(err.message, 'error')); };
  $('usage-prev').onclick = () => { offset = Math.max(0, offset - 50); loadRows().catch((err) => toast(err.message, 'error')); };
  $('usage-next').onclick = () => { offset += 50; loadRows().catch((err) => toast(err.message, 'error')); };
  await loadRows();
}

$('login-form').onsubmit = async (event) => {
  event.preventDefault();
  $('login-error').textContent = '';
  const form = new FormData(event.target);
  try {
    const data = await api('/api/login', { method: 'POST', body: { employeeId: form.get('employeeId'), password: form.get('password') } });
    me = data.user;
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
  if (localStorage.getItem(`smf-nav-${name}`) === 'collapsed') {
    acc.classList.add('is-collapsed');
    acc.querySelector('[data-nav-toggle]')?.setAttribute('aria-expanded', 'false');
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
