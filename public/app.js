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
const USAGE = 'ระบบงาน > Store > Usage';
const TITLES = {
  main: ['TSAT4 SMF', 'หน้าหลัก'],
  work: ['ระบบงาน', 'Work System'],
  store: ['Store', 'ระบบงาน > Store'],
  activity: ['ระบบกิจกรรม', 'Activity'],
  home: ['ภาพรวม', USAGE],
  requisition: ['เบิก', USAGE],
  queue: ['คิวจัดของ', USAGE],
  stock: ['Min / Current / Max', USAGE],
  users: ['ผู้ใช้', USAGE]
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
    home: renderHome,
    requisition: renderRequisition,
    queue: renderQueue,
    stock: renderStock,
    users: renderUsers
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
          ${moduleCard('home', 'inventory_2', 'Usage', 'เบิกของ ยอด Min / Current / Max และผู้ใช้')}
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
  const [buyers, mine] = await Promise.all([
    api('/api/buyers'),
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
        <div class="table-wrap" id="cart-lines"></div>
        <div class="actions"><button class="btn btn-primary" type="button" id="submit-cart">ส่งออร์เดอร์</button></div>` : '<p class="empty">ยังไม่มีตะกร้า</p>'}
    </section>
    <section class="card"><div class="card-title">ใบเบิกของฉัน</div><div class="table-wrap">${orderTable(mine.requisitions.filter((row) => row.status !== 'cart'), true)}</div></section>
    </div>`;
  if (!cart) {
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
  $('submit-cart').onclick = () => changeStatus(cart.id, 'submitted');
  bindOrderActions(target);
}

function drawLines(cart) {
  const box = $('cart-lines');
  if (!cart.lines?.length) {
    box.innerHTML = '<p class="empty">ตะกร้าว่าง</p>';
    return;
  }
  box.innerHTML = `<table class="mo-data-table"><thead><tr><th>รหัส</th><th>รายการ</th><th>จำนวน</th><th></th></tr></thead><tbody>
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
  $('item-results').innerHTML = data.materials.length ? `<div class="table-wrap"><table class="mo-data-table"><thead><tr><th>รหัส</th><th>รายการ</th><th>หน่วย</th><th></th></tr></thead><tbody>
    ${data.materials.map((row) => `<tr><td>${esc(row.material)}</td><td>${esc(row.material_description)}</td><td>${esc(row.bun)}</td><td><button class="btn btn-secondary" data-add="${esc(row.material)}">ใส่ตะกร้า</button></td></tr>`).join('')}
  </tbody></table></div>` : '<p class="empty">ไม่พบรายการ</p>';
  $('item-results').querySelectorAll('[data-add]').forEach((node) => {
    node.onclick = async () => {
      try {
        await api(`/api/requisitions/${cartId}/lines`, { method: 'POST', body: { material: node.dataset.add, qty: Number($('item-qty').value) } });
        const detail = await api(`/api/requisitions/${cartId}`);
        drawLines(detail.requisition);
        toast('ใส่ตะกร้าแล้ว');
      } catch (err) { toast(err.message, 'error'); }
    };
  });
}

function orderTable(rows, mine) {
  if (!rows.length) return '<p class="empty">ไม่มีใบเบิก</p>';
  return `<table class="mo-data-table"><thead><tr><th>เลขที่</th><th>ศูนย์ต้นทุน</th><th>สถานะ</th><th>ช่วงจัดเตรียม</th><th></th></tr></thead><tbody>
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
  target.innerHTML = `<div class="view-body"><section class="card fill-card"><div class="card-title">ออร์เดอร์ที่ต้องจัด</div><div class="table-wrap">${orderTable(data.requisitions, false)}</div></section></div>`;
  bindOrderActions(target);
}

async function renderStock(target) {
  const buyers = await api('/api/buyers');
  target.innerHTML = `
    <div class="view-body">
    <section class="card">
      <div class="card-title">ศูนย์ต้นทุนที่สั่งซื้อ</div>
      <div class="toolbar">
        <label class="field">ค้นศูนย์ต้นทุน<input id="cc-q" placeholder="รหัสหรือชื่อ"></label>
        <button class="btn btn-secondary" type="button" id="cc-search">ค้นหา</button>
      </div>
      <div id="cc-results"></div>
      <div class="table-wrap"><table class="mo-data-table"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>สถานะ</th><th></th></tr></thead><tbody>
        ${buyers.buyers.map((row) => `<tr><td>${esc(row.costcenter)}</td><td>${esc(row.objectName)}</td><td>${esc(row.status)}</td><td><button class="btn btn-secondary" data-buyer="${esc(row.costcenter)}" data-next="${row.status === 'Active' ? 'Inactive' : 'Active'}">${row.status === 'Active' ? 'ปิด' : 'เปิด'}</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">ยังไม่มีศูนย์ต้นทุนที่สั่งซื้อ</td></tr>'}
      </tbody></table></div>
    </section>
    <section class="card">
      <div class="card-title">ยอดรายการ</div>
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
      <div class="table-wrap" id="stock-table"></div>
    </section>
    </div>`;
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
  $('cc-results').innerHTML = data.costcenters.length ? `<div class="table-wrap"><table class="mo-data-table"><tbody>
    ${data.costcenters.map((row) => `<tr><td>${esc(row.costcenter)}</td><td>${esc(row.object_name)}</td><td><button class="btn btn-secondary" data-add-cc="${esc(row.costcenter)}">ตั้งเป็นผู้สั่งซื้อ</button></td></tr>`).join('')}
  </tbody></table></div>` : '<p class="empty">ไม่พบศูนย์ต้นทุน</p>';
  $('cc-results').querySelectorAll('[data-add-cc]').forEach((node) => {
    node.onclick = async () => {
      try {
        await api('/api/buyers', { method: 'POST', body: { costcenter: node.dataset.addCc } });
        openView('stock');
      } catch (err) { toast(err.message, 'error'); }
    };
  });
}

async function loadStock() {
  const cc = $('stock-cc').value;
  if (!cc) return;
  const data = await api(`/api/stock?costcenter=${encodeURIComponent(cc)}&q=${encodeURIComponent($('stock-q').value.trim())}`);
  $('stock-table').innerHTML = `<table class="mo-data-table"><thead><tr><th>รหัส</th><th>รายการ</th><th>Min</th><th>Current</th><th>Max</th><th></th></tr></thead><tbody>
    ${data.stock.map((row) => `<tr><td>${esc(row.material)}</td><td>${esc(row.materialDescription)}</td><td>${row.minQty}</td><td>${row.low ? `<span class="badge badge-warning">${row.currentQty}</span>` : row.currentQty}</td><td>${row.maxQty}</td><td><button class="btn btn-secondary" data-fill="${esc(row.material)}" data-min="${row.minQty}" data-current="${row.currentQty}" data-max="${row.maxQty}">แก้</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">ยังไม่มียอด</td></tr>'}
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
  } catch (err) { toast(err.message, 'error'); }
}

async function renderUsers(target) {
  const data = await api('/api/users');
  target.innerHTML = `
    <div class="view-body">
    <section class="card">
      <div class="card-title">เพิ่มผู้ใช้</div>
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
    <section class="card"><div class="card-title">บัญชีผู้ใช้</div><div class="table-wrap"><table class="mo-data-table"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>บทบาท</th><th>สถานะ</th><th>หมดอายุรหัส</th><th></th></tr></thead><tbody>
      ${data.users.map((row) => `<tr>
        <td>${esc(row.employeeId)}</td><td>${esc(row.name)}</td><td>${esc(ROLE[row.role] || row.role)}</td><td>${esc(row.status)}</td>
        <td>${row.passwordExpired ? '<span class="badge badge-danger">ครบ 90 วัน</span>' : esc(new Date(row.passwordExpiresAt).toLocaleDateString('th-TH'))}</td>
        <td class="actions">
          <button class="btn btn-secondary" data-edit="${esc(row.employeeId)}" data-role="${esc(row.role)}" data-user-status="${esc(row.status)}">แก้ไข</button>
          <button class="btn btn-danger" data-delete="${esc(row.employeeId)}">ลบ</button>
        </td></tr>`).join('')}
    </tbody></table></div></section>
    </div>`;
  $('emp-search').onclick = searchEmployees;
  $('user-save').onclick = createUser;
  target.querySelectorAll('[data-edit]').forEach((node) => { node.onclick = () => editUser(node.dataset.edit, node.dataset.role, node.dataset.userStatus); });
  target.querySelectorAll('[data-delete]').forEach((node) => { node.onclick = () => deleteUser(node.dataset.delete); });
}

async function searchEmployees() {
  const data = await api(`/api/employees?q=${encodeURIComponent($('emp-q').value.trim())}`);
  $('emp-results').innerHTML = data.employees.length ? `<div class="table-wrap"><table class="mo-data-table"><tbody>
    ${data.employees.map((row) => `<tr><td>${esc(row.employee_id)}</td><td>${esc(row.name)}</td><td>${esc(row.department || '')}</td><td><button class="btn btn-secondary" data-pick="${esc(row.employee_id)}">เลือก</button></td></tr>`).join('')}
  </tbody></table></div>` : '<p class="empty">ไม่พบพนักงาน</p>';
  $('emp-results').querySelectorAll('[data-pick]').forEach((node) => { node.onclick = () => { $('user-id').value = node.dataset.pick; }; });
}

async function createUser() {
  try {
    await api('/api/users', { method: 'POST', body: { employeeId: $('user-id').value.trim(), password: $('user-password').value, role: $('user-role').value } });
    toast('เพิ่มผู้ใช้แล้ว');
    openView('users');
  } catch (err) { toast(err.message, 'error'); }
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
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteUser(employeeId) {
  if (!confirm(`ลบหรือปิดบัญชี ${employeeId}?`)) return;
  try {
    const result = await api(`/api/users/${encodeURIComponent(employeeId)}`, { method: 'DELETE' });
    toast(result.inactive ? 'มีประวัติแล้ว จึงปิดเป็น Inactive' : 'ลบผู้ใช้แล้ว');
    openView('users');
  } catch (err) { toast(err.message, 'error'); }
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
