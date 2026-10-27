// ระบบกิจกรรม > CFO (Carbon Footprint for Organization): Dashboard (Summary / Scope / Company / Team / Schedule),
// transaction (TSATP4-CFO Scope pages + บันทึกกิจกรรม), Setting (plan / activities / emission factors / team / company). Server: server/modules/act/cfo.js
// spec: docs/specs/act-cfo.md · uses the shared year (a5Year), page bar slots and team tab of act-5s.js.
const CFO = 'cfo';
// Scope 1/2/3 colours = the shared chart palette (core.js CHART, cool tone here): this year teal shades, the base year slate.
const CFO_SCOPE_COLORS = CHART_THEMES.cool.series.slice(0, 3);
const CFO_BASE_COLORS = CHART_THEMES.cool.base;
const CFO_ROLE_LABEL = { admin: 'ผู้จัดทำ', chairman: 'ประธาน', vice: 'รองประธาน', member: 'ตัวแทนหน่วยงาน' };
const CFO_DASH_TABS = { summary: 'Summary', report: 'Summary 2', scope: 'Scope', company: 'Company Overview', team: 'Team', schedule: 'Schedule' };
const CFO_SET_TABS = { plan: 'แผนงาน', activities: 'กิจกรรม', ef: 'Emission Factor', team: 'ทีม', company: 'บริษัท' };
const CFO_COMPANY = [['company_name', 'ชื่อธุรกิจ'], ['company_address', 'สถานที่ตั้ง'], ['company_area', 'พื้นที่โรงงาน'], ['company_business', 'ประเภทธุรกิจ'],
  ['company_customers', 'กลุ่มลูกค้าหลัก'], ['company_employees', 'จำนวนพนักงาน'], ['company_updated', 'อัพเดท (วันที่)'], ['company_photo1', 'ลิงก์รูป 1'], ['company_photo2', 'ลิงก์รูป 2'],
  ['base_year', 'ปีฐาน'], ['target_percent', 'เป้าลด (% จากปีฐาน)'], ['septic_bod', 'บ่อเกรอะ BOD (g/คน/วัน)'], ['septic_b0', 'บ่อเกรอะ B0'], ['septic_mcf', 'บ่อเกรอะ MCF'], ['septic_i', 'บ่อเกรอะ I']];
const CFO_EF_GAS = [['co2', 'CO₂'], ['ch4_fossil', 'Fossil CH₄'], ['ch4', 'CH₄'], ['n2o', 'N₂O'], ['hfc', 'HFCs'], ['pfc', 'PFCs']];
let cfoDashTab = 'summary';
let cfoSetTab = 'plan';
const cfoFilter = { scope: '', department: '', q: '', status: '' };
const cfoDash = { department: '', chartScope: '', scope: '1' };
// transaction filters: Scope → month (one month, or '' = the year) → category (main) → activity (sub)
const cfoTx = { scope: '1', month: String(new Date().getMonth() + 1), category: '', activity: '' };
const cfoHeads = { entries: { sort: '', dir: 'asc', filters: {} }, activities: { sort: '', dir: 'asc', filters: {} }, ef: { sort: '', dir: 'asc', filters: {} } };

const cfoT = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 3 });
const cfoPct = (part, total) => (total ? `${Math.round((part / total) * 1000) / 10}%` : '0%');
const cfoMonthIso = (m) => `${a5Year}-${String(m).padStart(2, '0')}`;

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
  const { me, body } = await cfoFrame(target, CFO_DASH_TABS, 'data-cfodash', cfoDashTab);
  const rerender = () => cfoDashboard(target).catch(onErr);
  target.querySelectorAll('[data-cfodash]').forEach((node) => { node.onclick = () => { cfoDashTab = node.dataset.cfodash; rerender(); }; });
  $('a5-year').onchange = () => { a5Year = Number($('a5-year').value); rerender(); };
  if (cfoDashTab === 'schedule') return aplRender(body, CFO, { inPage: true, readOnly: true });
  if (cfoDashTab === 'scope') return cfoDrawProgress(body);
  if (cfoDashTab === 'report') return cfoDrawReport(body);
  if (cfoDashTab === 'company') return cfoDrawCompany(body, me.access.admin, rerender);
  if (cfoDashTab === 'team') return cfoDrawTeam(body, me.access.admin);
  return cfoDrawSummary(body);
}

// Change against the compared year (base year, or last year without one): +x% / −x%.
// Summary (like carbon-form "Accumulation CO2 Emission"): KPI cards with a share pie and a change pill,
// then per month stacked bars (base year next to this year, by Scope) with cumulative lines for this year, the base
// year and the target (base × (1 − target%)). Hover a month for its numbers. Department and Scope filter everything.
async function cfoDrawSummary(body) {
  const d = await a5Api(CFO, `cfo/summary?year=${a5Year}&department=${encodeURIComponent(cfoDash.department)}`);
  const c = d.compare;
  const baseName = c.isBase ? `ค่าปีฐาน (${c.year})` : `ปี ${c.year}`;
  const pick = Number(cfoDash.chartScope) || 0;
  const scopes = pick ? [pick] : [1, 2, 3];
  const cur = d.months.map((m) => (pick ? m.scopes[pick - 1] : m.total));
  const was = d.months.map((m) => (pick ? m.baseScopes[pick - 1] : m.base));
  const hasBase = was.some((v) => v > 0);
  const factor = 1 - c.target / 100;
  const lastMonth = cur.reduce((last, v, i) => (v > 0 ? i : last), -1);
  const cumulative = (list, upto = 11) => { let t = 0; return list.map((v, i) => (i > upto ? null : (t += v))); };
  const cumNow = cumulative(cur, lastMonth);
  const cumBase = hasBase ? cumulative(was) : [];
  const departments = [...new Set([...d.departments.map((x) => x.key), cfoDash.department].filter(Boolean))].sort();
  // Two axes: left = monthly bars, right = cumulative lines (a year adds up to ~12 bars, one axis would flatten them).
  const chart = chartPlot({
    id: 'cfo-area',
    labels: ACT_MONTHS_SHORT,
    left: 'รายเดือน (tCO₂e)',
    right: 'สะสม (tCO₂e)',
    bars: [
      ...(hasBase ? [{ values: d.months.map((m, i) => (pick ? [was[i]] : m.baseScopes)), colors: pick ? [CFO_BASE_COLORS[pick - 1]] : CFO_BASE_COLORS }] : []),
      { values: d.months.map((m, i) => (pick ? [cur[i]] : m.scopes)), colors: pick ? [CFO_SCOPE_COLORS[pick - 1]] : CFO_SCOPE_COLORS }
    ],
    lines: [
      ...(hasBase ? [{ values: cumBase, color: CHART.dark, axis: 'right' }, { values: cumBase.map((v) => v * factor), color: CHART.target, dash: true, axis: 'right' }] : []),
      { values: cumNow, color: CHART.line, axis: 'right' }
    ],
    legend: [
      { line: CHART.line, label: 'ค่าปีปัจจุบัน (สะสม)' },
      ...(hasBase ? [{ line: CHART.dark, label: `${baseName} (สะสม)` }, { line: CHART.target, dash: true, label: `ค่าเป้าหมาย (−${c.target}%)` },
        { head: c.isBase ? 'ปีฐาน' : `ปี ${c.year}` }, ...scopes.map((n) => ({ box: CFO_BASE_COLORS[n - 1], label: `Scope ${n}` }))] : []),
      { head: `ปี ${a5Year}` }, ...scopes.map((n) => ({ box: CFO_SCOPE_COLORS[n - 1], label: `Scope ${n}` }))
    ]
  });
  body.innerHTML = `
    <div class="toolbar a5-filters">
      ${field('หน่วยงาน', `<select id="cfo-d-dept">${options(['', ...departments], cfoDash.department, (v) => v || 'ทั้งหมด')}</select>`)}
      ${field('Scope', `<select id="cfo-d-scope">${options(['', '1', '2', '3'], cfoDash.chartScope, (v) => (v ? `Scope ${v}` : 'All Scope'))}</select>`)}
    </div>
    <div class="ch-kpis">
      ${chartKpi({ label: 'Total Emission', value: cfoT(d.total), unit: 'tCO₂e', icon: 'co2', pill: chartPill(d.total, c.total), note: c.total ? `เทียบ${baseName}` : `ไม่มีข้อมูล${baseName}` })}
      ${d.scopes.map((x, i) => chartKpi({ label: `Scope ${x.scope}`, value: cfoT(x.tco2e), unit: 'tCO₂e', pill: chartPill(x.tco2e, c.scopes[i]), note: `${cfoPct(x.tco2e, d.total)} ของทั้งหมด`, color: CFO_SCOPE_COLORS[i], pie: d.total ? (x.tco2e / d.total) * 100 : 0 })).join('')}
    </div>
    ${chartCard(`Accumulation CO₂ Emission${pick ? ` · Scope ${pick}` : ''}`, chart)}
    <div class="table-wrap cfo-month-table"><table class="mo-data-table"><thead><tr><th>เดือน</th>${hasBase ? `<th class="num">${esc(baseName)}</th>` : ''}<th class="num">ปี ${a5Year}</th>${hasBase ? '<th class="num">เป้า</th>' : ''}<th class="num">Scope 1</th><th class="num">Scope 2</th><th class="num">Scope 3</th></tr></thead>
      <tbody>${d.months.map((m) => `<tr><td>${ACT_MONTHS[m.month - 1]}</td>${hasBase ? `<td class="num">${cfoT(m.base)}</td>` : ''}<td class="num">${cfoT(m.total)}</td>${hasBase ? `<td class="num">${cfoT(m.target)}</td>` : ''}${m.scopes.map((x) => `<td class="num">${cfoT(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  a5Lift(body);
  $('cfo-d-dept').onchange = () => { cfoDash.department = $('cfo-d-dept').value; cfoDrawSummary(body).catch(onErr); };
  $('cfo-d-scope').onchange = () => { cfoDash.chartScope = $('cfo-d-scope').value; cfoDrawSummary(body).catch(onErr); };
  // Hover a month: its emission, against the target and the base year.
  chartTip('cfo-area', (i) => {
    const target = was[i] * factor;
    return `<strong>การปล่อยคาร์บอนเดือน ${ACT_MONTHS_SHORT[i]}</strong>
      <div class="ch-tip-row"><span>ปี ${a5Year}</span><b>${cfoT(cur[i])} tCO₂e</b></div>
      ${hasBase ? `<div class="ch-tip-row"><span>${esc(baseName)}</span><b>${cfoT(was[i])}</b></div><div class="ch-tip-row"><span>เป้า</span><b>${cfoT(target)}</b></div>
      ${cur[i] ? `${chartPill(cur[i], target, ' เทียบกับค่าเป้าหมาย')}<div class="ch-tip-note">${chartPill(cur[i], was[i], ` เทียบกับ${c.isBase ? 'ค่าปีฐาน' : `ปี ${c.year}`}`)}</div>` : ''}` : ''}
      <div class="ch-tip-row"><span>สะสมถึงเดือนนี้</span><b>${cfoT(cumNow[i] ?? 0)}</b></div>`;
  });
}

// Dashboard > Summary 2 (TGO CFO summary sheet): base year next to this year — each Scope and its categories with
// tCO2e, share within the Scope, share of Scope 1+2 and of Scope 1+2+3, then Carbon intensity per piece produced
// (production_<year> in Setting > บริษัท). Filter: department.
async function cfoDrawReport(body) {
  const d = await a5Api(CFO, `cfo/summary?year=${a5Year}&department=${encodeURIComponent(cfoDash.department)}`);
  const c = d.compare;
  const departments = [...new Set([...d.departments.map((x) => x.key), cfoDash.department].filter(Boolean))].sort();
  const years = [{ key: 'base', year: c.year, title: c.isBase ? `ปีฐาน ${c.year}` : `ปี ${c.year} (ยังไม่ตั้งปีฐาน)` }, { key: 'tco2e', year: a5Year, title: `ปีปัจจุบัน ${a5Year}` }];
  const pct = (part, total) => (total ? (Math.round((part / total) * 10000) / 100).toFixed(2) : '-');
  const table = ({ key, year, title }) => {
    const byScope = [1, 2, 3].map((n) => d.categories.filter((g) => g.scope === n).reduce((t, g) => t + g[key], 0));
    const s12 = byScope[0] + byScope[1];
    const s123 = s12 + byScope[2];
    const pieces = Number(d.settings[`production_${year}`]) || 0;
    const row = (cls, label, v, inScope, scope) => `<tr class="${cls}"><td>${label}</td><td class="num">${cfoT(v)}</td><td class="num">${inScope}</td>
      <td class="num">${scope < 3 ? pct(v, s12) : ''}</td><td class="num">${pct(v, s123)}</td></tr>`;
    const rows = [1, 2, 3].map((n) => row('cfo-group', `Scope ${n}`, byScope[n - 1], byScope[n - 1] ? '100.00' : '-', n)
      + d.categories.filter((g) => g.scope === n).map((g) => row('cfo-sub', esc(g.label), g[key], pct(g[key], byScope[n - 1]), n)).join('')).join('');
    const intensity = (label, v) => `<tr><td>Carbon intensity (${label})</td><td class="num">${pieces ? (v / pieces).toFixed(4) : '-'}</td><td colspan="3" class="sum-meta">tCO₂e / ชิ้น · ${pieces ? `ผลิต ${cfoT(pieces)} ชิ้น` : 'ยังไม่มีปริมาณผลิต (Setting > บริษัท)'}</td></tr>`;
    return chartCard(title, `<div class="table-wrap cfo-report"><table class="mo-data-table"><thead><tr><th>ขอบเขต</th><th class="num">tCO₂e</th><th class="num">สัดส่วน (%)</th><th class="num">สัดส่วน (%)<br>Scope 1+2</th><th class="num">สัดส่วน (%)<br>Scope 1+2+3</th></tr></thead>
      <tbody>${rows}
        <tr class="cfo-total"><td>รวม Scope 1 + 2</td><td class="num">${cfoT(s12)}</td><td></td><td class="num">${s12 ? '100.00' : '-'}</td><td></td></tr>
        <tr class="cfo-total"><td>รวม Scope 1 + 2 + 3</td><td class="num">${cfoT(s123)}</td><td></td><td></td><td class="num">${s123 ? '100.00' : '-'}</td></tr>
        ${intensity('Scope 1+2', s12)}${intensity('Scope 1+2+3', s123)}</tbody></table></div>`, 'ม.ค. – ธ.ค.');
  };
  const scopeSum = (key) => [1, 2, 3].map((n) => d.categories.filter((g) => g.scope === n).reduce((t, g) => t + g[key], 0));
  const [was, now] = [scopeSum('base'), scopeSum('tco2e')];
  const chart = chartPlot({
    id: 'cfo-cmp', labels: ['Scope 1', 'Scope 2', 'Scope 3'], left: 'tCO₂e',
    bars: [{ values: was, colors: [CFO_BASE_COLORS[1]] }, { values: now, colors: [CFO_SCOPE_COLORS[0]] }],
    legend: [{ box: CFO_BASE_COLORS[1], label: years[0].title }, { box: CFO_SCOPE_COLORS[0], label: years[1].title }]
  });
  body.innerHTML = `
    <div class="toolbar a5-filters">${field('หน่วยงาน', `<select id="cfo-d-dept">${options(['', ...departments], cfoDash.department, (v) => v || 'ทั้งหมด')}</select>`)}</div>
    ${chartCard('เปรียบเทียบตาม Scope', chart, 'tCO₂e ทั้งปี')}
    <div class="a5-two">${years.map(table).join('')}</div>`;
  a5Lift(body);
  $('cfo-d-dept').onchange = () => { cfoDash.department = $('cfo-d-dept').value; cfoDrawReport(body).catch(onErr); };
  chartTip('cfo-cmp', (i) => `<strong>Scope ${i + 1}</strong>
    <div class="ch-tip-row"><span>${esc(years[0].title)}</span><b>${cfoT(was[i])} tCO₂e</b></div>
    <div class="ch-tip-row"><span>${esc(years[1].title)}</span><b>${cfoT(now[i])} tCO₂e</b></div>
    ${now[i] && was[i] ? chartPill(now[i], was[i], ` เทียบ${esc(years[0].title)}`) : ''}`);
}

// Dashboard > Scope: how complete each activity is this year — 12 month cells (recorded / due but missing),
// % recorded of the months due, quantity and tCO2e. Filters: Scope, department, search.
async function cfoDrawProgress(body) {
  const d = await a5Api(CFO, `cfo/progress?year=${a5Year}`);
  const scope = Number(cfoDash.scope) || 1;
  const rows = d.rows.filter((r) => String(r.scope_code || '').startsWith(`${scope}-`));
  const departments = [...new Set(rows.map((r) => r.department))].sort();
  body.innerHTML = `
    <div class="toolbar a5-filters">
      ${field('Scope', `<select id="cfo-p-scope">${options(['1', '2', '3'], String(scope), (v) => `Scope ${v}`)}</select>`)}
      ${field('หน่วยงาน', `<select id="cfo-f-dept">${options(['', ...departments], cfoFilter.department, (v) => v || 'ทั้งหมด')}</select>`)}
      ${searchSlot('ค้นหา', 'cfo-f-q', 'cfo-f-search', { placeholder: 'กิจกรรมหรือรายละเอียด' })}
    </div>
    <div class="table-wrap sheet" id="cfo-rows"></div>
    <p class="sum-meta" id="cfo-sum"></p>`;
  $('cfo-f-q').value = cfoFilter.q;
  const draw = () => {
    const term = cfoFilter.q.trim().toLowerCase();
    const list = listQuery(rows.filter((r) => (!cfoFilter.department || r.department === cfoFilter.department)
      && (!term || `${r.name} ${r.detail || ''} ${r.source || ''}`.toLowerCase().includes(term))), cfoHeads.entries, (r, key) => r[key] ?? '');
    const cells = (r) => `<div class="cfo-months">${Array.from({ length: 12 }, (_, i) => `<i class="${r.months.includes(i + 1) ? 'is-done' : i < d.due ? 'is-missing' : ''}" title="${ACT_MONTHS_SHORT[i]}"></i>`).join('')}</div>`;
    // Category is a group row (sub heading) over its activities; sorting works inside each group.
    const groups = [...new Set(list.map((r) => r.category))];
    fillTable('cfo-rows', [{ label: 'หน่วยงาน', key: 'department' }, { label: 'กิจกรรม', key: 'name' }, { label: 'รายละเอียด', key: 'detail' }, 'รายเดือน',
      { label: 'ครบ', key: 'percent' }, { label: 'ปริมาณรวม', key: 'qty' }, 'หน่วย', { label: 'tCO₂e', key: 'tco2e' }],
    groups.map((g) => `<tr class="cfo-group"><td colspan="8">${esc(g || '-')}</td></tr>${list.filter((r) => r.category === g).map((r) => `<tr><td>${esc(r.department)}</td><td>${esc(r.name)}</td><td>${esc(r.detail || '')}</td><td>${cells(r)}</td>
      <td><div class="cfo-prog"><span><i style="width:${r.percent}%"></i></span>${r.percent}%</div></td><td class="num">${cfoT(r.qty)}</td><td>${esc(r.unit || '')}</td><td class="num">${cfoT(r.tco2e)}</td></tr>`).join('')}`).join(''), 'ไม่มีกิจกรรม', headFor(cfoHeads.entries, draw));
    const full = list.filter((r) => r.percent >= 100).length;
    $('cfo-sum').textContent = `Scope ${scope} · ${list.length} กิจกรรม · ครบถึงเดือนปัจจุบัน ${full} · ขาด ${list.length - full} · รวม ${cfoT(list.reduce((t, r) => t + r.tco2e, 0))} tCO₂e`;
  };
  draw();
  a5Lift(body);
  $('cfo-p-scope').onchange = () => { cfoDash.scope = $('cfo-p-scope').value; cfoDrawProgress(body).catch(onErr); };
  $('cfo-f-dept').onchange = () => { cfoFilter.department = $('cfo-f-dept').value; draw(); };
  const search = () => { cfoFilter.q = $('cfo-f-q').value; draw(); };
  $('cfo-f-search').onclick = search;
  onEnter('cfo-f-q', search);
}

// Google Drive links (uc?export=view / file/d/<id>) show through the thumbnail URL, as TSATP4-CFO drivePhotoUrl_.
function cfoPhotoSrc(url, width = 1600) {
  const id = String(url || '').match(/drive\.google\.com.*(?:[?&]id=|\/d\/)([\w-]+)/);
  return id ? `https://drive.google.com/thumbnail?id=${id[1]}&sz=w${width}` : url;
}

// Resize a photo to JPEG within 1600 px and about 650 KB (bucket limit 700 KB), keeping its shape.
function cfoJpeg(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
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

// Company Overview (TSATP4-CFO): company lines, customer logo picture (photo 1) and building picture (photo 2).
async function cfoDrawCompany(body, admin, rerender) {
  const s = (await a5Api(CFO, 'cfo/master')).settings;
  const updated = s.company_updated ? new Date(`${s.company_updated}T00:00:00`) : null;
  const line = (label, value) => (value ? `<div class="cfo-co-line"><span>${esc(label)} :</span><strong>${esc(value)}</strong></div>` : '');
  const img = (url, cls) => (url ? `<img class="${cls}" src="${esc(cfoPhotoSrc(url))}" alt="" loading="lazy">` : '');
  body.innerHTML = `
    ${admin ? `<div class="action-bar a5-actions">${button('cfo-co-edit', 'แก้ไขข้อมูล')}</div>` : ''}
    <section class="card cfo-co">
      <div class="cfo-co-text">
        <h2>Company Overview</h2>
        ${line('ชื่อธุรกิจ', s.company_name)}${line('สถานที่ตั้ง', s.company_address)}${line('พื้นที่โรงงาน', s.company_area)}
        ${line('ประเภทของธุรกิจ', s.company_business)}${line('กลุ่มลูกค้าหลัก', s.company_customers)}
        ${line('จำนวนพนักงาน', s.company_employees ? `${s.company_employees} คน${updated && !Number.isNaN(updated.getTime()) ? ` อัพเดท ${updated.toLocaleDateString('en-GB')}` : ''}` : '')}
        ${s.base_year ? line('ปีฐาน', `${s.base_year} · เป้าลด ${s.target_percent || 5}%`) : ''}
        ${s.company_name ? '' : '<p class="empty">ยังไม่มีข้อมูลบริษัท</p>'}
      </div>
      ${img(s.company_photo1, 'cfo-co-logo')}
      ${img(s.company_photo2, 'cfo-co-building')}
    </section>`;
  a5Lift(body);
  if (!admin) return;
  $('cfo-co-edit').onclick = () => {
    const picked = {};
    const fields = CFO_COMPANY.filter(([key]) => key.startsWith('company_') && !key.startsWith('company_photo'))
      .map(([key, label]) => field(label, `<input id="cfo-s-${key}" maxlength="1000" value="${esc(s[key] ?? '')}"${key === 'company_updated' ? ' type="date"' : ''}>`)).join('');
    openPopup('แก้ไข Company Overview', `${fields}
      ${field('รูปโลโก้ลูกค้า (รูป 1)', '<input id="cfo-s-photo1" type="file" accept="image/*">')}
      ${field('รูปอาคาร (รูป 2)', '<input id="cfo-s-photo2" type="file" accept="image/*">')}
      <p class="sum-meta">ไม่เลือกรูป = ใช้รูปเดิม · รูปเก็บใน ${CFO === 'cfo' ? 'img_cfo' : ''}</p>`, async () => {
      for (const slot of [1, 2]) if (picked[slot]) await a5Api(CFO, 'cfo/photo', { method: 'POST', body: { slot, image: picked[slot] } });
      const values = Object.fromEntries(CFO_COMPANY.filter(([key]) => $(`cfo-s-${key}`)).map(([key]) => [key, $(`cfo-s-${key}`).value]));
      await a5Api(CFO, 'cfo/settings', { method: 'PUT', body: values });
      toast('บันทึกแล้ว');
      closePopup();
      rerender();
    });
    [1, 2].forEach((slot) => {
      $(`cfo-s-photo${slot}`).onchange = (e) => { const f = e.target.files[0]; if (f) cfoJpeg(f).then((data) => { picked[slot] = data; }).catch(onErr); };
    });
  };
}

// Team Member (TSATP4-CFO): org chart by level — ประธาน · รองประธาน / ผู้จัดทำ · สมาชิก (ตัวแทนหน่วยงาน).
async function cfoDrawTeam(body, admin) {
  const team = await a5Api(CFO, `team?year=${a5Year}`);
  const active = team.members.filter((p) => p.status === 'Active');
  const first = (name) => String(name || '').replace(/^(นางสาว|นาง|นาย|Mr\.?|Mrs\.?|Ms\.?|Miss)\s*/, '').split(/\s+/)[0];
  const tiers = [
    { label: 'ประธาน', color: 'var(--cfo-tier-1)', people: active.filter((p) => p.role === 'chairman') },
    { label: 'รองประธาน , ผู้จัดทำ', color: 'var(--cfo-tier-2)', people: [...active.filter((p) => p.role === 'vice'), ...active.filter((p) => p.role === 'admin')] },
    { label: 'สมาชิก', color: 'var(--cfo-tier-3)', people: active.filter((p) => p.role === 'member').sort((a, b) => String(a.department).localeCompare(String(b.department))) }
  ];
  const card = (p) => `<div class="cfo-person"><span class="material-symbols-rounded">person</span><strong>${esc(p.name ? `คุณ${first(p.name)}` : p.employee_id)}</strong><small>${esc(p.department || '')}</small></div>`;
  body.innerHTML = `
    ${admin ? `<div class="action-bar a5-actions">${button('cfo-team-edit', 'แก้ไขทีม')}</div>` : ''}
    <section class="card cfo-team">
      <div class="plan-head"><div class="card-title">Team Member · ปี ${a5Year}</div><span class="sum-meta">${active.length} คน</span></div>
      ${tiers.map((t) => `<div class="cfo-tier">${t.people.length ? `<div class="cfo-tier-people">${t.people.map(card).join('')}</div>` : '<p class="empty">ยังไม่มี</p>'}
        <div class="cfo-tier-rule" style="--tier:${t.color}"><span>${esc(t.label)}</span></div></div>`).join('')}
    </section>`;
  a5Lift(body);
  if (admin) $('cfo-team-edit').onclick = () => { cfoSetTab = 'team'; openView(`${CFO}-setting`); };
}

// ---------- transaction: TSATP4-CFO Scope pages + บันทึกกิจกรรม ----------
// Activities of one Scope grouped by category (main) with their rows (sub). Month = values of that month (or the year).
// Pick a row you may record (your department, or all for ผู้จัดทำ) → บันทึกกิจกรรม. ผู้จัดทำ confirms / reopens a month.
async function cfoEntries(target) {
  const { me, body } = await cfoFrame(target, null, '', '');
  const rerender = () => cfoEntries(target).catch(onErr);
  $('a5-year').onchange = () => { a5Year = Number($('a5-year').value); rerender(); };
  if (!me.access.member) { body.innerHTML = `<p class="empty">เข้าได้เฉพาะทีม CFO ปี ${a5Year} (ตัวแทนหน่วยงาน / ผู้จัดทำ / ประธาน)</p>`; return; }
  const d = await a5Api(CFO, `cfo/progress?year=${a5Year}`);
  const scope = Number(cfoTx.scope) || 1;
  const all = d.rows.filter((r) => String(r.scope_code || '').startsWith(`${scope}-`));
  const categories = [...new Set(all.map((r) => r.category))];
  if (!categories.includes(cfoTx.category)) cfoTx.category = '';
  const inCategory = all.filter((r) => !cfoTx.category || r.category === cfoTx.category);
  if (!inCategory.some((r) => String(r.id) === cfoTx.activity)) cfoTx.activity = '';
  const list = inCategory.filter((r) => !cfoTx.activity || String(r.id) === cfoTx.activity);
  const m = Number(cfoTx.month) || 0;
  const value = (r, key) => (m ? Number(r.byMonth[m]?.[key] || 0) : Number(r[key] || 0));
  const confirmed = m && d.rows.some((r) => r.byMonth[m]?.status === 'CONFIRMED');
  const status = (r) => {
    const e = m && r.byMonth[m];
    if (!m) return '';
    return e ? `<span class="badge ${e.status === 'CONFIRMED' ? 'badge-success' : 'badge-warning'}">${e.status === 'CONFIRMED' ? 'ยืนยันแล้ว' : 'ร่าง'}</span>` : '<span class="sum-meta">ยังไม่บันทึก</span>';
  };
  const groups = [...new Set(list.map((r) => r.category))];
  const row = (r) => `<tr data-pick="${r.id}"${r.canEdit ? '' : ' class="is-muted"'}><td>${esc(r.name)}</td><td>${esc(r.detail || '')}</td><td>${esc(r.source || '')}</td><td class="num">${r.kgco2e == null ? '-' : cfoT(r.kgco2e)}</td>
    <td><div class="cfo-prog"><span><i style="width:${r.percent}%"></i></span>${r.percent}%<b class="cfo-freq" title="รายเดือน">M</b></div></td>
    <td class="num">${cfoT(value(r, 'qty'))}</td><td>${esc(r.unit || '')}</td><td class="num">${cfoT(value(r, 'tco2e'))}</td><td>${status(r)}</td>
    <td><button class="icon-btn" type="button" data-hist="${r.id}" title="ประวัติการบันทึก" aria-label="ประวัติการบันทึก ${esc(r.name)}"><span class="material-symbols-rounded">history</span></button></td></tr>`;
  body.innerHTML = `
    <div class="toolbar a5-filters">
      ${field('Scope', `<select id="cfo-s-scope">${options(['1', '2', '3'], String(scope), (v) => `Scope ${v}`)}</select>`)}
      ${field('เดือน', `<select id="cfo-s-month">${options(['', ...Array.from({ length: 12 }, (_, i) => String(i + 1))], cfoTx.month, (v) => (v ? ACT_MONTHS[v - 1] : 'ทั้งปี'))}</select>`)}
      ${field('category', `<select id="cfo-s-cat">${options(['', ...categories], cfoTx.category, (v) => v || 'ทั้งหมด')}</select>`)}
      ${field('Activity', `<select id="cfo-s-act"><option value="">ทั้งหมด</option>${inCategory.map((r) => `<option value="${r.id}"${String(r.id) === cfoTx.activity ? ' selected' : ''}>${esc(r.name)} · ${esc(r.detail || '')}</option>`).join('')}</select>`)}
      <div class="action-bar">${button('cfo-record', 'บันทึกกิจกรรม', 'primary', 'disabled')}${d.admin ? button('cfo-confirm', confirmed ? 'เปิดให้แก้เดือนนี้' : 'ยืนยันเดือนนี้', 'secondary', m ? '' : 'disabled title="เลือกเดือนก่อน"') : ''}</div>
    </div>
    <div class="table-wrap sheet" id="cfo-rows"><table class="mo-data-table cfo-scope-table"><thead><tr><th>Activity</th><th>Description</th><th>emission source</th><th class="num">kgCO₂e/unit</th><th>Progress</th><th class="num">Amount</th><th>Unit</th><th class="num">tCO₂e</th><th>สถานะ</th><th></th></tr></thead>
      <tbody>${groups.map((g) => `<tr class="cfo-group"><td colspan="10">${esc(g)}</td></tr>${list.filter((r) => r.category === g).map(row).join('')}`).join('') || '<tr><td colspan="10" class="empty">ไม่มีกิจกรรม</td></tr>'}</tbody></table></div>
    <p class="sum-meta">รวม ${cfoT(list.reduce((t, r) => t + value(r, 'tco2e'), 0))} tCO₂e · ${list.length} กิจกรรม${m ? ` · ${ACT_MONTHS[m - 1]} ${a5Year} บันทึกแล้ว ${list.filter((r) => r.byMonth[m]).length}` : ` · ปี ${a5Year}`}</p>`;
  a5Lift(body);
  $('cfo-s-scope').onchange = () => { cfoTx.scope = $('cfo-s-scope').value; cfoTx.category = ''; cfoTx.activity = ''; rerender(); };
  $('cfo-s-month').onchange = () => { cfoTx.month = $('cfo-s-month').value; rerender(); };
  $('cfo-s-cat').onchange = () => { cfoTx.category = $('cfo-s-cat').value; cfoTx.activity = ''; rerender(); };
  $('cfo-s-act').onchange = () => { cfoTx.activity = $('cfo-s-act').value; rerender(); };
  let picked = null;
  const open = (id) => { const r = all.find((x) => String(x.id) === String(id)); if (r?.canEdit) cfoEntryForm(r, d.septic, m || new Date().getMonth() + 1, rerender); };
  $('cfo-rows').querySelectorAll('tr[data-pick]').forEach((tr) => {
    tr.classList.add('row-pick');
    tr.onclick = () => {
      $('cfo-rows').querySelectorAll('tr.is-selected').forEach((x) => x.classList.remove('is-selected'));
      tr.classList.add('is-selected');
      picked = tr.dataset.pick;
      $('cfo-record').disabled = !all.find((x) => String(x.id) === picked)?.canEdit;
    };
    tr.ondblclick = () => open(tr.dataset.pick);
  });
  $('cfo-record').onclick = () => open(picked);
  body.querySelectorAll('[data-hist]').forEach((btn) => {
    btn.onclick = (ev) => {
      ev.stopPropagation();
      const r = all.find((x) => String(x.id) === btn.dataset.hist);
      const months = Object.keys(r.byMonth).map(Number).sort((x, y) => y - x);
      openPopup(`ประวัติ ${esc(r.name)} ${esc(r.detail || '')}`, months.length ? `<div class="table-wrap"><table class="mo-data-table"><thead><tr><th>เดือน</th><th class="num">ปริมาณ</th><th>หน่วย</th><th class="num">tCO₂e</th><th>สถานะ</th><th>หมายเหตุ</th><th>เอกสาร</th></tr></thead><tbody>${months.map((k) => {
        const e = r.byMonth[k];
        return `<tr><td>${ACT_MONTHS_SHORT[k - 1]} ${a5Year}</td><td class="num">${cfoT(e.qty)}</td><td>${esc(r.unit || '')}</td><td class="num">${cfoT(e.tco2e)}</td><td>${e.status === 'CONFIRMED' ? 'ยืนยันแล้ว' : 'ร่าง'}</td><td>${esc(e.remark || '')}</td><td>${/^https?:\/\//.test(e.doc || '') ? `<a href="${esc(e.doc)}" target="_blank" rel="noopener">เปิด</a>` : esc(e.doc || '')}</td></tr>`;
      }).join('')}</tbody></table></div>` : `<p class="empty">ยังไม่มีการบันทึกปี ${a5Year}</p>`, () => closePopup(), 'ปิด');
    };
  });
  if ($('cfo-confirm')) {
    $('cfo-confirm').onclick = () => m && confirmPopup(confirmed ? 'เปิดให้แก้' : 'ยืนยันข้อมูล', `${confirmed ? 'เปิดให้ตัวแทนหน่วยงานแก้' : 'ยืนยัน'}ข้อมูลทั้งหมดของ ${ACT_MONTHS[m - 1]} ${a5Year} (ทุก Scope)`, async () => {
      const r = await a5Api(CFO, 'cfo/confirm', { method: 'POST', body: { month: cfoMonthIso(m), status: confirmed ? 'DRAFT' : 'CONFIRMED' } });
      toast(`${confirmed ? 'เปิดแก้' : 'ยืนยัน'} ${r.count} รายการ`);
      rerender();
    }, confirmed ? 'เปิดให้แก้' : 'ยืนยัน');
  }
}

// บันทึกกิจกรรม: quantity of one activity for a month (changing the month loads what that month has).
// Septic tank: people × days → kg CH4 (same formula as the server).
function cfoEntryForm(row, septic, month, reload) {
  const isSeptic = row.calc === 'septic';
  const kg = () => {
    const n = (k) => Number(septic[k] || 0);
    return Number($('cfo-people').value || 0) * Number($('cfo-days').value || 0) * n('septic_bod') * 0.001 * n('septic_i') * n('septic_b0') * n('septic_mcf');
  };
  const fields = `<p class="sum-meta">${esc(row.department)} · ${esc(row.name)} ${esc(row.detail || '')} · ${esc(row.source || '')} (${cfoT(row.kgco2e)} kgCO₂e/${esc(row.unit || '')})</p>
    ${field('เดือน', `<select id="cfo-e-month">${options(Array.from({ length: 12 }, (_, i) => i + 1), month, (v) => `${ACT_MONTHS[v - 1]} ${a5Year}${row.byMonth[v] ? ' · บันทึกแล้ว' : ''}`)}</select>`)}
    ${isSeptic ? `${field('จำนวนคน', '<input id="cfo-people" type="number" min="0" step="1">')}
      ${field('จำนวนวันทำงาน', '<input id="cfo-days" type="number" min="1" step="1">')}
      <p class="sum-meta" id="cfo-kg"></p>`
    : field(`ปริมาณ (${esc(row.unit || '')})`, '<input id="cfo-qty" type="number" min="0" step="any">')}
    ${field('ลิงก์เอกสาร / หลักฐาน', '<input id="cfo-doc" maxlength="500">')}
    ${field('หมายเหตุ', '<textarea id="cfo-remark" rows="2" maxlength="500"></textarea>')}
    <p class="sum-meta" id="cfo-e-note"></p>
    ${button('cfo-del', 'ลบข้อมูลเดือนนี้', 'danger')}`;
  openPopup('บันทึกกิจกรรม', fields, async () => {
    const body = { activityId: row.id, month: cfoMonthIso($('cfo-e-month').value), doc: $('cfo-doc').value, remark: $('cfo-remark').value };
    if (isSeptic) body.inputs = { people: $('cfo-people').value, days: $('cfo-days').value };
    else body.qty = $('cfo-qty').value;
    await a5Api(CFO, 'cfo/entries', { method: 'PUT', body });
    toast('บันทึกแล้ว');
    closePopup();
    reload();
  });
  const show = () => { if (isSeptic) $('cfo-kg').textContent = `= ${cfoT(kg())} kg CH₄ · ${cfoT((kg() * Number(row.kgco2e || 0)) / 1000)} tCO₂e`; };
  const load = () => {
    const e = row.byMonth[Number($('cfo-e-month').value)] || {};
    if (isSeptic) { $('cfo-people').value = e.inputs?.people ?? ''; $('cfo-days').value = e.inputs?.days ?? ''; } else $('cfo-qty').value = e.qty ?? '';
    $('cfo-doc').value = e.doc || '';
    $('cfo-remark').value = e.remark || '';
    $('cfo-e-note').textContent = e.id ? `${e.status === 'CONFIRMED' ? 'ยืนยันแล้ว (แก้ได้เฉพาะผู้จัดทำ)' : 'ร่าง'}${e.updated_at ? ` · แก้ล่าสุด ${new Date(e.updated_at).toLocaleString('th-TH')}` : ''}` : 'ยังไม่บันทึกเดือนนี้';
    $('cfo-del').hidden = !e.id;
    show();
  };
  $('cfo-e-month').onchange = load;
  if (isSeptic) { $('cfo-people').oninput = show; $('cfo-days').oninput = show; }
  load();
  $('cfo-del').onclick = () => {
    const e = row.byMonth[Number($('cfo-e-month').value)];
    if (e?.id) confirmPopup('ลบข้อมูล', `ลบ ${esc(row.name)} ของ ${ACT_MONTHS[Number($('cfo-e-month').value) - 1]} ${a5Year}`, async () => {
      await a5Api(CFO, `cfo/entries/${e.id}`, { method: 'DELETE' });
      toast('ลบแล้ว');
      reload();
    });
  };
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
  // + pieces produced in the base year and this year (Summary 2 Carbon intensity)
  const years = [...new Set([Number(m.settings.base_year) || 0, a5Year].filter(Boolean))];
  const keys = [...CFO_COMPANY, ...years.map((y) => [`production_${y}`, `ปริมาณผลิต ปี ${y} (ชิ้น)`])];
  body.innerHTML = `
    ${m.admin ? `<div class="action-bar a5-actions">${button('cfo-save', 'บันทึก', 'primary')}</div>` : ''}
    <div class="cfo-company">${keys.map(([key, label]) => field(label, `<input id="cfo-s-${key}" maxlength="1000" value="${esc(m.settings[key] ?? '')}"${key === 'company_updated' ? ' type="date"' : ''}${m.admin ? '' : ' readonly'}>`)).join('')}</div>`;
  a5Lift(body);
  if (!m.admin) return;
  $('cfo-save').onclick = () => {
    const values = Object.fromEntries(keys.map(([key]) => [key, $(`cfo-s-${key}`).value]));
    a5Api(CFO, 'cfo/settings', { method: 'PUT', body: values }).then(() => { toast('บันทึกแล้ว'); rerender(); }).catch(onErr);
  };
}

Object.assign(VIEWS, { [`${CFO}-home`]: cfoDashboard, [`${CFO}-edit`]: cfoEntries, [`${CFO}-setting`]: cfoSetting });
