// ระบบกิจกรรม > QCC: Dashboard (Summary / Schedule / Team), Transaction (โครงการกลุ่ม QCC: ข้อมูลกลุ่ม + 10 ฟอร์ม FM-QMR-022…031
// เลือกด้วย dropdown), Setting (แผนงาน = Planner, ทีมคณะกรรมการ).
// Server: server/modules/act/qcc.js · spec: docs/specs/act-qcc.md · uses a5Year (act-5s.js) and kzPhoto169 / .kz-photo (act-kaizen.js).
const QC = 'qcc';
const QC_ROLE_LABEL = { ...ACT_TEAM_ROLES };
const QC_DASH_TABS = { summary: 'Summary', schedule: 'Schedule', team: 'Team' };
const QC_SET_TABS = { team: 'ทีม', plan: 'แผนงาน' };
const QC_STATUS = { DRAFT: ['ร่าง', ''], SUBMITTED: ['รอพิจารณา', 'badge-warning'], APPROVED: ['อนุมัติ', 'badge-success'], REJECTED: ['ไม่ผ่าน', 'badge-danger'] };
const QC_FORMS = [
  ['022', 'ใบรายงานแผนดำเนินกิจกรรม QCC'],
  ['023', 'ใบรายงานการพิจารณาหัวข้อปัญหามาทำกิจกรรม'],
  ['024', 'ใบรายงานสำรวจสภาพปัญหาปัจจุบัน'],
  ['025', 'ตารางจัดลำดับความสำคัญของปัญหา (พาเรโต้)'],
  ['026', 'ใบรายงานการวิเคราะห์ปัญหา (ผังก้างปลา)'],
  ['027', 'ใบรายงานการแก้ไขปัญหา'],
  ['028', 'ใบสรุปผลการแก้ไขปัญหา (ก่อน - หลัง)'],
  ['029', 'ใบกำหนดมาตรฐานการทำงาน'],
  ['030', 'สรุปผลที่ได้ของกิจกรรมกลุ่ม QCC'],
  ['031', 'สรุปผลจากการทำกิจกรรม QCC']
];
// FM-QMR-022: 11 steps grouped Plan / Do / Check / Act.
const QC_STEPS = [['Plan', '1. กำหนดหัวข้อเรื่อง'], ['Plan', '2. สำรวจสภาพปัจจุบัน'], ['Plan', '3. วางแผนการดำเนินงาน'], ['Plan', '4. จัดตั้งเป้าหมาย'],
  ['Do', '5. วิเคราะห์สาเหตุ และกำหนดวิธีการ'], ['Do', '6. ดำเนินการแก้ไข'], ['Check', '7. ตรวจสอบผลการแก้ไข'],
  ['Act', '8. ติดตามการแก้ไข'], ['Act', '9. สรุปผลดำเนินการแก้ไข'], ['Act', '10. สรุปจัดตั้งมาตรฐาน'], ['Act', '11. จัดทำรายงาน']];
// FM-QMR-023: criteria for choosing a topic, and the 1–3 scales.
const QC_CRITERIA = ['เป็นงานที่สมาชิกกลุ่มรับผิดชอบอยู่', 'เกี่ยวกับการสูญเสียเวลา', 'เป็นปัญหาด้านคุณภาพ', 'ผลผลิตต่ำ', 'ต้องอาศัยความร่วมมือจากบุคคลภายนอก', 'สมาชิกกลุ่มแก้ไขปัญหาได้เอง', 'อื่นๆ'];
const QC_FISH = [['man', 'คน (Man)'], ['machine', 'เครื่องจักร (Machine)'], ['method', 'วิธีการ (Method)'], ['material', 'วัตถุดิบ (Material)'], ['environment', 'สภาพแวดล้อม (Environment)']];
let qcDashTab = 'summary';
let qcSetTab = 'team';
let qcFormCode = '022';
const qcFilter = { status: '', q: '' };
const qcHead = { sort: '', dir: 'asc', filters: {} };

const qcNum = (n, digits = 2) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: digits });
const qcMoney = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qcBadge = (s) => `<span class="badge ${QC_STATUS[s]?.[1] || ''}">${QC_STATUS[s]?.[0] || esc(s)}</span>`;
const qcScore = (r) => (Number(r.freq) || 0) * (Number(r.severity) || 0) * (Number(r.feasible) || 0);
const qcMonth = (v) => String(v || '').slice(0, 7);
const qcPeriod = (r) => (r.start_month ? `${qcMonthName(r.start_month)} – ${qcMonthName(r.end_month || r.start_month)}` : '-');
function qcMonthName(v) {
  const [y, m] = String(v || '').split('-').map(Number);
  return y && m ? `${ACT_MONTHS_SHORT[m - 1]} ${y}` : '';
}
// Months of the project period as [year, month] (1–12 months; the whole year when not set).
function qcMonths(start, end, year) {
  const [ys, ms] = (qcMonth(start) || `${year}-01`).split('-').map(Number);
  const [ye, me] = (qcMonth(end) || qcMonth(start) || `${year}-12`).split('-').map(Number);
  const n = Math.max(1, Math.min(12, (ye - ys) * 12 + (me - ms) + 1));
  return Array.from({ length: n }, (_, i) => [ys + Math.floor((ms - 1 + i) / 12), ((ms - 1 + i) % 12) + 1]);
}
// FM-QMR-025 from 024: items by size, cumulative and percent.
function qcPareto(items) {
  const sorted = [...(items || [])].filter((r) => Number(r.value) > 0).sort((a, b) => b.value - a.value);
  const total = sorted.reduce((t, r) => t + Number(r.value), 0);
  let run = 0;
  return sorted.map((r) => { run += Number(r.value); return { ...r, cum: run, pct: total ? (r.value / total) * 100 : 0, cumPct: total ? (run / total) * 100 : 0 }; });
}
const qcCost = (forms) => (forms?.['030']?.costs || []).reduce((t, r) => t + (Number(r.labor) || 0) + (Number(r.other) || 0), 0);
const qcProgress = (forms) => Math.round(((forms?.['022']?.steps || []).filter((s) => s.actual?.length).length / QC_STEPS.length) * 100);

async function qcFrame(target, tabs, attr, active) {
  const me = await a5Api(QC, `me?year=${a5Year}`);
  target.innerHTML = `<div class="view-body"><section class="card">
    ${pageBar(tabs ? a5Seg(attr, tabs, active) : '', `<div class="a5-year">${a5YearSelect(me.years)}</div>`, 'a5')}
    <div id="a5-body"><div class="empty">กำลังโหลด...</div></div>
  </section></div>`;
  return { me, body: $('a5-body') };
}

// ---------- Dashboard ----------

async function qcDashboard(target) {
  const { me, body } = await qcFrame(target, QC_DASH_TABS, 'data-qcdash', qcDashTab);
  const rerender = () => qcDashboard(target).catch(onErr);
  target.querySelectorAll('[data-qcdash]').forEach((node) => { node.onclick = () => { qcDashTab = node.dataset.qcdash; rerender(); }; });
  $('a5-year').onchange = () => { a5Year = Number($('a5-year').value); rerender(); };
  if (qcDashTab === 'schedule') return aplRender(body, QC, { inPage: true, readOnly: true });
  if (qcDashTab === 'team') return qcDrawTeam(body, me.access.admin);
  return qcDrawSummary(body);
}

// Summary: groups of the year, sent / approved, cost and return; progress of each group (PDCA steps done).
async function qcDrawSummary(body) {
  const d = await a5Api(QC, `qcc/list?year=${a5Year}`);
  const sent = d.rows.filter((r) => r.status !== 'DRAFT');
  const approved = d.rows.filter((r) => r.status === 'APPROVED');
  const cost = d.rows.reduce((t, r) => t + Number(r.cost_total || 0), 0);
  const perMonth = d.rows.reduce((t, r) => t + Number(r.return_month || 0), 0);
  const shown = d.rows.slice(0, 12);
  const chart = shown.length ? chartPlot({
    id: 'qc-plot', labels: shown.map((r) => r.group_name), left: 'ความคืบหน้า (%)', leftMax: 100,
    bars: [{ values: shown.map((r) => r.progress), colors: [CHART.series[0]], unit: '%', inner: shown.map((r) => (r.progress ? `${Math.round((r.progress * QC_STEPS.length) / 100)}/${QC_STEPS.length} ขั้น` : '')) }],
    legend: [{ box: CHART.series[0], label: 'ขั้นตอนที่ดำเนินการแล้ว (จาก 11 ขั้น FM-QMR-022)' }]
  }) : '<p class="empty">ยังไม่มีกลุ่ม QCC ปีนี้</p>';
  body.innerHTML = `
    <div class="ch-kpis">
      ${chartKpi({ icon: 'groups', label: 'กลุ่ม QCC', value: qcNum(d.rows.length, 0), unit: 'กลุ่ม', note: `ส่งแล้ว ${qcNum(sent.length, 0)} · ร่าง ${qcNum(d.rows.length - sent.length, 0)}` })}
      ${chartKpi({ icon: 'verified', label: 'อนุมัติแล้ว', value: qcNum(approved.length, 0), unit: 'เรื่อง', note: `รอพิจารณา ${qcNum(d.rows.filter((r) => r.status === 'SUBMITTED').length, 0)} เรื่อง` })}
      ${chartKpi({ icon: 'payments', label: 'ค่าใช้จ่ายในการทำกิจกรรม', value: qcMoney(cost), unit: 'บาท', note: 'ค่าแรง + อื่นๆ (FM-QMR-030)' })}
      ${chartKpi({ icon: 'savings', label: 'ผลที่คิดเป็นเงินได้', value: qcMoney(perMonth), unit: 'บาท/เดือน', note: `ปีละ ${qcMoney(perMonth * 12)} บาท` })}
    </div>
    ${chartCard('ความคืบหน้าแต่ละกลุ่ม', chart, 'ตามแผนดำเนินกิจกรรม')}
    ${chartCard('กลุ่ม QCC ปีนี้', `<div class="table-wrap"><table class="mo-data-table"><thead><tr><th>เลขทะเบียน</th><th>ชื่อกลุ่ม</th><th>ฝ่าย</th><th>เรื่อง</th><th>หัวหน้ากลุ่ม</th><th>ระยะเวลา</th><th class="num">คืบหน้า (%)</th><th class="num">ค่าใช้จ่าย (บาท)</th><th class="num">ผลตอบแทน (บาท/เดือน)</th><th>สถานะ</th></tr></thead>
      <tbody>${d.rows.map((r) => `<tr><td>${esc(r.reg_no || '-')}</td><td>${esc(r.group_name)}</td><td>${esc(r.department || '')}</td><td>${esc(r.topic)}</td><td>${esc(r.leader_name || r.leader_id)}</td><td>${esc(qcPeriod(r))}</td>
        <td class="num">${qcNum(r.progress, 0)}</td><td class="num">${qcMoney(r.cost_total)}</td><td class="num">${qcMoney(r.return_month)}</td><td>${qcBadge(r.status)}</td></tr>`).join('') || '<tr><td colspan="10" class="empty">ยังไม่มีกลุ่ม QCC ปีนี้</td></tr>'}</tbody></table></div>`)}`;
  if (shown.length) chartTip('qc-plot', (i) => `<strong>${esc(shown[i].group_name)}</strong><div class="ch-tip-row"><span>เรื่อง</span><b>${esc(shown[i].topic)}</b></div><div class="ch-tip-row"><span>คืบหน้า</span><b>${shown[i].progress}%</b></div>`);
}

async function qcDrawTeam(body, admin) {
  const data = await a5Api(QC, `team?year=${a5Year}`);
  const active = data.members.filter((m) => m.status === 'Active');
  const person = (m) => `<div class="a5-person">${esc(m.employee_id)} · ${esc(m.name || '-')}<span>${esc(m.department || '')}</span></div>`;
  body.innerHTML = `
    ${admin ? `<div class="action-bar a5-actions">${button('qc-team-edit', 'แก้ไขทีม')}</div>` : ''}
    <div class="a5-team-grid">${Object.entries(QC_ROLE_LABEL).map(([role, label], i) => {
      const list = active.filter((m) => m.role === role);
      return `<div class="a5-team" style="--team:${CHART.series[i]}"><div class="a5-team-head">${esc(label)}<span>${list.length} คน</span></div>${list.map(person).join('') || '<div class="a5-person">-</div>'}</div>`;
    }).join('')}</div>
    <p class="sum-meta">คณะกรรมการ QCC (ประธาน รองประธาน ผู้ดูแล) อนุมัติโครงการ · หัวหน้ากลุ่มและผู้จัดการต้นสังกัดระบุในแต่ละโครงการ</p>`;
  a5Lift(body);
  if (admin) $('qc-team-edit').onclick = () => { qcSetTab = 'team'; openView(`${QC}-setting`); };
}

// ---------- Transaction: projects ----------

async function qcProjects(target) {
  const { body } = await qcFrame(target, null, '', '');
  const rerender = () => qcProjects(target).catch(onErr);
  $('a5-year').onchange = () => { a5Year = Number($('a5-year').value); rerender(); };
  const d = await a5Api(QC, `qcc/list?year=${a5Year}`);
  let picked = null;
  const draw = () => {
    const term = qcFilter.q.trim().toLowerCase();
    const list = listQuery(d.rows.filter((r) => (!qcFilter.status || r.status === qcFilter.status)
      && (!term || `${r.reg_no} ${r.group_name} ${r.topic} ${r.department} ${r.leader_name}`.toLowerCase().includes(term))), qcHead, (r, key) => r[key] ?? '');
    fillTable('qc-rows', [{ label: 'เลขทะเบียน', key: 'reg_no' }, { label: 'ชื่อกลุ่ม', key: 'group_name' }, { label: 'ฝ่าย', key: 'department' }, { label: 'เรื่อง', key: 'topic' }, { label: 'หัวหน้ากลุ่ม', key: 'leader_name' },
      { label: 'ระยะเวลา', key: 'start_month' }, { label: 'คืบหน้า (%)', key: 'progress', num: true }, { label: 'ค่าใช้จ่าย (บาท)', key: 'cost_total', num: true }, { label: 'สถานะ', key: 'status' }],
    list.map((r) => `<tr data-pick="${r.id}"><td>${esc(r.reg_no || '')}</td><td>${esc(r.group_name)}</td><td>${esc(r.department || '')}</td><td>${esc(r.topic)}</td><td>${esc(r.leader_name || r.leader_id)}</td><td>${esc(qcPeriod(r))}</td>
      <td class="num">${qcNum(r.progress, 0)}</td><td class="num">${qcMoney(r.cost_total)}</td><td>${qcBadge(r.status)}</td></tr>`).join(''), 'ยังไม่มีโครงการ QCC ปีนี้', headFor(qcHead, draw));
    bindRowSelect($('qc-rows'), (id) => {
      picked = d.rows.find((r) => String(r.id) === id);
      $('qc-open').disabled = !picked;
      $('qc-del').disabled = !(picked && (d.admin || (picked.mine && picked.status === 'DRAFT')));
      if ($('qc-review')) $('qc-review').disabled = !(picked && picked.status !== 'DRAFT');
    });
    $('qc-rows').querySelectorAll('tr[data-pick]').forEach((tr) => { tr.ondblclick = () => qcProject(body, d, d.rows.find((r) => String(r.id) === tr.dataset.pick), rerender); });
  };
  body.innerHTML = `
    <div class="toolbar a5-filters">
      ${field('สถานะ', `<select id="qc-f-status">${options(['', ...Object.keys(QC_STATUS)], qcFilter.status, (v) => (v ? QC_STATUS[v][0] : 'ทั้งหมด'))}</select>`)}
      ${searchSlot('ค้นหา', 'qc-f-q', 'qc-f-search', { placeholder: 'เลขทะเบียน ชื่อกลุ่ม เรื่อง หรือฝ่าย' })}
      <div class="action-bar">${d.reviewer ? button('qc-review', 'พิจารณา', 'secondary', 'disabled') : ''}${button('qc-open', 'เปิด', 'secondary', 'disabled')}${button('qc-add', 'สร้างโครงการ', 'primary')}${button('qc-del', 'ลบ', 'danger', 'disabled')}</div>
    </div>
    <div class="table-wrap sheet" id="qc-rows"></div>
    <p class="sum-meta">${qcNum(d.rows.length, 0)} โครงการ · 1 โครงการ = 1 กลุ่ม 1 เรื่อง พร้อมฟอร์ม FM-QMR-022 ถึง 031 · หัวหน้ากลุ่มกรอกและส่ง คณะกรรมการ QCC พิจารณา</p>`;
  $('qc-f-q').value = qcFilter.q;
  draw();
  a5Lift(body);
  $('qc-f-status').onchange = () => { qcFilter.status = $('qc-f-status').value; draw(); };
  const search = () => { qcFilter.q = $('qc-f-q').value; draw(); };
  $('qc-f-search').onclick = search;
  onEnter('qc-f-q', search);
  $('qc-add').onclick = () => qcProject(body, d, null, rerender);
  $('qc-open').onclick = () => picked && qcProject(body, d, picked, rerender);
  $('qc-del').onclick = () => picked && confirmPopup('ลบโครงการ QCC', `ลบ ${esc(picked.group_name)} · ${esc(picked.topic)}`, async () => {
    await a5Api(QC, `qcc/${picked.id}`, { method: 'DELETE' });
    toast('ลบแล้ว');
    rerender();
  });
  if ($('qc-review')) $('qc-review').onclick = () => picked && qcReview(picked, rerender);
}

function qcReview(row, reload) {
  openPopup(`พิจารณา QCC · ${esc(row.group_name)}`, `
    <p class="sum-meta">${esc(row.topic)} · หัวหน้ากลุ่ม ${esc(row.leader_name || row.leader_id)}</p>
    ${field('ผลการพิจารณา', `<select id="qc-r-status">${options(['APPROVED', 'REJECTED'], row.status === 'REJECTED' ? 'REJECTED' : 'APPROVED', (v) => QC_STATUS[v][0])}</select>`)}
    ${field('ความเห็นคณะกรรมการ QCC', `<textarea id="qc-r-note" rows="3" maxlength="1000">${esc(row.review_note || '')}</textarea>`)}`, async () => {
    await a5Api(QC, `qcc/${row.id}/status`, { method: 'POST', body: { status: $('qc-r-status').value, note: $('qc-r-note').value } });
    toast('บันทึกผลพิจารณาแล้ว');
    closePopup();
    reload();
  }, 'บันทึก');
}

// Read / write a value in the forms state by a dotted path ("023.rows.2.freq").
function qcGet(obj, path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function qcSet(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  keys.slice(0, -1).forEach((k, i) => {
    if (o[k] == null) o[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    o = o[k];
  });
  o[keys.at(-1)] = value;
}

// The project page: group details on top, one form at a time picked from the dropdown, one save for everything.
function qcProject(body, d, row, reload) {
  const editable = !row || row.canEdit;
  const off = editable ? '' : ' disabled';
  const st = JSON.parse(JSON.stringify(row?.forms || {}));
  const photos = {};
  const urls = { ...(row?.photos || {}) };
  let leader = row ? { employeeId: row.leader_id, name: row.leader_name } : { employeeId: d.me, name: 'ตัวคุณเอง' };
  let manager = row?.manager_id ? { employeeId: row.manager_id, name: row.manager_name } : null;
  const i = (path, attrs = '') => `<input data-k="${path}" value="${esc(qcGet(st, path) ?? '')}"${attrs}${off}>`;
  const n = (path) => `<input data-k="${path}" data-num type="number" min="0" step="0.01" value="${esc(qcGet(st, path) ?? '')}"${off}>`;
  const ta = (path, rows = 3) => `<textarea data-k="${path}" rows="${rows}" maxlength="2000"${off}>${esc(qcGet(st, path) ?? '')}</textarea>`;
  const del = (path) => (editable ? `<button type="button" class="icon-btn" data-del="${path}" aria-label="ลบแถว"><span class="material-symbols-rounded">delete</span></button>` : '');
  const add = (path, label) => (editable ? `<button type="button" class="btn btn-secondary" data-add="${path}">${label}</button>` : '');
  const photo = (slot, label) => `<label class="kz-photo${editable ? '' : ' is-locked'}" for="qc-ph-${slot}" id="qc-ph-${slot}-box">${urls[slot] ? `<img src="${esc(urls[slot])}" alt="">` : `<span class="material-symbols-rounded">add_photo_alternate</span><small>${label}</small>`}</label>
    <input id="qc-ph-${slot}" data-photo="${slot}" type="file" accept="image/*" hidden${off}>`;
  const months = () => qcMonths($('qc-start')?.value || row?.start_month, $('qc-end')?.value || row?.end_month, a5Year);

  const FORMS = {
    '022': () => {
      const ms = months();
      const cell = (s, kind, w) => `<button type="button" class="qc-wk${(qcGet(st, `022.steps.${s}.${kind}`) || []).includes(w) ? ` is-${kind}` : ''}" data-week="022.steps.${s}.${kind}" data-w="${w}"${off}></button>`;
      return `<div class="qc-grid2">${field('เป้าหมายของกิจกรรม (ระบุเป็นตัวเลข เช่น %, ระยะเวลา)', ta('022.goal', 2))}${field('เหตุผล / ปัญหาที่พบ', ta('022.reason', 2))}</div>
        <div class="table-wrap qc-gantt"><table><thead><tr><th rowspan="2">ขั้นตอน</th><th rowspan="2"></th>${ms.map(([y, m]) => `<th colspan="4" class="qc-c">${ACT_MONTHS_SHORT[m - 1]} ${String(y).slice(2)}</th>`).join('')}</tr>
          <tr>${ms.map(() => [1, 2, 3, 4].map((w) => `<th class="qc-c">W${w}</th>`).join('')).join('')}</tr></thead>
          <tbody>${QC_STEPS.map(([phase, label], s) => `<tr><td rowspan="2"><span class="qc-phase">${phase}</span> ${esc(label)}</td><td class="qc-kind">Plan</td>${ms.map((_, mi) => [0, 1, 2, 3].map((w) => `<td class="qc-c">${cell(s, 'plan', mi * 4 + w)}</td>`).join('')).join('')}</tr>
            <tr><td class="qc-kind">Actual</td>${ms.map((_, mi) => [0, 1, 2, 3].map((w) => `<td class="qc-c">${cell(s, 'actual', mi * 4 + w)}</td>`).join('')).join('')}</tr>`).join('')}</tbody></table></div>
        <p class="sum-meta">กดช่องสัปดาห์เพื่อใส่ / เอาออก · <span class="qc-wk is-plan"></span> Plan · <span class="qc-wk is-actual"></span> Actual · ช่วงเดือนตามระยะเวลาดำเนินกิจกรรมด้านบน</p>`;
    },
    '023': () => {
      const rows = st['023']?.rows || [];
      const best = Math.max(0, ...rows.map(qcScore));
      const sel = (path) => `<select data-k="${path}" data-num${off}>${options(['', 1, 2, 3], qcGet(st, path) || '', (v) => (v === '' ? '-' : String(v)))}</select>`;
      return `<div class="table-wrap qc-topic"><table class="mo-data-table"><thead><tr><th>ปัญหาที่นำมาทำกิจกรรม</th><th>ผู้เสนอ</th>${QC_CRITERIA.map((c) => `<th class="qc-c qc-vert"><span>${esc(c)}</span></th>`).join('')}<th class="qc-c">ความถี่</th><th class="qc-c">ความรุนแรง</th><th class="qc-c">ความเป็นไปได้</th><th class="num">คะแนนรวม</th><th></th></tr></thead>
        <tbody>${rows.map((r, k) => `<tr${best && qcScore(r) === best ? ' class="qc-best"' : ''}><td>${i(`023.rows.${k}.problem`, ' maxlength="300"')}<small class="qc-notes">${i(`023.rows.${k}.freqNote`, ' placeholder="ความถี่ เช่น 6 ครั้ง/เดือน"')}${i(`023.rows.${k}.severityNote`, ' placeholder="ความรุนแรง เช่น 40 นาที x 6 ครั้ง"')}</small></td><td>${i(`023.rows.${k}.proposer`, ' maxlength="100"')}</td>
          ${QC_CRITERIA.map((_, c) => `<td class="qc-c"><input type="checkbox" data-k="023.rows.${k}.criteria.${c}"${r.criteria?.[c] ? ' checked' : ''}${off}></td>`).join('')}
          <td class="qc-c">${sel(`023.rows.${k}.freq`)}</td><td class="qc-c">${sel(`023.rows.${k}.severity`)}</td><td class="qc-c">${sel(`023.rows.${k}.feasible`)}</td><td class="num"><b>${qcScore(r) || '-'}</b></td><td>${del(`023.rows.${k}`)}</td></tr>`).join('') || '<tr><td colspan="13" class="empty">ยังไม่มีหัวข้อปัญหา</td></tr>'}</tbody></table></div>
        <div class="action-bar">${add('023.rows', 'เพิ่มหัวข้อปัญหา')}</div>
        <p class="sum-meta">คะแนน = ความถี่ × ความรุนแรง × ความเป็นไปได้ (ข้อละ 1–3) · แถวที่คะแนนสูงสุดคือหัวข้อที่เลือก · ความถี่ (ครั้ง/เดือน): 3 แก้ไขได้เอง, 2 อาศัยหน่วยงานอื่น, 1 จ้างภายนอก · ความรุนแรง (เวลาเฉลี่ยต่อครั้ง × จำนวนครั้ง): 3 = &gt; 30 นาที, 2 = ราว 100 นาที, 1 = &lt; 150 นาที ตามแบบฟอร์ม · ความเป็นไปได้: 3 แก้ไขได้เอง, 2 อาศัยหน่วยงานอื่น, 1 จ้างภายนอก</p>`;
    },
    '024': () => {
      const items = st['024']?.items || [];
      const chart = items.some((r) => Number(r.value) > 0) ? chartPlot({ id: 'qc-024', labels: items.map((r) => r.name), left: st['024']?.unit || 'จำนวน', digits: 2, bars: [{ values: items.map((r) => Number(r.value) || 0), colors: [CHART.series[0]] }] }) : '';
      return `<div class="qc-grid3">${field('สำรวจปัญหาเดือน', i('024.month', ' placeholder="เช่น มีนาคม 2025"'))}${field('หน่วย', i('024.unit', ' placeholder="เช่น นาที/เดือน"'))}${field('อ้างอิงแหล่งที่มาของข้อมูล', i('024.source', ' placeholder="เช่น แผนผลิตงานประจำเดือน"'))}</div>
        <p class="sum-meta">( ก่อนการแก้ไข เพื่อนำไปเปรียบเทียบกับผลหลังการแก้ไข )</p>
        <div class="table-wrap"><table class="mo-data-table"><thead><tr><th>รายละเอียดปัญหาที่พบ</th><th class="num">ผลรวม</th><th></th></tr></thead>
          <tbody>${items.map((_, k) => `<tr><td>${i(`024.items.${k}.name`, ' maxlength="200"')}</td><td class="num">${n(`024.items.${k}.value`)}</td><td>${del(`024.items.${k}`)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">ยังไม่มีรายการ</td></tr>'}</tbody></table></div>
        <div class="action-bar">${add('024.items', 'เพิ่มรายการปัญหา')}</div>
        ${chart ? chartCard('กราฟแสดงปัญหาที่พบ', chart) : ''}
        <div class="qc-photo-one">${photo('survey', 'รูป / กราฟเพิ่มเติม (ถ้ามี)')}</div>`;
    },
    '025': () => {
      const rows = qcPareto(st['024']?.items);
      if (!rows.length) return '<p class="empty">ตารางนี้คำนวณจาก FM-QMR-024 ให้เอง · กรอกรายการปัญหาและผลรวมในฟอร์ม 024 ก่อน</p>';
      const chart = chartPlot({
        id: 'qc-025', labels: rows.map((r) => r.name), left: st['024']?.unit || 'จำนวน', right: 'เปอร์เซ็นต์สะสม (%)', digits: 1,
        bars: [{ values: rows.map((r) => r.value), colors: [CHART.series[0]], inner: rows.map((r) => `${qcNum(r.pct)}%`) }],
        lines: [{ values: rows.map((r) => Math.round(r.cumPct * 10) / 10), color: CHART.line, axis: 'right' }],
        legend: [{ box: CHART.series[0], label: 'จำนวน' }, { line: CHART.line, label: 'เปอร์เซ็นต์สะสม' }]
      });
      return `<div class="table-wrap"><table class="mo-data-table"><thead><tr><th>ลำดับ</th><th>รายละเอียดของปัญหา</th><th class="num">จำนวน</th><th class="num">จำนวนสะสม</th><th class="num">เปอร์เซ็นต์</th><th class="num">เปอร์เซ็นต์สะสม</th></tr></thead>
        <tbody>${rows.map((r, k) => `<tr><td>${k + 1}</td><td>${esc(r.name)}</td><td class="num">${qcNum(r.value)}</td><td class="num">${qcNum(r.cum)}</td><td class="num">${qcNum(r.pct)}%</td><td class="num">${qcNum(r.cumPct)}%</td></tr>`).join('')}</tbody></table></div>
        ${chartCard('แผนภูมิพาเรโต้', chart, esc(st['024']?.month || ''))}
        <p class="sum-meta">คำนวณจาก FM-QMR-024 · ปัญหาที่รวมกันถึงราว 80% แรกคือกลุ่มที่ควรแก้ก่อน</p>`;
    },
    '026': () => `${field('ปัญหา (หัวปลา)', i('026.problem', ' maxlength="300"'))}
      <div class="qc-fish">${QC_FISH.map(([k, label]) => `<section class="qc-bone"><div class="qc-bone-title">${label}</div>${ta(`026.causes.${k}`, 4)}</section>`).join('')}
        <div class="qc-fish-head"><span class="material-symbols-rounded">arrow_forward</span><b>${esc(st['026']?.problem || 'ปัญหา')}</b></div></div>
      <p class="sum-meta">ใส่สาเหตุทีละบรรทัดในแต่ละด้าน · แนบรูปผังก้างปลาที่วาดไว้ได้ด้านล่าง</p>
      <div class="qc-photo-one">${photo('fishbone', 'รูปผังก้างปลา (ถ้ามี)')}</div>`,
    '027': () => {
      const rows = st['027']?.rows || [];
      return `<div class="table-wrap"><table class="mo-data-table qc-fix"><thead><tr><th>ปัญหา What / When</th><th>สาเหตุ Why</th><th>การแก้ไข How / Where</th><th>ผู้รับผิดชอบ Who</th><th>กำหนดเสร็จ</th><th></th></tr></thead>
        <tbody>${rows.map((_, k) => `<tr><td>${ta(`027.rows.${k}.what`, 2)}</td><td>${ta(`027.rows.${k}.why`, 2)}</td><td>${ta(`027.rows.${k}.how`, 2)}${i(`027.rows.${k}.where`, ' placeholder="แก้ที่ไหน"')}</td><td>${i(`027.rows.${k}.who`)}</td><td>${i(`027.rows.${k}.when`, ' placeholder="เช่น พ.ค. 2025"')}</td><td>${del(`027.rows.${k}`)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">ยังไม่มีรายการแก้ไข</td></tr>'}</tbody></table></div>
        <div class="action-bar">${add('027.rows', 'เพิ่มรายการแก้ไข')}</div>`;
    },
    '028': () => {
      const f = st['028'] || {};
      const t = Number(f.target);
      const a = Number(f.actual);
      const done = f.target !== '' && f.actual !== '' && Number.isFinite(t) && Number.isFinite(a) && f.target != null && f.actual != null
        ? ((f.direction || 'up') === 'up' ? a >= t : a <= t) : null;
      return `${field('หัวข้อที่ปรับปรุง', i('028.topic', ' maxlength="300"'))}
        <div class="kz-sides">
          <section class="kz-side"><div class="kz-side-title">ก่อนการแก้ไข</div>${photo('before', 'รูปก่อนแก้ไข (16:9)')}${ta('028.before', 4)}</section>
          <section class="kz-side"><div class="kz-side-title">หลังการแก้ไข</div>${photo('after', 'รูปหลังแก้ไข (16:9)')}${ta('028.after', 4)}</section>
        </div>
        <section class="card qc-target"><div class="card-title">เปรียบเทียบเป้าหมาย (หลังแก้ไข)</div>
          <div class="qc-grid4">${field('เป้าหมาย', `<select data-k="028.direction"${off}>${options(['up', 'down'], f.direction || 'up', (v) => (v === 'up' ? 'ให้เพิ่มขึ้น' : 'ให้ลดลง'))}</select>`)}${field('หน่วย', i('028.unit', ' placeholder="เช่น %"'))}${field('เป้าหมาย (ก่อนการแก้ไข)', i('028.target'))}${field('ปฏิบัติงานจริง (หลังการแก้ไข)', i('028.actual'))}</div>
          ${done == null ? '' : `<div class="kz-result is-main"><span>ผลเทียบเป้าหมาย</span><b>${done ? 'ถึงเป้าหมาย' : 'ยังไม่ถึงเป้าหมาย'}</b><small>${esc(f.actual)} / ${esc(f.target)} ${esc(f.unit || '')}</small></div>`}
        </section>`;
    },
    '029': () => {
      const rows = st['029']?.rows || [];
      return `<div class="table-wrap"><table class="mo-data-table qc-fix"><thead><tr><th>รายละเอียดของมาตรฐานการทำงาน</th><th>WI. NO.</th><th>SOP. NO.</th><th>เอกสารอื่นๆ (เช่น CHECK SHEET, IS, OJT)</th><th></th></tr></thead>
        <tbody>${rows.map((_, k) => `<tr><td>${ta(`029.rows.${k}.topic`, 3)}</td><td>${i(`029.rows.${k}.wi`)}</td><td>${i(`029.rows.${k}.sop`)}</td><td>${i(`029.rows.${k}.other`)}</td><td>${del(`029.rows.${k}`)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">ยังไม่มีมาตรฐาน</td></tr>'}</tbody></table></div>
        <div class="action-bar">${add('029.rows', 'เพิ่มมาตรฐาน')}</div>`;
    },
    '030': () => {
      const rows = st['030']?.costs || [];
      const total = qcCost(st);
      const per = Number(st['030']?.perMonth) || 0;
      return `<div class="table-wrap"><table class="mo-data-table"><thead><tr><th>หัวข้อที่ปรับปรุง / รายการ</th><th>จำนวน</th><th class="num">ค่าแรง (บาท)</th><th class="num">อื่นๆ (บาท)</th><th class="num">รวม (บาท)</th><th></th></tr></thead>
        <tbody>${rows.map((r, k) => `<tr><td>${i(`030.costs.${k}.item`, ' maxlength="200"')}</td><td>${i(`030.costs.${k}.qty`, ' placeholder="เช่น 1 Set"')}</td><td class="num">${n(`030.costs.${k}.labor`)}</td><td class="num">${n(`030.costs.${k}.other`)}</td><td class="num">${qcMoney((Number(r.labor) || 0) + (Number(r.other) || 0))}</td><td>${del(`030.costs.${k}`)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">ยังไม่มีค่าใช้จ่าย</td></tr>'}</tbody>
        <tfoot><tr><td colspan="4"><b>ค่าใช้จ่ายรวม</b></td><td class="num"><b>${qcMoney(total)}</b></td><td></td></tr></tfoot></table></div>
        <div class="action-bar">${add('030.costs', 'เพิ่มค่าใช้จ่าย')}</div>
        <div class="qc-grid2">
          <section class="card qc-target"><div class="card-title">ผลที่คิดเป็นเงินได้</div>${ta('030.money', 3)}${field('ผลตอบแทน (บาท/เดือน)', n('030.perMonth'))}
            <div class="kz-result is-main"><span>ระยะเวลาคืนทุน</span><b>${per > 0 ? qcNum(total / per) : '-'}</b><small>เดือน</small></div></section>
          <section class="card qc-target"><div class="card-title">ผลที่คิดเป็นเงินไม่ได้</div>${ta('030.nonMoney', 6)}</section>
        </div>`;
    },
    '031': () => `<div class="qc-grid3">${field('ผลทางตรง', ta('031.direct', 6))}${field('ผลทางอ้อม', ta('031.indirect', 6))}${field('อุปสรรค', ta('031.obstacles', 6))}</div>${field('แผนงานในอนาคต (หัวข้อกิจกรรมต่อไป)', ta('031.future', 3))}`
  };

  // Buttons sit in the year row (a5Lift moves .a5-actions there); the title heads the group card.
  body.innerHTML = `
    <div class="action-bar a5-actions">${button('qc-back', 'กลับ')}${row?.canReview && row.status !== 'DRAFT' ? button('qc-p-review', 'พิจารณา', 'secondary') : ''}${editable ? `${button('qc-save', 'บันทึก')}${!row || ['DRAFT', 'REJECTED'].includes(row.status) ? button('qc-send', 'บันทึกและส่งพิจารณา', 'primary') : ''}` : ''}</div>
    <div class="qc-page">
      <section class="card qc-top">
        <div class="qc-title"><span class="card-title">โครงการกลุ่ม QCC</span><strong>${row ? esc(`${row.group_name} · ${row.reg_no || 'ยังไม่มีเลขทะเบียน'}`) : 'โครงการใหม่'}</strong>${row ? qcBadge(row.status) : ''}</div>
        ${field('ชื่อกลุ่ม', `<input id="qc-group" maxlength="120" value="${esc(row?.group_name || '')}"${off}>`, 'qc-s4')}
        ${field('เลขทะเบียนกลุ่ม', `<input id="qc-reg" maxlength="60" placeholder="เช่น QCC-TSAT-P4-005" value="${esc(row?.reg_no || '')}"${off}>`, 'qc-s4')}
        ${field('ฝ่าย', `<input id="qc-dept" maxlength="80" value="${esc(row?.department || '')}"${off}>`, 'qc-s4')}
        ${field('จดทะเบียนกิจกรรมเรื่อง', `<input id="qc-topic" maxlength="300" value="${esc(row?.topic || '')}"${off}>`, 'qc-s6')}
        ${field('ระยะเวลา ตั้งแต่', `<input id="qc-start" type="month" value="${esc(qcMonth(row?.start_month))}"${off}>`, 'qc-s3')}
        ${field('ถึง', `<input id="qc-end" type="month" value="${esc(qcMonth(row?.end_month))}"${off}>`, 'qc-s3')}
        ${field('หัวหน้ากลุ่ม', `<div class="qc-pick"><input id="qc-leader" readonly value="${esc(`${leader.employeeId} · ${leader.name || ''}`)}">${editable && d.admin ? button('qc-leader-pick', 'เลือก') : ''}</div>`, 'qc-s4')}
        ${field('ผู้จัดการต้นสังกัด', `<div class="qc-pick"><input id="qc-manager" readonly value="${esc(manager ? `${manager.employeeId} · ${manager.name || ''}` : '')}" placeholder="ยังไม่ระบุ">${editable ? button('qc-manager-pick', 'เลือก') : ''}</div>`, 'qc-s4')}
        ${field('สมาชิกกลุ่ม', `<input id="qc-members" maxlength="1000" placeholder="ชื่อสมาชิก คั่นด้วย ," value="${esc(row?.members || '')}"${off}>`, 'qc-s4')}
      </section>
      <section class="card qc-form-card">
        <div class="qc-form-bar">
          ${field('ฟอร์ม', `<select id="qc-form">${QC_FORMS.map(([code, label]) => `<option value="${code}"${code === qcFormCode ? ' selected' : ''}>FM-QMR-${code} · ${label}</option>`).join('')}</select>`, 'grow')}
          <div class="action-bar">${button('qc-prev', 'ก่อนหน้า')}${button('qc-next', 'ถัดไป')}</div>
        </div>
        <div id="qc-form-body"></div>
      </section>
      ${row?.review_note ? `<p class="sum-meta">ความเห็นคณะกรรมการ QCC: ${esc(row.review_note)}</p>` : ''}
    </div>`;
  a5Lift(body);

  const formBody = $('qc-form-body');
  const drawForm = () => {
    formBody.innerHTML = FORMS[qcFormCode]();
    $('qc-form').value = qcFormCode;
    $('qc-prev').disabled = qcFormCode === QC_FORMS[0][0];
    $('qc-next').disabled = qcFormCode === QC_FORMS.at(-1)[0];
  };
  // Typing updates the state; a change that alters what is drawn (scores, totals, rows) redraws the form.
  formBody.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    qcSet(st, k, e.target.type === 'checkbox' ? e.target.checked : e.target.dataset.num !== undefined ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value);
    if (k === '026.problem') formBody.querySelector('.qc-fish-head b').textContent = e.target.value || 'ปัญหา';
  });
  formBody.addEventListener('change', (e) => {
    if (e.target.dataset.photo) {
      const slot = e.target.dataset.photo;
      const file = e.target.files[0];
      if (file) kzPhoto169(file).then((data) => { photos[slot] = data; urls[slot] = data; $(`qc-ph-${slot}-box`).innerHTML = `<img src="${data}" alt="">`; }).catch(onErr);
      return;
    }
    // Redraw after the focus has moved on, then put it back on the same field.
    if (e.target.dataset.k && (e.target.tagName === 'SELECT' || e.target.type === 'checkbox' || e.target.dataset.num !== undefined || e.target.dataset.k.startsWith('024.'))) {
      setTimeout(() => {
        const k = document.activeElement?.dataset?.k;
        drawForm();
        if (k) formBody.querySelector(`[data-k="${k}"]`)?.focus();
      });
    }
  });
  formBody.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || !editable) return;
    if (btn.dataset.week) {
      const now = qcGet(st, btn.dataset.week) || [];
      const w = Number(btn.dataset.w);
      qcSet(st, btn.dataset.week, now.includes(w) ? now.filter((x) => x !== w) : [...now, w].sort((a, b) => a - b));
      btn.classList.toggle(`is-${btn.dataset.week.split('.').at(-1)}`);
    } else if (btn.dataset.add) {
      qcSet(st, btn.dataset.add, [...(qcGet(st, btn.dataset.add) || []), {}]);
      drawForm();
    } else if (btn.dataset.del) {
      const parts = btn.dataset.del.split('.');
      const at = Number(parts.pop());
      qcGet(st, parts.join('.')).splice(at, 1);
      drawForm();
    }
  });
  $('qc-form').onchange = () => { qcFormCode = $('qc-form').value; drawForm(); };
  const step = (by) => { const k = QC_FORMS.findIndex(([c]) => c === qcFormCode) + by; if (QC_FORMS[k]) { qcFormCode = QC_FORMS[k][0]; drawForm(); } };
  $('qc-prev').onclick = () => step(-1);
  $('qc-next').onclick = () => step(1);
  ['qc-start', 'qc-end'].forEach((id) => { $(id).onchange = () => { if (qcFormCode === '022') drawForm(); }; });
  drawForm();

  const pickPerson = (title, onPick) => {
    openPopup(title, searchBlock(searchSlot('ค้นพนักงาน', 'qc-p-q', 'qc-p-search', { placeholder: 'รหัส ชื่อ หรือหน่วยงาน' }), 'qc-p-list'), closePopup);
    $('popup-save').hidden = true; // picking a row closes it
    const run = async () => {
      const r = await a5Api(QC, `qcc/people?q=${encodeURIComponent($('qc-p-q').value.trim())}`);
      fillTable('qc-p-list', ['รหัส', 'ชื่อ', 'หน่วยงาน'], r.people.map((p) => `<tr data-pick="${esc(p.employeeId)}" data-name="${esc(p.name)}"><td>${esc(p.employeeId)}</td><td>${esc(p.name)}</td><td>${esc(p.department)}</td></tr>`).join(''), 'ไม่พบพนักงาน');
      bindRowSelect($('qc-p-list'), (id, tr) => { onPick({ employeeId: id, name: tr.dataset.name }); closePopup(); });
    };
    $('qc-p-search').onclick = () => run().catch(onErr);
    onEnter('qc-p-q', () => run().catch(onErr));
  };
  if ($('qc-leader-pick')) $('qc-leader-pick').onclick = () => pickPerson('เลือกหัวหน้ากลุ่ม', (p) => { leader = p; $('qc-leader').value = `${p.employeeId} · ${p.name}`; });
  if ($('qc-manager-pick')) $('qc-manager-pick').onclick = () => pickPerson('เลือกผู้จัดการต้นสังกัด', (p) => { manager = p; $('qc-manager').value = `${p.employeeId} · ${p.name}`; });
  $('qc-back').onclick = reload;
  if ($('qc-p-review')) $('qc-p-review').onclick = () => qcReview(row, reload);
  const save = async (send) => {
    const payload = {
      year: a5Year, group_name: $('qc-group').value, reg_no: $('qc-reg').value, department: $('qc-dept').value, topic: $('qc-topic').value,
      start_month: $('qc-start').value, end_month: $('qc-end').value, leader_id: leader.employeeId, manager_id: manager?.employeeId || '', members: $('qc-members').value, forms: st
    };
    const saved = row ? await a5Api(QC, `qcc/${row.id}`, { method: 'PATCH', body: payload }) : await a5Api(QC, 'qcc', { method: 'POST', body: payload });
    const id = row?.id || saved.id;
    for (const [slot, image] of Object.entries(photos)) await a5Api(QC, `qcc/${id}/photo`, { method: 'POST', body: { slot, image } });
    if (send) await a5Api(QC, `qcc/${id}/status`, { method: 'POST', body: { status: 'SUBMITTED' } });
    toast(send ? 'ส่งพิจารณาแล้ว' : 'บันทึกแล้ว');
    reload();
  };
  if ($('qc-save')) $('qc-save').onclick = () => save(false).catch(onErr);
  if ($('qc-send')) $('qc-send').onclick = () => save(true).catch(onErr);
}

// ---------- Setting ----------

async function qcSetting(target) {
  const { me, body } = await qcFrame(target, QC_SET_TABS, 'data-qcset', qcSetTab);
  const rerender = () => qcSetting(target).catch(onErr);
  target.querySelectorAll('[data-qcset]').forEach((node) => { node.onclick = () => { qcSetTab = node.dataset.qcset; rerender(); }; });
  $('a5-year').onchange = () => { a5Year = Number($('a5-year').value); rerender(); };
  if (qcSetTab === 'team') return a5SetTeam(body, QC, me.access.admin, rerender, QC_ROLE_LABEL);
  return aplRender(body, QC, { inPage: true });
}

Object.assign(VIEWS, { [`${QC}-home`]: qcDashboard, [`${QC}-edit`]: qcProjects, [`${QC}-setting`]: qcSetting });
