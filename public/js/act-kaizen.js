// ระบบกิจกรรม > KAIZEN: Dashboard (Summary / Schedule / Team), Transaction (ใบ Kaizen FM-QSM-039 ด้านหน้า + ด้านหลังประเมินผล),
// Setting (แผนงาน = Planner, ทีมประจำปี + เป้าหมายเรื่องต่อปี + ผู้จัดการประเมิน).
// Server: server/modules/act/kaizen.js · spec: docs/specs/act-kaizen.md · uses the shared year (a5Year) of act-5s.js.
const KZ = 'kaizen';
const KZ_ROLE_LABEL = { chairman: 'ประธาน', vice: 'รองประธาน', admin: 'ผู้ดูแล (เลขานุการ)', member: 'ตัวแทนสมาชิก (ประจำแผนก)' };
const KZ_DASH_TABS = { summary: 'Summary', schedule: 'Schedule', team: 'Team' };
const KZ_SET_TABS = { plan: 'แผนงาน', team: 'ทีม' };
const KZ_KINDS = { person: 'บุคคล', team: 'ทีม', qcc: 'เป็นกิจกรรมที่มาจาก QCC' };
const KZ_TYPES = [['Q', 'การปรับปรุงด้านคุณภาพ'], ['C', 'การลดต้นทุนการผลิต / ค่าใช้จ่าย'], ['D', 'การปรับปรุงด้านการส่งมอบ'],
  ['S', 'ความปลอดภัย'], ['M', 'ส่งเสริมด้านขวัญกำลังใจ'], ['E', 'ปรับปรุงสภาพแวดล้อม'], ['O', 'อื่นๆ']];
const KZ_STATUS = { DRAFT: ['ร่าง', ''], SUBMITTED: ['รอพิจารณา', 'badge-warning'], APPROVED: ['อนุมัติ', 'badge-success'], REJECTED: ['ไม่เข้าหลักเกณฑ์', 'badge-danger'] };
// FM-QSM-039 ด้านหลัง (ปรับใหม่): ก1 ลดชั่วโมงทำงาน (A–I), ก2 คำนวณเป็นตัวเงิน (Q–Z), ข คำนวณเป็นเงินไม่ได้ 6 ข้อ × 0–5 คะแนน (J–P).
const KZ_HOUR_GRADES = [[8001, 'A', 500], [5001, 'B', 300], [3001, 'C', 200], [1001, 'D', 100], [501, 'E', 80], [201, 'F', 50], [81, 'G', 40], [31, 'H', 30], [10, 'I', 20]];
const KZ_BAHT_GRADES = [[3000001, 'Q', 1500], [1000001, 'R', 1000], [500001, 'S', 500], [300001, 'T', 300], [100001, 'U', 200], [50001, 'V', 100], [10001, 'W', 80], [3001, 'X', 50], [301, 'Y', 20], [100, 'Z', 10]];
const KZ_SCORE_GRADES = [[25, 'J', 100], [22, 'K', 50], [19, 'L', 30], [16, 'M', 20], [11, 'N', 15], [4, 'P', 10]];
const KZ_CRITERIA = [
  '1. ความคิดริเริ่ม / ความใหม่',
  '2. ความพยายาม / วิจัย / ค้นคว้า / ทดลอง',
  '3. ความสมบูรณ์ & การประยุกต์ใช้',
  '4. คุณภาพ',
  '5. ความปลอดภัย',
  '6. ประสิทธิภาพ'
];
let kzDashTab = 'summary';
let kzSetTab = 'plan';
const kzFilter = { status: '', department: '', q: '' };
const kzHead = { sort: '', dir: 'asc', filters: {} };
const kzTeamHead = { sort: '', dir: 'asc', filters: {} };

const kzMoney = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kzNum = (n, digits = 2) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: digits });
const kzBadge = (s) => `<span class="badge ${KZ_STATUS[s]?.[1] || ''}">${KZ_STATUS[s]?.[0] || esc(s)}</span>`;
// Invested = labour + material · payback (months) = invested ÷ return per month (server kaizenMoney).
const kzPayback = (cost, perMonth) => (perMonth > 0 ? Math.round((cost / perMonth) * 100) / 100 : null);

function kzEvalCalc(hours, baht, scores) {
  const h = Math.max(0, Number(hours || 0));
  const b = Math.max(0, Number(baht || 0));
  const s = Array.from({ length: 6 }, (_, i) => Math.min(5, Math.max(0, Math.floor(Number(scores?.[i]) || 0))));
  const total = s.reduce((acc, v) => acc + v, 0);
  const pick = (table, val) => table.find(([min]) => val >= min) || [0, null, 0];
  const [, hourGrade, hourReward] = pick(KZ_HOUR_GRADES, h);
  const [, bahtGrade, bahtReward] = pick(KZ_BAHT_GRADES, b);
  const [, scoreGrade, scoreReward] = pick(KZ_SCORE_GRADES, total);
  return {
    scores: s,
    scoreTotal: total,
    hourGrade,
    hourReward,
    bahtGrade,
    bahtReward,
    scoreGrade,
    scoreReward,
    eval_grade: [hourGrade, bahtGrade, scoreGrade].filter(Boolean).join(' / ') || '-',
    eval_reward: hourReward + bahtReward + scoreReward
  };
}

// Page frame: tabs on the left, year on the right, body below (same as the other activities).
async function kzFrame(target, tabs, attr, active) {
  const me = await a5Api(KZ, `me?year=${a5Year}`);
  target.innerHTML = `<div class="view-body"><section class="card">
    ${pageBar(tabs ? a5Seg(attr, tabs, active) : '', `<div class="a5-year">${a5YearSelect(me.years)}</div>`, 'a5')}
    <div id="a5-body"><div class="empty">กำลังโหลด...</div></div>
  </section></div>`;
  return { me, body: $('a5-body') };
}

// A photo as 16:9 JPEG (centre crop, 1280 × 720 at most, under 650 KB) for the before / after boxes.
function kzPhoto169(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const ratio = 16 / 9;
      let sw = image.width;
      let sh = Math.round(sw / ratio);
      if (sh > image.height) { sh = image.height; sw = Math.round(sh * ratio); }
      const sx = Math.round((image.width - sw) / 2);
      const sy = Math.round((image.height - sh) / 2);
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(1280, sw);
      canvas.height = Math.round(canvas.width / ratio);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      let quality = 0.85;
      let data = canvas.toDataURL('image/jpeg', quality);
      while (data.length * 0.75 > 650000 && quality > 0.4) { quality -= 0.1; data = canvas.toDataURL('image/jpeg', quality); }
      resolve(data);
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('เปิดรูปไม่ได้')); };
    image.src = url;
  });
}

// ---------- Dashboard ----------

async function kzDashboard(target) {
  const { me, body } = await kzFrame(target, KZ_DASH_TABS, 'data-kzdash', kzDashTab);
  const rerender = () => kzDashboard(target).catch(onErr);
  target.querySelectorAll('[data-kzdash]').forEach((node) => { node.onclick = () => { kzDashTab = node.dataset.kzdash; rerender(); }; });
  $('a5-year').onchange = () => { a5Year = Number($('a5-year').value); rerender(); };
  if (kzDashTab === 'schedule') return aplRender(body, KZ, { inPage: true, readOnly: true });
  if (kzDashTab === 'team') return kzDrawTeam(body, me.access.admin);
  return kzDrawSummary(body);
}

// Summary: sheets of the year, target vs sent/approved, money invested, return per month, payback, and rewards; per month and per department.
async function kzDrawSummary(body) {
  const d = await a5Api(KZ, `kaizen/list?year=${a5Year}`);
  const sent = d.rows.filter((r) => r.status !== 'DRAFT');
  const approved = d.rows.filter((r) => r.status === 'APPROVED');
  const waiting = d.rows.filter((r) => r.status === 'SUBMITTED');
  const cost = approved.reduce((t, r) => t + r.cost, 0);
  const perMonth = approved.reduce((t, r) => t + Number(r.return_month || 0), 0);
  const totalReward = approved.reduce((t, r) => t + Number(r.eval_reward || 0), 0);
  const totalTarget = (d.teamTargets || []).reduce((t, r) => t + Number(r.target_count || 0), 0);
  const month = (r) => Number(String(r.submitted_on).slice(5, 7));
  const byMonth = (list) => ACT_MONTHS_SHORT.map((_, i) => list.filter((r) => month(r) === i + 1).length);
  const top = Math.max(...byMonth(approved).map((v, i) => v + byMonth(waiting)[i]), 0);
  const chart = chartPlot({
    id: 'kz-plot', labels: ACT_MONTHS_SHORT, left: 'จำนวน (ใบ)', leftMax: Math.max(4, Math.ceil(top / 4) * 4),
    bars: [{ values: byMonth(approved).map((v, i) => [v, byMonth(waiting)[i]]), colors: [CHART.series[0], CHART.series[1]] }],
    legend: [{ box: CHART.series[0], label: 'อนุมัติ' }, { box: CHART.series[1], label: 'รอพิจารณา' }]
  });
  const byDept = {};
  const ensureDept = (k) => {
    const key = k || '-';
    byDept[key] = byDept[key] || { department: key, reps: [], managers: [], target: 0, count: 0, approved: 0, cost: 0, perMonth: 0, reward: 0 };
    return byDept[key];
  };
  (d.teamTargets || []).forEach((t) => {
    const g = ensureDept(t.department);
    if (t.name || t.employee_id) g.reps.push(t.name || t.employee_id);
    if (t.manager_name || t.manager_id) g.managers.push(t.manager_name || t.manager_id);
    g.target += Number(t.target_count || 0);
  });
  sent.forEach((r) => {
    const g = ensureDept(r.department);
    g.count += 1;
    if (r.status === 'APPROVED') {
      g.approved += 1;
      g.cost += r.cost;
      g.perMonth += Number(r.return_month || 0);
      g.reward += Number(r.eval_reward || 0);
    }
  });
  const departments = Object.values(byDept).sort((a, b) => b.count - a.count || b.target - a.target || a.department.localeCompare(b.department));
  body.innerHTML = `
    <div class="ch-kpis">
      ${chartKpi({ icon: 'lightbulb', label: 'Kaizen ที่ส่ง', value: kzNum(sent.length, 0), unit: 'ใบ', note: `เป้าปีนี้ ${kzNum(totalTarget, 0)} ใบ · ร่าง ${kzNum(d.rows.length - sent.length, 0)} ใบ` })}
      ${chartKpi({ icon: 'verified', label: 'อนุมัติแล้ว', value: kzNum(approved.length, 0), unit: 'ใบ', note: `รอพิจารณา ${kzNum(waiting.length, 0)} ใบ · รางวัล ${kzNum(totalReward, 0)} บาท` })}
      ${chartKpi({ icon: 'payments', label: 'เงินที่ใช้ในการปรับปรุง', value: kzMoney(cost), unit: 'บาท', note: 'ค่าแรง + ค่าอุปกรณ์ (อนุมัติแล้ว)' })}
      ${chartKpi({ icon: 'savings', label: 'ผลตอบแทน', value: kzMoney(perMonth), unit: 'บาท/เดือน', note: `ปีละ ${kzMoney(perMonth * 12)} บาท` })}
      ${chartKpi({ icon: 'hourglass_bottom', label: 'ระยะเวลาคืนทุน (รวม)', value: kzPayback(cost, perMonth) == null ? '-' : kzNum(kzPayback(cost, perMonth)), unit: 'เดือน', note: 'เงินที่ใช้ ÷ ผลตอบแทนต่อเดือน' })}
    </div>
    ${chartCard(`Kaizen รายเดือน ปี ${a5Year}`, chart, 'ตามวันที่เสนอ')}
    ${chartCard('ตามหน่วยงานและเป้าหมายประจำปี', `<div class="table-wrap"><table class="mo-data-table"><thead><tr><th>หน่วยงาน</th><th>ตัวแทนสมาชิก</th><th>ผู้จัดการประเมิน</th><th class="num">เป้า/ปี (ใบ)</th><th class="num">ส่งแล้ว (ใบ)</th><th class="num">อนุมัติ (ใบ)</th><th class="num">เงินที่ใช้ (บาท)</th><th class="num">ผลตอบแทน (บาท/เดือน)</th><th class="num">คืนทุน (เดือน)</th><th class="num">เงินรางวัล (บาท)</th></tr></thead>
      <tbody>${departments.map((x) => `<tr><td>${esc(x.department)}</td><td>${esc([...new Set(x.reps)].join(', ') || '-')}</td><td>${esc([...new Set(x.managers)].join(', ') || '-')}</td><td class="num">${kzNum(x.target, 0)}</td><td class="num">${kzNum(x.count, 0)}</td><td class="num">${kzNum(x.approved, 0)}</td><td class="num">${kzMoney(x.cost)}</td><td class="num">${kzMoney(x.perMonth)}</td>
        <td class="num">${kzPayback(x.cost, x.perMonth) == null ? '-' : kzNum(kzPayback(x.cost, x.perMonth))}</td><td class="num">${kzNum(x.reward, 0)}</td></tr>`).join('') || '<tr><td colspan="10" class="empty">ยังไม่มีข้อมูลทีมหรือใบ Kaizen</td></tr>'}</tbody></table></div>`)}`;
  chartTip('kz-plot', (i) => `<strong>${ACT_MONTHS[i]} ${a5Year}</strong><div class="ch-tip-row"><span>อนุมัติ</span><b>${byMonth(approved)[i]} ใบ</b></div><div class="ch-tip-row"><span>รอพิจารณา</span><b>${byMonth(waiting)[i]} ใบ</b></div>`);
}

// Dashboard > Team: org chart by level (ประธาน · รองประธาน / ผู้ดูแล · ตัวแทนสมาชิกประจำแผนก) + annual target & manager table.
async function kzDrawTeam(body, admin) {
  const team = await a5Api(KZ, `team?year=${a5Year}`);
  const active = team.members.filter((p) => p.status === 'Active');
  const first = (name) => String(name || '').replace(/^(นางสาว|นาง|นาย|Mr\.?|Mrs\.?|Ms\.?|Miss)\s*/, '').split(/\s+/)[0];
  const tiers = [
    { label: 'ประธาน', color: 'var(--cfo-tier-1)', people: active.filter((p) => p.role === 'chairman') },
    { label: 'รองประธาน , ผู้ดูแล', color: 'var(--cfo-tier-2)', people: [...active.filter((p) => p.role === 'vice'), ...active.filter((p) => p.role === 'admin')] },
    { label: 'ตัวแทนสมาชิก (ประจำแผนก)', color: 'var(--cfo-tier-3)', people: active.filter((p) => p.role === 'member').sort((a, b) => String(a.department).localeCompare(String(b.department))) }
  ];
  const card = (p) => `<div class="cfo-person${p.role === 'member' ? ' is-wide' : ''}"><span class="material-symbols-rounded">person</span><strong>${esc(p.name ? `คุณ${first(p.name)}` : p.employee_id)}</strong><small>${esc(p.department || '')}</small>${p.role === 'member' ? `<small>เป้า ${kzNum(p.target_count || 0, 0)} เรื่อง/ปี</small><small>ผจก. ${esc(p.manager_name ? `คุณ${first(p.manager_name)}` : p.manager_id || '-')}</small>` : ''}</div>`;
  const members = tiers[2].people;
  body.innerHTML = `
    ${admin ? `<div class="action-bar a5-actions">${button('kz-team-edit', 'แก้ไขทีม')}</div>` : ''}
    <section class="card cfo-team">
      <div class="plan-head"><div class="card-title">โครงสร้างทีม Kaizen · ปี ${a5Year}</div><span class="sum-meta">${kzNum(active.length, 0)} คน</span></div>
      ${tiers.map((t) => `<div class="cfo-tier">${t.people.length ? `<div class="cfo-tier-people">${t.people.map(card).join('')}</div>` : '<p class="empty">ยังไม่มี</p>'}
        <div class="cfo-tier-rule" style="--tier:${t.color}"><span>${esc(t.label)}</span></div></div>`).join('')}
    </section>
    ${chartCard(`ตัวแทนสมาชิกประจำปี ${a5Year} และผู้จัดการประเมิน`, `<div class="table-wrap"><table class="mo-data-table"><thead><tr><th>แผนกที่ดูแล</th><th>รหัสตัวแทน</th><th>ชื่อตัวแทนสมาชิก</th><th class="num">จำนวนเรื่องที่ต้องส่ง/ปี</th><th>ผู้จัดการประเมิน Kaizen</th></tr></thead>
      <tbody>${members.map((m) => `<tr><td>${esc(m.department || '-')}</td><td>${esc(m.employee_id)}</td><td>${esc(m.name)}</td><td class="num">${kzNum(m.target_count || 0, 0)}</td><td>${m.manager_id ? `${esc(m.manager_id)} · ${esc(m.manager_name)}` : '<span class="sum-meta">ยังไม่ระบุ</span>'}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">ยังไม่ได้แต่งตั้งตัวแทนสมาชิกประจำปีนี้</td></tr>'}</tbody></table></div>`)}`;
  a5Lift(body);
  if (admin) $('kz-team-edit').onclick = () => { kzSetTab = 'team'; openView(`${KZ}-setting`); };
}

// ---------- Transaction: Kaizen sheets ----------

async function kzEntries(target) {
  const { body } = await kzFrame(target, null, '', '');
  const rerender = () => kzEntries(target).catch(onErr);
  $('a5-year').onchange = () => { a5Year = Number($('a5-year').value); rerender(); };
  const d = await a5Api(KZ, `kaizen/list?year=${a5Year}`);
  let picked = null;
  const departments = [...new Set([...(d.departments || []), ...d.rows.map((r) => r.department)].filter(Boolean))].sort();
  const draw = () => {
    const term = kzFilter.q.trim().toLowerCase();
    const list = listQuery(d.rows.filter((r) => (!kzFilter.status || r.status === kzFilter.status) && (!kzFilter.department || r.department === kzFilter.department)
      && (!term || `${r.reg_no} ${r.title} ${r.name} ${r.employee_id}`.toLowerCase().includes(term))), kzHead, (r, key) => r[key] ?? '');
    fillTable('kz-rows', [{ label: 'เลขทะเบียน', key: 'reg_no' }, { label: 'วันที่', key: 'submitted_on' }, { label: 'เรื่อง', key: 'title' }, { label: 'ผู้เสนอ', key: 'name' }, { label: 'หน่วยงาน', key: 'department' },
      'ประเภท', { label: 'เงินที่ใช้ (บาท)', key: 'cost', num: true }, { label: 'ผลตอบแทน (บาท/เดือน)', key: 'return_month', num: true }, { label: 'เกรด', key: 'eval_grade' }, { label: 'รางวัล (บาท)', key: 'eval_reward', num: true }, { label: 'สถานะ', key: 'status' }],
    list.map((r) => `<tr data-pick="${r.id}"><td>${esc(r.reg_no || '')}</td><td>${new Date(`${r.submitted_on}T00:00:00`).toLocaleDateString('en-GB')}</td><td>${esc(r.title)}</td><td>${esc(r.name || r.employee_id)}</td><td>${esc(r.department || '')}</td>
      <td>${esc(r.types.join(' '))}</td><td class="num">${kzMoney(r.cost)}</td><td class="num">${kzMoney(r.return_month)}</td><td>${esc(r.eval_grade || '-')}</td><td class="num">${r.eval_reward ? kzNum(r.eval_reward, 0) : '-'}</td><td>${kzBadge(r.status)}</td></tr>`).join(''),
    'ยังไม่มีใบ Kaizen ปีนี้', headFor(kzHead, draw));
    bindRowSelect($('kz-rows'), (id) => {
      picked = d.rows.find((r) => String(r.id) === id);
      $('kz-open').disabled = !picked;
      $('kz-edit').disabled = !(picked && picked.canEdit);
      $('kz-del').disabled = !(picked && (d.admin || ((picked.mine || (d.myDepartments || []).includes(picked.department)) && picked.status === 'DRAFT')));
      if ($('kz-eval')) $('kz-eval').disabled = !(picked && picked.canReview && picked.status !== 'DRAFT');
    });
    $('kz-rows').querySelectorAll('tr[data-pick]').forEach((tr) => { tr.ondblclick = () => kzForm(body, d, d.rows.find((r) => String(r.id) === tr.dataset.pick), rerender); });
  };
  body.innerHTML = `
    <div class="toolbar a5-filters">
      ${field('สถานะ', `<select id="kz-f-status">${options(['', ...Object.keys(KZ_STATUS)], kzFilter.status, (v) => (v ? KZ_STATUS[v][0] : 'ทั้งหมด'))}</select>`)}
      ${field('หน่วยงาน', `<select id="kz-f-dept">${options(['', ...departments], kzFilter.department, (v) => v || 'ทั้งหมด')}</select>`)}
      ${searchSlot('ค้นหา', 'kz-f-q', 'kz-f-search', { placeholder: 'เลขทะเบียน เรื่อง หรือผู้เสนอ' })}
      <div class="action-bar">${d.reviewer ? button('kz-eval', 'ประเมิน Kaizen', 'secondary', 'disabled') : ''}
        ${button('kz-open', 'ดู', 'secondary', 'disabled')}${button('kz-add', 'สร้าง', 'primary')}${button('kz-edit', 'แก้ไข', 'secondary', 'disabled')}${button('kz-del', 'ลบ', 'danger', 'disabled')}</div>
    </div>
    <div class="table-wrap sheet" id="kz-rows"></div>
    <p class="sum-meta">${kzNum(d.rows.length, 0)} ใบ · ตัวแทนสมาชิกเลือกพนักงานในสังกัดส่งเรื่องได้ (ชื่อเดิมส่งซ้ำได้) · ผู้จัดการประจำแผนกประเมินหลังส่งเรื่อง</p>`;
  $('kz-f-q').value = kzFilter.q;
  draw();
  a5Lift(body);
  $('kz-f-status').onchange = () => { kzFilter.status = $('kz-f-status').value; draw(); };
  $('kz-f-dept').onchange = () => { kzFilter.department = $('kz-f-dept').value; draw(); };
  const search = () => { kzFilter.q = $('kz-f-q').value; draw(); };
  $('kz-f-search').onclick = search;
  onEnter('kz-f-q', search);
  $('kz-add').onclick = () => kzForm(body, d, null, rerender);
  $('kz-open').onclick = () => picked && kzForm(body, d, picked, rerender);
  $('kz-edit').onclick = () => picked && kzForm(body, d, picked, rerender);
  $('kz-del').onclick = () => picked && confirmPopup('ลบใบ Kaizen', `ลบ ${esc(picked.reg_no || '')} ${esc(picked.title)}`, async () => {
    await a5Api(KZ, `kaizen/${picked.id}`, { method: 'DELETE' });
    toast('ลบแล้ว');
    rerender();
  });
  if ($('kz-eval')) $('kz-eval').onclick = () => picked && kzEvalPopup(picked, rerender);
}

// Back-of-form manager evaluation popup (FM-QSM-039 ด้านหลัง): dates, ก1 hours saved, ก2 baht saved, ข 6 non-money criteria (0..5), decision & note.
function kzEvalPopup(row, reload) {
  const scores = Array.isArray(row.scores) && row.scores.length === 6 ? row.scores : [0, 0, 0, 0, 0, 0];
  openPopup(`ประเมิน Kaizen · ${esc(row.reg_no || '')}`, `
    <p class="sum-meta">${esc(row.title)} · ผู้เสนอ ${esc(row.name || row.employee_id)} (${esc(row.department || '-')})</p>
    <div class="kz-eval-grid">
      ${field('เริ่มปฏิบัติวันที่', `<input id="kz-ev-start" type="date" value="${esc(row.start_on || row.submitted_on || '')}">`)}
      ${field('สิ้นสุด ณ วันที่', `<input id="kz-ev-end" type="date" value="${esc(row.end_on || '')}">`)}
      ${field('ก1. ลดชั่วโมงการทำงานได้ (ชม./ปี)', `<input id="kz-ev-hours" type="number" min="0" step="0.01" value="${esc(row.saved_hours ?? 0)}">`)}
      ${field('ก2. ประหยัดเป็นตัวเงินได้ (บาท)', `<input id="kz-ev-baht" type="number" min="0" step="0.01" value="${esc(row.saved_baht || (Number(row.return_month || 0) * 12) || 0)}">`)}
    </div>
    <p class="sum-meta" id="kz-ev-econ"></p>
    <div class="card-title">ข. ผลการปรับปรุงที่คำนวณเป็นเงินไม่ได้ (ข้อละ 0–5 คะแนน)</div>
    <div class="kz-scores">
      ${KZ_CRITERIA.map((label, i) => field(label, `<select data-kz-sc="${i}">${options([0, 1, 2, 3, 4, 5], scores[i], (v) => `${v} คะแนน`)}</select>`)).join('')}
    </div>
    <div class="kz-result is-main"><span>สรุปเกรดและเงินรางวัล</span><b id="kz-ev-sum">-</b><small id="kz-ev-reward">0 บาท</small></div>
    ${field('ผลการประเมิน', `<select id="kz-ev-status">${options(['APPROVED', 'REJECTED'], row.status === 'REJECTED' ? 'REJECTED' : 'APPROVED', (v) => KZ_STATUS[v][0])}</select>`)}
    ${field('ความเห็นผู้จัดการ / คณะกรรมการ', `<textarea id="kz-ev-note" rows="2" maxlength="1000">${esc(row.review_note || '')}</textarea>`)}`, async () => {
    const sc = KZ_CRITERIA.map((_, i) => Number(document.querySelector(`[data-kz-sc="${i}"]`).value || 0));
    await a5Api(KZ, `kaizen/${row.id}/status`, {
      method: 'POST',
      body: {
        status: $('kz-ev-status').value,
        start_on: $('kz-ev-start').value,
        end_on: $('kz-ev-end').value,
        saved_hours: $('kz-ev-hours').value,
        saved_baht: $('kz-ev-baht').value,
        scores: sc,
        note: $('kz-ev-note').value
      }
    });
    toast('บันทึกผลประเมินแล้ว');
    closePopup();
    reload();
  }, 'บันทึกผลประเมิน');
  const sync = () => {
    const sc = KZ_CRITERIA.map((_, i) => Number(document.querySelector(`[data-kz-sc="${i}"]`).value || 0));
    const ev = kzEvalCalc($('kz-ev-hours').value, $('kz-ev-baht').value, sc);
    $('kz-ev-econ').textContent = `ก1 ชั่วโมง: ${ev.hourGrade ? `เกรด ${ev.hourGrade} (${kzNum(ev.hourReward, 0)} บาท)` : 'ไม่เข้าเกณฑ์ (< 10 ชม.)'} · ก2 ตัวเงิน: ${ev.bahtGrade ? `เกรด ${ev.bahtGrade} (${kzNum(ev.bahtReward, 0)} บาท)` : 'ไม่เข้าเกณฑ์ (< 100 บาท)'} · ข คะแนนรวม ${ev.scoreTotal}/30: ${ev.scoreGrade ? `เกรด ${ev.scoreGrade} (${kzNum(ev.scoreReward, 0)} บาท)` : 'ไม่เข้าเกณฑ์ (< 4 คะแนน)'}`;
    $('kz-ev-sum').textContent = `เกรด ${ev.eval_grade}`;
    $('kz-ev-reward').textContent = `รางวัลรวม ${kzNum(ev.eval_reward, 0)} บาท`;
  };
  ['kz-ev-hours', 'kz-ev-baht'].forEach((id) => { $(id).oninput = sync; });
  document.querySelectorAll('[data-kz-sc]').forEach((el) => { el.onchange = sync; });
  sync();
}

// The Kaizen sheet (FM-QSM-039 ด้านหน้า + ด้านหลัง): header, proposer picker for department rep, before / after (photo 16:9 + text),
// Kaizen type, money results, non-money results, and back-of-form manager evaluation summary.
function kzForm(body, d, row, reload) {
  const editable = !row || row.canEdit;
  const canPickEmp = editable && (d.admin || (d.myDepartments || []).length > 0);
  const off = editable ? '' : ' disabled';
  const photos = { before: null, after: null };
  const empPool = [...(d.deptEmployees || [])];
  if (row && !empPool.some((e) => e.employeeId === String(row.employee_id))) {
    empPool.unshift({ employeeId: String(row.employee_id), name: row.name || row.employee_id, department: row.department || '' });
  }
  const curEmpId = String(row?.employee_id || d.me);
  const proposerField = canPickEmp
    ? field('ผู้เสนอ (เลือกสมาชิกในสังกัด · ชื่อเดิมส่งเรื่องเพิ่มได้)', `<select id="kz-emp">${empPool.map((e) => `<option value="${esc(e.employeeId)}"${e.employeeId === curEmpId ? ' selected' : ''}>${esc(e.employeeId)} · ${esc(e.name)}${e.department ? ` (${esc(e.department)})` : ''}</option>`).join('')}</select>`)
    : field('ผู้เสนอ', `<input value="${esc(row ? `${row.name || ''} · ${row.employee_id}${row.department ? ` · ${row.department}` : ''}` : 'ตัวคุณเอง')}" readonly>`);
  const photoBox = (side, label, textId, textLabel, value) => `<section class="kz-side">
      <div class="kz-side-title">${label}</div>
      <label class="kz-photo${editable ? '' : ' is-locked'}" for="kz-${side}-file" id="kz-${side}-box">${row?.[`${side}_photo`] ? `<img src="${esc(row[`${side}_photo`])}" alt="">` : '<span class="material-symbols-rounded">add_photo_alternate</span><small>เลือกรูป (ครอปเป็น 16:9 ให้อัตโนมัติ)</small>'}</label>
      <input id="kz-${side}-file" type="file" accept="image/*" hidden${off}>
      ${field(textLabel, `<textarea id="${textId}" rows="4" maxlength="2000"${off}>${esc(value || '')}</textarea>`)}
    </section>`;
  const ev = row ? kzEvalCalc(row.saved_hours, row.saved_baht, row.scores) : null;
  body.innerHTML = `
    <div class="kz-form">
      <div class="kz-head">
        <div><div class="card-title">แบบฟอร์ม Kaizen</div><strong>${row ? esc(row.reg_no || '') : 'ใบใหม่'}</strong> ${row ? kzBadge(row.status) : ''}</div>
        <div class="action-bar">${button('kz-back', 'กลับ')}${row && row.canReview && row.status !== 'DRAFT' ? button('kz-form-eval', 'ประเมิน Kaizen', 'secondary') : ''}${editable ? `${button('kz-save', 'บันทึกร่าง')}${!row || ['DRAFT', 'REJECTED'].includes(row.status) ? button('kz-send', 'บันทึกและส่งพิจารณา', 'primary') : ''}` : ''}</div>
      </div>
      <section class="card kz-top">
        ${field('เรื่อง', `<input id="kz-title" maxlength="300" value="${esc(row?.title || '')}"${off}>`, 'grow')}
        ${field('ประเภท', `<select id="kz-kind"${off}>${options(Object.keys(KZ_KINDS), row?.kind || 'person', (v) => KZ_KINDS[v])}</select>`)}
        ${field('วันที่', `<input id="kz-date" type="date" value="${esc(row?.submitted_on || new Date().toISOString().slice(0, 10))}"${off}>`)}
        ${proposerField}
        ${field('สมาชิกทีม', `<input id="kz-members" maxlength="1000" placeholder="ชื่อสมาชิก (เฉพาะประเภททีม)" value="${esc(row?.members || '')}"${off}>`, 'grow')}
      </section>
      <div class="kz-sides">
        ${photoBox('before', 'สภาพก่อนปรับปรุง', 'kz-before', 'สภาพปัจจุบัน หรือ ปัญหา ก่อนปรับปรุง', row?.before_text)}
        ${photoBox('after', 'สภาพหลังการปรับปรุง', 'kz-after', 'วิธีการปรับปรุง', row?.after_text)}
      </div>
      <div class="kz-bottom">
        <section class="card"><div class="card-title">ประเภทของ Kaizen</div>
          <div class="kz-types">${KZ_TYPES.map(([k, label]) => `<label class="check"><input type="checkbox" data-kz-type="${k}"${row?.types?.includes(k) ? ' checked' : ''}${off}> ${k === 'O' ? '' : `<b>${k}</b> : `}${label}</label>`).join('')}</div>
          ${field('อื่นๆ (ระบุ)', `<input id="kz-other" maxlength="200" value="${esc(row?.other_type || '')}"${off}>`)}
        </section>
        <section class="card"><div class="card-title">ผลที่ได้รับจากการปรับปรุง (ที่สามารถคิดเป็นตัวเงิน)</div>
          <div class="kz-money">
            ${field('ค่าแรง (บาท)', `<input id="kz-labor" type="number" min="0" step="0.01" value="${esc(row?.cost_labor ?? 0)}"${off}>`)}
            ${field('ค่าอุปกรณ์ (บาท)', `<input id="kz-material" type="number" min="0" step="0.01" value="${esc(row?.cost_material ?? 0)}"${off}>`)}
            <div class="kz-result"><span>จำนวนเงินที่ใช้ในการปรับปรุง</span><b id="kz-cost">0.00</b><small>บาท</small></div>
            ${field('ผลตอบแทนที่ได้รับ (บาท/เดือน)', `<input id="kz-return" type="number" min="0" step="0.01" value="${esc(row?.return_month ?? 0)}"${off}>`)}
            <div class="kz-result is-main"><span>ระยะเวลาในการคืนทุน</span><b id="kz-payback">-</b><small>เดือน</small></div>
          </div>
        </section>
        <section class="card"><div class="card-title">ผลที่ได้รับจากการปรับปรุง (ที่ไม่สามารถคิดเป็นตัวเงิน)</div>
          <textarea id="kz-benefit" rows="7" maxlength="2000"${off}>${esc(row?.benefit || '')}</textarea>
        </section>
      </div>
      ${row ? `<section class="card kz-eval">
        <div class="plan-head"><div class="card-title">การประเมินผล Kaizen หลังส่งเรื่อง (FM-QSM-039 ด้านหลัง)</div><span class="sum-meta">${row.reviewed_by ? `ผู้ประเมิน: ${esc(row.reviewer_name || row.reviewed_by)}` : 'รอผู้จัดการประจำแผนกประเมิน'}</span></div>
        <div class="kz-eval-grid">
          <div><span class="sum-meta">ช่วงเวลาปฏิบัติ:</span> <b>${esc(row.start_on || '-')} ถึง ${esc(row.end_on || '-')}</b></div>
          <div><span class="sum-meta">ก1. ลดชั่วโมงทำงาน:</span> <b>${kzNum(row.saved_hours || 0)} ชม./ปี (${ev.hourGrade ? `เกรด ${ev.hourGrade} · ${kzNum(ev.hourReward, 0)} บาท` : '-'})</b></div>
          <div><span class="sum-meta">ก2. ประหยัดเป็นตัวเงิน:</span> <b>${kzMoney(row.saved_baht || 0)} บาท (${ev.bahtGrade ? `เกรด ${ev.bahtGrade} · ${kzNum(ev.bahtReward, 0)} บาท` : '-'})</b></div>
          <div><span class="sum-meta">ข. คำนวณเป็นเงินไม่ได้ (6 ข้อ):</span> <b>รวม ${ev.scoreTotal}/30 คะแนน (${ev.scoreGrade ? `เกรด ${ev.scoreGrade} · ${kzNum(ev.scoreReward, 0)} บาท` : '-'})</b></div>
        </div>
        <div class="kz-result is-main"><span>สรุปเกรดประเมิน</span><b>${esc(row.eval_grade || ev.eval_grade)}</b><small>เงินรางวัลรวม ${kzNum(row.eval_reward ?? ev.eval_reward, 0)} บาท</small></div>
        ${row.review_note ? `<p class="sum-meta">ความเห็นผู้ประเมิน: ${esc(row.review_note)}</p>` : ''}
      </section>` : ''}
    </div>`;
  a5Lift(body);
  const calc = () => {
    const cost = Number($('kz-labor').value || 0) + Number($('kz-material').value || 0);
    const pay = kzPayback(cost, Number($('kz-return').value || 0));
    $('kz-cost').textContent = kzMoney(cost);
    $('kz-payback').textContent = pay == null ? '-' : kzNum(pay);
  };
  ['kz-labor', 'kz-material', 'kz-return'].forEach((id) => { $(id).oninput = calc; });
  calc();
  const syncKind = () => { $('kz-members').disabled = !editable || $('kz-kind').value !== 'team'; };
  $('kz-kind').onchange = syncKind;
  syncKind();
  const syncOther = () => { $('kz-other').disabled = !editable || !body.querySelector('[data-kz-type="O"]').checked; };
  body.querySelector('[data-kz-type="O"]').onchange = syncOther;
  syncOther();
  ['before', 'after'].forEach((side) => {
    $(`kz-${side}-file`).onchange = (e) => {
      const file = e.target.files[0];
      if (file) kzPhoto169(file).then((data) => { photos[side] = data; $(`kz-${side}-box`).innerHTML = `<img src="${data}" alt="">`; }).catch(onErr);
    };
  });
  $('kz-back').onclick = reload;
  if ($('kz-form-eval')) $('kz-form-eval').onclick = () => kzEvalPopup(row, reload);
  const save = async (send) => {
    const payload = {
      title: $('kz-title').value, kind: $('kz-kind').value, submitted_on: $('kz-date').value, members: $('kz-members').value,
      employeeId: $('kz-emp') ? $('kz-emp').value : undefined,
      before_text: $('kz-before').value, after_text: $('kz-after').value, benefit: $('kz-benefit').value, other_type: $('kz-other').value,
      types: [...body.querySelectorAll('[data-kz-type]:checked')].map((x) => x.dataset.kzType),
      cost_labor: $('kz-labor').value, cost_material: $('kz-material').value, return_month: $('kz-return').value
    };
    const saved = row ? await a5Api(KZ, `kaizen/${row.id}`, { method: 'PATCH', body: payload }) : await a5Api(KZ, 'kaizen', { method: 'POST', body: payload });
    const id = row?.id || saved.id;
    for (const side of ['before', 'after']) if (photos[side]) await a5Api(KZ, `kaizen/${id}/photo`, { method: 'POST', body: { side, image: photos[side] } });
    if (send) await a5Api(KZ, `kaizen/${id}/status`, { method: 'POST', body: { status: 'SUBMITTED' } });
    toast(send ? 'ส่งพิจารณาแล้ว' : `บันทึกแล้ว${saved.reg_no ? ` · เลขทะเบียน ${saved.reg_no}` : ''}`);
    reload();
  };
  if ($('kz-save')) $('kz-save').onclick = () => save(false).catch(onErr);
  if ($('kz-send')) $('kz-send').onclick = () => save(true).catch(onErr);
}

// ---------- Setting ----------

async function kzSetting(target) {
  const { me, body } = await kzFrame(target, KZ_SET_TABS, 'data-kzset', kzSetTab);
  const rerender = () => kzSetting(target).catch(onErr);
  target.querySelectorAll('[data-kzset]').forEach((node) => { node.onclick = () => { kzSetTab = node.dataset.kzset; rerender(); }; });
  $('a5-year').onchange = () => { a5Year = Number($('a5-year').value); rerender(); };
  if (kzSetTab === 'team') return kzSetTeam(body, me.access.admin, rerender);
  return aplRender(body, KZ, { inPage: true });
}

// Setting > ทีม: ประธาน · รองประธาน · ผู้ดูแล · ตัวแทนสมาชิก (ประจำแผนก + จำนวนเรื่องที่ต้องส่งต่อปี + ผู้จัดการประเมิน Kaizen).
async function kzSetTeam(body, admin, rerender) {
  const data = await a5Api(KZ, `team?year=${a5Year}`);
  let picked = null;
  const keys = Object.keys(KZ_ROLE_LABEL);
  const depts = data.departments || [];
  const rows = listQuery(
    [...data.members].sort((a, b) => keys.indexOf(a.role) - keys.indexOf(b.role) || String(a.department || '').localeCompare(String(b.department || '')) || String(a.employee_id).localeCompare(String(b.employee_id))),
    kzTeamHead,
    (m, key) => (key === 'role' ? KZ_ROLE_LABEL[m.role] || m.role : m[key] ?? '')
  );
  body.innerHTML = `
    ${admin ? `<div class="action-bar a5-actions">${button('kz-t-add', 'เพิ่มสมาชิก', 'primary')}${button('kz-t-edit', 'แก้ไข', 'secondary', 'disabled')}${button('kz-t-del', 'ลบ', 'danger', 'disabled')}${button('kz-t-copy', `คัดลอกจากปี ${a5Year - 1}`)}</div>` : ''}
    <div class="table-wrap sheet" id="kz-t-rows"></div>
    <p class="sum-meta">${kzNum(rows.length, 0)} รายชื่อ · ตัวแทนสมาชิกจะดูแลแผนกตนเอง เลือกสมาชิกในสังกัดส่ง Kaizen และระบุผู้จัดการประเมินหลังส่งเรื่อง</p>`;
  fillTable('kz-t-rows', [
    { label: 'บทบาท', key: 'role' },
    { label: 'รหัส', key: 'employee_id' },
    { label: 'ชื่อ', key: 'name' },
    { label: 'แผนกที่ดูแล', key: 'department' },
    { label: 'เป้าส่ง/ปี (เรื่อง)', key: 'target_count', num: true },
    { label: 'ผู้จัดการประเมิน Kaizen', key: 'manager_name' },
    { label: 'สถานะ', key: 'status' }
  ], rows.map((m) => `<tr data-pick="${m.id}"><td>${esc(KZ_ROLE_LABEL[m.role] || m.role)}</td><td>${esc(m.employee_id)}</td><td>${esc(m.name)}</td><td>${esc(m.department || '')}</td>
    <td class="num">${m.role === 'member' ? kzNum(m.target_count || 0, 0) : '-'}</td><td>${m.role === 'member' ? (m.manager_id ? `${esc(m.manager_id)} · ${esc(m.manager_name)}` : '<span class="sum-meta">ยังไม่ระบุ</span>') : '-'}</td><td>${esc(m.status)}</td></tr>`).join(''),
  `ยังไม่มีทีมปี ${a5Year}`, headFor(kzTeamHead, () => kzSetTeam(body, admin, rerender).catch(onErr)));
  a5Lift(body);
  if (!admin) return;
  bindRowSelect($('kz-t-rows'), (id) => {
    picked = rows.find((m) => String(m.id) === id);
    $('kz-t-edit').disabled = !picked;
    $('kz-t-del').disabled = !picked;
  });
  const mgrBlock = searchBlock(searchSlot('ค้นผู้จัดการประเมิน', 'kz-mgr-q', 'kz-mgr-search', { placeholder: 'รหัส ชื่อ หรือแผนก' }), 'kz-mgr-list');
  const openTeamForm = (m) => {
    let chosenEmp = m ? { employeeId: m.employee_id, name: m.name, department: m.department } : null;
    let chosenMgr = m?.manager_id ? { employeeId: m.manager_id, name: m.manager_name } : null;
    openPopup(m ? `แก้ไขทีม · ${esc(m.name || m.employee_id)}` : `เพิ่มสมาชิกทีมปี ${a5Year}`, `
      ${m ? '' : `${A5_EMP_FIELDS}${field('พนักงานที่เลือก', '<input id="kz-team-pick" readonly placeholder="เลือกจากรายชื่อ">')}`}
      ${field('บทบาท', `<select id="kz-role"${m ? ' disabled' : ''}>${options(keys, m?.role || 'member', (v) => KZ_ROLE_LABEL[v])}</select>`)}
      <datalist id="kz-dept-list">${depts.map((d) => `<option value="${esc(d)}">`).join('')}</datalist>
      ${field('แผนกที่ดูแล (เฉพาะตัวแทนสมาชิก)', `<input id="kz-dept" list="kz-dept-list" maxlength="80" value="${esc(m?.department || '')}" placeholder="เช่น PD1">`)}
      ${field('จำนวนเรื่องที่ต้องส่งต่อปี (เฉพาะตัวแทนสมาชิก)', `<input id="kz-target" type="number" min="0" step="1" value="${esc(m?.target_count ?? 0)}">`)}
      <div id="kz-mgr-wrap">
        ${mgrBlock}
        ${field('ผู้จัดการประเมิน Kaizen หลังส่งเรื่อง', `<input id="kz-mgr-pick" readonly value="${esc(chosenMgr ? `${chosenMgr.employeeId} · ${chosenMgr.name}` : '')}" placeholder="ค้นและเลือกผู้จัดการประเมิน">`)}
      </div>
      ${m ? field('สถานะ', `<select id="kz-status">${options(['Active', 'Inactive'], m.status || 'Active')}</select>`) : ''}`, async () => {
      const role = $('kz-role').value;
      if (!m) {
        if (!chosenEmp) throw new Error('เลือกพนักงานจากรายชื่อก่อน');
        await a5Api(KZ, 'team', {
          method: 'POST',
          body: {
            year: a5Year,
            employeeId: chosenEmp.employeeId,
            role,
            department: $('kz-dept').value.trim(),
            targetCount: $('kz-target').value,
            managerId: chosenMgr?.employeeId || ''
          }
        });
        toast('เพิ่มแล้ว');
      } else {
        await a5Api(KZ, `team/${m.id}`, {
          method: 'PATCH',
          body: {
            department: $('kz-dept').value.trim(),
            targetCount: $('kz-target').value,
            managerId: chosenMgr?.employeeId || '',
            status: $('kz-status').value
          }
        });
        toast('บันทึกแล้ว');
      }
      closePopup();
      rerender();
    });
    if (!m) {
      a5EmployeeSearch(KZ, (p) => {
        chosenEmp = p;
        $('kz-team-pick').value = `${p.employeeId} · ${p.name}`;
        if ($('kz-role').value === 'member' && !$('kz-dept').value && p.department) $('kz-dept').value = p.department;
      });
    }
    const runMgrSearch = async () => {
      const r = await a5Api(KZ, `employees?year=${a5Year}&q=${encodeURIComponent($('kz-mgr-q').value.trim())}`);
      $('kz-mgr-list').innerHTML = r.employees.map((p) => `<button type="button" class="emp-item" data-id="${esc(p.employeeId)}" data-name="${esc(p.name)}"><strong>${esc(p.employeeId)}</strong><span>${esc(p.name)}</span><small>${esc(p.department)}</small></button>`).join('') || '<div class="empty">ไม่พบพนักงาน</div>';
      $('kz-mgr-list').querySelectorAll('.emp-item').forEach((node) => {
        node.onclick = () => {
          chosenMgr = { employeeId: node.dataset.id, name: node.dataset.name };
          $('kz-mgr-pick').value = `${chosenMgr.employeeId} · ${chosenMgr.name}`;
        };
      });
    };
    $('kz-mgr-search').onclick = () => runMgrSearch().catch(onErr);
    onEnter('kz-mgr-q', () => runMgrSearch().catch(onErr));
    const syncRole = () => {
      const isMember = $('kz-role').value === 'member';
      $('kz-dept').disabled = !isMember;
      $('kz-target').disabled = !isMember;
      $('kz-mgr-wrap').hidden = !isMember;
    };
    $('kz-role').onchange = syncRole;
    syncRole();
  };
  $('kz-t-add').onclick = () => openTeamForm(null);
  $('kz-t-edit').onclick = () => picked && openTeamForm(picked);
  $('kz-t-del').onclick = () => picked && confirmPopup('ลบรายชื่อ', `ตรวจ ${esc(picked.employee_id)} ${esc(picked.name)} (${esc(KZ_ROLE_LABEL[picked.role] || picked.role)}) อีกครั้งก่อนลบ`, async () => {
    await a5Api(KZ, `team/${picked.id}`, { method: 'DELETE' });
    toast('ลบแล้ว');
    rerender();
  });
  $('kz-t-copy').onclick = () => confirmPopup('คัดลอกทีม', `คัดลอกรายชื่อทีมปี ${a5Year - 1} มาเป็นปี ${a5Year} (รวมเป้าส่งและผู้จัดการประเมิน)`, async () => {
    const r = await a5Api(KZ, 'team/copy', { method: 'POST', body: { from: a5Year - 1, to: a5Year } });
    toast(`คัดลอก ${r.copied} รายชื่อ`);
    rerender();
  }, 'คัดลอก');
}

Object.assign(VIEWS, { [`${KZ}-home`]: kzDashboard, [`${KZ}-edit`]: kzEntries, [`${KZ}-setting`]: kzSetting });
