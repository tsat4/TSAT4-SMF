// ระบบกิจกรรม > <activity> > Setting: yearly plan as a Gantt chart with week / month / year zoom (server: server/modules/act).
// Items with the same title share one row. Turn the plan on for another activity by adding its id to ACT_GANTT_ON.
const ACT_GANTT_ON = ['5s'];
// Rows the system plans by itself (not stored): spec docs/specs/act-5s.md.
const ACT_GANTT_AUTO = {
  '5s': [{ title: 'Self Audit (ภายในวันที่ 10)', fromDay: 1, toDay: 10 }]
};
const ACT_GANTT_COLORS = ['#ff6b6b', '#ff9f43', '#f7c948', '#2ed573', '#1dd1a1', '#54a0ff', '#5f6dff', '#a55eea', '#ee5a9b', '#e84118'];
let actGanttMode = 'year';
let actGanttAnchor = new Date();

function actGanttRange() {
  const a = actGanttAnchor;
  if (actGanttMode === 'week') {
    const from = actWeekStart(a);
    const to = actAddDays(from, 6);
    return { from, to, label: `${actShort(actIso(from))} – ${actShort(actIso(to))} ${to.getFullYear()}` };
  }
  if (actGanttMode === 'month') {
    return { from: new Date(a.getFullYear(), a.getMonth(), 1), to: new Date(a.getFullYear(), a.getMonth() + 1, 0), label: `${ACT_MONTHS[a.getMonth()]} ${a.getFullYear()}` };
  }
  return { from: new Date(a.getFullYear(), 0, 1), to: new Date(a.getFullYear(), 11, 31), label: `ปี ${a.getFullYear()}` };
}

function actGanttMove(step) {
  const a = actGanttAnchor;
  if (actGanttMode === 'week') actGanttAnchor = actAddDays(a, step * 7);
  else if (actGanttMode === 'month') actGanttAnchor = new Date(a.getFullYear(), a.getMonth() + step, 1);
  else actGanttAnchor = new Date(a.getFullYear() + step, 0, 1);
}

function actGanttDays(from, to) {
  return Math.round((to - from) / 86400000) + 1;
}

// Columns of the time axis: [label, days, weekend]
function actGanttColumns(range) {
  if (actGanttMode === 'year') {
    return ACT_MONTHS_SHORT.map((name, m) => [name, new Date(range.from.getFullYear(), m + 1, 0).getDate(), false]);
  }
  return Array.from({ length: actGanttDays(range.from, range.to) }, (_, i) => {
    const date = actAddDays(range.from, i);
    const label = actGanttMode === 'week' ? `${ACT_DAYS[i]} ${date.getDate()}` : String(date.getDate());
    return [label, 1, date.getDay() === 0 || date.getDay() === 6];
  });
}

function actGanttAutoEvents(activity, range) {
  const out = [];
  for (const rule of ACT_GANTT_AUTO[activity] || []) {
    for (let d = new Date(range.from.getFullYear(), range.from.getMonth(), 1); d <= range.to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      out.push({ auto: true, title: rule.title, start_date: actIso(new Date(d.getFullYear(), d.getMonth(), rule.fromDay)), end_date: actIso(new Date(d.getFullYear(), d.getMonth(), Math.min(rule.toDay, last))), status: 'planned' });
    }
  }
  return out;
}

// Group items into rows by title; auto rows first, then by first start date.
function actGanttRows(events, autoEvents) {
  const rows = new Map();
  for (const event of [...autoEvents, ...events]) {
    if (!rows.has(event.title)) rows.set(event.title, { title: event.title, auto: Boolean(event.auto), items: [] });
    rows.get(event.title).items.push(event);
  }
  return [...rows.values()].sort((a, b) => (b.auto - a.auto) || a.items[0].start_date.localeCompare(b.items[0].start_date));
}

function actGanttBar(event, range, total, color) {
  const from = actIso(range.from);
  const to = actIso(range.to);
  const start = event.start_date < from ? from : event.start_date;
  const end = event.end_date > to ? to : event.end_date;
  const left = (actGanttDays(range.from, actDate(start)) - 1) / total * 100;
  const width = actGanttDays(actDate(start), actDate(end)) / total * 100;
  const tip = `${event.title} · ${actSpan(event)}${event.auto ? '' : ` · ${ACT_STATUS[event.status] || event.status}`}`;
  // Text only where it fits: never on yearly or auto bars, and only on bars of 3+ days in the month view.
  const days = actGanttDays(actDate(start), actDate(end));
  const text = event.auto || actGanttMode === 'year' || (actGanttMode === 'month' && days < 3) ? '' : actSpan(event);
  const attrs = event.auto ? 'tabindex="-1"' : `data-ev="${esc(event.id)}"`;
  return `<button class="gantt-bar plan-${esc(event.status)}${event.auto ? ' is-auto' : ''}" type="button" ${attrs} title="${esc(tip)}" style="left:${left}%;width:${width}%;--bar:${color}">${event.status === 'done' ? '✓ ' : ''}${esc(text)}</button>`;
}

async function actGanttRender(target, activity) {
  const range = actGanttRange();
  const data = await api(`/api/act/${encodeURIComponent(activity)}/plan?from=${actIso(range.from)}&to=${actIso(range.to)}`);
  const events = data.events || [];
  const yearOf = (year) => (data.years || []).find((row) => row.year === year) || { department: '', canEdit: false };
  const current = yearOf(actGanttAnchor.getFullYear());
  const canEditDay = (iso) => yearOf(Number(String(iso).slice(0, 4))).canEdit;
  const owner = current.department ? `ผู้ดูแลปี ${actGanttAnchor.getFullYear()}: ${esc(current.department)}` : `ยังไม่กำหนดผู้ดูแลปี ${actGanttAnchor.getFullYear()}`;
  const total = actGanttDays(range.from, range.to);
  const columns = actGanttColumns(range);
  const template = columns.map(([, days]) => `${days}fr`).join(' ');
  const rows = actGanttRows(events, actGanttAutoEvents(activity, range));
  const titles = [...new Set(events.map((event) => event.title))];
  const today = new Date();
  const todayIso = actIso(today);
  const todayLine = todayIso >= actIso(range.from) && todayIso <= actIso(range.to)
    ? `<div class="gantt-today" title="วันนี้ ${actShort(todayIso)}" style="left:${(actGanttDays(range.from, new Date(today.getFullYear(), today.getMonth(), today.getDate())) - 0.5) / total * 100}%"></div>` : '';
  const head = `<div class="gantt-row gantt-head"><div class="gantt-label">รายการ</div><div class="gantt-axis" style="grid-template-columns:${template}">${columns.map(([label, , weekend]) => `<div class="gantt-tick${weekend ? ' is-weekend' : ''}">${esc(label)}</div>`).join('')}</div></div>`;
  const body = rows.map((row, i) => {
    const color = ACT_GANTT_COLORS[i % ACT_GANTT_COLORS.length];
    const label = row.auto
      ? `<div class="gantt-label" style="--bar:${color}" title="ระบบกำหนดให้อัตโนมัติ">${esc(row.title)}</div>`
      : `<button class="gantt-label${current.canEdit ? ' is-editable' : ''}" type="button" style="--bar:${color}" data-row="${esc(row.title)}" title="${esc(row.title)}">${esc(row.title)}<span>${row.items.length}</span></button>`;
    return `<div class="gantt-row">${label}<div class="gantt-track">${row.items.map((event) => actGanttBar(event, range, total, color)).join('')}</div></div>`;
  }).join('');
  const lines = `<div class="gantt-lines" style="grid-template-columns:${template}">${columns.map(([, , weekend]) => `<div class="${weekend ? 'is-weekend' : ''}"></div>`).join('')}${todayLine}</div>`;
  target.innerHTML = `<div class="view-body"><section class="card plan-card">
    <div class="plan-head">
      <div><div class="card-title">แผนประจำปี · ${esc(actLabel(activity))}</div><p class="sum-meta">${owner} · ${events.length} รายการ · <span class="gantt-key"></span> วันนี้${current.canEdit ? ' · กดชื่อแถวเพื่อเพิ่มช่วงใหม่ในแถวนั้น' : ''}</p></div>
      <div class="plan-tools">
        <div class="seg" role="group" aria-label="มุมมอง">${Object.entries(ACT_MODES).map(([mode, name]) => `<button class="seg-btn${mode === actGanttMode ? ' is-active' : ''}" type="button" data-gmode="${mode}" aria-pressed="${mode === actGanttMode}">${name}</button>`).join('')}</div>
        <div class="plan-nav">${button('gantt-prev', '‹', 'secondary', 'aria-label="ก่อนหน้า"')}${button('gantt-today', 'วันนี้')}${button('gantt-next', '›', 'secondary', 'aria-label="ถัดไป"')}</div>
        <strong class="plan-label">${range.label}</strong>
        ${current.canEdit ? button('gantt-add', 'เพิ่ม', 'primary') : ''}
      </div>
    </div>
    <div class="gantt-scroll"><div class="gantt">${head}<div class="gantt-body">${lines}${body || ''}</div></div></div>
    ${events.length ? '' : `<p class="empty">ยังไม่มีรายการในช่วงนี้${current.canEdit ? ' กด "เพิ่ม" เพื่อวางแผน' : ''}</p>`}
  </section></div>`;
  const rerender = () => actGanttRender(target, activity).catch(onErr);
  target.querySelectorAll('[data-gmode]').forEach((node) => { node.onclick = () => { actGanttMode = node.dataset.gmode; rerender(); }; });
  $('gantt-prev').onclick = () => { actGanttMove(-1); rerender(); };
  $('gantt-next').onclick = () => { actGanttMove(1); rerender(); };
  $('gantt-today').onclick = () => { actGanttAnchor = new Date(); rerender(); };
  const firstDay = () => actIso(actGanttMode === 'year' ? new Date(actGanttAnchor.getFullYear(), actGanttAnchor.getMonth(), 1) : range.from);
  if ($('gantt-add')) $('gantt-add').onclick = () => actOpenForm(activity, null, firstDay(), '', titles);
  target.querySelectorAll('[data-row]').forEach((node) => {
    node.onclick = () => { if (current.canEdit) actOpenForm(activity, null, firstDay(), node.dataset.row, titles); };
  });
  target.querySelectorAll('[data-ev]').forEach((node) => {
    node.onclick = () => {
      const event = events.find((row) => String(row.id) === node.dataset.ev);
      if (event) actOpenEvent(activity, event, canEditDay(event.start_date), titles);
    };
  });
}

for (const id of ACT_GANTT_ON) VIEWS[`${id}-setting`] = (target) => actGanttRender(target, id);
