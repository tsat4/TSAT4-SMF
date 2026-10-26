// ระบบกิจกรรม > CFO (Carbon Footprint for Organization): Dashboard (Summary / Schedule), transaction (monthly entry
// per activity), Setting (plan / activities / emission factors / team / company). Server: server/modules/act/cfo.js
// spec: docs/specs/act-cfo.md · uses the shared year (a5Year), page bar slots and team tab of act-5s.js.
const CFO = 'cfo';
const CFO_SCOPE_COLORS = ['#ef4444', '#f59e0b', '#3b82f6'];
const CFO_ROLE_LABEL = { admin: 'ผู้จัดทำ', chairman: 'ประธาน', vice: 'รองประธาน', member: 'ตัวแทนหน่วยงาน' };
const CFO_DASH_TABS = { summary: 'Summary', schedule: 'Schedule' };
const CFO_SET_TABS = { plan: 'แผนงาน', activities: 'กิจกรรม', ef: 'Emission Factor', team: 'ทีม', company: 'บริษัท' };
const CFO_COMPANY = [['company_name', 'ชื่อธุรกิจ'], ['company_address', 'สถานที่ตั้ง'], ['company_area', 'พื้นที่โรงงาน'], ['company_business', 'ประเภทธุรกิจ'],
  ['company_customers', 'กลุ่มลูกค้าหลัก'], ['company_employees', 'จำนวนพนักงาน'], ['company_photo1', 'ลิงก์รูป 1'], ['company_photo2', 'ลิงก์รูป 2'],
  ['base_year', 'ปีฐาน'], ['target_percent', 'เป้าลด (% จากปีฐาน)'], ['septic_bod', 'บ่อเกรอะ BOD (g/คน/วัน)'], ['septic_b0', 'บ่อเกรอะ B0'], ['septic_mcf', 'บ่อเกรอะ MCF'], ['septic_i', 'บ่อเกรอะ I']];
const CFO_EF_GAS = [['co2', 'CO₂'], ['ch4_fossil', 'Fossil CH₄'], ['ch4', 'CH₄'], ['n2o', 'N₂O'], ['hfc', 'HFCs'], ['pfc', 'PFCs']];
let cfoDashTab = 'summary';
let cfoSetTab = 'plan';
let cfoMonth = new Date().getMonth() + 1;
const cfoFilter = { scope: '', department: '', q: '', status: '' };
const cfoHeads = { entries: { sort: '', dir: 'asc', filters: {} }, activities: { sort: '', dir: 'asc', filters: {} }, ef: { sort: '', dir: 'asc', filters: {} } };

const cfoT = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 3 });
const cfoPct = (part, total) => (total ? `${Math.round((part / total) * 1000) / 10}%` : '0%');
const cfoMonthIso = () => `${a5Year}-${String(cfoMonth).padStart(2, '0')}`;

// Page frame shared by the three CFO pages: tabs on the left, year (+ extra) on the right, body below.
async function cfoFrame(target, tabs, attr, active, rightExtra = '') {
  const me = await a5Api(CFO, `me?year=${a5Year}`);
  target.innerHTML = `<div class="view-body"><section class="card">
    ${pageBar(tabs ? a5Seg(attr, tabs, active) : '', `<div class="a5-year">${a5YearSelect(me.years)}</div>${rightExtra}`, 'a5')}
    <div id="a5-body"><div class="empty">กำลังโหลด...</div></div>
  </section></div>`;
  return { me, body: $('a5-body') };
}

// ---------- Dashboard ----------

async function cfoDashboard(target) {
  const { body } = await cfoFrame(target, CFO_DASH_TABS, 'data-cfodash', cfoDashTab);
  const rerender = () => cfoDashboard(target).catch(onErr);
  target.querySelectorAll('[data-cfodash]').forEach((node) => { node.onclick = () => { cfoDashTab = node.dataset.cfodash; rerender(); }; });
  $('a5-year').onchange = () => { a5Year = Number($('a5-year').value); rerender(); };
  if (cfoDashTab === 'schedule') return aplRender(body, CFO, { inPage: true, readOnly: true });
  const d = await a5Api(CFO, `cfo/summary?year=${a5Year}`);
  const change = d.lastYear ? Math.round(((d.total - d.lastYear) / d.lastYear) * 1000) / 10 : null;
  const max = Math.max(...d.months.map((m) => m.total), 1);
  const share = (list) => list.map((g) => `<tr><td>${esc(g.label)}</td><td class="num">${cfoT(g.tco2e)}</td><td class="num">${cfoPct(g.tco2e, d.total)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">ยังไม่มีข้อมูล</td></tr>';
  body.innerHTML = `
    <div class="a5-kpis">
      <article class="kpi"><div class="kpi-label">รวมปี ${a5Year} (tCO₂e)</div><div class="kpi-value">${cfoT(d.total)}</div><div class="kpi-label">${change == null ? 'ไม่มีข้อมูลปีก่อน' : `${change > 0 ? '+' : ''}${change}% จากปี ${a5Year - 1}`}</div></article>
      ${d.scopes.map((s) => `<article class="kpi" style="--scope:${CFO_SCOPE_COLORS[s.scope - 1]}"><div class="kpi-label"><span class="cfo-dot"></span>Scope ${s.scope}</div><div class="kpi-value">${cfoT(s.tco2e)}</div><div class="kpi-label">${cfoPct(s.tco2e, d.total)} ของทั้งหมด</div></article>`).join('')}
    </div>
    <section class="card a5-chart-card">
      <div class="plan-head"><div class="card-title">tCO₂e รายเดือน</div><div class="cfo-legend">${[1, 2, 3].map((n) => `<span style="--scope:${CFO_SCOPE_COLORS[n - 1]}"><span class="cfo-dot"></span>Scope ${n}</span>`).join('')}</div></div>
      <div class="a5-chart">${d.months.map((m) => `<div class="a5-bar-col" title="${ACT_MONTHS[m.month - 1]}: ${cfoT(m.total)} tCO₂e"><span class="a5-bar-val">${m.total ? cfoT(Math.round(m.total)) : ''}</span>
        <div class="cfo-stack" style="height:${(m.total / max) * 100}%">${m.scopes.map((v, i) => (v ? `<div style="flex:${v};background:${CFO_SCOPE_COLORS[i]}"></div>` : '')).reverse().join('')}</div>
        <span class="a5-bar-label">${ACT_MONTHS_SHORT[m.month - 1]}</span></div>`).join('')}</div>
    </section>
    <div class="a5-two">
      <div class="table-wrap"><table class="mo-data-table"><thead><tr><th>หมวด</th><th class="num">tCO₂e</th><th class="num">สัดส่วน</th></tr></thead><tbody>${share(d.categories)}</tbody></table></div>
      <div class="table-wrap"><table class="mo-data-table"><thead><tr><th>หน่วยงาน</th><th class="num">tCO₂e</th><th class="num">สัดส่วน</th></tr></thead><tbody>${share(d.departments)}</tbody></table></div>
    </div>`;
}

// ---------- transaction: monthly quantities ----------

async function cfoEntries(target) {
  const monthSelect = field('เดือน', `<select id="cfo-month">${options(Array.from({ length: 12 }, (_, i) => i + 1), cfoMonth, (m) => ACT_MONTHS[m - 1])}</select>`);
  const { me, body } = await cfoFrame(target, null, '', '', monthSelect);
  const rerender = () => cfoEntries(target).catch(onErr);
  $('a5-year').onchange = () => { a5Year = Number($('a5-year').value); rerender(); };
  $('cfo-month').onchange = () => { cfoMonth = Number($('cfo-month').value); rerender(); };
  if (!me.access.member) { body.innerHTML = `<p class="empty">เข้าได้เฉพาะทีม CFO ปี ${a5Year} (ตัวแทนหน่วยงาน / ผู้จัดทำ / ประธาน)</p>`; return; }
  const d = await a5Api(CFO, `cfo/entries?month=${cfoMonthIso()}`);
  const departments = [...new Set(d.rows.map((r) => r.department))].sort();
  const confirmed = d.rows.some((r) => r.entry?.status === 'CONFIRMED');
  body.innerHTML = `
    <div class="toolbar a5-filters">
      ${field('Scope', `<select id="cfo-f-scope">${options(['', '1', '2', '3'], cfoFilter.scope, (v) => (v ? `Scope ${v}` : 'ทั้งหมด'))}</select>`)}
      ${field('หน่วยงาน', `<select id="cfo-f-dept">${options(['', ...departments], cfoFilter.department, (v) => v || 'ทั้งหมด')}</select>`)}
      ${searchSlot('ค้นหา', 'cfo-f-q', 'cfo-f-search', { placeholder: 'กิจกรรมหรือรายละเอียด' })}
      <div class="action-bar">${button('cfo-edit', 'บันทึก', 'primary', 'disabled')}${d.admin ? button('cfo-confirm', confirmed ? 'เปิดให้แก้เดือนนี้' : 'ยืนยันเดือนนี้') : ''}</div>
    </div>
    <div class="table-wrap sheet" id="cfo-rows"></div>
    <p class="sum-meta" id="cfo-sum"></p>`;
  $('cfo-f-q').value = cfoFilter.q;
  let picked = null;
  const draw = () => {
    const term = cfoFilter.q.trim().toLowerCase();
    const list = listQuery(d.rows.filter((r) => (!cfoFilter.scope || String(r.scope_code || '').startsWith(`${cfoFilter.scope}-`))
      && (!cfoFilter.department || r.department === cfoFilter.department)
      && (!term || `${r.name} ${r.detail || ''} ${r.source || ''}`.toLowerCase().includes(term))), cfoHeads.entries, (r, key) => (key === 'qty' || key === 'tco2e' ? Number(r.entry?.[key] ?? -1) : key === 'status' ? r.entry?.status || '' : r[key] ?? ''));
    fillTable('cfo-rows', [{ label: 'หน่วยงาน', key: 'department' }, { label: 'กิจกรรม', key: 'name' }, { label: 'รายละเอียด', key: 'detail' }, { label: 'หมวด', key: 'scope_code' },
      { label: 'แหล่งปล่อย', key: 'source' }, { label: 'ปริมาณ', key: 'qty' }, 'หน่วย', { label: 'tCO₂e', key: 'tco2e' }, { label: 'สถานะ', key: 'status' }],
    list.map((r) => `<tr data-pick="${r.id}"${r.canEdit ? '' : ' class="is-muted"'}><td>${esc(r.department)}</td><td>${esc(r.name)}</td><td>${esc(r.detail || '')}</td><td>${esc(r.scope_code || '')}</td><td>${esc(r.source || '')}</td>
      <td class="num">${r.entry ? cfoT(r.entry.qty) : '<span class="sum-meta">ยังไม่บันทึก</span>'}</td><td>${esc(r.unit || '')}</td><td class="num">${r.entry ? cfoT(r.entry.tco2e) : ''}</td>
      <td>${r.entry ? `<span class="badge ${r.entry.status === 'CONFIRMED' ? 'badge-success' : 'badge-warning'}">${r.entry.status === 'CONFIRMED' ? 'ยืนยันแล้ว' : 'ร่าง'}</span>` : ''}</td></tr>`).join(''), 'ไม่มีกิจกรรม', headFor(cfoHeads.entries, draw));
    const done = list.filter((r) => r.entry);
    $('cfo-sum').textContent = `${ACT_MONTHS[cfoMonth - 1]} ${a5Year} · บันทึกแล้ว ${done.length}/${list.length} กิจกรรม · รวม ${cfoT(done.reduce((s, r) => s + r.entry.tco2e, 0))} tCO₂e`;
    const open = (id) => { const row = d.rows.find((r) => String(r.id) === String(id)); if (row?.canEdit) cfoEntryForm(row, d.septic, rerender); };
    bindRowSelect($('cfo-rows'), (id) => { picked = id; $('cfo-edit').disabled = !d.rows.find((r) => String(r.id) === id)?.canEdit; });
    $('cfo-rows').querySelectorAll('tr[data-pick]').forEach((tr) => { tr.ondblclick = () => open(tr.dataset.pick); });
    $('cfo-edit').onclick = () => open(picked);
  };
  draw();
  a5Lift(body);
  $('cfo-f-scope').onchange = () => { cfoFilter.scope = $('cfo-f-scope').value; draw(); };
  $('cfo-f-dept').onchange = () => { cfoFilter.department = $('cfo-f-dept').value; draw(); };
  const search = () => { cfoFilter.q = $('cfo-f-q').value; draw(); };
  $('cfo-f-search').onclick = search;
  onEnter('cfo-f-q', search);
  if ($('cfo-confirm')) {
    $('cfo-confirm').onclick = () => confirmPopup(confirmed ? 'เปิดให้แก้' : 'ยืนยันข้อมูล', `${confirmed ? 'เปิดให้ตัวแทนหน่วยงานแก้' : 'ยืนยัน'}ข้อมูลทั้งหมดของ ${ACT_MONTHS[cfoMonth - 1]} ${a5Year}`, async () => {
      const r = await a5Api(CFO, 'cfo/confirm', { method: 'POST', body: { month: cfoMonthIso(), status: confirmed ? 'DRAFT' : 'CONFIRMED' } });
      toast(`${confirmed ? 'เปิดแก้' : 'ยืนยัน'} ${r.count} รายการ`);
      rerender();
    }, confirmed ? 'เปิดให้แก้' : 'ยืนยัน');
  }
}

// Quantity of one activity for the month. Septic tank: people × days → kg CH4 (same formula as the server).
function cfoEntryForm(row, septic, reload) {
  const e = row.entry || {};
  const isSeptic = row.calc === 'septic';
  const kg = () => {
    const n = (k) => Number(septic[k] || 0);
    return Number($('cfo-people').value || 0) * Number($('cfo-days').value || 0) * n('septic_bod') * 0.001 * n('septic_i') * n('septic_b0') * n('septic_mcf');
  };
  const fields = `<p class="sum-meta">${esc(row.department)} · ${esc(row.name)} ${esc(row.detail || '')} · ${esc(row.source || '')} (${cfoT(row.kgco2e)} kgCO₂e/${esc(row.unit || '')})</p>
    ${isSeptic ? `${field('จำนวนคน', `<input id="cfo-people" type="number" min="0" step="1" value="${esc(e.inputs?.people ?? '')}">`)}
      ${field('จำนวนวันทำงาน', `<input id="cfo-days" type="number" min="0" step="1" value="${esc(e.inputs?.days ?? '')}">`)}
      <p class="sum-meta" id="cfo-kg"></p>`
    : field(`ปริมาณ (${esc(row.unit || '')})`, `<input id="cfo-qty" type="number" min="0" step="any" value="${esc(e.qty ?? '')}">`)}
    ${field('ลิงก์เอกสาร / หลักฐาน', `<input id="cfo-doc" maxlength="500" value="${esc(e.doc || '')}">`)}
    ${field('หมายเหตุ', `<textarea id="cfo-remark" rows="2" maxlength="500">${esc(e.remark || '')}</textarea>`)}
    ${e.id ? button('cfo-del', 'ลบข้อมูลเดือนนี้', 'danger') : ''}`;
  openPopup(`${ACT_MONTHS[cfoMonth - 1]} ${a5Year}`, fields, async () => {
    const body = { activityId: row.id, month: cfoMonthIso(), doc: $('cfo-doc').value, remark: $('cfo-remark').value };
    if (isSeptic) body.inputs = { people: $('cfo-people').value, days: $('cfo-days').value };
    else body.qty = $('cfo-qty').value;
    await a5Api(CFO, 'cfo/entries', { method: 'PUT', body });
    toast('บันทึกแล้ว');
    closePopup();
    reload();
  });
  if (isSeptic) {
    const show = () => { $('cfo-kg').textContent = `= ${cfoT(kg())} kg CH₄ · ${cfoT((kg() * Number(row.kgco2e || 0)) / 1000)} tCO₂e`; };
    $('cfo-people').oninput = show;
    $('cfo-days').oninput = show;
    show();
  }
  if ($('cfo-del')) $('cfo-del').onclick = () => confirmPopup('ลบข้อมูล', `ลบ ${esc(row.name)} ของ ${ACT_MONTHS[cfoMonth - 1]} ${a5Year}`, async () => {
    await a5Api(CFO, `cfo/entries/${e.id}`, { method: 'DELETE' });
    toast('ลบแล้ว');
    reload();
  });
}

// ---------- Setting ----------

async function cfoSetting(target) {
  const { me, body } = await cfoFrame(target, CFO_SET_TABS, 'data-cfoset', cfoSetTab);
  const rerender = () => cfoSetting(target).catch(onErr);
  target.querySelectorAll('[data-cfoset]').forEach((node) => { node.onclick = () => { cfoSetTab = node.dataset.cfoset; rerender(); }; });
  $('a5-year').onchange = () => { a5Year = Number($('a5-year').value); rerender(); };
  if (cfoSetTab === 'plan') return aplRender(body, CFO, { inPage: true });
  if (cfoSetTab === 'team') return a5SetTeam(body, CFO, me.access.admin, rerender, CFO_ROLE_LABEL);
  const m = await a5Api(CFO, 'cfo/master');
  const draw = { activities: cfoSetActivities, ef: cfoSetEf, company: cfoSetCompany }[cfoSetTab] || cfoSetActivities;
  draw(body, m, rerender);
}

function cfoEfLabel(e) {
  return e ? `${e.scope_code} · ${e.name} (${e.kgco2e == null ? '-' : cfoT(e.kgco2e)} kgCO₂e/${e.unit})` : '';
}

function cfoSetActivities(body, m, rerender) {
  const efById = new Map(m.ef.map((e) => [e.id, e]));
  const departments = [...new Set(m.activities.map((a) => a.department))].sort();
  const draw = () => {
    const term = cfoFilter.q.trim().toLowerCase();
    const list = listQuery(m.activities.filter((a) => (!cfoFilter.department || a.department === cfoFilter.department)
      && (!cfoFilter.scope || String(efById.get(a.ef_id)?.scope_code || '').startsWith(`${cfoFilter.scope}-`))
      && (!term || `${a.name} ${a.detail || ''}`.toLowerCase().includes(term))), cfoHeads.activities, (a, key) => (key === 'ef' ? cfoEfLabel(efById.get(a.ef_id)) : a[key] ?? ''));
    fillTable('cfo-rows', [{ label: 'หน่วยงาน', key: 'department' }, { label: 'กิจกรรม', key: 'name' }, { label: 'รายละเอียด', key: 'detail' }, { label: 'Emission factor', key: 'ef' }, { label: 'สูตร', key: 'calc' }, { label: 'สถานะ', key: 'status' }],
      list.map((a) => `<tr data-pick="${a.id}"><td>${esc(a.department)}</td><td>${esc(a.name)}</td><td>${esc(a.detail || '')}</td><td>${esc(cfoEfLabel(efById.get(a.ef_id)))}</td><td>${a.calc === 'septic' ? 'บ่อเกรอะ' : ''}</td><td>${esc(a.status)}</td></tr>`).join(''), 'ยังไม่มีกิจกรรม', headFor(cfoHeads.activities, draw));
    bindRowSelect($('cfo-rows'), (id) => { picked = m.activities.find((a) => String(a.id) === id); ['cfo-edit', 'cfo-del'].forEach((b) => { if ($(b)) $(b).disabled = !picked; }); });
  };
  let picked = null;
  body.innerHTML = `
    <div class="toolbar a5-filters">
      ${field('Scope', `<select id="cfo-f-scope">${options(['', '1', '2', '3'], cfoFilter.scope, (v) => (v ? `Scope ${v}` : 'ทั้งหมด'))}</select>`)}
      ${field('หน่วยงาน', `<select id="cfo-f-dept">${options(['', ...departments], cfoFilter.department, (v) => v || 'ทั้งหมด')}</select>`)}
      ${searchSlot('ค้นหา', 'cfo-f-q', 'cfo-f-search', { placeholder: 'ชื่อกิจกรรม' })}
      ${m.admin ? `<div class="action-bar">${button('cfo-add', 'เพิ่ม', 'primary')}${button('cfo-edit', 'แก้ไข', 'secondary', 'disabled')}${button('cfo-del', 'ลบ', 'danger', 'disabled')}</div>` : ''}
    </div>
    <div class="table-wrap sheet" id="cfo-rows"></div>
    <p class="sum-meta">${m.activities.length} กิจกรรม · กิจกรรมที่มีข้อมูลแล้วลบไม่ได้ ให้ตั้งเป็น Inactive</p>`;
  $('cfo-f-q').value = cfoFilter.q;
  draw();
  a5Lift(body);
  $('cfo-f-scope').onchange = () => { cfoFilter.scope = $('cfo-f-scope').value; draw(); };
  $('cfo-f-dept').onchange = () => { cfoFilter.department = $('cfo-f-dept').value; draw(); };
  const search = () => { cfoFilter.q = $('cfo-f-q').value; draw(); };
  $('cfo-f-search').onclick = search;
  onEnter('cfo-f-q', search);
  if (!m.admin) return;
  const form = (a) => {
    const active = m.ef.filter((e) => e.status === 'Active' || e.id === a?.ef_id);
    openPopup(a ? 'แก้ไขกิจกรรม' : 'เพิ่มกิจกรรม', `
      ${field('หน่วยงาน', `<input id="cfo-a-dept" maxlength="80" list="cfo-depts" value="${esc(a?.department || '')}"><datalist id="cfo-depts">${departments.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`)}
      ${field('ชื่อกิจกรรม', `<input id="cfo-a-name" maxlength="200" value="${esc(a?.name || '')}">`)}
      ${field('รายละเอียด', `<input id="cfo-a-detail" maxlength="500" value="${esc(a?.detail || '')}">`)}
      ${field('Emission factor', `<select id="cfo-a-ef">${active.map((e) => `<option value="${e.id}"${e.id === a?.ef_id ? ' selected' : ''}>${esc(cfoEfLabel(e))}</option>`).join('')}</select>`)}
      ${field('GWP', `<select id="cfo-a-gwp">${options(m.gwp.map((g) => g.code), a?.gwp_code || m.gwp[0]?.code)}</select>`)}
      ${field('สูตรปริมาณ', `<select id="cfo-a-calc">${options(['', 'septic'], a?.calc || '', (v) => (v ? 'บ่อเกรอะ (คน × วัน → kg CH₄)' : 'กรอกปริมาณเอง'))}</select>`)}
      ${field('สถานะ', `<select id="cfo-a-status">${options(['Active', 'Inactive'], a?.status || 'Active')}</select>`)}`, async () => {
      const body2 = { department: $('cfo-a-dept').value, name: $('cfo-a-name').value, detail: $('cfo-a-detail').value, ef_id: $('cfo-a-ef').value, gwp_code: $('cfo-a-gwp').value, calc: $('cfo-a-calc').value, status: $('cfo-a-status').value };
      await a5Api(CFO, `cfo/activities${a ? `/${a.id}` : ''}`, { method: a ? 'PATCH' : 'POST', body: body2 });
      toast('บันทึกแล้ว');
      closePopup();
      rerender();
    });
  };
  $('cfo-add').onclick = () => form(null);
  $('cfo-edit').onclick = () => picked && form(picked);
  $('cfo-del').onclick = () => picked && confirmPopup('ลบกิจกรรม', `ลบ ${esc(picked.department)} · ${esc(picked.name)}`, async () => {
    await a5Api(CFO, `cfo/activities/${picked.id}`, { method: 'DELETE' });
    toast('ลบแล้ว');
    rerender();
  });
}

function cfoSetEf(body, m, rerender) {
  let picked = null;
  const draw = () => {
    const term = cfoFilter.q.trim().toLowerCase();
    const list = listQuery(m.ef.filter((e) => (!cfoFilter.scope || e.scope_code.startsWith(`${cfoFilter.scope}-`)) && (!cfoFilter.status || e.status === cfoFilter.status)
      && (!term || `${e.name} ${e.kind || ''} ${e.code || ''}`.toLowerCase().includes(term))), cfoHeads.ef, (e, key) => e[key] ?? '');
    fillTable('cfo-rows', [{ label: 'หมวด', key: 'scope_code' }, { label: 'กลุ่ม', key: 'kind' }, { label: 'ชื่อ', key: 'name' }, { label: 'หน่วย', key: 'unit' }, { label: 'kgCO₂e/หน่วย', key: 'kgco2e' }, { label: 'อ้างอิง', key: 'reference' }, 'ใช้แล้ว', { label: 'สถานะ', key: 'status' }],
      list.map((e) => `<tr data-pick="${e.id}"><td>${esc(e.scope_code)}</td><td>${esc(e.kind || '')}</td><td title="${esc(e.detail || '')}">${esc(e.name)}</td><td>${esc(e.unit)}</td><td class="num">${e.kgco2e == null ? '-' : cfoT(e.kgco2e)}</td><td>${esc(e.reference || '')}</td><td>${e.used ? '✓' : ''}</td><td>${esc(e.status)}</td></tr>`).join(''), 'ไม่มี EF', headFor(cfoHeads.ef, draw));
    bindRowSelect($('cfo-rows'), (id) => { picked = m.ef.find((e) => String(e.id) === id); ['cfo-edit', 'cfo-del'].forEach((b) => { if ($(b)) $(b).disabled = !picked; }); });
  };
  body.innerHTML = `
    <div class="toolbar a5-filters">
      ${field('Scope', `<select id="cfo-f-scope">${options(['', '1', '2', '3'], cfoFilter.scope, (v) => (v ? `Scope ${v}` : 'ทั้งหมด'))}</select>`)}
      ${field('สถานะ', `<select id="cfo-f-status">${options(['', 'Active', 'Inactive'], cfoFilter.status, (v) => v || 'ทั้งหมด')}</select>`)}
      ${searchSlot('ค้นหา', 'cfo-f-q', 'cfo-f-search', { placeholder: 'ชื่อ กลุ่ม หรือรหัส' })}
      ${m.admin ? `<div class="action-bar">${button('cfo-add', 'เพิ่ม', 'primary')}${button('cfo-edit', 'แก้ไข', 'secondary', 'disabled')}${button('cfo-del', 'ลบ', 'danger', 'disabled')}</div>` : ''}
    </div>
    <div class="table-wrap sheet" id="cfo-rows"></div>
    <p class="sum-meta">${m.ef.length} EF · EF ที่ใช้แล้วแก้ค่าไม่ได้ ให้เพิ่มแถวใหม่แล้วตั้งตัวเดิมเป็น Inactive</p>`;
  $('cfo-f-q').value = cfoFilter.q;
  draw();
  a5Lift(body);
  $('cfo-f-scope').onchange = () => { cfoFilter.scope = $('cfo-f-scope').value; draw(); };
  $('cfo-f-status').onchange = () => { cfoFilter.status = $('cfo-f-status').value; draw(); };
  const search = () => { cfoFilter.q = $('cfo-f-q').value; draw(); };
  $('cfo-f-search').onclick = search;
  onEnter('cfo-f-q', search);
  if (!m.admin) return;
  const form = (e) => {
    const lock = e?.used ? ' disabled' : '';
    openPopup(e ? 'แก้ไข Emission factor' : 'เพิ่ม Emission factor', `
      ${e?.used ? '<p class="sum-meta">EF นี้ถูกใช้แล้ว แก้ได้เฉพาะชื่อ รายละเอียด อ้างอิง และสถานะ</p>' : ''}
      ${field('หมวด', `<select id="cfo-e-scope"${lock}>${m.scopes.map((s) => `<option value="${esc(s.code)}"${s.code === e?.scope_code ? ' selected' : ''}>${esc(s.code)} ${esc(s.name)}</option>`).join('')}</select>`)}
      ${field('กลุ่ม', `<input id="cfo-e-kind" maxlength="120" value="${esc(e?.kind || '')}">`)}
      ${field('ชื่อ', `<input id="cfo-e-name" maxlength="300" value="${esc(e?.name || '')}">`)}
      ${field('รายละเอียด', `<textarea id="cfo-e-detail" rows="2" maxlength="1000">${esc(e?.detail || '')}</textarea>`)}
      ${field('หน่วย', `<input id="cfo-e-unit" maxlength="30" value="${esc(e?.unit || '')}"${lock}>`)}
      ${field('kgCO₂e ต่อหน่วย (รวม)', `<input id="cfo-e-kgco2e" type="number" step="any" value="${esc(e?.kgco2e ?? '')}"${lock}>`)}
      <div class="cfo-gas">${CFO_EF_GAS.map(([k, label]) => field(`${label} (Scope 1)`, `<input id="cfo-e-${k}" type="number" step="any" value="${esc(e?.[k] ?? '')}"${lock}>`)).join('')}</div>
      ${field('อ้างอิง', `<input id="cfo-e-ref" maxlength="500" value="${esc(e?.reference || '')}">`)}
      ${field('ปี', `<input id="cfo-e-year" type="number" value="${esc(e?.year ?? a5Year)}">`)}
      ${field('สถานะ', `<select id="cfo-e-status">${options(['Active', 'Inactive'], e?.status || 'Active')}</select>`)}`, async () => {
      const body2 = { scope_code: $('cfo-e-scope').value, kind: $('cfo-e-kind').value, name: $('cfo-e-name').value, detail: $('cfo-e-detail').value, unit: $('cfo-e-unit').value,
        kgco2e: $('cfo-e-kgco2e').value, reference: $('cfo-e-ref').value, year: $('cfo-e-year').value, status: $('cfo-e-status').value };
      CFO_EF_GAS.forEach(([k]) => { body2[k] = $(`cfo-e-${k}`).value; });
      await a5Api(CFO, `cfo/ef${e ? `/${e.id}` : ''}`, { method: e ? 'PATCH' : 'POST', body: body2 });
      toast('บันทึกแล้ว');
      closePopup();
      rerender();
    });
  };
  $('cfo-add').onclick = () => form(null);
  $('cfo-edit').onclick = () => picked && form(picked);
  $('cfo-del').onclick = () => picked && confirmPopup('ลบ EF', `ลบ ${esc(picked.name)}`, async () => {
    await a5Api(CFO, `cfo/ef/${picked.id}`, { method: 'DELETE' });
    toast('ลบแล้ว');
    rerender();
  });
}

function cfoSetCompany(body, m, rerender) {
  body.innerHTML = `
    ${m.admin ? `<div class="action-bar a5-actions">${button('cfo-save', 'บันทึก', 'primary')}</div>` : ''}
    <div class="cfo-company">${CFO_COMPANY.map(([key, label]) => field(label, `<input id="cfo-s-${key}" maxlength="1000" value="${esc(m.settings[key] ?? '')}"${m.admin ? '' : ' readonly'}>`)).join('')}</div>`;
  a5Lift(body);
  if (!m.admin) return;
  $('cfo-save').onclick = () => {
    const values = Object.fromEntries(CFO_COMPANY.map(([key]) => [key, $(`cfo-s-${key}`).value]));
    a5Api(CFO, 'cfo/settings', { method: 'PUT', body: values }).then(() => { toast('บันทึกแล้ว'); rerender(); }).catch(onErr);
  };
}

Object.assign(VIEWS, { [`${CFO}-home`]: cfoDashboard, [`${CFO}-edit`]: cfoEntries, [`${CFO}-setting`]: cfoSetting });
