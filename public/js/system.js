// System > Setting: creator-only table editor (server: server/modules/system).
const CHOICES = {
  status: ['Active', 'Inactive'],
  group: ['Factory', 'Non', 'Center'],
  usage: ['viewer', 'user', 'admin'],
  level: ['S1', 'S2', 'S3', 'T1', 'T2', 'T3', 'T6', 'T7', 'T8'],
  req: Object.keys(STATUS),
  areatype: ['โรงงาน', 'สำนักงาน'],
  actrole: ['admin', 'chairman', 'auditor', 'owner']
};

TITLES.system = ['Setting', 'ตารางทั้งระบบ'];

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
    state.rows = [];
    state.selected = null;
    $('sys-edit').disabled = true;
    $('sys-del').disabled = true;
    let data;
    try {
      data = await api(`/api/system/tables/${encodeURIComponent(table.name)}?q=${encodeURIComponent($('sys-q').value.trim())}&offset=${state.offset}`);
    } catch (err) {
      fillTable('sys-rows', [], '', esc(err.message));
      countText('sys-count', 0, 0);
      throw err;
    }
    state.rows = data.rows;
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

VIEWS.system = renderSystem;
