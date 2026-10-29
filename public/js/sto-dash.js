// Store > Usage dashboard. The sidebar has one Dashboard button. The pages are buttons inside that page.
// Charts use the shared look (core.js chartPlot / chartKpi / chartCard; CHART colours: warm tone in ระบบงาน).
let stoDashYear = new Date().getFullYear();
let stoDashPage = 'overview';

function stoDashNum(value, digits = 0) {
  return Number(value || 0).toLocaleString('th-TH', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function stoDashDelta(current, previous) {
  if (previous == null) return '';
  if (!previous && !current) return '<span class="sto-delta">เท่าเดือนที่แล้ว</span>';
  if (!previous) return '<span class="sto-delta is-up">↑ ใหม่เทียบเดือนที่แล้ว</span>';
  const pct = (current - previous) / previous * 100;
  const up = pct >= 0;
  return `<span class="sto-delta ${up ? 'is-up' : 'is-down'}">${up ? '↑' : '↓'} ${stoDashNum(Math.abs(pct), 1)}% เทียบเดือนที่แล้ว</span>`;
}

function stoDashKpi(icon, label, value, unit, extra = '') {
  return chartKpi({ icon, label, value, unit, note: extra });
}

// Monthly quantity issued: a line on the shared chart (hover a month for its numbers).
function stoDashLine(months) {
  return chartPlot({ id: 'sto-plot', labels: months.map((row) => row.label), left: 'จำนวนจ่ายออก', digits: 2,
    lines: [{ values: months.map((row) => row.outQty), color: CHART.line }],
    legend: [{ line: CHART.line, label: 'จ่ายออก' }] });
}

function stoDashDonut(slices) {
  const colors = CHART.series;
  // SVG ring, one path per slice: solid edge + the same colour inside 60% transparent.
  const point = (pct, r) => { const a = (pct / 100) * 2 * Math.PI - Math.PI / 2; return `${(60 + r * Math.cos(a)).toFixed(2)} ${(60 + r * Math.sin(a)).toFixed(2)}`; };
  const arc = (from, to, c) => {
    const big = to - from > 50 ? 1 : 0;
    return `<path d="M${point(from, 58)}A58 58 0 ${big} 1 ${point(to, 58)}L${point(to, 32)}A32 32 0 ${big} 0 ${point(from, 32)}Z" style="--c:${c}"/>`;
  };
  let cursor = 0;
  const paths = slices.map((slice, index) => {
    const start = cursor;
    cursor += Number(slice.share) || 0;
    return cursor > start ? arc(start, Math.min(cursor, start + 99.99), colors[index % colors.length]) : '';
  }).join('') || arc(0, 99.99, '#a1a1aa');
  const legend = slices.map((slice, index) => `<li><i style="--c:${colors[index % colors.length]}"></i><span>${esc(slice.name)}</span><b>${stoDashNum(slice.value, 2)}</b><em>${stoDashNum(slice.share, 1)}%</em></li>`).join('');
  return `<div class="sto-donut-wrap"><svg class="sto-donut" viewBox="0 0 120 120" aria-hidden="true">${paths}</svg><ul class="sto-legend">${legend || '<li>ไม่มีข้อมูล</li>'}</ul></div>`;
}

// Received next to issued per month on the shared chart.
function stoDashBars(months) {
  return chartPlot({ id: 'sto-plot', labels: months.map((row) => row.label), left: 'จำนวน', digits: 2,
    bars: [{ values: months.map((row) => row.inQty), colors: [CHART.base[1]] }, { values: months.map((row) => row.outQty), colors: [CHART.series[0]] }],
    legend: [{ box: CHART.base[1], label: 'รับเข้า' }, { box: CHART.series[0], label: 'จ่ายออก' }] });
}

function stoDashRanks(rows, pick, digits) {
  if (!rows.length) return '<p class="empty">ยังไม่มีการจ่ายออกในปีนี้</p>';
  const max = Math.max(...rows.map(pick), 1);
  return `<ol class="sto-ranks">${rows.map((row) => `<li><span title="${esc(row.material)} ${esc(row.name)}">${esc(row.name)}</span><div class="sto-track"><i style="width:${pick(row) / max * 100}%"></i></div><b>${stoDashNum(pick(row), digits)}</b></li>`).join('')}</ol>`;
}

function stoDashMonthTable(months) {
  const body = months.map((row) => `<tr><td>${row.label}</td><td class="num">${stoDashNum(row.inQty, 2)}</td><td class="num">${stoDashNum(row.outQty, 2)}</td><td class="num">${stoDashNum(row.outValue, 2)}</td></tr>`).join('');
  return `<div class="table-wrap sto-month-table"><table class="mo-data-table"><colgroup><col class="sto-month-col"><col><col><col></colgroup><thead><tr><th>เดือน</th><th class="num">รับเข้า</th><th class="num">จ่ายออก</th><th class="num">มูลค่าจ่ายออก (บาท)</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function stoDashOverview(data) {
  const k = data.kpis;
  return `<div class="ch-kpis">
      ${stoDashKpi('inventory_2', 'รายการใช้งาน', stoDashNum(k.items), 'รายการ', `<span class="sto-delta">${stoDashNum(k.groups)} ${esc(data.groupBy)}</span>`)}
      ${stoDashKpi('output', 'จ่ายออกปีนี้', stoDashNum(k.outQty, 2), 'หน่วย', stoDashDelta(k.outQtyNow, k.outQtyPrev))}
      ${stoDashKpi('payments', 'มูลค่าจ่ายออก', stoDashNum(k.outValue, 2), 'บาท', stoDashDelta(k.outValueNow, k.outValuePrev))}
      ${stoDashKpi('input', 'รับเข้าปีนี้', stoDashNum(k.inQty, 2), 'หน่วย', '<span class="sto-delta">ยังไม่มีตารางรับเข้า</span>')}
      ${stoDashKpi('account_balance', 'มูลค่าคงเหลือ', stoDashNum(k.stockValue, 2), 'บาท', `<span class="sto-delta">คงเหลือ ${stoDashNum(k.stockQty, 2)} หน่วย</span>`)}
    </div>
    <div class="sto-split">
      ${chartCard('จ่ายออกรายเดือน', stoDashLine(data.months), `ปี ${data.year}`)}
      ${chartCard(`สัดส่วนตาม${esc(data.groupBy)}`, stoDashDonut(data.slices), esc(data.donut))}
    </div>`;
}

function stoDashFlow(data) {
  const k = data.kpis;
  return `<div class="ch-kpis">
      ${stoDashKpi('input', 'รับเข้า', stoDashNum(k.inQty, 2), 'หน่วย', '<span class="sto-delta">ยังไม่มีรายการรับเข้า</span>')}
      ${stoDashKpi('output', 'จ่ายออก', stoDashNum(k.outQty, 2), 'หน่วย', stoDashDelta(k.outQtyNow, k.outQtyPrev))}
      ${stoDashKpi('account_balance', 'คงเหลือ', stoDashNum(k.stockQty, 2), 'หน่วย', `<span class="sto-delta">มูลค่า ${stoDashNum(k.stockValue, 2)} บาท</span>`)}
    </div>
    ${chartCard('รับเข้าและจ่ายออกรายเดือน', stoDashBars(data.months) + stoDashMonthTable(data.months), `ขอบเขต ${esc(data.scope)}`)}`;
}

function stoDashMonth(data) {
  const idleText = data.idleBasis === 'stock'
    ? 'ยอดคงเหลือที่ไม่มีการจ่ายออกในปีนี้'
    : 'ยังไม่มียอดคงเหลือ แสดง 10 รายการราคาสูงสุดที่ไม่มีการจ่ายออก';
  return `${chartCard(`กราฟรายเดือน ${data.year}`, stoDashLine(data.months) + stoDashMonthTable(data.months), `ขอบเขต ${esc(data.scope)}`)}
    <div class="sto-three">
      <section class="card"><div class="card-title">ใช้มากสุด 10 รายการ</div><p class="sum-meta">จำนวนจ่ายออก</p>${stoDashRanks(data.topQty, (row) => row.qty, 2)}</section>
      <section class="card"><div class="card-title">มูลค่าสูงสุด 10 รายการ</div><p class="sum-meta">จำนวนจ่ายออก × ราคา</p>${stoDashRanks(data.topValue, (row) => row.value, 2)}</section>
      <section class="card"><div class="card-title">ไม่มีการเคลื่อนไหว 10 รายการ</div><p class="sum-meta">${idleText}</p>${data.idle.length ? stoDashRanks(data.idle, (row) => row.value || row.price, 2) : '<p class="empty">ไม่มีรายการ</p>'}</section>
    </div>`;
}

async function stoDashRender(target) {
  const page = stoDashPage;
  const data = await api(`/api/usage-dashboard?year=${stoDashYear}`);
  const years = [stoDashYear - 1, stoDashYear, stoDashYear + 1];
  const tabs = [['overview', 'ภาพรวม'], ['flow', 'รับเข้า-จ่ายออก'], ['month', 'รายเดือน']];
  const seg = `<div class="seg" role="group" aria-label="หน้า Dashboard">${tabs.map(([id, label]) => `<button class="seg-btn${id === page ? ' is-active' : ''}" type="button" data-sto-dash="${id}">${label}</button>`).join('')}</div>`;
  const year = field('ปี', `<select id="sto-dash-year">${years.map((item) => `<option value="${item}"${item === data.year ? ' selected' : ''}>${item}</option>`).join('')}</select>`);
  target.innerHTML = `<div class="view-body sto-dash">
    ${pageBar(seg, year, 'sto-dash')}
    ${page === 'flow' ? stoDashFlow(data) : page === 'month' ? stoDashMonth(data) : stoDashOverview(data)}
  </div>`;
  chartTip('sto-plot', (i) => {
    const row = data.months[i];
    return `<strong>${esc(row.label)} ${data.year}</strong><div class="ch-tip-row"><span>รับเข้า</span><b>${stoDashNum(row.inQty, 2)}</b></div><div class="ch-tip-row"><span>จ่ายออก</span><b>${stoDashNum(row.outQty, 2)}</b></div><div class="ch-tip-row"><span>มูลค่าจ่ายออก</span><b>${stoDashNum(row.outValue, 2)}</b></div>`;
  });
  target.querySelectorAll('[data-sto-dash]').forEach((node) => {
    node.onclick = () => {
      stoDashPage = node.dataset.stoDash;
      stoDashRender(target).catch(onErr);
    };
  });
  $('sto-dash-year').onchange = () => {
    stoDashYear = Number($('sto-dash-year').value);
    stoDashRender(target).catch(onErr);
  };
}
