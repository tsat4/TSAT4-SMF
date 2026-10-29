// ระบบกิจกรรม > <activity> > Setting: Project Planner (server: server/modules/act/planner.js).
// Main items with sub items on a Gantt: year view = 12 months × W1–W4 (longer when items run into next year), month view = days. The year's admins
// drag bars (whole bar = move, edge = resize), add rows with +, and create / edit / delete. Others read only.
// 100P: its own Setting page (APL_ON). 5S: a tab inside Setting (edit) and Dashboard (read only), see act-5s.js.
// Turn it on for another activity by adding its id to PLANNER_ON in planner.js and here (or calling aplRender from a tab).
const APL_ON = ['100p', 'smf', 'e-day', 'lean', 'safety'];
// Main item colours (ผู้ใช้ขอเพิ่ม 2026-10-29: 5 → 12); keys are stored in mt_<act>_task.color, server COLORS lists the same keys.
const APL_COLORS = {
  p1: '#ec6f73', p2: '#3fbfbf', p3: '#e3a52f', p4: '#8b6fd8', p5: '#4b8bea', p6: '#2fa36b',
  p7: '#f08a3c', p8: '#e46aa8', p9: '#8d6e52', p10: '#5f7488', p11: '#1f8a99', p12: '#a8b236'
};
// Narrowest column in px; wider screens stretch the columns so the last month ends at the right edge.
const APL_COL = { year: 15, month: 26 };
const APL_LEFT = 384; // left columns, app.css .apl-row (260 on phones)
// A plan of year Y may run until December of Y + 1 (planner.js datesIn).
const APL_MAX_MONTHS = 24;
let aplView = 'year';
let aplYear = new Date().getFullYear();
let aplMonth = new Date().getMonth(); // month of the plan, 12–23 = next year
let aplSelected = null;
let aplQuery = '';
const aplCollapsed = new Set();

function aplLastDay(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function aplMonthOf(iso) {
  const date = actDate(iso);
  return (date.getFullYear() - aplYear) * 12 + date.getMonth();
}

function aplMonthName(month, long = false) {
  const name = (long ? ACT_MONTHS : ACT_MONTHS_SHORT)[month % 12];
  if (month < 12) return long ? `${name} ${aplYear}` : name;
  return long ? `${name} ${aplYear + 1}` : `${name} ${String(aplYear + 1).slice(2)}`;
}

// Year view column = plan month * 4 + week (W1 1–7, W2 8–14, W3 15–21, W4 22–end of month), as in the 5S audit plan.
function aplWeekCol(iso) {
  return aplMonthOf(iso) * 4 + Math.min(3, Math.floor((actDate(iso).getDate() - 1) / 7));
}

function aplColStart(col) {
  return actIso(new Date(aplYear, Math.floor(col / 4), (col % 4) * 7 + 1));
}

function aplColEnd(col) {
  const month = Math.floor(col / 4);
  const week = col % 4;
  return actIso(new Date(aplYear, month, week < 3 ? week * 7 + 7 : aplLastDay(aplYear, month)));
}

// Year view shows 12 months, or more when an item runs into next year.
function aplGeometry(tasks) {
  if (aplView === 'month') {
    const cols = aplLastDay(aplYear, aplMonth);
    return { cols, min: APL_COL.month, first: actIso(new Date(aplYear, aplMonth, 1)), last: actIso(new Date(aplYear, aplMonth, cols)) };
  }
  const lastMonth = Math.max(11, ...tasks.filter((t) => t.end_date).map((t) => Math.min(APL_MAX_MONTHS - 1, aplMonthOf(t.end_date))));
  return { cols: (lastMonth + 1) * 4, months: lastMonth + 1, min: APL_COL.year };
}

// Column span [a, b] of an item, clipped to the view; null when it is outside.
function aplPlace(task, g) {
  if (!task.start_date || !task.end_date) return null;
  if (aplView === 'year') {
    const a = Math.max(0, aplWeekCol(task.start_date));
    const b = Math.min(g.cols - 1, aplWeekCol(task.end_date));
    return b < a ? null : { a, b };
  }
  if (task.end_date < g.first || task.start_date > g.last) return null;
  return { a: task.start_date < g.first ? 0 : actDate(task.start_date).getDate() - 1, b: task.end_date > g.last ? g.cols - 1 : actDate(task.end_date).getDate() - 1 };
}

// Today as a column position (fractional), or null.
function aplTodayCol(g) {
  const today = actIso(new Date());
  if (aplView === 'month') return today >= g.first && today <= g.last ? actDate(today).getDate() - 0.5 : null;
  const col = aplWeekCol(today);
  if (col < 0 || col >= g.cols) return null;
  const date = actDate(today);
  const from = (col % 4) * 7 + 1;
  const to = col % 4 < 3 ? from + 6 : aplLastDay(date.getFullYear(), date.getMonth());
  return col + (date.getDate() - from + 0.5) / (to - from + 1);
}

const aplPct = (col, g) => `${(col / g.cols) * 100}%`;

// New dates after dragging `delta` columns. Year view snaps to whole weeks, month view moves by days.
function aplShift(task, mode, delta, g) {
  if (aplView === 'year') {
    const max = APL_MAX_MONTHS * 4 - 1;
    let a = aplWeekCol(task.start_date);
    let b = aplWeekCol(task.end_date);
    if (mode === 'move') {
      const len = b - a;
      a = Math.max(0, Math.min(max - len, a + delta));
      b = a + len;
    } else if (mode === 'l') a = Math.max(0, Math.min(b, a + delta));
    else b = Math.min(Math.max(g.cols - 1, b), Math.max(a, b + delta));
    return { startDate: aplColStart(a), endDate: aplColEnd(b) };
  }
  const first = actIso(new Date(aplYear, 0, 1));
  const last = actIso(new Date(aplYear + 1, 11, 31));
  const add = (iso) => actIso(actAddDays(actDate(iso), delta));
  let start = task.start_date;
  let end = task.end_date;
  if (mode === 'move') {
    const days = Math.round((actDate(end) - actDate(start)) / 86400000);
    start = add(start);
    if (start < first) start = first;
    end = actIso(actAddDays(actDate(start), days));
    if (end > last) { end = last; start = actIso(actAddDays(actDate(end), -days)); }
  } else if (mode === 'l') {
    start = add(start);
    if (start > end) start = end;
    if (start < first) start = first;
  } else {
    end = add(end);
    if (end < start) end = start;
    if (end > last) end = last;
  }
  return { startDate: start, endDate: end };
}

function aplHead(g) {
  if (aplView === 'year') {
    return `<div class="apl-months" style="grid-template-columns:repeat(${g.months}, 1fr)">${Array.from({ length: g.months }, (_, m) => `<div class="${m === 12 ? 'is-year' : ''}">${aplMonthName(m)}</div>`).join('')}</div>
      <div class="apl-ticks" style="grid-template-columns:repeat(${g.cols}, 1fr)">${Array.from({ length: g.cols }, (_, c) => `<div class="${c % 4 === 0 ? 'is-month' : ''}${c === 48 ? ' is-year' : ''}" title="${aplMonthName(Math.floor(c / 4))} W${c % 4 + 1}">${c % 4 + 1}</div>`).join('')}</div>`;
  }
  return `<div class="apl-months"><div>${aplMonthName(aplMonth, true)}</div></div>
    <div class="apl-ticks" style="grid-template-columns:repeat(${g.cols}, 1fr)">${Array.from({ length: g.cols }, (_, c) => {
      const day = new Date(aplYear, aplMonth, c + 1).getDay();
      return `<div class="${day === 0 || day === 6 ? 'is-weekend' : ''}">${c + 1}</div>`;
    }).join('')}</div>`;
}

function aplLines(g) {
  const cells = Array.from({ length: g.cols }, (_, c) => {
    if (aplView === 'year') return `<div class="${c % 4 === 0 ? 'is-month' : ''}${c === 48 ? ' is-year' : ''}"></div>`;
    const day = new Date(aplYear, aplMonth, c + 1).getDay();
    return `<div class="${day === 0 || day === 6 ? 'is-weekend' : ''}"></div>`;
  }).join('');
  const today = aplTodayCol(g);
  return `<div class="apl-lines" style="grid-template-columns:repeat(${g.cols}, 1fr)">${cells}</div>${today == null ? '' : `<div class="apl-today" style="left:${aplPct(today, g)}"></div>`}`;
}

// Owner without the title (นาย / นาง / นางสาว ...) to keep the column short.
const aplOwner = (name) => String(name || '').replace(/^(นางสาว|นาง|นาย|Mr\.?|Mrs\.?|Ms\.?|Miss)\s*/, '');
// Plan vs actual (server planStatus): colour key for the % cell and the label beside the bar.
const APL_PLAN_KEY = [['early', 'เสร็จก่อนแผน'], ['done', 'เสร็จ / ตามแผน'], ['ahead', 'เร็วกว่าแผน'], ['behind', 'ช้ากว่าแผน'], ['overdue', 'เลยกำหนด / เสร็จช้า']];

// Where the dark (actual) bar ends: the done day, today while open (past the end when late), none before the start.
function aplActualEnd(task) {
  if (!task.start_date) return null;
  if (task.progress >= 100) return task.done_on || task.end_date;
  const today = actIso(new Date());
  // nothing done yet = no actual bar (like an empty A row in the Excel plan)
  return today < task.start_date || task.progress <= 0 ? null : today;
}

// Dates + plan status beside the bar: on the right when there is room, else on the left, else only in the bar's tooltip.
function aplDatesLabel(pos, g, text) {
  const room = Math.max(0.18, text.length * 0.0042);
  if ((g.cols - pos.b - 1) / g.cols >= room) return `<div class="apl-dates" style="left:calc(${aplPct(pos.b + 1, g)} + 6px)">${text}</div>`;
  if (pos.a / g.cols >= room) return `<div class="apl-dates" style="right:calc(${aplPct(g.cols - pos.a, g)} + 6px)">${text}</div>`;
  return '';
}

function aplRow(task, code, color, g, lines, canEdit, phase) {
  const pos = aplPlace(task, g);
  const plan = task.plan || { code: 'none', text: '' };
  const span = task.start_date ? `${actShort(task.start_date)} – ${actShort(task.end_date)}${plan.text ? ` · ${plan.text}` : ''}` : '';
  // Light bar = plan (start → end, the one you drag). Dark bar = actual, from the start to the day it was done,
  // or to today while open — so it stops short when done early and runs past the end when late (ผู้ใช้กำหนด 2026-10-29).
  const act = pos ? aplPlace({ start_date: task.start_date, end_date: aplActualEnd(task) }, g) : null;
  const tip = `${esc(task.title)} · ${span} · ${task.progress}%`;
  const bar = pos ? `<div class="apl-bar${canEdit ? ' is-editable' : ''}" data-bar="${task.id}" data-a="${pos.a}" data-b="${pos.b}" style="left:${aplPct(pos.a, g)};width:${aplPct(pos.b - pos.a + 1, g)};--bar:${color}" title="${tip}">
      ${canEdit && !task.derived ? '<div class="apl-handle is-l" data-h="l"></div><div class="apl-handle is-r" data-h="r"></div>' : ''}</div>
    ${act ? `<div class="apl-act" style="left:${aplPct(act.a, g)};width:${aplPct(Math.min(act.b, pos.b) - act.a + 1, g)};--bar:${color}"></div>
    ${act.b > pos.b ? `<div class="apl-act is-over" style="left:${aplPct(pos.b + 1, g)};width:${aplPct(act.b - pos.b, g)}" title="เลยกำหนด"></div>` : ''}
    <div class="apl-act-pct" style="${act.b + 1 > g.cols * 0.95 ? 'right:4px' : `left:calc(${aplPct(act.b + 1, g)} + 4px)`}">${task.progress}%</div>` : ''}
    ${aplDatesLabel(pos, g, span)}` : '';
  const title = phase
    ? `<div class="apl-title"><button class="apl-tog" type="button" data-tog="${task.id}" aria-expanded="${!aplCollapsed.has(task.id)}" aria-label="ย่อ/ขยาย">${phase.kids ? (aplCollapsed.has(task.id) ? '▸' : '▾') : ''}</button><span>${esc(task.title)}</span></div>`
    : `<div class="apl-title is-sub"><span>${esc(task.title)}</span></div>`;
  return `<div class="apl-row${phase ? ' is-phase' : ''}${aplSelected === task.id ? ' is-selected' : ''}" data-task="${task.id}">
    <div class="apl-left"><div class="apl-code">${code}</div>${title}<div title="${esc(task.owner_name)}">${esc(aplOwner(task.owner_name))}</div><div class="apl-pct is-${plan.code}" title="${esc(plan.text)}">${task.progress}</div></div>
    <div class="apl-track">${lines}${bar}</div></div>`;
}

// inPage: inside a tab of another page that has its own year (a5Year) and page bar (slot a5-tools).
// readOnly: no create / edit / drag even for admins (Dashboard).
async function aplRender(target, activity, opts = {}) {
  const { inPage = false, readOnly = false } = opts;
  if (inPage) aplYear = a5Year;
  let data;
  try {
    data = await api(`/api/act/${encodeURIComponent(activity)}/tasks?year=${aplYear}`);
  } catch (err) {
    if (inPage) $('a5-tools').innerHTML = '';
    target.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    return;
  }
  const tasks = data.tasks || [];
  const canEdit = Boolean(data.canEdit) && !readOnly;
  if (!tasks.some((t) => t.id === aplSelected)) aplSelected = null;
  const g = aplGeometry(tasks);
  const kidsOf = (id) => tasks.filter((t) => t.parent_id === id).sort((a, b) => a.sort_no - b.sort_no || a.id - b.id);
  const phases = tasks.filter((t) => t.parent_id == null).sort((a, b) => a.sort_no - b.sort_no || a.id - b.id);
  const q = aplQuery.trim().toLowerCase();
  const match = (t) => !q || `${t.title} ${t.owner_name}`.toLowerCase().includes(q);
  const lines = aplLines(g);
  let rows = '';
  phases.forEach((p, pi) => {
    const kids = kidsOf(p.id);
    const shownKids = q ? kids.filter(match) : kids;
    if (!match(p) && !shownKids.length) return;
    const color = APL_COLORS[p.color] || Object.values(APL_COLORS)[pi % Object.keys(APL_COLORS).length];
    rows += aplRow(p, `${pi + 1}`, color, g, lines, canEdit, { kids: kids.length });
    if (!aplCollapsed.has(p.id)) shownKids.forEach((k) => { rows += aplRow(k, `${pi + 1}.${kids.indexOf(k) + 1}`, color, g, lines, canEdit, null); });
  });
  if (canEdit) rows += `<div class="apl-row apl-addrow"><div class="apl-left"><div></div><div><button class="apl-link" type="button" id="apl-add-phase">+ เพิ่มข้อหลัก</button></div><div></div><div></div></div><div class="apl-track">${lines}</div></div>`;
  const years = [aplYear - 1, aplYear, aplYear + 1].filter((y) => y >= 2000 && y <= 2100);
  const seg = `<div class="seg" role="group" aria-label="มุมมอง">${[['year', 'รายปี'], ['month', 'รายเดือน']].map(([mode, name]) => `<button class="seg-btn${mode === aplView ? ' is-active' : ''}" type="button" data-aplview="${mode}" aria-pressed="${mode === aplView}">${name}</button>`).join('')}</div>`;
  const search = field('ค้นหา', `<input id="apl-q" placeholder="ชื่อรายการหรือผู้รับผิดชอบ" value="${esc(aplQuery)}">`);
  // All on the right (the page has no sub-pages), large to small: year → year/month view → month → search →
  // create / edit / delete at the far right.
  const tools = `${inPage ? '' : `<div class="a5-year">${field('ปี', `<select id="apl-year">${years.map((y) => `<option value="${y}"${y === aplYear ? ' selected' : ''}>${y}</option>`).join('')}</select>`)}</div>`}
    ${seg}
    ${aplView === 'month' ? `<div class="plan-nav">${button('apl-prev', '‹', 'secondary', 'aria-label="เดือนก่อน"')}${button('apl-next', '›', 'secondary', 'aria-label="เดือนถัดไป"')}</div><strong class="plan-label">${aplMonthName(aplMonth, true)}</strong>` : ''}
    ${search}
    ${canEdit ? `${button('apl-new', 'สร้าง', 'primary')}${button('apl-edit', 'แก้ไข', 'secondary', aplSelected ? '' : 'disabled')}${button('apl-del', 'ลบ', 'danger', aplSelected ? '' : 'disabled')}` : ''}`;
  const keepScroll = target.querySelector('.apl-scroll');
  const scroll = keepScroll ? [keepScroll.scrollLeft, keepScroll.scrollTop] : null;
  const content = `<div class="apl-scroll"><div class="apl-grid" style="--apl-tl:${g.cols * g.min}px">
      <div class="apl-row apl-head"><div class="apl-left"><div>ลำดับ</div><div>รายการ</div><div>ผู้รับผิดชอบ</div><div class="apl-pct">%</div></div><div class="apl-track">${aplHead(g)}</div></div>
      ${rows}
    </div></div>
    ${tasks.length ? `<div class="apl-key">${APL_PLAN_KEY.map(([k, label]) => `<span><i class="apl-pct is-${k}"></i>${label}</span>`).join('')}<span class="sum-meta">แถบบน (อ่อน) = แผน · แถบล่าง (เข้ม) = ทำจริง ถึงวันเสร็จ / วันนี้ · แดง = เลยกำหนด · สถานะเทียบ % จริงกับ % ที่ควรได้ถึงวันนี้ ต่างไม่เกิน 10% = ตามแผน${canEdit ? ' · เพิ่มข้อรอง: เลือกข้อหลักแล้วกด "สร้าง"' : ''}</span></div>` : `<p class="empty">ยังไม่มีแผนปี ${aplYear}${canEdit ? ' กด "สร้าง" หรือ "+ เพิ่มข้อหลัก"' : ''}</p>`}`;
  if (inPage) {
    $('a5-tools').innerHTML = tools;
    target.innerHTML = content;
  } else {
    target.innerHTML = `<div class="view-body"><section class="card plan-card">${pageBar('', tools, 'apl')}${content}</section></div>`;
  }
  const box = target.querySelector('.apl-scroll');
  // The scrollbars start below the header row and right of the left columns (app.css .apl-scroll).
  box.style.setProperty('--apl-head', `${box.querySelector('.apl-head').offsetHeight}px`);
  box.style.setProperty('--apl-left', `${box.querySelector('.apl-left').offsetWidth}px`);
  if (scroll) [box.scrollLeft, box.scrollTop] = scroll;
  else if (box.scrollWidth > box.clientWidth) {
    const track = box.scrollWidth - box.querySelector('.apl-left').offsetWidth;
    box.scrollLeft = Math.max(0, ((aplTodayCol(g) ?? 0) / g.cols) * track - (box.clientWidth - APL_LEFT) / 2);
  }

  const rerender = () => aplRender(target, activity, opts).catch(onErr);
  const byId = (id) => tasks.find((t) => t.id === Number(id));
  document.querySelectorAll('[data-aplview]').forEach((node) => { node.onclick = () => { aplView = node.dataset.aplview; rerender(); }; });
  if ($('apl-year')) $('apl-year').onchange = () => { aplYear = Number($('apl-year').value); aplMonth %= 12; aplSelected = null; rerender(); };
  let typing;
  $('apl-q').oninput = () => { clearTimeout(typing); typing = setTimeout(() => { aplQuery = $('apl-q').value; rerender().then(() => { const input = $('apl-q'); input?.focus(); input?.setSelectionRange(input.value.length, input.value.length); }); }, 250); };
  if ($('apl-prev')) {
    // Month view moves within the plan: January of its year to December of the next.
    $('apl-prev').disabled = aplMonth <= 0;
    $('apl-next').disabled = aplMonth >= APL_MAX_MONTHS - 1;
    $('apl-prev').onclick = () => { aplMonth = Math.max(0, aplMonth - 1); rerender(); };
    $('apl-next').onclick = () => { aplMonth = Math.min(APL_MAX_MONTHS - 1, aplMonth + 1); rerender(); };
  }
  target.querySelectorAll('[data-tog]').forEach((node) => {
    node.onclick = (e) => { e.stopPropagation(); const id = Number(node.dataset.tog); if (aplCollapsed.has(id)) aplCollapsed.delete(id); else aplCollapsed.add(id); rerender(); };
  });
  target.querySelectorAll('[data-task]').forEach((row) => {
    row.onclick = (e) => {
      if (e.target.closest('[data-add],[data-tog]')) return;
      aplSelected = Number(row.dataset.task);
      target.querySelectorAll('[data-task]').forEach((r) => r.classList.toggle('is-selected', r === row));
      if ($('apl-edit')) { $('apl-edit').disabled = false; $('apl-del').disabled = false; }
    };
    if (canEdit) row.ondblclick = (e) => { if (!e.target.closest('[data-add],[data-tog]')) aplOpenForm(activity, tasks, byId(row.dataset.task), null, rerender); };
  });
  if (!canEdit) return;
  $('apl-add-phase').onclick = () => aplOpenForm(activity, tasks, null, null, rerender);
  // With a main item selected, "สร้าง" adds a sub item under it (the + button per row was removed for space).
  $('apl-new').onclick = () => { const sel = byId(aplSelected); aplOpenForm(activity, tasks, null, sel ? (sel.parent_id ?? sel.id) : null, rerender); };
  $('apl-edit').onclick = () => { const task = byId(aplSelected); if (task) aplOpenForm(activity, tasks, task, null, rerender); };
  $('apl-del').onclick = () => {
    const task = byId(aplSelected);
    if (!task) return;
    const kids = kidsOf(task.id).length;
    confirmPopup('ลบรายการ', `ลบ "${esc(task.title)}"${kids ? ` และข้อรอง ${kids} รายการ` : ''}`, async () => {
      await api(`/api/act/${encodeURIComponent(activity)}/tasks/${task.id}`, { method: 'DELETE' });
      aplSelected = null;
      toast('ลบแล้ว');
      rerender();
    });
  };
  target.querySelectorAll('[data-bar]').forEach((node) => node.addEventListener('pointerdown', (e) => aplDrag(e, node, g, activity, tasks, kidsOf, rerender)));
}

// Drag a bar; a main item with sub items has no edges and moves all its sub items by the same step.
function aplDrag(e, node, g, activity, tasks, kidsOf, rerender) {
  if (e.button !== 0) return;
  e.preventDefault();
  const task = tasks.find((t) => t.id === Number(node.dataset.bar));
  const mode = e.target.dataset.h || 'move';
  const x0 = e.clientX;
  const colPx = node.parentElement.getBoundingClientRect().width / g.cols;
  const a0 = Number(node.dataset.a);
  const b0 = Number(node.dataset.b);
  let delta = 0;
  try { node.setPointerCapture(e.pointerId); } catch { // keep dragging without capture
  }
  node.classList.add('is-dragging');
  const move = (ev) => {
    delta = Math.round((ev.clientX - x0) / colPx);
    let a = a0;
    let b = b0;
    if (mode === 'move') { a += delta; b += delta; } else if (mode === 'l') a = Math.min(b0, a0 + delta); else b = Math.max(a0, b0 + delta);
    node.style.left = aplPct(a, g);
    node.style.width = aplPct(b - a + 1, g);
  };
  const up = async () => {
    node.removeEventListener('pointermove', move);
    node.removeEventListener('pointerup', up);
    node.removeEventListener('pointercancel', up);
    node.classList.remove('is-dragging');
    aplSelected = task.id;
    if (!delta) return rerender();
    const targets = task.derived ? kidsOf(task.id) : [task];
    const items = targets.map((t) => ({ id: t.id, ...aplShift(t, mode, delta, g) }))
      .filter((item, i) => item.startDate !== targets[i].start_date || item.endDate !== targets[i].end_date);
    try {
      if (items.length) await api(`/api/act/${encodeURIComponent(activity)}/tasks/dates`, { method: 'PATCH', body: { year: aplYear, items } });
    } catch (err) {
      onErr(err);
    }
    rerender();
  };
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
}

function aplOpenForm(activity, tasks, task, parentId, rerender) {
  const phases = tasks.filter((t) => t.parent_id == null && (!task || t.id !== task.id)).sort((a, b) => a.sort_no - b.sort_no);
  const pid = task ? task.parent_id : parentId;
  const derived = Boolean(task?.derived);
  const base = aplView === 'month' ? new Date(aplYear, aplMonth, 1) : new Date(aplYear, aplYear === new Date().getFullYear() ? new Date().getMonth() : 0, 1);
  const range = `min="${aplYear}-01-01" max="${aplYear + 1}-12-31"`;
  const start = task ? task.start_date || '' : actIso(base);
  const end = task ? task.end_date || '' : actIso(actAddDays(base, 13));
  let ownerId = task?.owner_id || '';
  const color = task?.color || 'p5';
  const kidCount = task ? tasks.filter((t) => t.parent_id === task.id).length : 0;
  const fields = [
    // Said first: a main item with sub items takes its dates and % from them, so those fields are locked here.
    derived ? `<p class="apl-locked">ข้อหลักนี้มีข้อรอง ${kidCount} ข้อ: วันเริ่ม วันจบ และ % คิดจากข้อรองให้อัตโนมัติ · แก้วันหรือ % ที่ข้อรอง (ดับเบิลคลิกแถวข้อรอง) หรือลากแท่งข้อหลักเพื่อเลื่อนทั้งชุด · ที่นี่แก้ได้: ชื่อ ผู้รับผิดชอบ สี รายละเอียด</p>` : '',
    field('ระดับ', `<select id="apl-parent"${derived ? ' disabled' : ''}><option value="">ข้อหลัก</option>${phases.map((p) => `<option value="${p.id}"${p.id === pid ? ' selected' : ''}>ข้อรองของ: ${esc(p.title)}</option>`).join('')}</select>`),
    field('ชื่อรายการ', `<input id="apl-title" maxlength="200" value="${esc(task?.title || '')}">`),
    field('ผู้รับผิดชอบ', `<div class="apl-owner"><input id="apl-owner" readonly value="${esc(ownerId ? `${ownerId} · ${task.owner_name}` : '')}" placeholder="ค้นจากรายชื่อด้านล่าง">${button('apl-owner-clear', 'ล้าง')}</div>`),
    A5_EMP_FIELDS,
    field('วันเริ่ม', `<input id="apl-start" type="date" ${range} value="${esc(start)}"${derived ? ' disabled' : ''}>`),
    field('วันจบ', `<input id="apl-end" type="date" ${range} value="${esc(end)}"${derived ? ' disabled' : ''}>`),
    field(`ความคืบหน้า <span id="apl-pct-v">${task?.progress ?? 0}%</span>`, `<input id="apl-pct" type="range" min="0" max="100" step="5" value="${task?.progress ?? 0}"${derived ? ' disabled' : ''}>`),
    `<div id="apl-done-wrap">${field('วันที่ทำเสร็จ (100%)', `<input id="apl-done" type="date" value="${esc(task?.done_on || actIso(new Date()))}">`)}<p class="sum-meta">ใช้เทียบกับวันจบ: เสร็จก่อนแผน / ตามแผน / เสร็จช้า</p></div>`,
    `<div id="apl-color-wrap">${field('สีข้อหลัก', `<div class="apl-swatches">${Object.entries(APL_COLORS).map(([key, hex]) => `<label class="apl-swatch" style="--bar:${hex}"><input type="radio" name="apl-color" value="${key}"${key === color ? ' checked' : ''}><span></span></label>`).join('')}</div>`)}</div>`,
    field('รายละเอียด', `<textarea id="apl-note" rows="2" maxlength="2000">${esc(task?.note || '')}</textarea>`),
    derived ? '' : `<p class="sum-meta">วางแผนได้ถึง ธ.ค. ${aplYear + 1} · ข้อหลักเว้นวันว่างได้ ข้อรองต้องมีวันเริ่มและวันจบ</p>`
  ].join('');
  const title = task ? 'แก้ไขรายการ' : pid ? 'เพิ่มข้อรอง' : 'สร้างข้อหลัก';
  openPopup(title, fields, async () => {
    const body = {
      year: aplYear,
      title: $('apl-title').value.trim(),
      parentId: $('apl-parent').value || null,
      ownerId,
      note: $('apl-note').value.trim(),
      color: document.querySelector('[name="apl-color"]:checked')?.value,
      startDate: $('apl-start').value,
      endDate: $('apl-end').value,
      progress: Number($('apl-pct').value),
      doneOn: Number($('apl-pct').value) >= 100 ? $('apl-done').value : ''
    };
    if (!body.title) throw new Error('ระบุชื่อรายการ');
    if (body.parentId && (!body.startDate || !body.endDate)) throw new Error('ข้อรองต้องมีวันเริ่มและวันจบ');
    if (body.startDate && body.endDate && body.endDate < body.startDate) throw new Error('วันจบต้องไม่ก่อนวันเริ่ม');
    const path = `/api/act/${encodeURIComponent(activity)}/tasks${task ? `/${task.id}` : ''}`;
    const saved = await api(path, { method: task ? 'PATCH' : 'POST', body });
    if (!task && saved?.id) aplSelected = saved.id;
    if (body.parentId) aplCollapsed.delete(Number(body.parentId));
    // The finish date needs mt_<act>_task.done_on: the server says which SQL to run when it is missing.
    toast(saved?.warn || 'บันทึกแล้ว', saved?.warn ? 'error' : undefined);
    closePopup();
    rerender();
  });
  const syncColor = () => { $('apl-color-wrap').hidden = Boolean($('apl-parent').value); };
  $('apl-parent').onchange = syncColor;
  syncColor();
  const syncDone = () => { $('apl-done-wrap').hidden = derived || Number($('apl-pct').value) < 100; };
  $('apl-pct').oninput = () => { $('apl-pct-v').textContent = `${$('apl-pct').value}%`; syncDone(); };
  syncDone();
  $('apl-owner-clear').onclick = () => { ownerId = ''; $('apl-owner').value = ''; };
  a5EmployeeSearch(activity, (p) => { ownerId = p.employeeId; $('apl-owner').value = `${p.employeeId} · ${p.name}`; }, aplYear);
}

const APL_DASH_TABS = { schedule: 'Schedule', team: 'Team' };
const APL_SET_TABS = { team: 'ทีม', plan: 'แผนงาน' };
const APL_ROLE_LABEL = {
  admin: 'Admin ผู้ดูแลกิจกรรม',
  chairman: 'ประธาน',
  vice: 'รองประธาน',
  member: 'ตัวแทนหน่วยงาน',
  auditor: 'ผู้ตรวจประเมิน'
};
const aplDashTab = {};
const aplSetTab = {};

async function aplDashboard(target, activity) {
  const me = await a5Api(activity, `me?year=${a5Year}`);
  const tab = aplDashTab[activity] || 'schedule';
  target.innerHTML = `<div class="view-body"><section class="card">
    ${pageBar(a5Seg('data-apldash', APL_DASH_TABS, tab), `<div class="a5-year">${a5YearSelect(me.years)}</div>`, 'a5')}
    <div id="a5-body"><div class="empty">กำลังโหลด...</div></div>
  </section></div>`;
  const rerender = () => aplDashboard(target, activity).catch(onErr);
  target.querySelectorAll('[data-apldash]').forEach((node) => {
    node.onclick = () => { aplDashTab[activity] = node.dataset.apldash; rerender(); };
  });
  if ($('a5-year')) $('a5-year').onchange = () => { a5Year = Number($('a5-year').value); rerender(); };
  const body = $('a5-body');
  if (tab === 'team') return aplDrawTeam(body, activity, me.access.admin);
  return aplRender(body, activity, { inPage: true, readOnly: true });
}

async function aplDrawTeam(body, activity, admin) {
  let data;
  try {
    data = await a5Api(activity, `team?year=${a5Year}`);
  } catch (err) {
    body.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    return;
  }
  const active = (data.members || []).filter((m) => m.status === 'Active');
  const person = (m) => `<div class="a5-person">${esc(m.employee_id)} · ${esc(m.name || '-')}<span>${esc(m.department || (m.team ? `ทีม ${m.team}` : ''))}</span></div>`;
  const actName = actLabel(activity);
  body.innerHTML = `
    ${admin ? `<div class="action-bar a5-actions">${button('apl-team-edit', 'แก้ไขทีม')}</div>` : ''}
    <div class="a5-team-grid">${Object.entries(APL_ROLE_LABEL).map(([role, label], i) => {
      const list = active.filter((m) => m.role === role);
      if (!list.length && (role === 'auditor' || (role === 'member' && !active.some((m) => m.role === 'member')))) return '';
      return `<div class="a5-team" style="--team:${CHART.series[i % CHART.series.length]}"><div class="a5-team-head">${esc(label)}<span>${list.length} คน</span></div>${list.map(person).join('') || '<div class="a5-person">-</div>'}</div>`;
    }).join('')}</div>
    <p class="sum-meta">โครงสร้างทีม ${esc(actName)} ปี ${a5Year} · ${active.length} คน</p>`;
  a5Lift(body);
  if (admin && $('apl-team-edit')) $('apl-team-edit').onclick = () => {
    aplSetTab[activity] = 'team';
    openView(`${activity}-setting`);
  };
}

async function aplSetting(target, activity) {
  const me = await a5Api(activity, `me?year=${a5Year}`);
  const admin = me.access.admin;
  const tab = aplSetTab[activity] || 'team';
  target.innerHTML = `<div class="view-body"><section class="card">
    ${pageBar(a5Seg('data-aplset', APL_SET_TABS, tab), `<div class="a5-year">${a5YearSelect(me.years)}</div>`, 'a5')}
    <div id="a5-body"><div class="empty">กำลังโหลด...</div></div>
  </section></div>`;
  const rerender = () => aplSetting(target, activity).catch(onErr);
  target.querySelectorAll('[data-aplset]').forEach((node) => {
    node.onclick = () => { aplSetTab[activity] = node.dataset.aplset; rerender(); };
  });
  if ($('a5-year')) $('a5-year').onchange = () => { a5Year = Number($('a5-year').value); rerender(); };
  const body = $('a5-body');
  if (tab === 'team') {
    try {
      return await a5SetTeam(body, activity, admin, rerender, APL_ROLE_LABEL);
    } catch (err) {
      body.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
      return;
    }
  }
  return aplRender(body, activity, { inPage: true });
}

for (const id of APL_ON) {
  VIEWS[`${id}-home`] = (target) => aplDashboard(target, id);
  VIEWS[`${id}-setting`] = (target) => aplSetting(target, id);
}
