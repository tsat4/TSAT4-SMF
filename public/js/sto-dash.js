// Store > Usage dashboard. The sidebar has one Dashboard button. The pages are buttons inside that page.
const STO_DASH_COLORS = ['#3b82f6', '#ff8a1f', '#3ecf8e', '#a78bfa', '#f87171', '#f59e0b', '#14b8a6', '#71717a'];
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

function stoDashKpi(icon, label, value, extra = '') {
  return `<article class="kpi sto-kpi"><span class="sto-kpi-icon material-symbols-rounded">${icon}</span><div><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div>${extra}</div></article>`;
}

function stoDashLine(months) {
  const values = months.map((row) => row.outQty);
  const max = Math.max(...values, 1);
  const step = 320 / Math.max(values.length - 1, 1);
  const points = values.map((value, index) => `${index * step},${110 - (value / max) * 96}`).join(' ');
  const area = `0,110 ${points} ${(values.length - 1) * step},110`;
  const labels = months.map((row) => `<span>${row.label}</span>`).join('');
  return `<div class="sto-line"><svg viewBox="0 0 320 120" role="img" aria-label="จ่ายออกรายเดือน"><polygon class="sto-area" points="${area}"></polygon><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2"></polyline>${values.map((value, index) => `<circle cx="${index * step}" cy="${110 - (value / max) * 96}" r="2.5"></circle>`).join('')}</svg><div class="sto-line-axis">${labels}</div></div>`;
}

function stoDashDonut(slices) {
  const colors = STO_DASH_COLORS;
  let cursor = 0;
  const stops = slices.map((slice, index) => {
    const start = cursor;
    cursor += Number(slice.share) || 0;
    return `${colors[index % colors.length]} ${start}% ${cursor}%`;
  }).join(', ');
  const paint = slices.length ? stops : '#d4d4d8 0% 100%';
  const legend = slices.map((slice, index) => `<li><i style="background:${colors[index % colors.length]}"></i><span>${esc(slice.name)}</span><b>${stoDashNum(slice.value, 2)}</b><em>${stoDashNum(slice.share, 1)}%</em></li>`).join('');
  return `<div class="sto-donut-wrap"><div class="sto-donut" style="background:conic-gradient(${paint})"><div class="sto-donut-hole"></div></div><ul class="sto-legend">${legend || '<li>ไม่มีข้อมูล</li>'}</ul></div>`;
}

function stoDashBars(months) {
  const max = Math.max(...months.map((row) => Math.max(row.inQty, row.outQty)), 1);
  return `<div class="sto-plot" style="--plot-height:168px">${months.map((row) => `<div class="sto-col" title="${esc(row.label)} รับเข้า ${stoDashNum(row.inQty, 2)} จ่ายออก ${stoDashNum(row.outQty, 2)}"><i class="is-in" style="height:${row.inQty / max * 100}%"></i><i class="is-out" style="height:${row.outQty / max * 100}%"></i><span>${row.label}</span></div>`).join('')}</div>`;
}

function stoDashRanks(rows, pick, digits) {
  if (!rows.length) return '<p class="empty">ยังไม่มีการจ่ายออกในปีนี้</p>';
  const max = Math.max(...rows.map(pick), 1);
  return `<ol class="sto-ranks">${rows.map((row) => `<li><span title="${esc(row.material)} ${esc(row.name)}">${esc(row.name)}</span><div class="sto-track"><i style="width:${pick(row) / max * 100}%"></i></div><b>${stoDashNum(pick(row), digits)}</b></li>`).join('')}</ol>`;
}

function stoDashMonthTable(months) {
  const body = months.map((row) => `<tr><td>${row.label}</td><td>${stoDashNum(row.inQty, 2)}</td><td>${stoDashNum(row.outQty, 2)}</td><td>${stoDashNum(row.outValue, 2)}</td></tr>`).join('');
  return `<div class="table-wrap mo-data-table sto-month-table"><table class="mo-data-table"><thead><tr><th>เดือน</th><th>รับเข้า</th><th>จ่ายออก</th><th>มูลค่าจ่ายออก</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function stoDashOverview(data) {
  const k = data.kpis;
  return `<div class="sto-kpis">
      ${stoDashKpi('inventory_2', 'รายการใช้งาน', stoDashNum(k.items), `<span class="sto-delta">${stoDashNum(k.groups)} ${esc(data.groupBy)}</span>`)}
      ${stoDashKpi('output', 'จ่ายออกปีนี้', stoDashNum(k.outQty, 2), stoDashDelta(k.outQtyNow, k.outQtyPrev))}
      ${stoDashKpi('payments', 'มูลค่าจ่ายออก', stoDashNum(k.outValue, 2), stoDashDelta(k.outValueNow, k.outValuePrev))}
      ${stoDashKpi('input', 'รับเข้าปีนี้', stoDashNum(k.inQty, 2), '<span class="sto-delta">ยังไม่มีตารางรับเข้า</span>')}
      ${stoDashKpi('account_balance', 'มูลค่าคงเหลือ', stoDashNum(k.stockValue, 2), `<span class="sto-delta">คงเหลือ ${stoDashNum(k.stockQty, 2)}</span>`)}
    </div>
    <div class="sto-split">
      <section class="card"><div class="card-title">จ่ายออกรายเดือน</div><p class="sum-meta">จำนวนที่จ่ายออกในปี ${data.year}</p>${stoDashLine(data.months)}</section>
      <section class="card"><div class="card-title">สัดส่วนตาม${esc(data.groupBy)}</div><p class="sum-meta">${esc(data.donut)}</p>${stoDashDonut(data.slices)}</section>
    </div>`;
}

function stoDashFlow(data) {
  const k = data.kpis;
  return `<div class="sto-kpis">
      ${stoDashKpi('input', 'รับเข้า', stoDashNum(k.inQty, 2), '<span class="sto-delta">ยังไม่มีรายการรับเข้า</span>')}
      ${stoDashKpi('output', 'จ่ายออก', stoDashNum(k.outQty, 2), stoDashDelta(k.outQtyNow, k.outQtyPrev))}
      ${stoDashKpi('account_balance', 'คงเหลือ', stoDashNum(k.stockQty, 2), `<span class="sto-delta">มูลค่า ${stoDashNum(k.stockValue, 2)}</span>`)}
    </div>
    <section class="card sto-month-card">
      <div class="card-title">รับเข้าและจ่ายออกรายเดือน</div>
      <p class="sum-meta"><i class="sto-key is-in"></i> รับเข้า <i class="sto-key is-out"></i> จ่ายออก · ขอบเขต ${esc(data.scope)}</p>
      ${stoDashBars(data.months)}
      ${stoDashMonthTable(data.months)}
    </section>`;
}

function stoDashMonth(data) {
  const idleText = data.idleBasis === 'stock'
    ? 'ยอดคงเหลือที่ไม่มีการจ่ายออกในปีนี้'
    : 'ยังไม่มียอดคงเหลือ แสดง 10 รายการราคาสูงสุดที่ไม่มีการจ่ายออก';
  return `<section class="card sto-month-card">
      <div class="card-title">กราฟรายเดือน ${data.year}</div>
      <p class="sum-meta">จำนวนจ่ายออก · ขอบเขต ${esc(data.scope)}</p>
      ${stoDashLine(data.months)}
      ${stoDashMonthTable(data.months)}
    </section>
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
    <p class="page-note">รายการใช้งานทั้งระบบ · จ่ายออกของ ${esc(data.scope)}</p>
    ${page === 'flow' ? stoDashFlow(data) : page === 'month' ? stoDashMonth(data) : stoDashOverview(data)}
  </div>`;
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
