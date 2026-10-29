// System > Setting: creator-only table editor (server: server/modules/system).
const CHOICES = {
  status: ['Active', 'Inactive'],
  group: ['Factory', 'Non', 'Center'],
  usage: ['viewer', 'user', 'admin'],
  level: ['S1', 'S2', 'S3', 'T1', 'T2', 'T3', 'T6', 'T7', 'T8', 'M1', 'M2', 'M3', 'G1', 'G2', 'G3'],
  prefix: ['นาย', 'นาง', 'นางสาว', 'Mr.', 'Mrs.', 'Ms.'],
  req: Object.keys(STATUS),
  areatype: ['โรงงาน', 'สำนักงาน'],
  actrole: ['admin', 'chairman', 'vice', 'advisor', 'smart', 'auditor', 'owner', 'member']
};

TITLES.system = ['Setting', 'ตารางทั้งระบบ'];
const SYS_LEVEL_NAMES = { M: 'ผู้จัดการ', G: 'ผู้จัดการโรงงาน' };
let sysDepts = null; // department choices = departments in mt_main_costcenter (GET /api/system/choices)
// mt_main_user.admin_of choices: Store + ระบบงาน + ระบบกิจกรรม (server: ADMIN_SCOPES in server/core/access.js).
const SYS_SCOPES = [['sto', 'Store / Usage'], ...PLANTS.map(([id, label]) => [id, label]), ...ACTIVITIES.map(([id, label]) => [id, label])];
const SYS_USER_LABELS = { creator: 'จัดการได้ทั้งหมด', executive: 'ผู้บริหาร', admin_of: 'ผู้ดูแลระบบ' };

function columnLabel(table, column) {
  if (table?.name === 'mt_main_user' && SYS_USER_LABELS[column.name]) return SYS_USER_LABELS[column.name];
  return column.name;
}

function cellText(column, value) {
  if (column.type === 'scopes') return (Array.isArray(value) ? value : []).map((id) => (SYS_SCOPES.find(([key]) => key === id) || [, id])[1]).join(', ');
  if (column.type === 'bool') return value ? '✓' : '';
  return value ?? '';
}

function columnControl(table, column, value) {
  const id = `sys-${column.name}`;
  const label = columnLabel(table, column);
  if (column.type === 'password') return field(label, `<input id="${id}" type="password" autocomplete="new-password">`);
  if (column.type === 'bool') return field(label, `<select id="${id}"><option value="false">false</option><option value="true"${value ? ' selected' : ''}>true</option></select>`);
  if (column.type === 'scopes') {
    const on = Array.isArray(value) ? value : [];
    // A div, not field(): checkbox labels must not sit inside another label.
    return `<div class="field sys-scope-field">${label}<div id="${id}" class="sys-scopes">${SYS_SCOPES.map(([key, name]) => `<label class="check"><input type="checkbox" value="${esc(key)}"${on.includes(key) ? ' checked' : ''}> ${esc(name)}</label>`).join('')}</div></div>`;
  }
  const list = column.type === 'dept' ? sysDepts || [] : CHOICES[column.type];
  if (list) {
    // A value no longer in the list (old data) stays selectable so the row can still be saved unchanged.
    const all = [...(column.required ? [] : ['']), ...(value && !list.includes(value) ? [value] : []), ...list];
    const text = (v) => (v === '' ? '-' : column.type === 'level' && SYS_LEVEL_NAMES[v[0]] ? `${v} · ${SYS_LEVEL_NAMES[v[0]]}` : v);
    return field(label, `<select id="${id}">${options(all, value ?? '', text)}</select>`);
  }
  const number = ['int', 'qty', 'money'].includes(column.type);
  const step = column.type === 'int' ? '1' : '0.001';
  return field(label, `<input id="${id}" ${number ? `type="number" step="${step}"` : ''} value="${esc(value ?? '')}">`);
}

// Pick ระบบ → งาน / กิจกรรม → ตาราง (ผู้ใช้กำหนด 2026-10-29). A table's unit comes from its name:
// mt_main_* = ข้อมูลกลาง (ระบบตั้งค่า), mt_sto_* / tx_sto_* = Store, mt_<key>_* / tx_<key>_* = that work unit or activity.
const SYS_GROUPS = [['setting', 'ระบบตั้งค่า'], ['work', 'ระบบงาน'], ['activity', 'ระบบกิจกรรม']];
const sysUnitsOf = (group) => (group === 'work' ? [['sto', 'Store / Usage'], ...PLANTS.map(([id, label]) => [id, label])]
  : group === 'activity' ? ACTIVITIES.map(([id, label]) => [id, label]) : [['main', 'ข้อมูลกลาง']]);
function sysUnitOf(name) {
  const key = (/^(?:mt|tx|v)_([a-z0-9]+)_/.exec(name) || [])[1] || 'main';
  if (key === 'sto') return ['work', 'sto'];
  const act = ACTIVITIES.find(([id]) => id.replace(/[^a-z0-9]/g, '') === key);
  if (act) return ['activity', act[0]];
  const plant = PLANTS.find(([id]) => id.replace(/[^a-z0-9]/g, '') === key);
  return plant ? ['work', plant[0]] : ['setting', 'main'];
}
const sysPick = { group: 'setting', unit: 'main', table: '' };

async function renderSystem(target) {
  const catalog = await api('/api/system/tables');
  const state = { offset: 0, editing: null, rows: [], selected: null };
  const head = { sort: '', dir: 'asc', filters: {} };
  const columnHead = () => headFor(head, () => { state.offset = 0; loadRows().catch(onErr); });
  target.innerHTML = tablePage('sys', `
    ${field('ระบบ', `<select id="sys-group">${options(SYS_GROUPS.map(([id]) => id), sysPick.group, (v) => SYS_GROUPS.find(([id]) => id === v)[1])}</select>`)}
    ${field('งาน / กิจกรรม', '<select id="sys-unit"></select>')}
    ${field('ตาราง', '<select id="sys-table"></select>', 'grow')}
    ${searchSlot('ค้นหา', 'sys-q', 'sys-search', { grow: true })}
    ${crudBar('sys')}`);
  const tableOf = () => catalog.tables.find((table) => table.name === $('sys-table').value);
  const tablesIn = (group, unit) => catalog.tables.filter((table) => { const [g, u] = sysUnitOf(table.name); return g === group && u === unit; });
  // งาน / กิจกรรม list with its table count; ตาราง list of the chosen unit only.
  const fillUnits = () => {
    const units = sysUnitsOf(sysPick.group);
    if (!units.some(([id]) => id === sysPick.unit)) sysPick.unit = (units.find(([id]) => tablesIn(sysPick.group, id).length) || units[0])[0];
    $('sys-unit').innerHTML = options(units.map(([id]) => id), sysPick.unit, (id) => `${units.find(([u]) => u === id)[1]} (${tablesIn(sysPick.group, id).length})`);
  };
  const fillTables = () => {
    const list = tablesIn(sysPick.group, sysPick.unit);
    if (!list.some((table) => table.name === sysPick.table)) sysPick.table = list[0]?.name || '';
    $('sys-table').innerHTML = list.length ? options(list.map((table) => table.name), sysPick.table) : '<option value="">ยังไม่มีตาราง</option>';
    $('sys-table').disabled = !list.length;
  };
  const loadRows = async () => {
    const table = tableOf();
    state.rows = [];
    state.selected = null;
    $('sys-edit').disabled = true;
    $('sys-del').disabled = true;
    $('sys-add').disabled = !table;
    if (!table) {
      fillTable('sys-rows', [], '', `ยังไม่มีตารางของ ${esc($('sys-unit').selectedOptions[0]?.textContent.replace(/ \(\d+\)$/, '') || '')} ในระบบ`);
      countText('sys-count', 0, 0);
      setPager('sys', 0, 0);
      return;
    }
    let data;
    try {
      const params = tableParams(new URLSearchParams({ q: $('sys-q').value.trim(), offset: String(state.offset) }), head);
      data = await api(`/api/system/tables/${encodeURIComponent(table.name)}?${params}`);
    } catch (err) {
      fillTable('sys-rows', [], '', esc(err.message));
      countText('sys-count', 0, 0);
      setPager('sys', 0, 0);
      throw err;
    }
    state.rows = data.rows;
    countText('sys-count', state.rows.length, data.total);
    setPager('sys', state.offset, data.total);
    const visible = table.columns.filter((column) => column.type !== 'password');
    fillTable('sys-rows', visible.map((column) => ({ label: columnLabel(table, column), key: column.name })), state.rows.map((row, index) => `<tr data-pick="${index}">${visible.map((column) => `<td>${esc(cellText(column, row[column.name]))}</td>`).join('')}</tr>`).join(''), 'ไม่มีแถว', columnHead());
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
      if (column.type === 'scopes') { values[column.name] = [...input.querySelectorAll('input:checked')].map((box) => box.value); continue; }
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
  const drawForm = async () => {
    const table = tableOf();
    if (table.columns.some((column) => column.type === 'dept') && !sysDepts) sysDepts = (await api('/api/system/choices')).dept || [];
    const fields = table.columns.map((column) => {
      if (column.type === 'read') return '';
      return columnControl(table, column, state.editing ? state.editing[column.name] : '');
    }).join('');
    const title = table.name === 'mt_main_user'
      ? (state.editing ? 'แก้ไขสิทธิ์จัดการระบบ' : 'เพิ่มสิทธิ์จัดการระบบ')
      : `${state.editing ? 'แก้ไขแถว' : 'เพิ่มแถว'} ${esc(table.name)}`;
    openPopup(title, fields, saveRow);
  };
  const reset = () => { state.offset = 0; head.sort = ''; head.dir = 'asc'; head.filters = {}; state.editing = null; closePopup(); loadRows().catch(onErr); };
  $('sys-group').onchange = () => { sysPick.group = $('sys-group').value; fillUnits(); fillTables(); reset(); };
  $('sys-unit').onchange = () => { sysPick.unit = $('sys-unit').value; fillTables(); reset(); };
  $('sys-table').onchange = () => { sysPick.table = $('sys-table').value; reset(); };
  fillUnits();
  fillTables();
  $('sys-add').onclick = () => { state.editing = null; drawForm().catch(onErr); };
  $('sys-edit').onclick = () => { if (!state.selected) return toast('เลือกแถวก่อน', 'error'); state.editing = state.selected; drawForm().catch(onErr); };
  $('sys-del').onclick = () => {
    if (!state.selected) return toast('เลือกแถวก่อน', 'error');
    const table = tableOf();
    const key = {};
    table.pk.forEach((column) => { key[column] = state.selected[column]; });
    const removing = table.name === 'mt_main_user' ? 'นำสิทธิ์จัดการระบบออก' : `ลบแถว ${esc(table.name)}`;
    confirmPopup(removing, 'ตรวจแถวที่เลือกอีกครั้งก่อนลบ', async () => {
      await api(`/api/system/tables/${encodeURIComponent(table.name)}`, { method: 'DELETE', body: { key } });
      toast('ลบแล้ว');
      await loadRows();
    });
  };
  bindPager('sys', state, loadRows);
  await loadRows();
}

VIEWS.system = renderSystem;
