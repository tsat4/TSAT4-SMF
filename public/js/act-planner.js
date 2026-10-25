// ระบบกิจกรรม > <activity> > Setting: Project Planner (server: server/modules/act/planner.js).
// Main items with sub items on a Gantt: year view = 12 months × W1–W4 (longer when items run into next year), month view = days. The year's admins
// drag bars (whole bar = move, edge = resize), add rows with +, and create / edit / delete. Others read only.
// 100P: its own Setting page (APL_ON). 5S: a tab inside Setting (edit) and Dashboard (read only), see act-5s.js.
// Turn it on for another activity by adding its id to PLANNER_ON in planner.js and here (or calling aplRender from a tab).
const APL_ON = ['100p'];
const APL_COLORS = { p1: '#ec6f73', p2: '#3fbfbf', p3: '#e3a52f', p4: '#8b6fd8', p5: '#4b8bea' };
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
  if (!task.start_date) return null;
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

function aplRow(task, code, color, g, lines, canEdit, phase) {
  const pos = aplPlace(task, g);
  const span = task.start_date ? `${actShort(task.start_date)} – ${actShort(task.end_date)}` : '';
  // A bar shorter than about 3 weeks (year view) has no room for its %: the % goes beside it with the dates.
  const narrow = pos && (pos.b - pos.a + 1) / g.cols < 0.06;
  const bar = pos ? `<div class="apl-bar${canEdit ? ' is-editable' : ''}" data-bar="${task.id}" data-a="${pos.a}" data-b="${pos.b}" style="left:${aplPct(pos.a, g)};width:${aplPct(pos.b - pos.a + 1, g)};--bar:${color}" title="${esc(task.title)} · ${span} · ${task.progress}%">
      <div class="apl-fill" style="width:${task.progress}%"></div>${narrow ? '' : `<span>${task.progress}%</span>`}
      ${canEdit && !task.derived ? '<div class="apl-handle is-l" data-h="l"></div><div class="apl-handle is-r" data-h="r"></div>' : ''}</div>
    <div class="apl-dates" style="${pos.b + 1 > g.cols * 0.8 ? `right:calc(${aplPct(g.cols - pos.a, g)} + 6px)` : `left:calc(${aplPct(pos.b + 1, g)} + 6px)`}">${span}${narrow ? ` · ${task.progress}%` : ''}</div>` : '';
  const title = phase
    ? `<div class="apl-title"><button class="apl-tog" type="button" data-tog="${task.id}" aria-expanded="${!aplCollapsed.has(task.id)}" aria-label="ย่อ/ขยาย">${phase.kids ? (aplCollapsed.has(task.id) ? '▸' : '▾') : ''}</button><span>${esc(task.title)}</span>${canEdit ? `<button class="apl-add" type="button" data-add="${task.id}" title="เพิ่มข้อรอง" aria-label="เพิ่มข้อรองใต้ ${esc(task.title)}">+</button>` : ''}</div>`
    : `<div class="apl-title is-sub"><span>${esc(task.title)}</span></div>`;
  return `<div class="apl-row${phase ? ' is-phase' : ''}${aplSelected === task.id ? ' is-selected' : ''}" data-task="${task.id}">
    <div class="apl-left"><div class="apl-code">${code}</div>${title}<div title="${esc(task.owner_name)}">${esc(task.owner_name)}</div><div class="apl-pct">${task.progress}</div></div>
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
    const color = APL_COLORS[p.color] || Object.values(APL_COLORS)[pi % 5];
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
  const admins = data.admins?.length ? `admin ปี ${aplYear}: ${data.admins.map(esc).join(', ')}` : `ยังไม่กำหนด admin ปี ${aplYear}`;
  const keepScroll = target.querySelector('.apl-scroll');
  const scroll = keepScroll ? [keepScroll.scrollLeft, keepScroll.scrollTop] : null;
  const hint = canEdit ? ' · ลากแท่งเพื่อย้าย ลากขอบเพื่อยืด/หด (รายปีทีละสัปดาห์ รายเดือนทีละวัน) · ดับเบิลคลิกแถวเพื่อแก้ไข' : readOnly ? ' · ดูอย่างเดียว แก้ไขที่ Setting > แผนงาน' : '';
  const content = `<p class="page-note">${admins} · ${tasks.length} รายการ${hint}</p>
    <div class="apl-scroll"><div class="apl-grid" style="--apl-tl:${g.cols * g.min}px">
      <div class="apl-row apl-head"><div class="apl-left"><div>ลำดับ</div><div>รายการ</div><div>ผู้รับผิดชอบ</div><div class="apl-pct">%</div></div><div class="apl-track">${aplHead(g)}</div></div>
      ${rows}
    </div></div>
    ${tasks.length ? '' : `<p class="empty">ยังไม่มีแผนปี ${aplYear}${canEdit ? ' กด "สร้าง" หรือ "+ เพิ่มข้อหลัก"' : ''}</p>`}`;
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
  target.querySelectorAll('[data-add]').forEach((node) => { node.onclick = (e) => { e.stopPropagation(); aplOpenForm(activity, tasks, null, Number(node.dataset.add), rerender); }; });
  $('apl-add-phase').onclick = () => aplOpenForm(activity, tasks, null, null, rerender);
  $('apl-new').onclick = () => aplOpenForm(activity, tasks, null, null, rerender);
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
  const fields = [
    field('ระดับ', `<select id="apl-parent"${derived ? ' disabled' : ''}><option value="">ข้อหลัก</option>${phases.map((p) => `<option value="${p.id}"${p.id === pid ? ' selected' : ''}>ข้อรองของ: ${esc(p.title)}</option>`).join('')}</select>`),
    field('ชื่อรายการ', `<input id="apl-title" maxlength="200" value="${esc(task?.title || '')}">`),
    field('ผู้รับผิดชอบ', `<div class="apl-owner"><input id="apl-owner" readonly value="${esc(ownerId ? `${ownerId} · ${task.owner_name}` : '')}" placeholder="ค้นจากรายชื่อด้านล่าง">${button('apl-owner-clear', 'ล้าง')}</div>`),
    searchBlock(searchSlot('ค้นพนักงาน', 'apl-emp-q', 'apl-emp-search', { placeholder: 'รหัส ชื่อ หรือหน่วยงาน' }), 'apl-emp-list'),
    field('วันเริ่ม', `<input id="apl-start" type="date" ${range} value="${esc(start)}"${derived ? ' disabled' : ''}>`),
    field('วันจบ', `<input id="apl-end" type="date" ${range} value="${esc(end)}"${derived ? ' disabled' : ''}>`),
    field(`ความคืบหน้า <span id="apl-pct-v">${task?.progress ?? 0}%</span>`, `<input id="apl-pct" type="range" min="0" max="100" step="5" value="${task?.progress ?? 0}"${derived ? ' disabled' : ''}>`),
    `<div id="apl-color-wrap">${field('สีข้อหลัก', `<div class="apl-swatches">${Object.entries(APL_COLORS).map(([key, hex]) => `<label class="apl-swatch" style="--bar:${hex}"><input type="radio" name="apl-color" value="${key}"${key === color ? ' checked' : ''}><span></span></label>`).join('')}</div>`)}</div>`,
    field('รายละเอียด', `<textarea id="apl-note" rows="2" maxlength="2000">${esc(task?.note || '')}</textarea>`),
    derived ? '<p class="sum-meta">ข้อหลักที่มีข้อรอง: ช่วงวันและ % คิดจากข้อรองให้อัตโนมัติ</p>' : `<p class="sum-meta">วางแผนได้ถึง ธ.ค. ${aplYear + 1} · ข้อหลักเว้นวันว่างได้ ข้อรองต้องมีวันเริ่มและวันจบ</p>`
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
      progress: Number($('apl-pct').value)
    };
    if (!body.title) throw new Error('ระบุชื่อรายการ');
    if (body.parentId && (!body.startDate || !body.endDate)) throw new Error('ข้อรองต้องมีวันเริ่มและวันจบ');
    if (body.startDate && body.endDate && body.endDate < body.startDate) throw new Error('วันจบต้องไม่ก่อนวันเริ่ม');
    const path = `/api/act/${encodeURIComponent(activity)}/tasks${task ? `/${task.id}` : ''}`;
    const saved = await api(path, { method: task ? 'PATCH' : 'POST', body });
    if (!task && saved?.id) aplSelected = saved.id;
    if (body.parentId) aplCollapsed.delete(Number(body.parentId));
    toast('บันทึกแล้ว');
    closePopup();
    rerender();
  });
  const syncColor = () => { $('apl-color-wrap').hidden = Boolean($('apl-parent').value); };
  $('apl-parent').onchange = syncColor;
  syncColor();
  $('apl-pct').oninput = () => { $('apl-pct-v').textContent = `${$('apl-pct').value}%`; };
  $('apl-owner-clear').onclick = () => { ownerId = ''; $('apl-owner').value = ''; };
  const search = async () => {
    const data = await api(`/api/act/${encodeURIComponent(activity)}/employees?year=${aplYear}&q=${encodeURIComponent($('apl-emp-q').value.trim())}`);
    fillTable('apl-emp-list', ['รหัส', 'ชื่อ', 'หน่วยงาน'], data.employees.map((p) => `<tr data-pick="${esc(p.employeeId)}" data-name="${esc(p.name)}"><td>${esc(p.employeeId)}</td><td>${esc(p.name)}</td><td>${esc(p.department)}</td></tr>`).join(''), 'ไม่พบพนักงาน');
    bindRowSelect($('apl-emp-list'), (id, row) => { ownerId = id; $('apl-owner').value = `${id} · ${row.dataset.name}`; });
  };
  $('apl-emp-search').onclick = () => search().catch(onErr);
  onEnter('apl-emp-q', () => search().catch(onErr));
}

for (const id of APL_ON) VIEWS[`${id}-setting`] = (target) => aplRender(target, id);
