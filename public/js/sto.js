// ระบบงาน > Store > Usage (server: server/modules/sto).
const STATUS = {
  cart: 'ตะกร้า', submitted: 'ส่งแล้ว', accepted: 'รับออร์เดอร์', preparing: 'กำลังจัด',
  ready: 'พร้อมรับ', received: 'รับแล้ว', cancelled: 'ยกเลิก'
};
const USAGE_ROLE = { viewer: 'Viewer', user: 'User', admin: 'Admin' };
const USAGE = 'ระบบงาน > Store > Usage';
const LINE_HEAD = ['หมายเลขเลขรายการ', 'ชื่อรายการ', 'หน่วย'];
const TX_PAGE = { issue: 'เบิกจ่าย', receive: 'รับเข้า', stock: 'Stock' };
let editMode = 'list';
let txPage = 'issue';
Object.assign(TITLES, {
  store: ['Store', 'ระบบงาน > Store'],
  locked: ['Usage', USAGE],
  home: ['Dashboard', USAGE],
  edit: ['transaction', USAGE],
  setting: ['Setting', USAGE]
});
Object.assign(ACCESS, { home: ['sto', 1], edit: ['sto', 1], setting: ['sto', 3] });

function usageThumb(src) {
  return src ? `<img class="usage-thumb" src="${esc(src)}" alt="">` : '';
}

function badge(status) {
  const kind = status === 'ready' || status === 'received' ? 'badge-success' : status === 'cancelled' ? 'badge-danger' : status === 'cart' ? 'badge-warning' : 'badge-primary';
  return `<span class="badge ${kind}">${esc(STATUS[status] || status)}</span>`;
}

async function renderStore(target) {
  modulePage(target, 'Store', 'ระบบงาน > Store', [['home', 'inventory_2', 'Usage', 'Dashboard, transaction, Setting']]);
}

async function renderLocked(target) {
  target.innerHTML = cardView('Usage', '', '<p class="empty">ยังไม่มีชื่อในรายการ Usage จึงยังเข้าส่วนนี้ไม่ได้</p>');
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
  const admin = rankOf('sto') >= 3;
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

Object.assign(VIEWS, { store: renderStore, locked: renderLocked, home: renderHome, edit: renderEdit, setting: renderUsers });
