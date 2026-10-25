// ระบบกิจกรรม > <activity> > Setting: Schedule Plan with week / month / year views (server: server/modules/act).
// Turn the plan on for another activity by adding its id to ACT_PLAN_ON.
const ACT_PLAN_ON = ['5s'];
const ACT_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const ACT_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const ACT_DAYS = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];
const ACT_STATUS = { planned: 'ตามแผน', done: 'เสร็จแล้ว', cancelled: 'ยกเลิก' };
const ACT_MODES = { week: 'สัปดาห์', month: 'เดือน', year: 'ปี' };
let actPlanMode = 'month';
let actPlanAnchor = new Date();

function actIso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function actDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function actAddDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function actWeekStart(date) {
  return actAddDays(date, -((date.getDay() + 6) % 7));
}

function actShort(iso) {
  const date = actDate(iso);
  return `${date.getDate()} ${ACT_MONTHS_SHORT[date.getMonth()]}`;
}

function actSpan(event) {
  return event.start_date === event.end_date ? actShort(event.start_date) : `${actShort(event.start_date)} – ${actShort(event.end_date)}`;
}

function actRange() {
  const a = actPlanAnchor;
  if (actPlanMode === 'week') {
    const from = actWeekStart(a);
    return { from, to: actAddDays(from, 6), label: `${actShort(actIso(from))} – ${actShort(actIso(actAddDays(from, 6)))} ${actAddDays(from, 6).getFullYear()}` };
  }
  if (actPlanMode === 'year') {
    return { from: new Date(a.getFullYear(), 0, 1), to: new Date(a.getFullYear(), 11, 31), label: `ปี ${a.getFullYear()}` };
  }
  const from = actWeekStart(new Date(a.getFullYear(), a.getMonth(), 1));
  return { from, to: actAddDays(from, 41), label: `${ACT_MONTHS[a.getMonth()]} ${a.getFullYear()}` };
}

function actMove(step) {
  const a = actPlanAnchor;
  if (actPlanMode === 'week') actPlanAnchor = actAddDays(a, step * 7);
  else if (actPlanMode === 'year') actPlanAnchor = new Date(a.getFullYear() + step, a.getMonth(), 1);
  else actPlanAnchor = new Date(a.getFullYear(), a.getMonth() + step, 1);
}

function actOn(events, iso) {
  return events.filter((event) => event.start_date <= iso && event.end_date >= iso);
}

function actChip(event) {
  return `<button class="plan-chip plan-${esc(event.status)}" type="button" data-ev="${esc(event.id)}" title="${esc(event.title)}">${esc(event.title)}</button>`;
}

function actWeekBody(events, from) {
  const today = actIso(new Date());
  return `<div class="plan-week">${ACT_DAYS.map((name, i) => {
    const iso = actIso(actAddDays(from, i));
    const list = actOn(events, iso);
    return `<div class="plan-col${iso === today ? ' is-today' : ''}" data-day="${iso}">
      <div class="plan-col-head">${name} ${actShort(iso)}</div>
      ${list.map(actChip).join('') || '<span class="plan-empty">-</span>'}
    </div>`;
  }).join('')}</div>`;
}

function actMonthBody(events, from) {
  const today = actIso(new Date());
  const month = actPlanAnchor.getMonth();
  const cells = Array.from({ length: 42 }, (_, i) => {
    const date = actAddDays(from, i);
    const iso = actIso(date);
    const list = actOn(events, iso);
    const more = list.length > 3 ? `<button class="plan-more" type="button" data-week="${iso}">+${list.length - 3}</button>` : '';
    return `<div class="plan-cell${date.getMonth() !== month ? ' is-out' : ''}${iso === today ? ' is-today' : ''}" data-day="${iso}">
      <span class="plan-day">${date.getDate()}</span>${list.slice(0, 3).map(actChip).join('')}${more}
    </div>`;
  }).join('');
  return `<div class="plan-month-grid">${ACT_DAYS.map((name) => `<div class="plan-dow">${name}</div>`).join('')}${cells}</div>`;
}

function actYearBody(events) {
  const year = actPlanAnchor.getFullYear();
  return `<div class="plan-year">${ACT_MONTHS.map((name, m) => {
    const first = actIso(new Date(year, m, 1));
    const last = actIso(new Date(year, m + 1, 0));
    const list = events.filter((event) => event.start_date <= last && event.end_date >= first);
    return `<div class="plan-ym">
      <button class="plan-ym-head" type="button" data-month="${m}">${name}<span class="badge${list.length ? ' badge-primary' : ''}">${list.length}</span></button>
      ${list.map((event) => `<button class="plan-item plan-${esc(event.status)}" type="button" data-ev="${esc(event.id)}"><span>${actSpan(event)}</span>${esc(event.title)}</button>`).join('') || '<span class="plan-empty">ไม่มีรายการ</span>'}
    </div>`;
  }).join('')}</div>`;
}

function actForm(event, day) {
  const row = event || { start_date: day, end_date: day, status: 'planned' };
  return [
    field('ชื่อกิจกรรม', `<input id="act-title" maxlength="200" value="${esc(row.title || '')}">`),
    field('วันเริ่ม', `<input id="act-start" type="date" value="${esc(row.start_date || '')}">`),
    field('วันจบ', `<input id="act-end" type="date" value="${esc(row.end_date || '')}">`),
    field('ผู้รับผิดชอบ', `<input id="act-resp" maxlength="200" value="${esc(row.responsible || '')}">`),
    field('สถานะ', `<select id="act-status">${options(Object.keys(ACT_STATUS), row.status, (value) => ACT_STATUS[value])}</select>`),
    field('รายละเอียด', `<textarea id="act-detail" rows="3" maxlength="2000">${esc(row.detail || '')}</textarea>`)
  ].join('');
}

function actOpenForm(activity, event, day) {
  openPopup(event ? 'แก้ไขรายการในแผน' : 'เพิ่มรายการในแผน', actForm(event, day), async () => {
    const body = {
      title: $('act-title').value.trim(),
      startDate: $('act-start').value,
      endDate: $('act-end').value || $('act-start').value,
      responsible: $('act-resp').value.trim(),
      status: $('act-status').value,
      detail: $('act-detail').value.trim()
    };
    if (!body.title) throw new Error('ระบุชื่อกิจกรรม');
    if (!body.startDate) throw new Error('ระบุวันเริ่ม');
    if (body.endDate < body.startDate) throw new Error('วันจบต้องไม่ก่อนวันเริ่ม');
    const path = `/api/act/${encodeURIComponent(activity)}/plan${event ? `/${event.id}` : ''}`;
    await api(path, { method: event ? 'PATCH' : 'POST', body });
    toast('บันทึกแล้ว');
    closePopup();
    openView(view);
  });
}

function actOpenEvent(activity, event, editable) {
  const body = `<div class="plan-detail">
    <p><strong>${esc(event.title)}</strong></p>
    <p class="sum-meta">${actSpan(event)} ${actDate(event.start_date).getFullYear()} · ${esc(ACT_STATUS[event.status] || event.status)}</p>
    ${event.responsible ? `<p>ผู้รับผิดชอบ: ${esc(event.responsible)}</p>` : ''}
    ${event.detail ? `<p class="plan-note">${esc(event.detail)}</p>` : ''}
    ${editable ? button('act-del', 'ลบรายการ', 'danger') : ''}
  </div>`;
  openPopup('รายการในแผน', body, () => (editable ? actOpenForm(activity, event) : closePopup()), editable ? 'แก้ไข' : 'ปิด');
  if (editable) {
    $('act-del').onclick = () => confirmPopup('ลบรายการ', `ตรวจ "${esc(event.title)}" อีกครั้งก่อนลบ`, async () => {
      await api(`/api/act/${encodeURIComponent(activity)}/plan/${event.id}`, { method: 'DELETE' });
      toast('ลบแล้ว');
      openView(view);
    });
  }
}

async function actPlanRender(target, activity) {
  const label = (ACTIVITIES.find(([id]) => id === activity) || [activity, activity])[1];
  const range = actRange();
  const data = await api(`/api/act/${encodeURIComponent(activity)}/plan?from=${actIso(range.from)}&to=${actIso(range.to)}`);
  const events = data.events || [];
  const yearOf = (year) => (data.years || []).find((row) => row.year === year) || { department: '', canEdit: false };
  const canEditDay = (iso) => yearOf(Number(String(iso).slice(0, 4))).canEdit;
  const current = yearOf(actPlanAnchor.getFullYear());
  const owner = current.department ? `ผู้ดูแลปี ${actPlanAnchor.getFullYear()}: ${esc(current.department)}` : `ยังไม่กำหนดผู้ดูแลปี ${actPlanAnchor.getFullYear()}`;
  const body = actPlanMode === 'week' ? actWeekBody(events, range.from) : actPlanMode === 'year' ? actYearBody(events) : actMonthBody(events, range.from);
  target.innerHTML = `<div class="view-body"><section class="card plan-card">
    <div class="plan-head">
      <div><div class="card-title">Schedule Plan · ${esc(label)}</div><p class="sum-meta">${owner} · ${events.length} รายการ${current.canEdit ? ' · กดที่วันเพื่อเพิ่ม' : ''}</p></div>
      <div class="plan-tools">
        <div class="seg" role="group" aria-label="มุมมอง">${Object.entries(ACT_MODES).map(([mode, name]) => `<button class="seg-btn${mode === actPlanMode ? ' is-active' : ''}" type="button" data-mode="${mode}" aria-pressed="${mode === actPlanMode}">${name}</button>`).join('')}</div>
        <div class="plan-nav">${button('act-prev', '‹', 'secondary', 'aria-label="ก่อนหน้า"')}${button('act-today', 'วันนี้')}${button('act-next', '›', 'secondary', 'aria-label="ถัดไป"')}</div>
        <strong class="plan-label">${range.label}</strong>
        ${current.canEdit ? button('act-add', 'เพิ่ม', 'primary') : ''}
      </div>
    </div>
    <div class="plan-body">${body}</div>
  </section></div>`;
  const rerender = () => actPlanRender(target, activity).catch(onErr);
  target.querySelectorAll('[data-mode]').forEach((node) => { node.onclick = () => { actPlanMode = node.dataset.mode; rerender(); }; });
  $('act-prev').onclick = () => { actMove(-1); rerender(); };
  $('act-next').onclick = () => { actMove(1); rerender(); };
  $('act-today').onclick = () => { actPlanAnchor = new Date(); rerender(); };
  if ($('act-add')) $('act-add').onclick = () => actOpenForm(activity, null, actIso(actPlanMode === 'year' ? new Date(actPlanAnchor.getFullYear(), actPlanAnchor.getMonth(), 1) : actPlanAnchor));
  target.querySelectorAll('[data-ev]').forEach((node) => {
    node.onclick = (e) => {
      e.stopPropagation();
      const event = events.find((row) => String(row.id) === node.dataset.ev);
      if (event) actOpenEvent(activity, event, canEditDay(event.start_date));
    };
  });
  target.querySelectorAll('[data-day]').forEach((node) => {
    if (!canEditDay(node.dataset.day)) return;
    node.classList.add('is-editable');
    node.onclick = () => actOpenForm(activity, null, node.dataset.day);
  });
  target.querySelectorAll('[data-week]').forEach((node) => {
    node.onclick = (e) => { e.stopPropagation(); actPlanMode = 'week'; actPlanAnchor = actDate(node.dataset.week); rerender(); };
  });
  target.querySelectorAll('[data-month]').forEach((node) => {
    node.onclick = () => { actPlanMode = 'month'; actPlanAnchor = new Date(actPlanAnchor.getFullYear(), Number(node.dataset.month), 1); rerender(); };
  });
}

for (const id of ACT_PLAN_ON) VIEWS[`${id}-setting`] = (target) => actPlanRender(target, id);
