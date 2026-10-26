// ระบบกิจกรรม > <activity>: Dashboard (Summary / Ranking / Schedule / Audit Plan / Team) and Setting (plan / areas / team / checklist / audit plan)
// Schedule (Dashboard, read only) and แผนงาน (Setting, admins edit) are the Project Planner (act-planner.js).
// for checklist-audit activities. Server: server/modules/act/audit.js · spec: docs/specs/act-5s.md
// Turn it on for another activity by adding its id to A5_ON (and its group names to A5_GROUPS).
const A5_ON = ['5s'];
const A5_GROUPS = { '5s': ['สะสาง', 'สะดวก', 'สะอาด', 'สร้างมาตรฐาน', 'สร้างวินัย'] };
const A5_TEAMS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
const A5_TEAM_COLORS = { A: '#1f2937', B: '#ec4899', C: '#f97316', D: '#ca8a04', E: '#0d9488', F: '#2563eb', G: '#9333ea', H: '#06b6d4', I: '#9ca3af' };
const A5_AREA_TYPES = ['โรงงาน', 'สำนักงาน'];
const A5_ROLE_LABEL = { admin: 'Admin', chairman: 'หัวหน้าทีม', auditor: 'ผู้ตรวจ' };
const A5_DASH_TABS = { summary: 'Summary', ranking: 'Ranking', schedule: 'Schedule', audit: 'Audit Plan', team: 'Team Auditor' };
const A5_SET_TABS = { gantt: 'แผนงาน', areas: 'พื้นที่', team: 'ทีม', checklist: 'หัวข้อตรวจ', plan: 'แผนตรวจ' };
let a5Year = new Date().getFullYear();
let a5DashTab = 'summary';
let a5SetTab = 'gantt';
let a5AreaType = A5_AREA_TYPES[0];
const a5Summary = { type: '', areaType: '', area: '' };
let a5RankMonth = new Date().getMonth() + 1;

function a5Api(activity, path, options) {
  return api(`/api/act/${encodeURIComponent(activity)}/${path}`, options);
}

function a5GroupName(activity, n) {
  const names = A5_GROUPS[activity] || [];
  return `ส${n}${names[n - 1] ? ` ${names[n - 1]}` : ''}`;
}

function a5TeamColor(team) {
  return A5_TEAM_COLORS[team] || '#64748b';
}

function a5Seg(attr, tabs, active) {
  return `<div class="seg" role="group">${Object.entries(tabs).map(([key, name]) => `<button class="seg-btn${key === active ? ' is-active' : ''}" type="button" ${attr}="${esc(key)}" aria-pressed="${key === active}">${esc(name)}</button>`).join('')}</div>`;
}

function a5YearSelect(years) {
  const list = [...new Set([...years, a5Year])].sort();
  return field('ปี', `<select id="a5-year">${options(list, a5Year)}</select>`);
}

// Week w of month m (1-based): the last day, used to decide "missed" vs "waiting".
function a5WeekEnd(year, month, week) {
  const last = new Date(year, month, 0).getDate();
  return new Date(year, month - 1, week === 4 ? last : week * 7);
}

// Move a tab's filters, search and buttons from its body up into the right side of the page bar (core.js pageBar,
// slot a5-tools, after the year): filters in body order (large to small) → search → buttons at the far right.
// The left side keeps only tabs. Notes (p, .sum-meta) stay in the body. Bind events before calling.
function a5Lift(body) {
  const left = $('a5-left');
  const tools = $('a5-tools');
  if (!tools) return;
  tools.innerHTML = '';
  if (left) left.innerHTML = '';
  const groups = { filter: [], search: [], action: [] };
  body.querySelectorAll(':scope > .a5-actions, :scope > .a5-filters').forEach((box) => {
    [...box.children].forEach((child) => {
      if (child.matches('p, .sum-meta')) return;
      if (child.matches('.search-slot')) groups.search.push(child);
      else if (child.matches('.action-bar, .btn') || box.classList.contains('a5-actions')) groups.action.push(child);
      else groups.filter.push(child);
    });
    if (!box.children.length) box.remove();
  });
  tools.append(...groups.filter, ...groups.search, ...groups.action);
}

// ---------- Dashboard ----------

async function a5Dashboard(target, activity) {
  const me = await a5Api(activity, `me?year=${a5Year}`);
  target.innerHTML = `<div class="view-body"><section class="card">
    ${pageBar(a5Seg('data-a5dash', A5_DASH_TABS, a5DashTab), `<div class="a5-year">${a5YearSelect(me.years)}</div>`, 'a5')}
    <div id="a5-body"><div class="empty">กำลังโหลด...</div></div>
  </section></div>`;
  const rerender = () => a5Dashboard(target, activity).catch(onErr);
  target.querySelectorAll('[data-a5dash]').forEach((node) => { node.onclick = () => { a5DashTab = node.dataset.a5dash; rerender(); }; });
  $('a5-year').onchange = () => { a5Year = Number($('a5-year').value); rerender(); };
  const body = $('a5-body');
  if (a5DashTab === 'schedule') return aplRender(body, activity, { inPage: true, readOnly: true });
  const draw = { summary: a5DrawSummary, ranking: a5DrawRanking, audit: a5DrawSchedule, team: a5DrawTeam }[a5DashTab] || a5DrawSummary;
  await draw(body, activity, me);
}

async function a5DrawSummary(body, activity) {
  const q = new URLSearchParams({ year: a5Year, type: a5Summary.type, areaType: a5Summary.areaType, area: a5Summary.area });
  const data = await a5Api(activity, `dashboard/summary?${q}`);
  const areas = data.areas.filter((a) => !a5Summary.areaType || a.areaType === a5Summary.areaType);
  const months = data.months;
  const pass = data.pass || 80; // pass_percent setting
  const row = (m) => `<tr><td>${ACT_MONTHS_SHORT[m.month - 1]}</td><td>${m.percent}%</td><td>${m.audits}</td></tr>`;
  body.innerHTML = `
    <div class="toolbar a5-filters">
      ${field('ประเภท', `<select id="a5-type">${options(['', 'SELF', 'COMMITTEE'], a5Summary.type, (v) => ({ '': 'ทั้งหมด', SELF: 'Self Audit', COMMITTEE: 'Committee' }[v]))}</select>`)}
      ${field('ประเภทพื้นที่', `<select id="a5-atype">${options(['', ...A5_AREA_TYPES], a5Summary.areaType, (v) => v || 'ทั้งหมด')}</select>`)}
      ${field('พื้นที่', `<select id="a5-area"><option value="">ทั้งหมด</option>${areas.map((a) => `<option value="${a.id}"${String(a.id) === String(a5Summary.area) ? ' selected' : ''}>${esc(a.code)} ${esc(a.name)}</option>`).join('')}</select>`, 'grow')}
    </div>
    <div class="ch-kpis">${(data.groups.length ? data.groups : [1, 2, 3, 4, 5].map((n) => ({ group: n, percent: 0 }))).map((g, i) => chartKpi({ label: `${esc(a5GroupName(activity, g.group))} · เฉลี่ยทั้งปี`, value: `${g.percent}%`, pie: g.percent, color: CHART.series[i % CHART.series.length], note: g.percent >= pass ? 'ผ่านเกณฑ์' : g.percent ? `ต่ำกว่าเกณฑ์ ${pass}%` : '' })).join('')}</div>
    <section class="card ch-card">
      <div class="ch-head"><div class="card-title">${esc(actLabel(activity))} Score % รายเดือน</div><div class="sum-meta">${data.owner ? `เจ้าของพื้นที่: ${esc(data.owner.name || data.owner.employeeId)} · ` : ''}${data.audits} ใบตรวจ</div></div>
      ${chartPlot({ id: 'a5-plot', labels: ACT_MONTHS_SHORT, left: 'Score (%)', leftMax: 100, bars: [{ values: months.map((m) => m.percent), colors: [CHART.series[0]] }],
        lines: [{ values: months.map(() => pass), color: CHART.target, dash: true, dots: false }],
        legend: [{ box: CHART.series[0], label: `${actLabel(activity)} % เฉลี่ยของเดือน` }, { line: CHART.target, dash: true, label: `เกณฑ์ผ่าน ${pass}%` }] })}
    </section>
    <div class="a5-two">
      <div class="table-wrap"><table class="mo-data-table"><thead><tr><th>เดือน</th><th>${esc(actLabel(activity))} %</th><th>ครั้ง</th></tr></thead><tbody>${months.slice(0, 6).map(row).join('')}</tbody></table></div>
      <div class="table-wrap"><table class="mo-data-table"><thead><tr><th>เดือน</th><th>${esc(actLabel(activity))} %</th><th>ครั้ง</th></tr></thead><tbody>${months.slice(6).map(row).join('')}</tbody></table></div>
    </div>`;
  a5Lift(body);
  const redraw = () => a5DrawSummary(body, activity).catch(onErr);
  $('a5-type').onchange = () => { a5Summary.type = $('a5-type').value; redraw(); };
  $('a5-atype').onchange = () => { a5Summary.areaType = $('a5-atype').value; a5Summary.area = ''; redraw(); };
  $('a5-area').onchange = () => { a5Summary.area = $('a5-area').value; redraw(); };
  chartTip('a5-plot', (i) => `<strong>${ACT_MONTHS[i]} ${a5Year}</strong><div class="ch-tip-row"><span>Score</span><b>${months[i].percent}%</b></div><div class="ch-tip-row"><span>ใบตรวจ</span><b>${months[i].audits}</b></div>${months[i].audits ? chartPill(months[i].percent, pass, ' เทียบเกณฑ์', true) : ''}`);
}

async function a5DrawRanking(body, activity) {
  const month = a5Year === new Date().getFullYear() ? Math.min(a5RankMonth, 12) : (a5RankMonth || 12);
  const data = await a5Api(activity, `dashboard/ranking?year=${a5Year}&month=${month}`);
  const groups = data.groups.length ? data.groups : [1, 2, 3, 4, 5];
  const table = (type) => {
    const t = data.types[type] || { rows: [], total: { groups: [], average: 0 } };
    return `<section class="card"><div class="card-title">${esc(type)}</div>
      <div class="table-wrap"><table class="mo-data-table a5-rank"><thead><tr><th>ลำดับ</th><th>ชื่อพื้นที่</th>${groups.map((n) => `<th title="${esc(a5GroupName(activity, n))}">ส${n}</th>`).join('')}<th>เฉลี่ย</th></tr></thead>
      <tbody>${t.rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td>${r.groups.map((v) => `<td>${v.toFixed(1)}</td>`).join('')}<td><strong>${r.average.toFixed(1)}</strong></td></tr>`).join('') || `<tr><td colspan="${groups.length + 3}" class="empty">ยังไม่มีผลตรวจ</td></tr>`}</tbody>
      ${t.rows.length ? `<tfoot><tr><td></td><td>เฉลี่ยรวม (${t.rows.length})</td>${t.total.groups.map((v) => `<td>${v.toFixed(1)}</td>`).join('')}<td>${t.total.average.toFixed(1)}</td></tr></tfoot>` : ''}</table></div></section>`;
  };
  body.innerHTML = `
    <div class="toolbar a5-filters">${field('เดือน', `<select id="a5-rank-month">${options(Array.from({ length: 12 }, (_, i) => i + 1), data.month, (m) => (m === 1 ? 'ม.ค.' : `สะสม ม.ค.–${ACT_MONTHS_SHORT[m - 1]}`))}</select>`)}</div>
    <div class="a5-two">${A5_AREA_TYPES.map(table).join('')}</div>`;
  a5Lift(body);
  $('a5-rank-month').onchange = () => { a5RankMonth = Number($('a5-rank-month').value); a5DrawRanking(body, activity).catch(onErr); };
}

// One circle per area x month x week (shared by the Schedule dashboard and the Setting audit plan).
function a5Dot(year, plan, audit, today) {
  const team = plan?.team || audit?.team || '';
  const color = a5TeamColor(team);
  if (audit) {
    const fixed = audit.issues > 0 && audit.openIssues === 0;
    const title = `${audit.auditNo} · ทีม ${team || '-'} · ${audit.percent}%${audit.issues ? ` · Issue ${audit.issues - audit.openIssues}/${audit.issues} แก้แล้ว` : ''}`;
    return `<span class="a5-dot is-done${fixed ? ' is-fixed' : ''}" style="--team:${color}" title="${esc(title)}"></span>`;
  }
  if (plan) {
    const missed = a5WeekEnd(year, plan.month, plan.week) < today;
    const title = `แผน ทีม ${team}${plan.round ? ` ครั้งที่ ${plan.round}` : ''}${missed ? ' · ไม่ได้ตรวจตามช่วงแผน' : ' · รอตรวจ'}`;
    return `<span class="a5-dot ${missed ? 'is-missed' : 'is-plan'}" style="--team:${color}" title="${esc(title)}">${missed ? '' : esc(team)}</span>`;
  }
  return '<span class="a5-dot"></span>';
}

function a5Grid(year, areas, plans, audits, cell) {
  const head1 = ACT_MONTHS_SHORT.map((m) => `<th colspan="4" class="a5-month">${m}</th>`).join('');
  const head2 = ACT_MONTHS_SHORT.map(() => [1, 2, 3, 4].map((w) => `<th class="a5-wk">${w}</th>`).join('')).join('');
  const rows = areas.map((a) => `<tr><td class="a5-sticky">${esc(a.code)}</td><td class="a5-sticky a5-sticky2">${esc(a.name)}</td>${ACT_MONTHS_SHORT.map((_, mi) => [1, 2, 3, 4].map((w) => {
    const plan = plans.find((p) => p.area_id === a.id && p.month === mi + 1 && p.week === w);
    const audit = audits.find((x) => x.areaId === a.id && x.month === mi + 1 && x.week === w);
    return `<td class="a5-cell" data-cell="${a.id}:${mi + 1}:${w}">${cell(plan, audit)}</td>`;
  }).join('')).join('')}</tr>`).join('');
  return `<div class="a5-sched-wrap"><table class="a5-sched"><thead><tr><th rowspan="2" class="a5-sticky">ID</th><th rowspan="2" class="a5-sticky a5-sticky2">ชื่อพื้นที่</th>${head1}</tr><tr>${head2}</tr></thead><tbody>${rows || `<tr><td colspan="50" class="empty">ยังไม่มีพื้นที่ ${esc(a5AreaType)}</td></tr>`}</tbody></table></div>`;
}

function a5Legend() {
  return `<div class="a5-legend">
    <span><span class="a5-dot is-plan" style="--team:#64748b"></span>มีแผน รอตรวจ (ขอบสีทีม)</span>
    <span><span class="a5-dot is-done" style="--team:#64748b"></span>ตรวจแล้ว (สีทีม)</span>
    <span><span class="a5-dot is-missed"></span>ไม่ได้ตามช่วงแผน</span>
    <span><span class="a5-dot is-done is-fixed"></span>Issue แก้ไขครบ</span>
    <span><span class="a5-dot"></span>ไม่มีแผน</span>
  </div>
  <div class="a5-legend">${A5_TEAMS.map((t) => `<span><span class="a5-dot is-done" style="--team:${a5TeamColor(t)}"></span>ทีม ${t}</span>`).join('')}<span class="sum-meta">W1: 1–7 · W2: 8–14 · W3: 15–21 · W4: 22–สิ้นเดือน</span></div>`;
}

async function a5DrawSchedule(body, activity) {
  const data = await a5Api(activity, `dashboard/schedule?year=${a5Year}&areaType=${encodeURIComponent(a5AreaType)}`);
  const today = new Date();
  body.innerHTML = `<div class="toolbar a5-filters">${a5Seg('data-a5atype', { โรงงาน: 'แผนโรงงาน', สำนักงาน: 'แผนสำนักงาน' }, a5AreaType)}</div>
    ${a5Legend()}
    ${a5Grid(a5Year, data.areas, data.plans, data.audits, (plan, audit) => a5Dot(a5Year, plan, audit, today))}`;
  body.querySelectorAll('[data-a5atype]').forEach((node) => { node.onclick = () => { a5AreaType = node.dataset.a5atype; a5DrawSchedule(body, activity).catch(onErr); }; });
  a5Lift(body);
}

async function a5DrawTeam(body, activity) {
  const data = await a5Api(activity, `team?year=${a5Year}`);
  const active = data.members.filter((m) => m.status === 'Active');
  const person = (m) => `<div class="a5-person">${esc(m.employee_id)} · ${esc(m.name || '-')}<span>${esc(m.department || '')}</span></div>`;
  const admins = active.filter((m) => m.role === 'admin');
  const chairs = active.filter((m) => m.role === 'chairman');
  const teams = A5_TEAMS.filter((t) => active.some((m) => m.team === t)).concat([...new Set(active.filter((m) => m.team && !A5_TEAMS.includes(m.team)).map((m) => m.team))]);
  body.innerHTML = `
    <div class="a5-team-grid a5-team-top">
      <div class="a5-team" style="--team:var(--mo-primary)"><div class="a5-team-head"><span class="a5-badge">A</span>Admin ผู้ดูแลกิจกรรม<span>${admins.length}</span></div>${admins.map(person).join('') || '<div class="a5-person">-</div>'}</div>
      <div class="a5-team" style="--team:#475569"><div class="a5-team-head"><span class="a5-badge">H</span>หัวหน้าทีมตรวจประเมิน<span>${chairs.length}</span></div>${chairs.map(person).join('') || '<div class="a5-person">-</div>'}</div>
    </div>
    <div class="a5-team-grid">${teams.map((t) => {
      const list = active.filter((m) => m.role === 'auditor' && m.team === t);
      return `<div class="a5-team" style="--team:${a5TeamColor(t)}"><div class="a5-team-head"><span class="a5-badge">${esc(t)}</span>ทีม ${esc(t)}<span>${list.length} คน</span></div>${list.map(person).join('')}</div>`;
    }).join('') || '<p class="empty">ยังไม่มีทีมตรวจประเมินปีนี้</p>'}</div>`;
  a5Lift(body);
}

// ---------- Setting ----------

async function a5Setting(target, activity) {
  const me = await a5Api(activity, `me?year=${a5Year}`);
  const admin = me.access.admin;
  target.innerHTML = `<div class="view-body"><section class="card">
    ${pageBar(a5Seg('data-a5set', A5_SET_TABS, a5SetTab), `<div class="a5-year">${a5YearSelect(me.years)}</div>`, 'a5')}
    <div id="a5-body"><div class="empty">กำลังโหลด...</div></div>
  </section></div>`;
  const rerender = () => a5Setting(target, activity).catch(onErr);
  target.querySelectorAll('[data-a5set]').forEach((node) => { node.onclick = () => { a5SetTab = node.dataset.a5set; rerender(); }; });
  if ($('a5-year')) $('a5-year').onchange = () => { a5Year = Number($('a5-year').value); rerender(); };
  const body = $('a5-body');
  if (a5SetTab === 'gantt') return aplRender(body, activity, { inPage: true });
  const draw = { areas: a5SetAreas, team: a5SetTeam, checklist: a5SetChecklist, plan: a5SetPlan }[a5SetTab] || a5SetAreas;
  await draw(body, activity, admin, rerender);
}

// Popup with an employee search; onPick(person) gets { employeeId, name, department }.
function a5EmployeeSearch(activity, onPick, year = a5Year) {
  const run = async () => {
    const data = await a5Api(activity, `employees?year=${year}&q=${encodeURIComponent($('a5-emp-q').value.trim())}`);
    fillTable('a5-emp-list', ['รหัส', 'ชื่อ', 'หน่วยงาน'], data.employees.map((p) => `<tr data-pick="${esc(p.employeeId)}" data-name="${esc(p.name)}" data-dept="${esc(p.department)}"><td>${esc(p.employeeId)}</td><td>${esc(p.name)}</td><td>${esc(p.department)}</td></tr>`).join(''), 'ไม่พบพนักงาน');
    bindRowSelect($('a5-emp-list'), (id, row) => onPick({ employeeId: id, name: row.dataset.name, department: row.dataset.dept }));
  };
  $('a5-emp-search').onclick = () => run().catch(onErr);
  onEnter('a5-emp-q', () => run().catch(onErr));
}

const A5_EMP_FIELDS = searchBlock(searchSlot('ค้นพนักงาน', 'a5-emp-q', 'a5-emp-search', { placeholder: 'รหัส ชื่อ หรือหน่วยงาน' }), 'a5-emp-list');
const a5Heads = { areas: { sort: '', dir: 'asc', filters: {} }, team: { sort: '', dir: 'asc', filters: {} }, check: { sort: '', dir: 'asc', filters: {} } };

async function a5SetAreas(body, activity, admin, rerender) {
  const data = await a5Api(activity, `areas?year=${a5Year}`);
  let picked = null;
  body.innerHTML = `
    ${admin ? `<div class="action-bar a5-actions">${button('a5-add', 'เพิ่มพื้นที่', 'primary')}${button('a5-edit', 'แก้ไข', 'secondary', 'disabled')}${button('a5-owner', 'กำหนดเจ้าของปี ' + a5Year, 'secondary', 'disabled')}${button('a5-del', 'ลบ', 'danger', 'disabled')}</div>` : ''}
    <div class="table-wrap sheet" id="a5-rows"></div>
    <p class="sum-meta">${data.areas.length} พื้นที่ · เจ้าของพื้นที่แยกตามปี (ปี ${a5Year})</p>`;
  const areas = listQuery(data.areas, a5Heads.areas, (a, key) => (key === 'owner' ? (a.owner ? `${a.owner.employeeId} ${a.owner.name}` : '') : a[key] || ''));
  fillTable('a5-rows', [{ label: 'รหัส', key: 'code' }, { label: 'ประเภท', key: 'area_type' }, { label: 'ชื่อพื้นที่', key: 'name' }, { label: 'Section', key: 'section' }, { label: `เจ้าของปี ${a5Year}`, key: 'owner' }, { label: 'สถานะ', key: 'status' }], areas.map((a) => `<tr data-pick="${a.id}"><td>${esc(a.code)}</td><td>${esc(a.area_type)}</td><td>${esc(a.name)}</td><td>${esc(a.section || '')}</td><td>${a.owner ? `${esc(a.owner.employeeId)} · ${esc(a.owner.name)}` : '<span class="sum-meta">ยังไม่กำหนด</span>'}</td><td>${esc(a.status)}</td></tr>`).join(''), 'ยังไม่มีพื้นที่', headFor(a5Heads.areas, () => a5SetAreas(body, activity, admin, rerender).catch(onErr)));
  a5Lift(body);
  if (!admin) return;
  bindRowSelect($('a5-rows'), (id) => {
    picked = data.areas.find((a) => String(a.id) === id);
    ['a5-edit', 'a5-owner', 'a5-del'].forEach((b) => { $(b).disabled = !picked; });
  });
  const form = (area) => openPopup(area ? `แก้ไขพื้นที่ ${esc(area.code)}` : 'เพิ่มพื้นที่', [
    field('รหัสพื้นที่', `<input id="a5-code" maxlength="20" value="${esc(area?.code || '')}" placeholder="เช่น A20">`),
    field('ประเภท', `<select id="a5-atype-f">${options(A5_AREA_TYPES, area?.area_type || a5AreaType)}</select>`),
    field('ชื่อพื้นที่', `<input id="a5-name" maxlength="120" value="${esc(area?.name || '')}">`),
    field('Section', `<input id="a5-section" maxlength="120" value="${esc(area?.section || '')}">`),
    field('สถานะ', `<select id="a5-status">${options(['Active', 'Inactive'], area?.status || 'Active')}</select>`)
  ].join(''), async () => {
    const payload = { year: a5Year, code: $('a5-code').value, areaType: $('a5-atype-f').value, name: $('a5-name').value, section: $('a5-section').value, status: $('a5-status').value };
    await a5Api(activity, area ? `areas/${area.id}` : 'areas', { method: area ? 'PATCH' : 'POST', body: payload });
    toast('บันทึกแล้ว');
    closePopup();
    rerender();
  });
  $('a5-add').onclick = () => form(null);
  $('a5-edit').onclick = () => picked && form(picked);
  $('a5-del').onclick = () => picked && confirmPopup('ลบพื้นที่', `ตรวจ ${esc(picked.code)} ${esc(picked.name)} อีกครั้งก่อนลบ (ถ้ามีผลตรวจแล้วจะเปลี่ยนเป็น Inactive แทน)`, async () => {
    const r = await a5Api(activity, `areas/${picked.id}?year=${a5Year}`, { method: 'DELETE' });
    toast(r.inactive ? 'มีผลตรวจแล้ว จึงเปลี่ยนเป็น Inactive' : 'ลบแล้ว');
    rerender();
  });
  $('a5-owner').onclick = () => {
    if (!picked) return;
    let chosen = picked.owner ? { employeeId: picked.owner.employeeId, name: picked.owner.name } : null;
    openPopup(`เจ้าของพื้นที่ ${esc(picked.code)} ปี ${a5Year}`, `${A5_EMP_FIELDS}${field('เจ้าของที่เลือก', `<input id="a5-owner-pick" readonly value="${esc(chosen ? `${chosen.employeeId} · ${chosen.name}` : '')}" placeholder="เลือกจากรายชื่อ (เว้นว่าง = ไม่มีเจ้าของ)">`)}${button('a5-owner-clear', 'ล้าง')}`, async () => {
      await a5Api(activity, `areas/${picked.id}/owner`, { method: 'PUT', body: { year: a5Year, employeeId: chosen?.employeeId || '' } });
      toast('บันทึกแล้ว');
      closePopup();
      rerender();
    });
    a5EmployeeSearch(activity, (p) => { chosen = p; $('a5-owner-pick').value = `${p.employeeId} · ${p.name}`; });
    $('a5-owner-clear').onclick = () => { chosen = null; $('a5-owner-pick').value = ''; };
  };
}

// roles: { role: label } this activity uses (5S: admin / chairman / auditor + team · CFO: + vice / member + department).
async function a5SetTeam(body, activity, admin, rerender, roles = A5_ROLE_LABEL) {
  const data = await a5Api(activity, `team?year=${a5Year}`);
  let picked = null;
  const keys = Object.keys(roles);
  const hasTeam = keys.includes('auditor');
  const rows = listQuery([...data.members].sort((a, b) => keys.indexOf(a.role) - keys.indexOf(b.role) || String(a.team || '').localeCompare(String(b.team || '')) || String(a.employee_id).localeCompare(String(b.employee_id))), a5Heads.team, (m, key) => (key === 'role' ? roles[m.role] || m.role : m[key] || ''));
  body.innerHTML = `
    ${admin ? `<div class="action-bar a5-actions">${button('a5-add', 'เพิ่มรายชื่อ', 'primary')}${button('a5-del', 'ลบ', 'danger', 'disabled')}${button('a5-copy', `คัดลอกจากปี ${a5Year - 1}`)}</div>` : ''}
    <div class="table-wrap sheet" id="a5-rows"></div>
    <p class="sum-meta">${rows.length} รายชื่อ</p>`;
  const teamCell = (m) => (hasTeam ? `<td>${m.team ? `<span class="a5-dot is-done" style="--team:${a5TeamColor(m.team)}"></span> ${esc(m.team)}` : ''}</td>` : '');
  fillTable('a5-rows', [{ label: 'บทบาท', key: 'role' }, ...(hasTeam ? [{ label: 'ทีม', key: 'team' }] : []), { label: 'รหัส', key: 'employee_id' }, { label: 'ชื่อ', key: 'name' }, { label: 'หน่วยงาน', key: 'department' }, { label: 'สถานะ', key: 'status' }], rows.map((m) => `<tr data-pick="${m.id}"><td>${esc(roles[m.role] || m.role)}</td>${teamCell(m)}<td>${esc(m.employee_id)}</td><td>${esc(m.name)}</td><td>${esc(m.department)}</td><td>${esc(m.status)}</td></tr>`).join(''), `ยังไม่มีทีมปี ${a5Year}`, headFor(a5Heads.team, () => a5SetTeam(body, activity, admin, rerender, roles).catch(onErr)));
  a5Lift(body);
  if (!admin) return;
  bindRowSelect($('a5-rows'), (id) => { picked = rows.find((m) => String(m.id) === id); $('a5-del').disabled = !picked; });
  $('a5-add').onclick = () => {
    let chosen = null;
    openPopup(`เพิ่มรายชื่อปี ${a5Year}`, `${A5_EMP_FIELDS}${field('พนักงานที่เลือก', '<input id="a5-team-pick" readonly placeholder="เลือกจากรายชื่อ">')}
      ${field('บทบาท', `<select id="a5-role">${options(keys, keys.at(-1), (v) => roles[v])}</select>`)}
      ${hasTeam ? field('ทีม (เฉพาะผู้ตรวจ)', `<select id="a5-team">${options(A5_TEAMS, 'A')}</select>`, '') : ''}
      ${keys.includes('member') ? field('หน่วยงาน (เฉพาะตัวแทนหน่วยงาน)', '<input id="a5-dept" maxlength="80" placeholder="เช่น PD1">') : ''}`, async () => {
      if (!chosen) throw new Error('เลือกพนักงานจากรายชื่อก่อน');
      await a5Api(activity, 'team', { method: 'POST', body: { year: a5Year, employeeId: chosen.employeeId, role: $('a5-role').value, team: $('a5-team')?.value, department: $('a5-dept')?.value.trim() } });
      toast('เพิ่มแล้ว');
      closePopup();
      rerender();
    });
    a5EmployeeSearch(activity, (p) => { chosen = p; $('a5-team-pick').value = `${p.employeeId} · ${p.name}`; });
    const syncTeam = () => {
      if ($('a5-team')) $('a5-team').disabled = $('a5-role').value !== 'auditor';
      if ($('a5-dept')) $('a5-dept').disabled = $('a5-role').value !== 'member';
    };
    $('a5-role').onchange = syncTeam;
    syncTeam();
  };
  $('a5-del').onclick = () => picked && confirmPopup('ลบรายชื่อ', `ตรวจ ${esc(picked.employee_id)} ${esc(picked.name)} (${esc(roles[picked.role] || picked.role)}) อีกครั้งก่อนลบ`, async () => {
    await a5Api(activity, `team/${picked.id}`, { method: 'DELETE' });
    toast('ลบแล้ว');
    rerender();
  });
  $('a5-copy').onclick = () => confirmPopup('คัดลอกทีม', `คัดลอกรายชื่อทีมปี ${a5Year - 1} มาเป็นปี ${a5Year} (รายชื่อที่มีอยู่แล้วจะไม่ซ้ำ)`, async () => {
    const r = await a5Api(activity, 'team/copy', { method: 'POST', body: { from: a5Year - 1, to: a5Year } });
    toast(`คัดลอก ${r.copied} รายชื่อ`);
    rerender();
  }, 'คัดลอก');
}

async function a5SetChecklist(body, activity, admin, rerender) {
  const data = await a5Api(activity, `checklist?year=${a5Year}`);
  let picked = null;
  const total = data.items.filter((i) => i.status === 'Active').reduce((s, i) => s + Number(i.score_max), 0);
  body.innerHTML = `
    ${admin ? `<div class="action-bar a5-actions">${button('a5-add', 'เพิ่มหัวข้อ', 'primary')}${button('a5-edit', 'แก้ไข', 'secondary', 'disabled')}${button('a5-del', 'ลบ', 'danger', 'disabled')}${button('a5-copy', `คัดลอกจากปี ${a5Year - 1}`)}</div>` : ''}
    <div class="table-wrap sheet" id="a5-rows"></div>
    <p class="sum-meta">${data.items.length} ข้อ · คะแนนเต็มรวม ${total} · หัวข้อแยกตามปี แก้ปีนี้ไม่กระทบผลตรวจปีก่อน</p>`;
  const items = listQuery(data.items, a5Heads.check, (i, key) => (key === 's_group' ? a5GroupName(activity, i.s_group) : i[key]));
  fillTable('a5-rows', [{ label: 'ข้อที่', key: 'item_no' }, { label: 'หมวด', key: 's_group' }, { label: 'หัวข้อตรวจ', key: 'title' }, { label: 'คะแนนเต็ม', key: 'score_max' }, { label: 'สถานะ', key: 'status' }], items.map((i) => `<tr data-pick="${i.id}"><td>${i.item_no}</td><td>${esc(a5GroupName(activity, i.s_group))}</td><td>${esc(i.title)}</td><td>${i.score_max}</td><td>${esc(i.status)}</td></tr>`).join(''), `ยังไม่มีหัวข้อปี ${a5Year}`, headFor(a5Heads.check, () => a5SetChecklist(body, activity, admin, rerender).catch(onErr)));
  a5Lift(body);
  if (!admin) return;
  bindRowSelect($('a5-rows'), (id) => { picked = data.items.find((i) => String(i.id) === id); $('a5-edit').disabled = !picked; $('a5-del').disabled = !picked; });
  const groupCount = Math.max(5, (A5_GROUPS[activity] || []).length);
  const form = (item) => openPopup(item ? `แก้ไขข้อที่ ${item.item_no}` : `เพิ่มหัวข้อปี ${a5Year}`, [
    field('ข้อที่', `<input id="a5-no" type="number" min="1" max="200" value="${item?.item_no || (data.items.length + 1)}">`),
    field('หมวด', `<select id="a5-group">${options(Array.from({ length: groupCount }, (_, i) => i + 1), item?.s_group || 1, (n) => a5GroupName(activity, n))}</select>`),
    field('หัวข้อตรวจ', `<textarea id="a5-title" rows="2" maxlength="300">${esc(item?.title || '')}</textarea>`),
    field('คะแนนเต็ม', `<input id="a5-max" type="number" min="1" max="100" value="${item?.score_max || 5}">`),
    field('สถานะ', `<select id="a5-status">${options(['Active', 'Inactive'], item?.status || 'Active')}</select>`)
  ].join(''), async () => {
    const payload = { year: a5Year, itemNo: Number($('a5-no').value), sGroup: Number($('a5-group').value), title: $('a5-title').value, scoreMax: Number($('a5-max').value), status: $('a5-status').value };
    await a5Api(activity, item ? `checklist/${item.id}` : 'checklist', { method: item ? 'PATCH' : 'POST', body: payload });
    toast('บันทึกแล้ว');
    closePopup();
    rerender();
  });
  $('a5-add').onclick = () => form(null);
  $('a5-edit').onclick = () => picked && form(picked);
  $('a5-del').onclick = () => picked && confirmPopup('ลบหัวข้อ', `ตรวจข้อที่ ${picked.item_no} อีกครั้งก่อนลบ (ถ้ามีคะแนนแล้วจะเปลี่ยนเป็น Inactive แทน)`, async () => {
    const r = await a5Api(activity, `checklist/${picked.id}`, { method: 'DELETE' });
    toast(r.inactive ? 'มีคะแนนแล้ว จึงเปลี่ยนเป็น Inactive' : 'ลบแล้ว');
    rerender();
  });
  $('a5-copy').onclick = () => confirmPopup('คัดลอกหัวข้อ', `คัดลอกหัวข้อปี ${a5Year - 1} มาเป็นปี ${a5Year} (ข้อที่มีอยู่แล้วจะไม่ถูกทับ)`, async () => {
    const r = await a5Api(activity, 'checklist/copy', { method: 'POST', body: { from: a5Year - 1, to: a5Year } });
    toast(`คัดลอก ${r.copied} ข้อ`);
    rerender();
  }, 'คัดลอก');
}

async function a5SetPlan(body, activity, admin) {
  const [areas, plan] = await Promise.all([a5Api(activity, `areas?year=${a5Year}`), a5Api(activity, `audit-plan?year=${a5Year}`)]);
  const list = areas.areas.filter((a) => a.area_type === a5AreaType && (a.status === 'Active' || plan.plans.some((p) => p.area_id === a.id)));
  const today = new Date();
  body.innerHTML = `<div class="toolbar a5-filters">${a5Seg('data-a5atype', { โรงงาน: 'แผนโรงงาน', สำนักงาน: 'แผนสำนักงาน' }, a5AreaType)}</div>
    ${a5Legend()}
    ${a5Grid(a5Year, list, plan.plans, [], (p) => a5Dot(a5Year, p, null, today))}`;
  const redraw = () => a5SetPlan(body, activity, admin).catch(onErr);
  body.querySelectorAll('[data-a5atype]').forEach((node) => { node.onclick = () => { a5AreaType = node.dataset.a5atype; redraw(); }; });
  a5Lift(body);
  if (!admin) return;
  body.querySelectorAll('[data-cell]').forEach((node) => {
    node.classList.add('is-editable');
    node.onclick = () => {
      const [areaId, month, week] = node.dataset.cell.split(':').map(Number);
      const area = list.find((a) => a.id === areaId);
      const current = plan.plans.find((p) => p.area_id === areaId && p.month === month && p.week === week);
      openPopup(`${esc(area.code)} ${esc(area.name)} · ${ACT_MONTHS[month - 1]} W${week}`, [
        field('ทีมที่ตรวจ', `<select id="a5-plan-team">${options(['', ...A5_TEAMS], current?.team || '', (t) => (t ? `ทีม ${t}` : 'ไม่มีแผน (ลบช่องนี้)'))}</select>`),
        field('ครั้งที่', `<select id="a5-plan-round">${options(['', 1, 2, 3, 4, 5, 6], current?.round || '', (r) => (r ? `ครั้งที่ ${r}` : '-'))}</select>`)
      ].join(''), async () => {
        await a5Api(activity, 'audit-plan', { method: 'PUT', body: { year: a5Year, areaId, month, week, team: $('a5-plan-team').value, round: $('a5-plan-round').value || null } });
        toast('บันทึกแล้ว');
        closePopup();
        redraw();
      });
    };
  });
}

for (const id of A5_ON) {
  VIEWS[`${id}-home`] = (target) => a5Dashboard(target, id);
  VIEWS[`${id}-setting`] = (target) => a5Setting(target, id);
}
