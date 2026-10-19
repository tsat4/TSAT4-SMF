const STATUS = {
  cart: 'ตะกร้า',
  submitted: 'ส่งแล้ว',
  accepted: 'รับออร์เดอร์',
  preparing: 'กำลังจัด',
  ready: 'พร้อมรับ',
  received: 'รับแล้ว',
  cancelled: 'ยกเลิก'
};
const ROLE = { employee: 'ผู้เบิก', supervisor: 'ผู้ดูแล', officer: 'เจ้าหน้าที่' };
const TITLES = {
  home: ['ภาพรวม', 'ระบบเบิก Usage'],
  requisition: ['เบิก', 'เลือกรายการ ใส่ตะกร้า แล้วเลือกศูนย์ต้นทุนที่จ่าย'],
  queue: ['คิวจัดของ', 'รับออร์เดอร์ จัดเตรียม และบอกเวลาที่พร้อมรับ'],
  stock: ['Min / Current / Max', 'ยอดของศูนย์ต้นทุนที่มีการสั่งซื้อ'],
  users: ['ผู้ใช้', 'เพิ่ม แก้ไข และลบบัญชีจากรายชื่อพนักงาน']
};

let me = null;
let view = 'home';

const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function toast(message) {
  const node = document.createElement('div');
  node.className = 'toast';
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

function badge(status) {
  const kind = status === 'ready' || status === 'received' ? 'ready' : status === 'cancelled' ? 'danger' : status === 'cart' ? 'warn' : '';
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

function showShell() {
  $('login').classList.add('d-none');
  $('password-gate').classList.add('d-none');
  $('shell').classList.remove('d-none');
  $('header-user').textContent = me.name || me.employeeId;
  $('header-role').textContent = `${ROLE[me.role] || me.role} · ${me.employeeId}`;
  document.querySelectorAll('[data-staff]').forEach((node) => node.classList.toggle('d-none', me.role === 'employee'));
  document.querySelectorAll('[data-supervisor]').forEach((node) => node.classList.toggle('d-none', me.role !== 'supervisor'));
  openView(view);
}

function openView(name) {
  if (name === 'queue' && me.role === 'employee') name = 'home';
  if ((name === 'stock' && me.role === 'employee') || (name === 'users' && me.role !== 'supervisor')) name = 'home';
  view = name;
  const [title, subtitle] = TITLES[name];
  $('header-page-title').textContent = title;
  $('header-page-subtitle').textContent = subtitle;
  document.querySelectorAll('.nav-btn').forEach((node) => node.classList.toggle('active', node.dataset.view === name));
  $('shell').classList.remove('nav-open');
  const target = $('app-view');
  target.innerHTML = '<p class="muted">กำลังโหลด...</p>';
  const render = { home: renderHome, requisition: renderRequisition, queue: renderQueue, stock: renderStock, users: renderUsers }[name];
  render(target).catch((err) => { target.innerHTML = `<p class="form-error">${esc(err.message)}</p>`; });
}

async function renderHome(target) {
  const summary = await api('/api/summary');
  target.innerHTML = `
    <div class="kpi-grid">
      <article class="card"><div class="kpi-label">ใบเบิกที่ยังไม่จบ</div><div class="kpi-value">${summary.open}</div></article>
      <article class="card"><div class="kpi-label">พร้อมให้รับของ</div><div class="kpi-value">${summary.ready}</div></article>
      <article class="card"><div class="kpi-label">คิวที่ต้องจัด</div><div class="kpi-value">${summary.queue}</div></article>
    </div>
    <section class="card">
      <h2>เริ่มเบิก</h2>
      <p class="muted">เลือกศูนย์ต้นทุนที่จ่าย เลือกรายการ ระบุจำนวน แล้วใส่ตะกร้าได้หลายรายการ เมื่อรับของและกดยืนยัน ระบบจะตัดยอด Current</p>
      <button class="btn btn-primary" type="button" data-go="requisition">ไปที่ใบเบิก</button>
    </section>`;
  target.querySelector('[data-go]').onclick = () => openView('requisition');
}

async function renderRequisition(target) {
  const [buyers, mine] = await Promise.all([
    api('/api/buyers'),
    api('/api/requisitions?scope=mine')
  ]);
  const cartHeader = mine.requisitions.find((row) => row.status === 'cart');
  const cart = cartHeader ? (await api(`/api/requisitions/${cartHeader.id}`)).requisition : null;
  target.innerHTML = `
    <section class="card">
      <div class="page-head"><h2>${cart ? `ตะกร้า #${cart.id}` : 'เปิดตะกร้า'}</h2></div>
      <div class="toolbar">
        <label class="field">ศูนย์ต้นทุนที่จ่าย
          <select id="buyer">${buyers.buyers.map((row) => `<option value="${esc(row.costcenter)}" ${cart && cart.costcenter === row.costcenter ? 'selected' : ''}>${esc(row.costcenter)} · ${esc(row.objectName)}</option>`).join('')}</select>
        </label>
        ${cart ? '' : '<button class="btn btn-primary" type="button" id="new-cart">เปิดตะกร้า</button>'}
      </div>
      ${cart ? `
        <div class="toolbar">
          <label class="field">ค้นหารายการ<input id="item-q" placeholder="รหัสหรือชื่อรายการ"></label>
          <label class="field">จำนวน<input id="item-qty" type="number" min="0.001" step="0.001" value="1"></label>
          <button class="btn btn-primary" type="button" id="search-item">ค้นหา</button>
        </div>
        <div id="item-results"></div>
        <div class="table-wrap mo-data-table" id="cart-lines"></div>
        <div class="actions"><button class="btn btn-primary" type="button" id="submit-cart">ส่งออร์เดอร์</button></div>` : '<p class="empty">ยังไม่มีตะกร้า</p>'}
    </section>
    <section class="card"><h2>ใบเบิกของฉัน</h2><div class="table-wrap mo-data-table">${orderTable(mine.requisitions.filter((row) => row.status !== 'cart'), true)}</div></section>`;
  if (!cart) {
    $('new-cart').onclick = async () => {
      try {
        await api('/api/requisitions', { method: 'POST', body: { costcenter: $('buyer').value } });
        openView('requisition');
      } catch (err) { toast(err.message); }
    };
    return;
  }
  drawLines(cart);
  $('search-item').onclick = () => searchItems(cart.id);
  $('item-q').addEventListener('keydown', (event) => { if (event.key === 'Enter') searchItems(cart.id); });
  $('submit-cart').onclick = () => changeStatus(cart.id, 'submitted');
  bindOrderActions(target);
}

function drawLines(cart) {
  const box = $('cart-lines');
  if (!cart.lines?.length) {
    box.innerHTML = '<p class="empty">ตะกร้าว่าง</p>';
    return;
  }
  box.innerHTML = `<table><thead><tr><th>รหัส</th><th>รายการ</th><th>จำนวน</th><th></th></tr></thead><tbody>
    ${cart.lines.map((line) => `<tr><td>${esc(line.material)}</td><td>${esc(line.materialDescription)}</td><td>${Number(line.qty)} ${esc(line.bun)}</td><td class="actions"><button class="btn btn-danger" data-remove="${line.id}">เอาออก</button></td></tr>`).join('')}
  </tbody></table>`;
  box.querySelectorAll('[data-remove]').forEach((node) => {
    node.onclick = async () => {
      await api(`/api/requisitions/${cart.id}/lines/${node.dataset.remove}`, { method: 'DELETE' });
      openView('requisition');
    };
  });
}

async function searchItems(cartId) {
  const term = $('item-q').value.trim();
  const data = await api(`/api/materials?q=${encodeURIComponent(term)}`);
  $('item-results').innerHTML = data.materials.length ? `<div class="table-wrap mo-data-table"><table><thead><tr><th>รหัส</th><th>รายการ</th><th>หน่วย</th><th></th></tr></thead><tbody>
    ${data.materials.map((row) => `<tr><td>${esc(row.material)}</td><td>${esc(row.material_description)}</td><td>${esc(row.bun)}</td><td><button class="btn btn-secondary" data-add="${esc(row.material)}">ใส่ตะกร้า</button></td></tr>`).join('')}
  </tbody></table></div>` : '<p class="empty">ไม่พบรายการ</p>';
  $('item-results').querySelectorAll('[data-add]').forEach((node) => {
    node.onclick = async () => {
      try {
        await api(`/api/requisitions/${cartId}/lines`, { method: 'POST', body: { material: node.dataset.add, qty: Number($('item-qty').value) } });
        const detail = await api(`/api/requisitions/${cartId}`);
        drawLines(detail.requisition);
        toast('ใส่ตะกร้าแล้ว');
      } catch (err) { toast(err.message); }
    };
  });
}

function orderTable(rows, mine) {
  if (!rows.length) return '<p class="empty">ไม่มีใบเบิก</p>';
  return `<table><thead><tr><th>เลขที่</th><th>ศูนย์ต้นทุน</th><th>สถานะ</th><th>ช่วงจัดเตรียม</th><th></th></tr></thead><tbody>
    ${rows.map((row) => `<tr>
      <td>#${row.id}</td>
      <td>${esc(row.costcenter)} · ${esc(row.costcenterName)}</td>
      <td>${badge(row.status)}</td>
      <td>${esc(lead(row.prepare_lead))}</td>
      <td class="actions">${actionsFor(row, mine)}</td>
    </tr>`).join('')}
  </tbody></table>`;
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
    <div class="page-head"><h2>ใบเบิก #${requisition.id}</h2><button class="btn btn-secondary" type="button" id="close-detail">ปิด</button></div>
    <p>${badge(requisition.status)} ${esc(requisition.costcenter)} · ${esc(requisition.costcenterName)}</p>
    <p class="muted">จัดเตรียม ${esc(lead(requisition.prepare_lead))} · จนรับของ ${esc(lead(requisition.receive_lead))}</p>
    <div class="table-wrap mo-data-table"><table><thead><tr><th>รหัส</th><th>รายการ</th><th>จำนวน</th></tr></thead><tbody>${lines || ''}</tbody></table></div>
  </section>`);
  $('close-detail').onclick = () => $('detail').remove();
}

async function changeStatus(id, status) {
  try {
    await api(`/api/requisitions/${id}/status`, { method: 'POST', body: { status } });
    toast(status === 'received' ? 'ยืนยันแล้ว และตัดยอด Current' : 'อัปเดตสถานะแล้ว');
    openView(view);
  } catch (err) { toast(err.message); }
}

async function renderQueue(target) {
  const data = await api('/api/requisitions?scope=queue');
  target.innerHTML = `<section class="card"><h2>ออร์เดอร์ที่ต้องจัด</h2><div class="table-wrap mo-data-table">${orderTable(data.requisitions, false)}</div></section>`;
  bindOrderActions(target);
}

async function renderStock(target) {
  const buyers = await api('/api/buyers');
  target.innerHTML = `
    <section class="card">
      <h2>ศูนย์ต้นทุนที่สั่งซื้อ</h2>
      <div class="toolbar">
        <label class="field">ค้นศูนย์ต้นทุน<input id="cc-q" placeholder="รหัสหรือชื่อ"></label>
        <button class="btn btn-secondary" type="button" id="cc-search">ค้นหา</button>
      </div>
      <div id="cc-results"></div>
      <div class="table-wrap mo-data-table"><table><thead><tr><th>รหัส</th><th>ชื่อ</th><th>สถานะ</th><th></th></tr></thead><tbody>
        ${buyers.buyers.map((row) => `<tr><td>${esc(row.costcenter)}</td><td>${esc(row.objectName)}</td><td>${esc(row.status)}</td><td><button class="btn btn-secondary" data-buyer="${esc(row.costcenter)}" data-next="${row.status === 'Active' ? 'Inactive' : 'Active'}">${row.status === 'Active' ? 'ปิด' : 'เปิด'}</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">ยังไม่มีศูนย์ต้นทุนที่สั่งซื้อ</td></tr>'}
      </tbody></table></div>
    </section>
    <section class="card">
      <h2>ยอดรายการ</h2>
      <div class="toolbar">
        <label class="field">ศูนย์ต้นทุน<select id="stock-cc">${buyers.buyers.filter((row) => row.status === 'Active').map((row) => `<option value="${esc(row.costcenter)}">${esc(row.costcenter)} · ${esc(row.objectName)}</option>`).join('')}</select></label>
        <label class="field">ค้นหารายการ<input id="stock-q"></label>
        <button class="btn btn-secondary" type="button" id="stock-load">แสดง</button>
      </div>
      <div class="toolbar">
        <label class="field">รหัสวัสดุ<input id="stock-material"></label>
        <label class="field">Min<input id="stock-min" type="number" min="0" step="0.001" value="0"></label>
        <label class="field">Current<input id="stock-current" type="number" min="0" step="0.001" value="0"></label>
        <label class="field">Max<input id="stock-max" type="number" min="0" step="0.001" value="0"></label>
        <button class="btn btn-primary" type="button" id="stock-save">บันทึกยอด</button>
      </div>
      <div class="table-wrap mo-data-table" id="stock-table"></div>
    </section>`;
  $('cc-search').onclick = searchCenters;
  $('stock-load').onclick = loadStock;
  $('stock-save').onclick = saveStock;
  target.querySelectorAll('[data-buyer]').forEach((node) => {
    node.onclick = async () => {
      await api(`/api/buyers/${encodeURIComponent(node.dataset.buyer)}`, { method: 'PATCH', body: { status: node.dataset.next } });
      openView('stock');
    };
  });
  if ($('stock-cc').value) loadStock();
}

async function searchCenters() {
  const data = await api(`/api/costcenters?q=${encodeURIComponent($('cc-q').value.trim())}`);
  $('cc-results').innerHTML = data.costcenters.length ? `<div class="table-wrap mo-data-table"><table><tbody>
    ${data.costcenters.map((row) => `<tr><td>${esc(row.costcenter)}</td><td>${esc(row.object_name)}</td><td><button class="btn btn-secondary" data-add-cc="${esc(row.costcenter)}">ตั้งเป็นผู้สั่งซื้อ</button></td></tr>`).join('')}
  </tbody></table></div>` : '<p class="empty">ไม่พบศูนย์ต้นทุน</p>';
  $('cc-results').querySelectorAll('[data-add-cc]').forEach((node) => {
    node.onclick = async () => {
      try {
        await api('/api/buyers', { method: 'POST', body: { costcenter: node.dataset.addCc } });
        openView('stock');
      } catch (err) { toast(err.message); }
    };
  });
}

async function loadStock() {
  const cc = $('stock-cc').value;
  if (!cc) return;
  const data = await api(`/api/stock?costcenter=${encodeURIComponent(cc)}&q=${encodeURIComponent($('stock-q').value.trim())}`);
  $('stock-table').innerHTML = `<table><thead><tr><th>รหัส</th><th>รายการ</th><th>Min</th><th>Current</th><th>Max</th><th></th></tr></thead><tbody>
    ${data.stock.map((row) => `<tr><td>${esc(row.material)}</td><td>${esc(row.materialDescription)}</td><td>${row.minQty}</td><td>${row.low ? `<span class="badge warn">${row.currentQty}</span>` : row.currentQty}</td><td>${row.maxQty}</td><td><button class="btn btn-secondary" data-fill="${esc(row.material)}" data-min="${row.minQty}" data-current="${row.currentQty}" data-max="${row.maxQty}">แก้</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">ยังไม่มียอด</td></tr>'}
  </tbody></table>`;
  $('stock-table').querySelectorAll('[data-fill]').forEach((node) => {
    node.onclick = () => {
      $('stock-material').value = node.dataset.fill;
      $('stock-min').value = node.dataset.min;
      $('stock-current').value = node.dataset.current;
      $('stock-max').value = node.dataset.max;
    };
  });
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
  } catch (err) { toast(err.message); }
}

async function renderUsers(target) {
  const data = await api('/api/users');
  target.innerHTML = `
    <section class="card">
      <h2>เพิ่มผู้ใช้</h2>
      <div class="toolbar">
        <label class="field">ค้นพนักงาน<input id="emp-q" placeholder="รหัสหรือชื่อ"></label>
        <button class="btn btn-secondary" type="button" id="emp-search">ค้นหา</button>
      </div>
      <div id="emp-results"></div>
      <div class="toolbar">
        <label class="field">รหัสพนักงาน<input id="user-id" required></label>
        <label class="field">รหัสผ่าน<input id="user-password" type="password" minlength="8"></label>
        <label class="field">บทบาท<select id="user-role"><option value="employee">ผู้เบิก</option><option value="officer">เจ้าหน้าที่</option><option value="supervisor">ผู้ดูแล</option></select></label>
        <button class="btn btn-primary" type="button" id="user-save">เพิ่ม</button>
      </div>
    </section>
    <section class="card"><div class="table-wrap mo-data-table"><table><thead><tr><th>รหัส</th><th>ชื่อ</th><th>บทบาท</th><th>สถานะ</th><th>หมดอายุรหัส</th><th></th></tr></thead><tbody>
      ${data.users.map((row) => `<tr>
        <td>${esc(row.employeeId)}</td><td>${esc(row.name)}</td><td>${esc(ROLE[row.role] || row.role)}</td><td>${esc(row.status)}</td>
        <td>${row.passwordExpired ? '<span class="badge danger">ครบ 90 วัน</span>' : esc(new Date(row.passwordExpiresAt).toLocaleDateString('th-TH'))}</td>
        <td class="actions">
          <button class="btn btn-secondary" data-edit="${esc(row.employeeId)}" data-role="${esc(row.role)}" data-user-status="${esc(row.status)}">แก้ไข</button>
          <button class="btn btn-danger" data-delete="${esc(row.employeeId)}">ลบ</button>
        </td></tr>`).join('')}
    </tbody></table></div></section>`;
  $('emp-search').onclick = searchEmployees;
  $('user-save').onclick = createUser;
  target.querySelectorAll('[data-edit]').forEach((node) => { node.onclick = () => editUser(node.dataset.edit, node.dataset.role, node.dataset.userStatus); });
  target.querySelectorAll('[data-delete]').forEach((node) => { node.onclick = () => deleteUser(node.dataset.delete); });
}

async function searchEmployees() {
  const data = await api(`/api/employees?q=${encodeURIComponent($('emp-q').value.trim())}`);
  $('emp-results').innerHTML = data.employees.length ? `<div class="table-wrap mo-data-table"><table><tbody>
    ${data.employees.map((row) => `<tr><td>${esc(row.employee_id)}</td><td>${esc(row.name)}</td><td>${esc(row.department || '')}</td><td><button class="btn btn-secondary" data-pick="${esc(row.employee_id)}">เลือก</button></td></tr>`).join('')}
  </tbody></table></div>` : '<p class="empty">ไม่พบพนักงาน</p>';
  $('emp-results').querySelectorAll('[data-pick]').forEach((node) => { node.onclick = () => { $('user-id').value = node.dataset.pick; }; });
}

async function createUser() {
  try {
    await api('/api/users', { method: 'POST', body: { employeeId: $('user-id').value.trim(), password: $('user-password').value, role: $('user-role').value } });
    toast('เพิ่มผู้ใช้แล้ว');
    openView('users');
  } catch (err) { toast(err.message); }
}

async function editUser(employeeId, role, status) {
  const nextRole = prompt('บทบาท employee, officer หรือ supervisor', role);
  if (!nextRole) return;
  const nextStatus = prompt('สถานะ Active หรือ Inactive', status);
  if (!nextStatus) return;
  const password = prompt('รหัสผ่านใหม่ เว้นว่างถ้าไม่เปลี่ยน', '') || '';
  try {
    await api(`/api/users/${encodeURIComponent(employeeId)}`, { method: 'PATCH', body: { role: nextRole, status: nextStatus, password } });
    openView('users');
  } catch (err) { toast(err.message); }
}

async function deleteUser(employeeId) {
  if (!confirm(`ลบหรือปิดบัญชี ${employeeId}?`)) return;
  try {
    const result = await api(`/api/users/${encodeURIComponent(employeeId)}`, { method: 'DELETE' });
    toast(result.inactive ? 'มีประวัติแล้ว จึงปิดเป็น Inactive' : 'ลบผู้ใช้แล้ว');
    openView('users');
  } catch (err) { toast(err.message); }
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
document.querySelectorAll('.nav-btn').forEach((node) => { node.onclick = () => openView(node.dataset.view); });
$('sidebar-toggle').onclick = () => $('shell').classList.toggle('nav-open');
$('sidebar-backdrop').onclick = () => $('shell').classList.remove('nav-open');

const savedTheme = localStorage.getItem('smf-theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
function paintTheme() {
  $('theme-icon').textContent = document.documentElement.dataset.theme === 'dark' ? 'dark_mode' : 'light_mode';
}
paintTheme();
$('theme-toggle').onclick = () => {
  const next = document.documentElement.dataset.theme === 'dark' ? '' : 'dark';
  if (next) document.documentElement.dataset.theme = next;
  else delete document.documentElement.dataset.theme;
  localStorage.setItem('smf-theme', next);
  paintTheme();
};

api('/api/me').then((data) => {
  me = data.user;
  if (me.passwordExpired) showPassword();
  else showShell();
}).catch(() => showLogin());
