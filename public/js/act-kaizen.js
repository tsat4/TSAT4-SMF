// ระบบกิจกรรม > KAIZEN: Dashboard (Summary / Schedule / Team), Transaction (ใบ Kaizen FM-QSM-039 ด้านหน้า:
// list + form with before / after photos 16:9 and the money results), Setting (แผนงาน = Planner, ทีม).
// Server: server/modules/act/kaizen.js · spec: docs/specs/act-kaizen.md · uses the shared year (a5Year) of act-5s.js.
const KZ = 'kaizen';
const KZ_ROLE_LABEL = { admin: 'ผู้ดูแล (เลขานุการ)', chairman: 'ประธานกิจกรรม', vice: 'รองประธาน', auditor: 'คณะกรรมการ', member: 'ตัวแทนหน่วยงาน' };
const KZ_DASH_TABS = { summary: 'Summary', schedule: 'Schedule', team: 'Team' };
const KZ_SET_TABS = { plan: 'แผนงาน', team: 'ทีม' };
const KZ_KINDS = { person: 'บุคคล', team: 'ทีม', qcc: 'เป็นกิจกรรมที่มาจาก QCC' };
const KZ_TYPES = [['Q', 'การปรับปรุงด้านคุณภาพ'], ['C', 'การลดต้นทุนการผลิต / ค่าใช้จ่าย'], ['D', 'การปรับปรุงด้านการส่งมอบ'],
  ['S', 'ความปลอดภัย'], ['M', 'ส่งเสริมด้านขวัญกำลังใจ'], ['E', 'ปรับปรุงสภาพแวดล้อม'], ['O', 'อื่นๆ']];
const KZ_STATUS = { DRAFT: ['ร่าง', ''], SUBMITTED: ['รอพิจารณา', 'badge-warning'], APPROVED: ['อนุมัติ', 'badge-success'], REJECTED: ['ไม่เข้าหลักเกณฑ์', 'badge-danger'] };
let kzDashTab = 'summary';
let kzSetTab = 'plan';
const kzFilter = { status: '', department: '', q: '' };
const kzHead = { sort: '', dir: 'asc', filters: {} };

const kzMoney = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kzNum = (n, digits = 2) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: digits });
const kzBadge = (s) => `<span class="badge ${KZ_STATUS[s]?.[1] || ''}">${KZ_STATUS[s]?.[0] || esc(s)}</span>`;
// Invested = labour + material · payback (months) = invested ÷ return per month (server kaizenMoney).
const kzPayback = (cost, perMonth) => (perMonth > 0 ? Math.round((cost / perMonth) * 100) / 100 : null);

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
  if (kzDashTab === 'team') return a5SetTeam(body, KZ, false, rerender, KZ_ROLE_LABEL);
  return kzDrawSummary(body, me);
}

// Summary: sheets of the year, approved, money invested, return per month, payback; per month and per department.
async function kzDrawSummary(body) {
  const d = await a5Api(KZ, `kaizen/list?year=${a5Year}`);
  const sent = d.rows.filter((r) => r.status !== 'DRAFT');
  const approved = d.rows.filter((r) => r.status === 'APPROVED');
  const cost = approved.reduce((t, r) => t + r.cost, 0);
  const perMonth = approved.reduce((t, r) => t + Number(r.return_month || 0), 0);
  const month = (r) => Number(String(r.submitted_on).slice(5, 7));
  const byMonth = (list) => ACT_MONTHS_SHORT.map((_, i) => list.filter((r) => month(r) === i + 1).length);
  const waiting = d.rows.filter((r) => r.status === 'SUBMITTED');
  // Counts are whole sheets: a top of at least 4 in steps of 4 keeps the axis on whole numbers.
  const top = Math.max(...byMonth(approved).map((v, i) => v + byMonth(waiting)[i]), 0);
  const chart = chartPlot({
    id: 'kz-plot', labels: ACT_MONTHS_SHORT, left: 'จำนวน (ใบ)', leftMax: Math.max(4, Math.ceil(top / 4) * 4),
    bars: [{ values: byMonth(approved).map((v, i) => [v, byMonth(waiting)[i]]), colors: [CHART.series[0], CHART.series[1]] }],
    legend: [{ box: CHART.series[0], label: 'อนุมัติ' }, { box: CHART.series[1], label: 'รอพิจารณา' }]
  });
  const departments = Object.values(sent.reduce((acc, r) => {
    const k = r.department || '-';
    acc[k] = acc[k] || { department: k, count: 0, approved: 0, cost: 0, perMonth: 0 };
    acc[k].count += 1;
    if (r.status === 'APPROVED') { acc[k].approved += 1; acc[k].cost += r.cost; acc[k].perMonth += Number(r.return_month || 0); }
    return acc;
  }, {})).sort((a, b) => b.count - a.count);
  body.innerHTML = `
    <div class="ch-kpis">
      ${chartKpi({ icon: 'lightbulb', label: 'Kaizen ที่ส่ง', value: kzNum(sent.length, 0), unit: 'ใบ', note: `ร่าง ${kzNum(d.rows.length - sent.length, 0)} ใบ` })}
      ${chartKpi({ icon: 'verified', label: 'อนุมัติแล้ว', value: kzNum(approved.length, 0), unit: 'ใบ', note: `รอพิจารณา ${kzNum(waiting.length, 0)} ใบ` })}
      ${chartKpi({ icon: 'payments', label: 'เงินที่ใช้ในการปรับปรุง', value: kzMoney(cost), unit: 'บาท', note: 'ค่าแรง + ค่าอุปกรณ์ (อนุมัติแล้ว)' })}
      ${chartKpi({ icon: 'savings', label: 'ผลตอบแทน', value: kzMoney(perMonth), unit: 'บาท/เดือน', note: `ปีละ ${kzMoney(perMonth * 12)} บาท` })}
      ${chartKpi({ icon: 'hourglass_bottom', label: 'ระยะเวลาคืนทุน (รวม)', value: kzPayback(cost, perMonth) == null ? '-' : kzNum(kzPayback(cost, perMonth)), unit: 'เดือน', note: 'เงินที่ใช้ ÷ ผลตอบแทนต่อเดือน' })}
    </div>
    ${chartCard(`Kaizen รายเดือน ปี ${a5Year}`, chart, 'ตามวันที่เสนอ')}
    ${chartCard('ตามหน่วยงาน', `<div class="table-wrap"><table class="mo-data-table"><thead><tr><th>หน่วยงาน</th><th class="num">ส่ง (ใบ)</th><th class="num">อนุมัติ (ใบ)</th><th class="num">เงินที่ใช้ (บาท)</th><th class="num">ผลตอบแทน (บาท/เดือน)</th><th class="num">คืนทุน (เดือน)</th></tr></thead>
      <tbody>${departments.map((x) => `<tr><td>${esc(x.department)}</td><td class="num">${kzNum(x.count, 0)}</td><td class="num">${kzNum(x.approved, 0)}</td><td class="num">${kzMoney(x.cost)}</td><td class="num">${kzMoney(x.perMonth)}</td>
        <td class="num">${kzPayback(x.cost, x.perMonth) == null ? '-' : kzNum(kzPayback(x.cost, x.perMonth))}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">ยังไม่มี Kaizen ที่ส่ง</td></tr>'}</tbody></table></div>`)}`;
  chartTip('kz-plot', (i) => `<strong>${ACT_MONTHS[i]} ${a5Year}</strong><div class="ch-tip-row"><span>อนุมัติ</span><b>${byMonth(approved)[i]} ใบ</b></div><div class="ch-tip-row"><span>รอพิจารณา</span><b>${byMonth(waiting)[i]} ใบ</b></div>`);
}

// ---------- Transaction: Kaizen sheets ----------

async function kzEntries(target) {
  const { body } = await kzFrame(target, null, '', '');
  const rerender = () => kzEntries(target).catch(onErr);
  $('a5-year').onchange = () => { a5Year = Number($('a5-year').value); rerender(); };
  const d = await a5Api(KZ, `kaizen/list?year=${a5Year}`);
  let picked = null;
  const departments = [...new Set(d.rows.map((r) => r.department).filter(Boolean))].sort();
  const draw = () => {
    const term = kzFilter.q.trim().toLowerCase();
    const list = listQuery(d.rows.filter((r) => (!kzFilter.status || r.status === kzFilter.status) && (!kzFilter.department || r.department === kzFilter.department)
      && (!term || `${r.reg_no} ${r.title} ${r.name} ${r.employee_id}`.toLowerCase().includes(term))), kzHead, (r, key) => r[key] ?? '');
    fillTable('kz-rows', [{ label: 'เลขทะเบียน', key: 'reg_no' }, { label: 'วันที่', key: 'submitted_on' }, { label: 'เรื่อง', key: 'title' }, { label: 'ผู้เสนอ', key: 'name' }, { label: 'หน่วยงาน', key: 'department' },
      'ประเภท', { label: 'เงินที่ใช้ (บาท)', key: 'cost', num: true }, { label: 'ผลตอบแทน (บาท/เดือน)', key: 'return_month', num: true }, { label: 'คืนทุน (เดือน)', key: 'payback', num: true }, { label: 'สถานะ', key: 'status' }],
    list.map((r) => `<tr data-pick="${r.id}"><td>${esc(r.reg_no || '')}</td><td>${new Date(`${r.submitted_on}T00:00:00`).toLocaleDateString('en-GB')}</td><td>${esc(r.title)}</td><td>${esc(r.name || r.employee_id)}</td><td>${esc(r.department || '')}</td>
      <td>${esc(r.types.join(' '))}</td><td class="num">${kzMoney(r.cost)}</td><td class="num">${kzMoney(r.return_month)}</td><td class="num">${r.payback == null ? '-' : kzNum(r.payback)}</td><td>${kzBadge(r.status)}</td></tr>`).join(''),
    'ยังไม่มีใบ Kaizen ปีนี้', headFor(kzHead, draw));
    bindRowSelect($('kz-rows'), (id) => {
      picked = d.rows.find((r) => String(r.id) === id);
      const canEdit = picked && (d.admin || (picked.mine && picked.status !== 'APPROVED'));
      $('kz-open').disabled = !picked;
      $('kz-edit').disabled = !canEdit;
      $('kz-del').disabled = !(picked && (d.admin || (picked.mine && picked.status === 'DRAFT')));
      if ($('kz-approve')) ['kz-approve', 'kz-reject'].forEach((b) => { $(b).disabled = !(picked && picked.status !== 'DRAFT'); });
    });
    $('kz-rows').querySelectorAll('tr[data-pick]').forEach((tr) => { tr.ondblclick = () => kzForm(body, d, d.rows.find((r) => String(r.id) === tr.dataset.pick), rerender); });
  };
  body.innerHTML = `
    <div class="toolbar a5-filters">
      ${field('สถานะ', `<select id="kz-f-status">${options(['', ...Object.keys(KZ_STATUS)], kzFilter.status, (v) => (v ? KZ_STATUS[v][0] : 'ทั้งหมด'))}</select>`)}
      ${field('หน่วยงาน', `<select id="kz-f-dept">${options(['', ...departments], kzFilter.department, (v) => v || 'ทั้งหมด')}</select>`)}
      ${searchSlot('ค้นหา', 'kz-f-q', 'kz-f-search', { placeholder: 'เลขทะเบียน เรื่อง หรือผู้เสนอ' })}
      <div class="action-bar">${d.reviewer ? `${button('kz-approve', 'อนุมัติ', 'secondary', 'disabled')}${button('kz-reject', 'ไม่เข้าหลักเกณฑ์', 'secondary', 'disabled')}` : ''}
        ${button('kz-open', 'ดู', 'secondary', 'disabled')}${button('kz-add', 'สร้าง', 'primary')}${button('kz-edit', 'แก้ไข', 'secondary', 'disabled')}${button('kz-del', 'ลบ', 'danger', 'disabled')}</div>
    </div>
    <div class="table-wrap sheet" id="kz-rows"></div>
    <p class="sum-meta">${kzNum(d.rows.length, 0)} ใบ · ทุกคนสร้างใบของตนเองได้ · แก้ได้จนกว่าจะอนุมัติ · ดับเบิลคลิกแถวเพื่อเปิดใบ</p>`;
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
  const review = (status, title) => picked && openPopup(`${title} · ${esc(picked.reg_no || '')}`, `<p class="sum-meta">${esc(picked.title)} · ${esc(picked.name || picked.employee_id)}</p>
    ${field('ความเห็น / เหตุผล', '<textarea id="kz-note" rows="3" maxlength="1000"></textarea>')}`, async () => {
    await a5Api(KZ, `kaizen/${picked.id}/status`, { method: 'POST', body: { status, note: $('kz-note').value } });
    toast('บันทึกแล้ว');
    closePopup();
    rerender();
  }, title);
  if ($('kz-approve')) {
    $('kz-approve').onclick = () => review('APPROVED', 'อนุมัติ');
    $('kz-reject').onclick = () => review('REJECTED', 'ไม่เข้าหลักเกณฑ์');
  }
}

// The Kaizen sheet (FM-QSM-039 ด้านหน้า): header, before / after (photo 16:9 + text), Kaizen type, money results
// (labour + material = invested, return per month, payback months) and the results that are not money.
function kzForm(body, d, row, reload) {
  const editable = !row || d.admin || (row.mine && row.status !== 'APPROVED');
  const off = editable ? '' : ' disabled';
  const photos = { before: null, after: null };
  const photoBox = (side, label, textId, textLabel, value) => `<section class="kz-side">
      <div class="kz-side-title">${label}</div>
      <label class="kz-photo${editable ? '' : ' is-locked'}" for="kz-${side}-file" id="kz-${side}-box">${row?.[`${side}_photo`] ? `<img src="${esc(row[`${side}_photo`])}" alt="">` : '<span class="material-symbols-rounded">add_photo_alternate</span><small>เลือกรูป (ครอปเป็น 16:9 ให้อัตโนมัติ)</small>'}</label>
      <input id="kz-${side}-file" type="file" accept="image/*" hidden${off}>
      ${field(textLabel, `<textarea id="${textId}" rows="4" maxlength="2000"${off}>${esc(value || '')}</textarea>`)}
    </section>`;
  body.innerHTML = `
    <div class="kz-form">
      <div class="kz-head">
        <div><div class="card-title">แบบฟอร์ม Kaizen</div><strong>${row ? esc(row.reg_no || '') : 'ใบใหม่'}</strong> ${row ? kzBadge(row.status) : ''}</div>
        <div class="action-bar">${button('kz-back', 'กลับ')}${editable ? `${button('kz-save', 'บันทึกร่าง')}${!row || ['DRAFT', 'REJECTED'].includes(row.status) ? button('kz-send', 'บันทึกและส่งพิจารณา', 'primary') : ''}` : ''}</div>
      </div>
      <section class="card kz-top">
        ${field('เรื่อง', `<input id="kz-title" maxlength="300" value="${esc(row?.title || '')}"${off}>`, 'grow')}
        ${field('ประเภท', `<select id="kz-kind"${off}>${options(Object.keys(KZ_KINDS), row?.kind || 'person', (v) => KZ_KINDS[v])}</select>`)}
        ${field('วันที่', `<input id="kz-date" type="date" value="${esc(row?.submitted_on || new Date().toISOString().slice(0, 10))}"${off}>`)}
        ${field('ผู้เสนอ', `<input value="${esc(row ? `${row.name || ''} · ${row.employee_id}${row.department ? ` · ${row.department}` : ''}` : 'ตัวคุณเอง')}" readonly>`)}
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
          ${row?.review_note ? `<p class="sum-meta">ความเห็นผู้พิจารณา: ${esc(row.review_note)}</p>` : ''}
        </section>
      </div>
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
  const save = async (send) => {
    const payload = {
      title: $('kz-title').value, kind: $('kz-kind').value, submitted_on: $('kz-date').value, members: $('kz-members').value,
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
  if (kzSetTab === 'team') return a5SetTeam(body, KZ, me.access.admin, rerender, KZ_ROLE_LABEL);
  return aplRender(body, KZ, { inPage: true });
}

Object.assign(VIEWS, { [`${KZ}-home`]: kzDashboard, [`${KZ}-edit`]: kzEntries, [`${KZ}-setting`]: kzSetting });
