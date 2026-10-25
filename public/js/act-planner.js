// ระบบกิจกรรม > <activity> > Setting: Project Planner (server: server/modules/act/planner.js).
// Main items with sub items on a Gantt: year view = 12 months × W1–W4, month view = days. The year's admins
// drag bars (whole bar = move, edge = resize), add rows with +, and create / edit / delete. Others read only.
// Turn it on for another activity by adding its id here and to PLANNER_ON in planner.js.
const APL_ON = ['100p'];
const APL_COLORS = { p1: '#ec6f73', p2: '#3fbfbf', p3: '#e3a52f', p4: '#8b6fd8', p5: '#4b8bea' };
// Narrowest column; columns grow to fill the screen when there is room. 384 = left columns (app.css .apl-row).
const APL_COL = { year: 15, month: 26 };
const APL_LEFT = 384;
let aplView = 'year';
let aplYear = new Date().getFullYear();
let aplMonth = new Date().getMonth();
let aplSelected = null;
let aplQuery = '';
const aplCollapsed = new Set();

function aplLastDay(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

// Year view column = month * 4 + week (W1 1–7, W2 8–14, W3 15–21, W4 22–end of month), as in the 5S audit plan.
function aplWeekCol(iso) {
  const date = actDate(iso);
  return date.getMonth() * 4 + Math.min(3, Math.floor((date.getDate() - 1) / 7));
}

function aplColStart(year, col) {
  return actIso(new Date(year, Math.floor(col / 4), (col % 4) * 7 + 1));
}

function aplColEnd(year, col) {
  const month = Math.floor(col / 4);
  const week = col % 4;
  return actIso(new Date(year, month, week < 3 ? week * 7 + 7 : aplLastDay(year, month)));
}

function aplGeometry(width) {
  const cols = aplView === 'year' ? 48 : aplLastDay(aplYear, aplMonth);
  const room = Math.floor((width - (window.innerWidth <= 640 ? 260 : APL_LEFT) - 4) / cols);
  return { cols, w: Math.max(APL_COL[aplView], room) };
}

function aplPlace(task, g) {
  if (!task.start_date) return null;
  if (aplView === 'year') {
    const a = aplWeekCol(task.start_date);
    return { left: a * g.w, width: (aplWeekCol(task.end_date) - a + 1) * g.w };
  }
  const first = actIso(new Date(aplYear, aplMonth, 1));
  const last = actIso(new Date(aplYear, aplMonth, g.cols));
  if (task.end_date < first || task.start_date > last) return null;
  const a = task.start_date < first ? 0 : actDate(task.start_date).getDate() - 1;
  const b = task.end_date > last ? g.cols - 1 : actDate(task.end_date).getDate() - 1;
  return { left: a * g.w, width: (b - a + 1) * g.w };
}

function aplTodayLeft(g) {
  const today = new Date();
  if (today.getFullYear() !== aplYear) return null;
  if (aplView === 'month') return today.getMonth() === aplMonth ? (today.getDate() - 0.5) * g.w : null;
  const col = aplWeekCol(actIso(today));
  const from = (col % 4) * 7 + 1;
  const to = col % 4 < 3 ? from + 6 : aplLastDay(aplYear, today.getMonth());
  return (col + (today.getDate() - from + 0.5) / (to - from + 1)) * g.w;
}

// New dates after dragging `delta` columns. Year view snaps to whole weeks, month view moves by days.
function aplShift(task, mode, delta) {
  if (aplView === 'year') {
    let a = aplWeekCol(task.start_date);
    let b = aplWeekCol(task.end_date);
    if (mode === 'move') {
      const len = b - a;
      a = Math.max(0, Math.min(47 - len, a + delta));
      b = a + len;
    } else if (mode === 'l') a = Math.max(0, Math.min(b, a + delta));
    else b = Math.min(47, Math.max(a, b + delta));
    return { startDate: aplColStart(aplYear, a), endDate: aplColEnd(aplYear, b) };
  }
  const first = actIso(new Date(aplYear, 0, 1));
  const last = actIso(new Date(aplYear, 11, 31));
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
  const tpl = `repeat(${g.cols}, ${g.w}px)`;
  if (aplView === 'year') {
    return `<div class="apl-months" style="grid-template-columns:repeat(12, ${4 * g.w}px)">${ACT_MONTHS_SHORT.map((m) => `<div>${m}</div>`).join('')}</div>
      <div class="apl-ticks" style="grid-template-columns:${tpl}">${Array.from({ length: 48 }, (_, c) => `<div title="${ACT_MONTHS_SHORT[Math.floor(c / 4)]} W${c % 4 + 1}">${c % 4 + 1}</div>`).join('')}</div>`;
  }
  return `<div class="apl-months" style="grid-template-columns:${g.cols * g.w}px"><div>${ACT_MONTHS[aplMonth]} ${aplYear}</div></div>
    <div class="apl-ticks" style="grid-template-columns:${tpl}">${Array.from({ length: g.cols }, (_, c) => {
      const day = new Date(aplYear, aplMonth, c + 1).getDay();
      return `<div class="${day === 0 || day === 6 ? 'is-weekend' : ''}">${c + 1}</div>`;
    }).join('')}</div>`;
}

function aplLines(g) {
  const cells = Array.from({ length: g.cols }, (_, c) => {
    if (aplView === 'year') return `<div class="${c % 4 === 0 ? 'is-month' : ''}"></div>`;
    const day = new Date(aplYear, aplMonth, c + 1).getDay();
    return `<div class="${day === 0 || day === 6 ? 'is-weekend' : ''}"></div>`;
  }).join('');
  const today = aplTodayLeft(g);
  return `<div class="apl-lines" style="grid-template-columns:repeat(${g.cols}, ${g.w}px)">${cells}</div>${today == null ? '' : `<div class="apl-today" style="left:${today}px"></div>`}`;
}

function aplRow(task, code, color, g, lines, canEdit, phase) {
  const pos = aplPlace(task, g);
  const width = pos ? Math.max(pos.width, g.w) : 0;
  const span = task.start_date ? `${actShort(task.start_date)} – ${actShort(task.end_date)}` : '';
  const bar = pos ? `<div class="apl-bar${canEdit ? ' is-editable' : ''}" data-bar="${task.id}" style="left:${pos.left}px;width:${width}px;--bar:${color}" title="${esc(task.title)} · ${span} · ${task.progress}%">
      <div class="apl-fill" style="width:${task.progress}%"></div><span>${task.progress}%</span>
      ${canEdit && !task.derived ? '<div class="apl-handle is-l" data-h="l"></div><div class="apl-handle is-r" data-h="r"></div>' : ''}</div>
    <div class="apl-dates" style="left:${pos.left + width + 6}px">${span}</div>` : '';
  const title = phase
    ? `<div class="apl-title"><button class="apl-tog" type="button" data-tog="${task.id}" aria-expanded="${!aplCollapsed.has(task.id)}" aria-label="ย่อ/ขยาย">${phase.kids ? (aplCollapsed.has(task.id) ? '▸' : '▾') : ''}</button><span>${esc(task.title)}</span>${canEdit ? `<button class="apl-add" type="button" data-add="${task.id}" title="เพิ่มข้อรอง" aria-label="เพิ่มข้อรองใต้ ${esc(task.title)}">+</button>` : ''}</div>`
    : `<div class="apl-title is-sub"><span>${esc(task.title)}</span></div>`;
  return `<div class="apl-row${phase ? ' is-phase' : ''}${aplSelected === task.id ? ' is-selected' : ''}" data-task="${task.id}">
    <div class="apl-left"><div class="apl-code">${code}</div>${title}<div title="${esc(task.owner_name)}">${esc(task.owner_name)}</div><div class="apl-pct">${task.progress}</div></div>
    <div class="apl-track">${lines}${bar}</div></div>`;
}

async function aplRender(target, activity) {
  const data = await api(`/api/act/${encodeURIComponent(activity)}/tasks?year=${aplYear}`);
  const tasks = data.tasks || [];
  const canEdit = Boolean(data.canEdit);
  if (!tasks.some((t) => t.id === aplSelected)) aplSelected = null;
  const g = aplGeometry(target.clientWidth - 2 * 8 - 2 * 10);
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
  const tools = `${aplView === 'month' ? `<div class="plan-nav">${button('apl-prev', '‹', 'secondary', 'aria-label="เดือนก่อน"')}${button('apl-next', '›', 'secondary', 'aria-label="เดือนถัดไป"')}</div><strong class="plan-label">${ACT_MONTHS[aplMonth]} ${aplYear}</strong>` : ''}
    ${canEdit ? `${button('apl-new', 'สร้าง', 'primary')}${button('apl-edit', 'แก้ไข', 'secondary', aplSelected ? '' : 'disabled')}${button('apl-del', 'ลบ', 'danger', aplSelected ? '' : 'disabled')}` : ''}
    <div class="a5-year">${field('ปี', `<select id="apl-year">${years.map((y) => `<option value="${y}"${y === aplYear ? ' selected' : ''}>${y}</option>`).join('')}</select>`)}</div>`;
  const admins = data.admins?.length ? `admin ปี ${aplYear}: ${data.admins.map(esc).join(', ')}` : `ยังไม่กำหนด admin ปี ${aplYear}`;
  const keepScroll = target.querySelector('.apl-scroll');
  const scroll = keepScroll ? [keepScroll.scrollLeft, keepScroll.scrollTop] : null;
  target.innerHTML = `<div class="view-body"><section class="card plan-card">
    ${pageBar(`${seg}${search}`, tools, 'apl')}
    <p class="page-note">${admins} · ${tasks.length} รายการ${canEdit ? ' · ลากแท่งเพื่อย้าย ลากขอบเพื่อยืด/หด (รายปีทีละสัปดาห์ รายเดือนทีละวัน) · ดับเบิลคลิกแถวเพื่อแก้ไข' : ''}</p>
    <div class="apl-scroll"><div class="apl-grid" style="--apl-tl:${g.cols * g.w}px">
      <div class="apl-row apl-head"><div class="apl-left"><div>ลำดับ</div><div>รายการ</div><div>ผู้รับผิดชอบ</div><div class="apl-pct">%</div></div><div class="apl-track">${aplHead(g)}</div></div>
      ${rows}
    </div></div>
    ${tasks.length ? '' : `<p class="empty">ยังไม่มีแผนปี ${aplYear}${canEdit ? ' กด "สร้าง" หรือ "+ เพิ่มข้อหลัก"' : ''}</p>`}
  </section></div>`;
  const box = target.querySelector('.apl-scroll');
  if (scroll) [box.scrollLeft, box.scrollTop] = scroll;
  else if (box.scrollWidth > box.clientWidth) box.scrollLeft = Math.max(0, (aplTodayLeft(g) ?? 0) - (box.clientWidth - APL_LEFT) / 2);

  const rerender = () => aplRender(target, activity).catch(onErr);
  const byId = (id) => tasks.find((t) => t.id === Number(id));
  target.querySelectorAll('[data-aplview]').forEach((node) => { node.onclick = () => { aplView = node.dataset.aplview; rerender(); }; });
  $('apl-year').onchange = () => { aplYear = Number($('apl-year').value); aplSelected = null; rerender(); };
  let typing;
  $('apl-q').oninput = () => { clearTimeout(typing); typing = setTimeout(() => { aplQuery = $('apl-q').value; rerender().then(() => { const input = $('apl-q'); input?.focus(); input?.setSelectionRange(input.value.length, input.value.length); }); }, 250); };
  if ($('apl-prev')) {
    $('apl-prev').onclick = () => { if (aplMonth === 0) { aplMonth = 11; aplYear -= 1; } else aplMonth -= 1; rerender(); };
    $('apl-next').onclick = () => { if (aplMonth === 11) { aplMonth = 0; aplYear += 1; } else aplMonth += 1; rerender(); };
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
  const left0 = parseFloat(node.style.left);
  const width0 = parseFloat(node.style.width);
  let delta = 0;
  try { node.setPointerCapture(e.pointerId); } catch { // keep dragging without capture
  }
  node.classList.add('is-dragging');
  const move = (ev) => {
    delta = Math.round((ev.clientX - x0) / g.w);
    if (mode === 'move') node.style.left = `${left0 + delta * g.w}px`;
    else if (mode === 'l') { node.style.left = `${left0 + Math.min(delta, width0 / g.w - 1) * g.w}px`; node.style.width = `${Math.max(g.w, width0 - delta * g.w)}px`; }
    else node.style.width = `${Math.max(g.w, width0 + delta * g.w)}px`;
  };
  const up = async () => {
    node.removeEventListener('pointermove', move);
    node.removeEventListener('pointerup', up);
    node.removeEventListener('pointercancel', up);
    node.classList.remove('is-dragging');
    aplSelected = task.id;
    if (!delta) return rerender();
    const targets = task.derived ? kidsOf(task.id) : [task];
    const items = targets.map((t) => ({ id: t.id, ...aplShift(t, mode, delta) }))
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
  const start = task ? task.start_date || '' : actIso(base);
  const end = task ? task.end_date || '' : actIso(actAddDays(base, 13));
  let ownerId = task?.owner_id || '';
  const color = task?.color || 'p5';
  const fields = [
    field('ระดับ', `<select id="apl-parent"${derived ? ' disabled' : ''}><option value="">ข้อหลัก</option>${phases.map((p) => `<option value="${p.id}"${p.id === pid ? ' selected' : ''}>ข้อรองของ: ${esc(p.title)}</option>`).join('')}</select>`),
    field('ชื่อรายการ', `<input id="apl-title" maxlength="200" value="${esc(task?.title || '')}">`),
    field('ผู้รับผิดชอบ', `<div class="apl-owner"><input id="apl-owner" readonly value="${esc(ownerId ? `${ownerId} · ${task.owner_name}` : '')}" placeholder="ค้นจากรายชื่อด้านล่าง">${button('apl-owner-clear', 'ล้าง')}</div>`),
    searchBlock(searchSlot('ค้นพนักงาน', 'apl-emp-q', 'apl-emp-search', { placeholder: 'รหัส ชื่อ หรือหน่วยงาน' }), 'apl-emp-list'),
    field('วันเริ่ม', `<input id="apl-start" type="date" min="${aplYear}-01-01" max="${aplYear}-12-31" value="${esc(start)}"${derived ? ' disabled' : ''}>`),
    field('วันจบ', `<input id="apl-end" type="date" min="${aplYear}-01-01" max="${aplYear}-12-31" value="${esc(end)}"${derived ? ' disabled' : ''}>`),
    field(`ความคืบหน้า <span id="apl-pct-v">${task?.progress ?? 0}%</span>`, `<input id="apl-pct" type="range" min="0" max="100" step="5" value="${task?.progress ?? 0}"${derived ? ' disabled' : ''}>`),
    `<div id="apl-color-wrap">${field('สีข้อหลัก', `<div class="apl-swatches">${Object.entries(APL_COLORS).map(([key, hex]) => `<label class="apl-swatch" style="--bar:${hex}"><input type="radio" name="apl-color" value="${key}"${key === color ? ' checked' : ''}><span></span></label>`).join('')}</div>`)}</div>`,
    field('รายละเอียด', `<textarea id="apl-note" rows="2" maxlength="2000">${esc(task?.note || '')}</textarea>`),
    derived ? '<p class="sum-meta">ข้อหลักที่มีข้อรอง: ช่วงวันและ % คิดจากข้อรองให้อัตโนมัติ</p>' : '<p class="sum-meta">ข้อหลักเว้นวันว่างได้ ข้อรองต้องมีวันเริ่มและวันจบ</p>'
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
