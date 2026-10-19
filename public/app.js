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

const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
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
  const need = { home: 1, edit: 2, requisition: 2, queue: 2, stock: 2, setting: 3 }[name] || 0;
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
    requisition: renderRequisition,
    queue: renderQueue,
    stock: renderStock,
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
      <label class="field grow">ค้นหา<input id="sys-q"></label>
      <button class="btn btn-secondary" type="button" id="sys-search">ค้นหา</button>
      <div class="action-bar">
        <button class="btn btn-primary" type="button" id="sys-add">เพิ่ม</button>
        <button class="btn btn-secondary" type="button" id="sys-edit" disabled>แก้ไข</button>
        <button class="btn btn-danger" type="button" id="sys-del" disabled>ลบ</button>
      </div>
    </div>
    <div id="sys-form"></div>
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
    const box = $('sys-form');
    if (!box.dataset.open) { box.innerHTML = ''; return; }
    box.innerHTML = `<section class="card"><div class="card-title">${editing ? 'แก้ไขแถว' : 'เพิ่มแถว'} ${esc(table.name)}</div><div class="toolbar">${table.columns.map((column) => {
      if (column.type === 'read') return '';
      const value = editing ? editing[column.name] : '';
      if (column.type === 'password') return `<label class="field">${column.name}<input id="sys-${column.name}" type="password" autocomplete="new-password"></label>`;
      if (column.type === 'bool') return `<label class="field">${column.name}<select id="sys-${column.name}"><option value="false">false</option><option value="true" ${value ? 'selected' : ''}>true</option></select></label>`;
      if (choices[column.type]) return `<label class="field">${column.name}<select id="sys-${column.name}">${choices[column.type].map((option) => `<option ${String(value) === option ? 'selected' : ''}>${esc(option)}</option>`).join('')}</select></label>`;
      const number = ['int', 'qty', 'money'].includes(column.type);
      return `<label class="field">${esc(column.name)}<input id="sys-${column.name}" ${number ? `type="number" step="${column.type === 'int' ? '1' : '0.001'}"` : ''} value="${esc(value ?? '')}" ${editing && column.pk ? 'disabled' : ''}></label>`;
    }).join('')}</div><div class="form-actions"><button class="btn btn-primary" type="button" id="sys-save">บันทึก</button><button class="btn btn-secondary" type="button" id="sys-cancel">ยกเลิก</button></div></section>`;
    $('sys-cancel').onclick = () => { editing = null; delete box.dataset.open; drawForm(); };
    $('sys-save').onclick = saveRow;
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
      delete $('sys-form').dataset.open;
      drawForm();
      await loadRows();
    } catch (err) { toast(err.message, 'error'); }
  };
  const removeRow = async (row) => {
    const table = tableOf();
    const key = {};
    table.pk.forEach((column) => { key[column] = row[column]; });
    if (!confirm(`ลบแถวใน ${table.name}?`)) return;
    try {
      await api(`/api/system/tables/${encodeURIComponent(table.name)}`, { method: 'DELETE', body: { key } });
      toast('ลบแล้ว');
      await loadRows();
    } catch (err) { toast(err.message, 'error'); }
  };
  $('sys-table').onchange = () => { offset = 0; editing = null; delete $('sys-form').dataset.open; drawForm(); loadRows().catch((err) => toast(err.message, 'error')); };
  $('sys-search').onclick = () => { offset = 0; loadRows().catch((err) => toast(err.message, 'error')); };
  $('sys-add').onclick = () => { editing = null; $('sys-form').dataset.open = '1'; drawForm(); };
  $('sys-edit').onclick = () => {
    if (!selected) return toast('เลือกแถวก่อน', 'error');
    editing = selected;
    $('sys-form').dataset.open = '1';
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

async function renderEdit(target) {
  target.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-secondary" type="button" data-panel="requisition">เบิก</button>
      <button class="btn btn-secondary" type="button" data-panel="queue">คิวจัดของ</button>
      <button class="btn btn-secondary" type="button" data-panel="stock">Min / Current / Max</button>
    </div>
    <div id="edit-panel"></div>`;
  const openPanel = async (panel) => {
    target.querySelectorAll('[data-panel]').forEach((node) => {
      node.classList.toggle('btn-primary', node.dataset.panel === panel);
      node.classList.toggle('btn-secondary', node.dataset.panel !== panel);
    });
    const box = $('edit-panel');
    box.innerHTML = '<div class="empty">กำลังโหลด...</div>';
    await { requisition: renderRequisition, queue: renderQueue, stock: renderStock }[panel](box);
  };
  target.querySelectorAll('[data-panel]').forEach((node) => { node.onclick = () => openPanel(node.dataset.panel); });
  await openPanel('requisition');
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
        <p class="sum-meta">เลือกศูนย์ต้นทุนที่จ่าย เลือกรายการ ระบุจำนวน แล้วใส่ตะกร้าได้หลายรายการ เมื่อรับของและกดยืนยัน ระบบจะตัดยอด Current</p>
        <button class="btn btn-primary" type="button" data-go="requisition">ไปที่ใบเบิก</button>
      </section>
    </div>`;
  bindGo(target);
}

async function renderRequisition(target) {
  const [pay, mine] = await Promise.all([
    api('/api/pay-centers'),
    api('/api/requisitions?scope=mine')
  ]);
  const cartHeader = mine.requisitions.find((row) => row.status === 'cart');
  const cart = cartHeader ? (await api(`/api/requisitions/${cartHeader.id}`)).requisition : null;
  target.innerHTML = `
    <div class="view-body">
    <section class="card">
      <div class="card-title">${cart ? `ตะกร้า #${cart.id}` : 'เปิดตะกร้า'}</div>
      <div class="toolbar">
        <label class="field">ศูนย์ต้นทุนที่จ่าย
          <select id="buyer">${pay.costcenters.map((row) => `<option value="${esc(row.costcenter)}" ${cart && cart.costcenter === row.costcenter ? 'selected' : ''}>${esc(row.costcenter)} · ${esc(row.objectName)}</option>`).join('')}</select>
        </label>
        ${cart || !pay.costcenters.length ? '' : '<button class="btn btn-primary" type="button" id="new-cart">เปิดตะกร้า</button>'}
      </div>
      ${cart ? `
        <div class="toolbar">
          <label class="field">ค้นหารายการ<input id="item-q" placeholder="รหัสหรือชื่อรายการ"></label>
          <label class="field">จำนวน<input id="item-qty" type="number" min="0.001" step="0.001" value="1"></label>
          <button class="btn btn-primary" type="button" id="search-item">ค้นหา</button>
        </div>
        <div id="item-results"></div>
        <div id="cart-lines"></div>` : `<p class="empty">${pay.costcenters.length ? 'ยังไม่มีตะกร้า' : 'หน่วยงานนี้ยังไม่มีศูนย์ต้นทุนสำหรับเบิกจ่าย'}</p>`}
    </section>
    <section class="card"><div class="card-title-row"><div class="card-title">ใบเบิกของฉัน</div><div class="action-bar" id="mine-bar"></div></div><div class="table-wrap" id="mine-table">${orderTable(mine.requisitions.filter((row) => row.status !== 'cart'), true)}</div></section>
    </div>`;
  mountOrderBar($('mine-table'), $('mine-bar'));
  if (!cart) {
    if (!$('new-cart')) return;
    $('new-cart').onclick = async () => {
      try {
        await api('/api/requisitions', { method: 'POST', body: { costcenter: $('buyer').value } });
        openView('requisition');
      } catch (err) { toast(err.message, 'error'); }
    };
    return;
  }
  drawLines(cart);
  $('search-item').onclick = () => searchItems(cart.id);
  $('item-q').addEventListener('keydown', (event) => { if (event.key === 'Enter') searchItems(cart.id); });
}

function drawLines(cart) {
  const box = $('cart-lines');
  if (!cart.lines?.length) {
    box.innerHTML = '<div class="action-bar"><button class="btn btn-primary" type="button" id="submit-cart">ส่งออร์เดอร์</button></div><p class="empty">ตะกร้าว่าง</p>';
    $('submit-cart').onclick = () => changeStatus(cart.id, 'submitted');
    return;
  }
  let picked = '';
  box.innerHTML = `
    <div class="action-bar"><button class="btn btn-danger" type="button" id="line-remove" disabled>เอาออก</button><button class="btn btn-primary" type="button" id="submit-cart">ส่งออร์เดอร์</button></div>
    <div class="table-wrap"><table class="mo-data-table"><thead><tr><th>รหัส</th><th>รายการ</th><th>จำนวน</th></tr></thead><tbody>
    ${cart.lines.map((line) => `<tr data-pick="${esc(line.id)}"><td>${esc(line.material)}</td><td>${esc(line.materialDescription)}</td><td>${Number(line.qty)} ${esc(line.bun)}</td></tr>`).join('')}
  </tbody></table></div>`;
  bindRowSelect(box, (id) => { picked = id; $('line-remove').disabled = !id; });
  $('line-remove').onclick = async () => {
    if (!picked) return toast('เลือกแถวก่อน', 'error');
    await api(`/api/requisitions/${cart.id}/lines/${picked}`, { method: 'DELETE' });
    openView('requisition');
  };
  $('submit-cart').onclick = () => changeStatus(cart.id, 'submitted');
}

async function searchItems(cartId) {
  const term = $('item-q').value.trim();
  const data = await api(`/api/materials?q=${encodeURIComponent(term)}`);
  let picked = '';
  $('item-results').innerHTML = data.materials.length ? `
    <div class="action-bar"><button class="btn btn-primary" type="button" id="item-add" disabled>ใส่ตะกร้า</button></div>
    <div class="table-wrap"><table class="mo-data-table"><thead><tr><th>รหัส</th><th>รายการ</th><th>หน่วย</th></tr></thead><tbody>
    ${data.materials.map((row) => `<tr data-pick="${esc(row.material)}"><td>${esc(row.material)}</td><td>${esc(row.material_description)}</td><td>${esc(row.bun)}</td></tr>`).join('')}
  </tbody></table></div>` : '<p class="empty">ไม่พบรายการ</p>';
  if (!data.materials.length) return;
  bindRowSelect($('item-results'), (id) => { picked = id; $('item-add').disabled = !id; });
  $('item-add').onclick = async () => {
    if (!picked) return toast('เลือกแถวก่อน', 'error');
    try {
      await api(`/api/requisitions/${cartId}/lines`, { method: 'POST', body: { material: picked, qty: Number($('item-qty').value) } });
      const detail = await api(`/api/requisitions/${cartId}`);
      drawLines(detail.requisition);
      toast('ใส่ตะกร้าแล้ว');
    } catch (err) { toast(err.message, 'error'); }
  };
}

function orderTable(rows, mine) {
  if (!rows.length) return '<p class="empty">ไม่มีใบเบิก</p>';
  return `<table class="mo-data-table"><thead><tr><th>เลขที่</th><th>ศูนย์ต้นทุน</th><th>สถานะ</th><th>ช่วงจัดเตรียม</th></tr></thead><tbody>
    ${rows.map((row) => `<tr data-pick="${esc(row.id)}" data-status="${esc(row.status)}" data-mine="${mine ? '1' : '0'}">
      <td>#${row.id}</td>
      <td>${esc(row.costcenter)} · ${esc(row.costcenterName)}</td>
      <td>${badge(row.status)}</td>
      <td>${esc(lead(row.prepare_lead))}</td>
    </tr>`).join('')}
  </tbody></table>`;
}

function mountOrderBar(tableHost, bar) {
  if (!tableHost || !bar) return;
  bar.innerHTML = '<button class="btn btn-secondary" type="button" disabled>ดูรายการ</button>';
  bindRowSelect(tableHost, (_id, row) => {
    bar.innerHTML = actionsFor({ id: row.dataset.pick, status: row.dataset.status }, row.dataset.mine === '1');
    bindOrderActions(bar);
  });
}

function lead(value) {
  if (!value) return '-';
  return String(value).replace(/^(\d+):(\d+).*/, (_, h, m) => `${h} ชม. ${m} นาที`);
}

function actionsFor(row, mine) {
  const buttons = [`<button class="btn btn-secondary" data-open="${row.id}">ดูรายการ</button>`];
  if (mine && row.status === 'ready') buttons.push(`<button class="btn btn-primary" data-status="${row.id}" data-next="received">ยืนยันรับของ</button>`);
  if (!mine && row.status === 'submitted') buttons.push(`<button class="btn btn-primary" data-status="${row.id}" data-next="accepted">รับออร์เดอร์</button>`);
  if (!mine && row.status === 'accepted') buttons.push(`<button class="btn btn-primary" data-status="${row.id}" data-next="preparing">เริ่มจัด</button>`);
  if (!mine && row.status === 'preparing') buttons.push(`<button class="btn btn-primary" data-status="${row.id}" data-next="ready">พร้อมรับ</button>`);
  if (['cart', 'submitted', 'accepted', 'preparing', 'ready'].includes(row.status)) buttons.push(`<button class="btn btn-danger" data-status="${row.id}" data-next="cancelled">ยกเลิก</button>`);
  return buttons.join('');
}

function bindOrderActions(target) {
  target.querySelectorAll('[data-open]').forEach((node) => { node.onclick = () => showDetail(node.dataset.open); });
  target.querySelectorAll('[data-status]').forEach((node) => { node.onclick = () => changeStatus(node.dataset.status, node.dataset.next); });
}

async function showDetail(id) {
  const { requisition } = await api(`/api/requisitions/${id}`);
  const lines = requisition.lines.map((line) => `<tr><td>${esc(line.material)}</td><td>${esc(line.materialDescription)}</td><td>${Number(line.qty)} ${esc(line.bun)}</td></tr>`).join('');
  $('app-view').insertAdjacentHTML('afterbegin', `<section class="card" id="detail">
    <div class="card-title-row"><div class="card-title">ใบเบิก #${requisition.id}</div><button class="btn btn-secondary" type="button" id="close-detail">ปิด</button></div>
    <p class="sum-meta">${badge(requisition.status)} ${esc(requisition.costcenter)} · ${esc(requisition.costcenterName)}</p>
    <p class="sum-meta">จัดเตรียม ${esc(lead(requisition.prepare_lead))} · จนรับของ ${esc(lead(requisition.receive_lead))}</p>
    <div class="table-wrap"><table class="mo-data-table"><thead><tr><th>รหัส</th><th>รายการ</th><th>จำนวน</th></tr></thead><tbody>${lines || ''}</tbody></table></div>
  </section>`);
  $('close-detail').onclick = () => $('detail').remove();
}

async function changeStatus(id, status) {
  try {
    await api(`/api/requisitions/${id}/status`, { method: 'POST', body: { status } });
    toast(status === 'received' ? 'ยืนยันแล้ว และตัดยอด Current' : 'อัปเดตสถานะแล้ว');
    openView(view);
  } catch (err) { toast(err.message, 'error'); }
}

async function renderQueue(target) {
  const data = await api('/api/requisitions?scope=queue');
  target.innerHTML = `<div class="view-body"><section class="card fill-card"><div class="card-title-row"><div class="card-title">ออร์เดอร์ที่ต้องจัด</div><div class="action-bar" id="queue-bar"></div></div><div class="table-wrap" id="queue-table">${orderTable(data.requisitions, false)}</div></section></div>`;
  mountOrderBar($('queue-table'), $('queue-bar'));
}

async function renderStock(target) {
  const [buyers, pay] = await Promise.all([api('/api/buyers'), api('/api/pay-centers')]);
  target.innerHTML = `
    <div class="view-body">
    <section class="card">
      <div class="card-title-row"><div class="card-title">ศูนย์ต้นทุนที่สั่งซื้อ</div><div class="action-bar"><button class="btn btn-secondary" type="button" id="buyer-toggle" disabled>เปิด/ปิด</button></div></div>
      <div class="toolbar">
        <label class="field">ค้นศูนย์ต้นทุน<input id="cc-q" placeholder="รหัสหรือชื่อ"></label>
        <button class="btn btn-secondary" type="button" id="cc-search">ค้นหา</button>
      </div>
      <div id="cc-results"></div>
      <div class="table-wrap" id="buyer-table"><table class="mo-data-table"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>สถานะ</th></tr></thead><tbody>
        ${buyers.buyers.map((row) => `<tr data-pick="${esc(row.costcenter)}" data-next="${row.status === 'Active' ? 'Inactive' : 'Active'}"><td>${esc(row.costcenter)}</td><td>${esc(row.objectName)}</td><td>${esc(row.status)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">ยังไม่มีศูนย์ต้นทุนที่สั่งซื้อ</td></tr>'}
      </tbody></table></div>
    </section>
    <section class="card">
      <div class="card-title">ยอดรายการ</div>
      <div class="toolbar">
        <label class="field">ศูนย์ต้นทุน<select id="stock-cc">${pay.costcenters.map((row) => `<option value="${esc(row.costcenter)}">${esc(row.costcenter)} · ${esc(row.objectName)}</option>`).join('')}</select></label>
        <label class="field">ค้นหารายการ<input id="stock-q"></label>
        <button class="btn btn-secondary" type="button" id="stock-load">แสดง</button>
      </div>
      <div class="toolbar">
        <label class="field">รหัสวัสดุ<input id="stock-material"></label>
        <label class="field">Min<input id="stock-min" type="number" min="0" step="0.001" value="0"></label>
        <label class="field">Current<input id="stock-current" type="number" min="0" step="0.001" value="0"></label>
        <label class="field">Max<input id="stock-max" type="number" min="0" step="0.001" value="0"></label>
        <div class="action-bar">
          <button class="btn btn-secondary" type="button" id="stock-edit" disabled>แก้ไข</button>
          <button class="btn btn-primary" type="button" id="stock-save">บันทึกยอด</button>
        </div>
      </div>
      <div class="table-wrap" id="stock-table"></div>
    </section>
    </div>`;
  $('cc-search').onclick = searchCenters;
  $('stock-load').onclick = loadStock;
  $('stock-save').onclick = saveStock;
  let buyer = null;
  bindRowSelect($('buyer-table'), (id, row) => {
    buyer = { costcenter: id, next: row.dataset.next };
    $('buyer-toggle').disabled = false;
    $('buyer-toggle').textContent = row.dataset.next === 'Inactive' ? 'ปิด' : 'เปิด';
  });
  $('buyer-toggle').onclick = async () => {
    if (!buyer) return toast('เลือกแถวก่อน', 'error');
    await api(`/api/buyers/${encodeURIComponent(buyer.costcenter)}`, { method: 'PATCH', body: { status: buyer.next } });
    openView('stock');
  };
  if ($('stock-cc').value) loadStock();
}

async function searchCenters() {
  const data = await api(`/api/costcenters?q=${encodeURIComponent($('cc-q').value.trim())}`);
  let picked = '';
  $('cc-results').innerHTML = data.costcenters.length ? `
    <div class="action-bar"><button class="btn btn-primary" type="button" id="cc-add" disabled>ตั้งเป็นผู้สั่งซื้อ</button></div>
    <div class="table-wrap"><table class="mo-data-table"><tbody>
    ${data.costcenters.map((row) => `<tr data-pick="${esc(row.costcenter)}"><td>${esc(row.costcenter)}</td><td>${esc(row.object_name)}</td></tr>`).join('')}
  </tbody></table></div>` : '<p class="empty">ไม่พบศูนย์ต้นทุน</p>';
  if (!data.costcenters.length) return;
  bindRowSelect($('cc-results'), (id) => { picked = id; $('cc-add').disabled = !id; });
  $('cc-add').onclick = async () => {
    if (!picked) return toast('เลือกแถวก่อน', 'error');
    try {
      await api('/api/buyers', { method: 'POST', body: { costcenter: picked } });
      openView('stock');
    } catch (err) { toast(err.message, 'error'); }
  };
}

async function loadStock() {
  const cc = $('stock-cc').value;
  if (!cc) return;
  const data = await api(`/api/stock?costcenter=${encodeURIComponent(cc)}&q=${encodeURIComponent($('stock-q').value.trim())}`);
  let picked = null;
  $('stock-edit').disabled = true;
  $('stock-table').innerHTML = `<table class="mo-data-table"><thead><tr><th>รหัส</th><th>รายการ</th><th>Min</th><th>Current</th><th>Max</th></tr></thead><tbody>
    ${data.stock.map((row) => `<tr data-pick="${esc(row.material)}" data-min="${row.minQty}" data-current="${row.currentQty}" data-max="${row.maxQty}"><td>${esc(row.material)}</td><td>${esc(row.materialDescription)}</td><td>${row.minQty}</td><td>${row.low ? `<span class="badge badge-warning">${row.currentQty}</span>` : row.currentQty}</td><td>${row.maxQty}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">ยังไม่มียอด</td></tr>'}
  </tbody></table>`;
  bindRowSelect($('stock-table'), (_id, row) => {
    picked = row;
    $('stock-edit').disabled = false;
  });
  $('stock-edit').onclick = () => {
    if (!picked) return toast('เลือกแถวก่อน', 'error');
    $('stock-material').value = picked.dataset.pick;
    $('stock-min').value = picked.dataset.min;
    $('stock-current').value = picked.dataset.current;
    $('stock-max').value = picked.dataset.max;
  };
}

async function saveStock() {
  try {
    await api('/api/stock', {
      method: 'PUT',
      body: {
        costcenter: $('stock-cc').value,
        material: $('stock-material').value.trim(),
        minQty: Number($('stock-min').value),
        currentQty: Number($('stock-current').value),
        maxQty: Number($('stock-max').value)
      }
    });
    toast('บันทึกยอดแล้ว');
    loadStock();
  } catch (err) { toast(err.message, 'error'); }
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
      <label class="field grow">ค้นหา<input id="usage-q"></label>
      <button class="btn btn-secondary" type="button" id="usage-search">ค้นหา</button>
      <div class="action-bar">
        <button class="btn btn-primary" type="button" id="usage-add">เพิ่ม</button>
        <button class="btn btn-secondary" type="button" id="usage-edit" disabled>แก้ไข</button>
        <button class="btn btn-danger" type="button" id="usage-del" disabled>ลบ</button>
      </div>
    </div>
    <div id="usage-form"></div>
    <div class="table-wrap" id="usage-rows"></div>
    <div class="table-foot">
      <div class="sum-meta" id="usage-count"></div>
      <div class="action-bar">
        <button class="btn btn-secondary" type="button" id="usage-prev">ก่อนหน้า</button>
        <button class="btn btn-secondary" type="button" id="usage-next">ถัดไป</button>
      </div>
    </div>`;
  const kind = () => $('usage-table').value;
  const closeForm = () => { delete $('usage-form').dataset.open; drawForm(); };
  const drawForm = () => {
    const box = $('usage-form');
    if (!box.dataset.open) { box.innerHTML = ''; return; }
    if (kind() === 'materials') {
      const row = box.dataset.mode === 'edit' && selected ? selected : {};
      box.innerHTML = `<section class="card"><div class="card-title">${row.material ? 'แก้ไขแถว' : 'เพิ่มแถว'} mt_sto_usage</div><div class="toolbar">
        <label class="field">รหัส<input id="mat-code" value="${esc(row.material || '')}" ${row.material ? 'readonly' : ''}></label>
        <label class="field grow">ชื่อรายการ<input id="mat-name" value="${esc(row.material_description || '')}"></label>
        <label class="field">หน่วย<input id="mat-bun" value="${esc(row.bun || '')}"></label>
        <label class="field">ราคา<input id="mat-price" type="number" min="0" step="0.01" value="${row.price ?? ''}"></label>
        <label class="field">สกุลเงิน<input id="mat-crcy" value="${esc(row.crcy || 'THB')}"></label>
        <label class="field">สถานะ<select id="mat-status"><option ${row.status === 'Inactive' ? '' : 'selected'}>Active</option><option ${row.status === 'Inactive' ? 'selected' : ''}>Inactive</option></select></label>
      </div><div class="form-actions"><button class="btn btn-primary" type="button" id="usage-save">บันทึก</button><button class="btn btn-secondary" type="button" id="usage-cancel">ยกเลิก</button></div></section>`;
    } else {
      const row = box.dataset.mode === 'edit' && selected ? selected : null;
      box.innerHTML = `<section class="card"><div class="card-title">${row ? 'แก้ไขแถว' : 'เพิ่มแถว'} mt_sto_user</div>
        ${row ? '' : `<div class="toolbar"><label class="field grow">ค้นพนักงาน<input id="emp-q" placeholder="รหัสหรือชื่อจาก mt_main_employee"></label><button class="btn btn-secondary" type="button" id="emp-search">ค้นหา</button></div><div id="emp-results"></div>`}
        <div class="toolbar">
          <label class="field">รหัสพนักงาน<input id="user-id" readonly value="${esc(row?.employeeId || '')}" placeholder="เลือกจากรายชื่อพนักงาน"></label>
          <label class="field">รหัสผ่าน<input id="user-password" type="password" minlength="8" autocomplete="new-password"></label>
          <label class="field">บทบาท<select id="user-role"><option value="viewer" ${row?.role === 'viewer' ? 'selected' : ''}>Viewer</option><option value="user" ${row?.role === 'user' ? 'selected' : ''}>User</option><option value="admin" ${row?.role === 'admin' ? 'selected' : ''}>Admin</option></select></label>
          <label class="field">สถานะ<select id="user-status"><option ${row?.status === 'Inactive' ? '' : 'selected'}>Active</option><option ${row?.status === 'Inactive' ? 'selected' : ''}>Inactive</option></select></label>
        </div>
        <p class="sum-meta" id="user-centers">${row ? esc(`${row.department || '-'}: ${centerText(row) || 'ไม่มีศูนย์ต้นทุน'}`) : ''}</p>
        <div class="form-actions"><button class="btn btn-primary" type="button" id="usage-save">บันทึก</button><button class="btn btn-secondary" type="button" id="usage-cancel">ยกเลิก</button></div></section>`;
      if ($('emp-search')) $('emp-search').onclick = searchEmployees;
    }
    $('usage-cancel').onclick = closeForm;
    $('usage-save').onclick = saveRow;
  };
  const searchEmployees = async () => {
    const data = await api(`/api/employees?q=${encodeURIComponent($('emp-q').value.trim())}`);
    $('emp-results').innerHTML = data.employees.length ? `<div class="table-wrap"><table class="mo-data-table"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>หน่วยงาน</th><th>ศูนย์ต้นทุน</th></tr></thead><tbody>
      ${data.employees.map((row, index) => `<tr data-pick="${index}"><td>${esc(row.employee_id)}</td><td>${esc(row.name)}</td><td>${esc(row.department || '')}</td><td>${esc(centerText(row))}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="empty">ไม่พบพนักงาน</p>';
    bindRowSelect($('emp-results'), (index) => {
      const person = data.employees[Number(index)];
      $('user-id').value = person.employee_id;
      $('user-centers').textContent = `${person.department || '-'}: ${centerText(person) || 'ไม่มีศูนย์ต้นทุน'}`;
    });
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
        if ($('usage-form').dataset.mode === 'edit' && selected) await api(`/api/usage-materials/${encodeURIComponent(selected.material)}`, { method: 'PATCH', body });
        else await api('/api/usage-materials', { method: 'POST', body });
      } else if ($('usage-form').dataset.mode === 'edit' && selected) {
        await api(`/api/users/${encodeURIComponent(selected.employeeId)}`, { method: 'PATCH', body: { role: $('user-role').value, status: $('user-status').value, password: $('user-password').value } });
      } else {
        if (!$('user-id').value.trim()) return toast('เลือกพนักงานจากรายชื่อก่อน', 'error');
        await api('/api/users', { method: 'POST', body: { employeeId: $('user-id').value.trim(), password: $('user-password').value, role: $('user-role').value, status: $('user-status').value } });
      }
      toast('บันทึกแล้ว');
      closeForm();
      await loadRows();
    } catch (err) { toast(err.message, 'error'); }
  };
  const removeRow = async () => {
    if (!selected) return toast('เลือกแถวก่อน', 'error');
    if (kind() === 'materials') {
      if (!confirm(`ลบรายการ ${selected.material}?`)) return;
      await api(`/api/usage-materials/${encodeURIComponent(selected.material)}`, { method: 'DELETE' });
      toast('ลบแล้ว');
    } else {
      if (!confirm(`นำ ${selected.employeeId} ออกจาก Usage?`)) return;
      const result = await api(`/api/users/${encodeURIComponent(selected.employeeId)}`, { method: 'DELETE' });
      toast(result.inactive ? 'มีประวัติแล้ว จึงปิดเป็น Inactive' : 'นำออกจาก Usage แล้ว');
    }
    await loadRows();
  };
  $('usage-table').onchange = () => { offset = 0; $('usage-q').value = ''; closeForm(); loadRows().catch((err) => toast(err.message, 'error')); };
  $('usage-search').onclick = () => { offset = 0; loadRows().catch((err) => toast(err.message, 'error')); };
  $('usage-add').onclick = () => { selected = null; $('usage-form').dataset.open = '1'; $('usage-form').dataset.mode = 'add'; drawForm(); };
  $('usage-edit').onclick = () => {
    if (!selected) return toast('เลือกแถวก่อน', 'error');
    $('usage-form').dataset.open = '1';
    $('usage-form').dataset.mode = 'edit';
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
