// ระบบกิจกรรม > <activity> > transaction: audit list + Self / Committee audit form, and Issues.
// Server: server/modules/act/transaction.js · rules: docs/specs/act-5s.md · uses helpers from act-5s.js (a5Api, a5Seg, a5Year ...).
const ATX_TABS = { audits: 'ตรวจประเมิน', issues: 'Issue' };
const ATX_TYPES = { SELF: 'Self Audit', COMMITTEE: 'Committee Audit' };
const ATX_STATUS = {
  OPEN: ['เปิด รอแก้', 'badge-warning'],
  ON_PLAN: ['แก้แล้ว ตามกำหนด', 'badge-primary'],
  WAIT_VERIFY: ['แก้แล้ว เลยกำหนด', 'badge-primary'],
  OVERDUE: ['เลยกำหนด', 'badge-danger'],
  CLOSED: ['ปิดแล้ว', 'badge-success']
};
let atxTab = 'audits';
let atxIssueAll = false;

function atxBadge(status) {
  const [label, kind] = ATX_STATUS[status] || [status, ''];
  return `<span class="badge ${kind}">${esc(label)}</span>`;
}

function atxDate(iso) {
  if (!iso) return '-';
  const d = actDate(String(iso).slice(0, 10));
  return `${d.getDate()} ${ACT_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

function atxToday() {
  return actIso(new Date());
}

// Problem / after photos: center crop to 16:9, 1280x720 JPEG.
function atxWideJpeg(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const ratio = 16 / 9;
      let w = image.width;
      let h = w / ratio;
      if (h > image.height) { h = image.height; w = h * ratio; }
      canvas.getContext('2d').drawImage(image, (image.width - w) / 2, (image.height - h) / 2, w, h, 0, 0, 1280, 720);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.75));
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('เปิดรูปไม่ได้')); };
    image.src = url;
  });
}

// File input + 16:9 preview; onPick(dataUrl).
function atxPhotoInput(id, onPick) {
  const input = $(id);
  if (!input) return;
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const data = await atxWideJpeg(file);
      const preview = $(`${id}-preview`);
      if (preview) { preview.src = data; preview.classList.remove('d-none'); }
      onPick(data);
    } catch (err) { onErr(err); }
  };
}

async function atxPage(target, activity) {
  const me = await a5Api(activity, `me?year=${a5Year}`);
  target.innerHTML = `<div class="view-body"><section class="card">
    <div class="plan-head">
      <div><div class="card-title">transaction · ${esc(actLabel(activity))}</div><p class="sum-meta">${me.access.member ? `ทีมปี ${a5Year}` : `เข้าได้เฉพาะทีมของกิจกรรมปี ${a5Year} (admin เพิ่มรายชื่อที่ Setting > ทีม)`}</p></div>
      <div class="plan-tools">${a5Seg('data-atx', ATX_TABS, atxTab)}<div class="a5-year">${a5YearSelect(me.years)}</div></div>
    </div>
    <div id="atx-body"></div>
  </section></div>`;
  const rerender = () => atxPage(target, activity).catch(onErr);
  target.querySelectorAll('[data-atx]').forEach((node) => { node.onclick = () => { atxTab = node.dataset.atx; rerender(); }; });
  $('a5-year').onchange = () => { a5Year = Number($('a5-year').value); rerender(); };
  const body = $('atx-body');
  if (!me.access.member) { body.innerHTML = '<p class="empty">ยังไม่มีชื่อในทีมของปีนี้</p>'; return; }
  if (atxTab === 'issues') return atxIssues(body, activity);
  return atxAudits(body, activity, me);
}

// ---------- audits ----------

async function atxAudits(body, activity, me) {
  const data = await a5Api(activity, `audits?year=${a5Year}`);
  const canAudit = me.access.admin || me.access.chairman || me.access.auditor || me.access.ownerAreaIds.length > 0;
  body.innerHTML = `
    <div class="action-bar a5-actions">${canAudit ? button('atx-new', 'เริ่มตรวจ', 'primary') : ''}<span class="sum-meta">${data.audits.length} ใบตรวจ · กดแถวเพื่อดูรายละเอียด</span></div>
    <div class="table-wrap sheet" id="atx-rows"></div>`;
  fillTable('atx-rows', ['เลขที่', 'วันที่', 'ประเภท', 'พื้นที่', 'ทีม', 'คะแนน', '%', 'ผล', 'Issue ค้าง'], data.audits.map((a) => `<tr data-pick="${a.id}">
    <td>${esc(a.audit_no)}</td><td>${atxDate(a.audited_at)}</td><td>${esc(ATX_TYPES[a.audit_type] || a.audit_type)}</td>
    <td>${esc(a.areaCode || '')} ${esc(a.areaName || '')}</td><td>${a.team ? `<span class="a5-dot is-done" style="--team:${a5TeamColor(a.team)}"></span> ${esc(a.team)}` : ''}</td>
    <td>${Number(a.total_score)}</td><td>${Number(a.percent_score).toFixed(2)}</td>
    <td>${a.result === 'PASS' ? '<span class="badge badge-success">PASS</span>' : '<span class="badge badge-danger">ต้องปรับปรุง</span>'}</td>
    <td>${a.issues ? `${a.openIssues}/${a.issues}` : '-'}</td></tr>`).join(''), `ยังไม่มีใบตรวจปี ${a5Year}`);
  bindRowSelect($('atx-rows'), (id) => atxAuditDetail(activity, Number(id), data.canDelete, () => atxAudits(body, activity, me).catch(onErr)));
  if ($('atx-new')) $('atx-new').onclick = () => atxForm(body, activity, me).catch(onErr);
}

async function atxAuditDetail(activity, id, canDelete, reload) {
  const d = await a5Api(activity, `audits/${id}`);
  const a = d.audit;
  const groups = [...new Set(d.scores.map((s) => s.s_group))].sort((x, y) => x - y);
  const people = (kind) => d.people.filter((p) => p.kind === kind).map((p) => `${esc(p.employee_id)} ${esc(p.name)}`).join(', ') || '-';
  openPopup(`${esc(a.audit_no)}`, `<div class="plan-detail">
      <p class="sum-meta">${esc(ATX_TYPES[a.audit_type])} · ${esc(a.area?.code || '')} ${esc(a.area?.name || '')} · ${atxDate(a.audited_at)}${a.team ? ` · ทีม ${esc(a.team)}` : ''}</p>
      <p><strong>${Number(a.total_score)}</strong> คะแนน · <strong>${Number(a.percent_score).toFixed(2)}%</strong> · ${a.result === 'PASS' ? 'PASS' : 'ต้องปรับปรุง'}</p>
      <p class="sum-meta">ผู้ตรวจ: ${people('participated')} · ผู้รับตรวจ: ${people('receiver')}</p>
      ${groups.map((g) => `<div class="atx-detail-group"><strong>${esc(a5GroupName(activity, g))}</strong>${d.scores.filter((s) => s.s_group === g).map((s) => `<div class="atx-detail-row"><span>${s.item_no}. ${esc(s.title)}</span><span class="${Number(s.score) <= 3 ? 'atx-low' : ''}">${Number(s.score)}/${s.score_max}</span></div>`).join('')}</div>`).join('')}
      ${d.issues.length ? `<p><strong>Issue ${d.issues.length} รายการ</strong></p>${d.issues.map((i) => `<div class="atx-detail-row"><span>${esc(i.issue_no)} · ${esc(i.description)}</span>${atxBadge(i.status)}</div>`).join('')}` : ''}
      ${canDelete ? button('atx-del', 'ลบใบตรวจนี้', 'danger') : ''}
    </div>`, () => closePopup(), 'ปิด');
  if ($('atx-del')) $('atx-del').onclick = () => confirmPopup('ลบใบตรวจ', `ลบ ${esc(a.audit_no)} และ Issue ที่เปิดจากใบนี้ (Issue เดิมที่ใบนี้ยืนยันไปแล้วจะไม่ย้อนกลับ)`, async () => {
    await a5Api(activity, `audits/${id}`, { method: 'DELETE' });
    toast('ลบแล้ว');
    reload();
  });
}

async function atxForm(body, activity, me) {
  const state = { type: '', areaId: '', date: atxToday(), team: '', participated: new Set(), receivers: [], scores: {}, text: {}, photo: {} };
  let form = await a5Api(activity, `audit-form?year=${a5Year}`);
  if (!form.types.length) throw new Error('คุณยังไม่มีสิทธิ์ทำการตรวจปีนี้');
  if (!form.items.length) throw new Error(`ยังไม่มีหัวข้อตรวจปี ${a5Year} (admin เพิ่มที่ Setting > หัวข้อตรวจ)`);
  state.type = form.types.includes('COMMITTEE') && !form.access.ownerAreaIds.length ? 'COMMITTEE' : form.types[0];
  state.team = form.access.teams[0] || form.teams[0]?.team || '';

  const areasFor = () => form.areas.filter((a) => state.type === 'COMMITTEE' || a.self);
  const teamMembers = () => (form.teams.find((t) => t.team === state.team) || { members: [] }).members;
  const resetParticipants = () => { state.participated = new Set(teamMembers().map((m) => m.employeeId)); };
  resetParticipants();
  const openBy = () => new Map(form.openIssues.map((i) => [i.checklist_id, i]));
  const forcedZero = (issue) => issue && !(String(issue.action_description || '').trim() && issue.after_photos > 0);

  const draw = () => {
    const open = state.type === 'COMMITTEE' ? openBy() : new Map();
    const groups = [...new Set(form.items.map((i) => i.s_group))].sort((x, y) => x - y);
    const scoreOf = (item) => (forcedZero(open.get(item.id)) ? 0 : state.scores[item.id]);
    const max = form.items.reduce((s, i) => s + i.score_max, 0);
    const total = form.items.reduce((s, i) => s + (Number(scoreOf(i)) || 0), 0);
    const done = form.items.filter((i) => scoreOf(i) != null).length;
    const percent = max ? (total / max) * 100 : 0;
    const itemRow = (item) => {
      const issue = open.get(item.id);
      const locked = forcedZero(issue);
      const value = scoreOf(item);
      const needIssue = state.type === 'COMMITTEE' && !issue && value != null && value <= form.settings.issue_score;
      return `<div class="atx-item${value == null ? '' : ' is-scored'}">
        <div class="atx-item-title"><span>${item.item_no}.</span> ${esc(item.title)}${issue ? `<div class="atx-carry">Issue เดิม ${esc(issue.issue_no)}: ${esc(issue.description)} · ${locked ? '<b>ยังไม่มี Action → ข้อนี้ได้ 0</b>' : 'มี Action แล้ว ให้ ≥ 4 เพื่อปิด Issue'}</div>` : ''}</div>
        <div class="atx-scores">${locked ? '<span class="atx-zero">0</span>' : Array.from({ length: item.score_max }, (_, i) => i + 1).map((n) => `<button type="button" class="atx-score${value === n ? ' is-on' : ''}${n <= form.settings.issue_score ? ' is-low' : ''}" data-score="${item.id}:${n}">${n}</button>`).join('')}</div>
        ${needIssue ? `<div class="atx-issue">
          ${field(`เปิด Issue (ได้ ≤ ${form.settings.issue_score}) รายละเอียดปัญหา`, `<textarea id="atx-text-${item.id}" rows="2" maxlength="2000" data-text="${item.id}">${esc(state.text[item.id] || '')}</textarea>`)}
          ${field('รูปปัญหา 16:9', `<input id="atx-photo-${item.id}" type="file" accept="image/*"><img id="atx-photo-${item.id}-preview" class="atx-photo${state.photo[item.id] ? '' : ' d-none'}" src="${state.photo[item.id] || ''}" alt="">`)}
        </div>` : ''}
      </div>`;
    };
    body.innerHTML = `
      <div class="toolbar atx-head">
        ${a5Seg('data-atype', Object.fromEntries(form.types.map((t) => [t, ATX_TYPES[t]])), state.type)}
        ${field('พื้นที่', `<select id="atx-area"><option value="">เลือกพื้นที่</option>${areasFor().map((a) => `<option value="${a.id}"${String(a.id) === String(state.areaId) ? ' selected' : ''}>${esc(a.code)} ${esc(a.name)}</option>`).join('')}</select>`, 'grow')}
        ${field('วันที่ตรวจ', `<input id="atx-date" type="date" max="${atxToday()}" value="${state.date}">`)}
        ${state.type === 'COMMITTEE' ? field('ทีม', `<select id="atx-team">${options(form.teams.map((t) => t.team), state.team, (t) => `ทีม ${t}`)}</select>`) : ''}
      </div>
      ${state.type === 'COMMITTEE' ? `<div class="atx-people"><span class="sum-meta">ผู้ตรวจ:</span>${teamMembers().map((m) => `<label class="atx-check"><input type="checkbox" data-part="${esc(m.employeeId)}"${state.participated.has(m.employeeId) ? ' checked' : ''}> ${esc(m.employeeId)} ${esc(m.name)}</label>`).join('') || '<span class="sum-meta">ทีมนี้ยังไม่มีรายชื่อ</span>'}</div>` : ''}
      <div class="atx-people"><span class="sum-meta">ผู้รับตรวจ:</span>${state.receivers.map((p, i) => `<span class="atx-chip">${esc(p.employeeId)} ${esc(p.name)} <button type="button" data-unrecv="${i}" aria-label="เอาออก">×</button></span>`).join('')}${button('atx-recv', '+ เพิ่ม')}</div>
      ${state.type === 'COMMITTEE' && state.areaId && form.openIssues.length ? `<p class="atx-note">พื้นที่นี้มี Issue ค้าง ${form.openIssues.length} รายการ จะถูกยืนยันในการตรวจครั้งนี้ (ไม่มี Action = ข้อนั้นได้ 0 · มี Action และให้ ≥ 4 = ปิด)</p>` : ''}
      ${state.areaId ? groups.map((g) => `<section class="atx-group"><div class="card-title">${esc(a5GroupName(activity, g))}</div>${form.items.filter((i) => i.s_group === g).map(itemRow).join('')}</section>`).join('') : '<p class="empty">เลือกพื้นที่เพื่อเริ่มให้คะแนน</p>'}
      <div class="atx-foot">
        <span>ให้คะแนนแล้ว ${done}/${form.items.length} · รวม <strong>${total}/${max}</strong> · <strong>${percent.toFixed(2)}%</strong> · ${percent >= form.settings.pass_percent ? 'PASS' : 'ต้องปรับปรุง'}</span>
        <div class="action-bar">${button('atx-cancel', 'ยกเลิก')}${button('atx-save', 'บันทึกผลตรวจ', 'primary', state.areaId ? '' : 'disabled')}</div>
      </div>`;

    body.querySelectorAll('[data-atype]').forEach((node) => { node.onclick = async () => { state.type = node.dataset.atype; state.areaId = ''; form.openIssues = []; draw(); }; });
    $('atx-area').onchange = async () => {
      state.areaId = $('atx-area').value;
      form = { ...form, openIssues: state.areaId && state.type === 'COMMITTEE' ? (await a5Api(activity, `audit-form?year=${a5Year}&area=${state.areaId}`)).openIssues : [] };
      draw();
    };
    $('atx-date').onchange = () => { state.date = $('atx-date').value; };
    if ($('atx-team')) $('atx-team').onchange = () => { state.team = $('atx-team').value; resetParticipants(); draw(); };
    body.querySelectorAll('[data-part]').forEach((node) => { node.onchange = () => { if (node.checked) state.participated.add(node.dataset.part); else state.participated.delete(node.dataset.part); }; });
    body.querySelectorAll('[data-unrecv]').forEach((node) => { node.onclick = () => { state.receivers.splice(Number(node.dataset.unrecv), 1); draw(); }; });
    $('atx-recv').onclick = () => {
      openPopup('เพิ่มผู้รับตรวจ', A5_EMP_FIELDS, () => closePopup(), 'เสร็จ');
      a5EmployeeSearch(activity, (p) => {
        if (!state.receivers.some((r) => r.employeeId === p.employeeId)) state.receivers.push(p);
        closePopup();
        draw();
      });
    };
    body.querySelectorAll('[data-score]').forEach((node) => {
      node.onclick = () => {
        const [id, n] = node.dataset.score.split(':').map(Number);
        state.scores[id] = n;
        // Redraw keeps the page where it was, so scoring 25 items does not jump to the top.
        const scroller = body.closest('.view-body');
        const y = scroller ? scroller.scrollTop : 0;
        draw();
        if (scroller) scroller.scrollTop = y;
      };
    });
    body.querySelectorAll('[data-text]').forEach((node) => { node.oninput = () => { state.text[node.dataset.text] = node.value; }; });
    form.items.forEach((item) => atxPhotoInput(`atx-photo-${item.id}`, (data) => { state.photo[item.id] = data; }));
    $('atx-cancel').onclick = () => atxAudits(body, activity, me).catch(onErr);
    $('atx-save').onclick = () => atxSave(body, activity, me, state, form, open);
  };
  draw();
}

function atxSave(body, activity, me, state, form, open) {
  const missing = form.items.filter((i) => state.scores[i.id] == null && !(open.get(i.id) && !(String(open.get(i.id).action_description || '').trim() && open.get(i.id).after_photos > 0))).map((i) => i.item_no);
  if (missing.length) return toast(`ให้คะแนนให้ครบ (ข้อที่ ${missing.join(', ')})`, 'error');
  const need = state.type === 'COMMITTEE' ? form.items.filter((i) => !open.get(i.id) && state.scores[i.id] <= form.settings.issue_score) : [];
  const noText = need.filter((i) => !String(state.text[i.id] || '').trim()).map((i) => i.item_no);
  if (noText.length) return toast(`ใส่รายละเอียด Issue (ข้อที่ ${noText.join(', ')})`, 'error');
  const noPhoto = need.filter((i) => !state.photo[i.id]).map((i) => i.item_no);
  if (noPhoto.length) return toast(`แนบรูปปัญหา (ข้อที่ ${noPhoto.join(', ')})`, 'error');
  confirmPopup('บันทึกผลตรวจ', `บันทึก ${esc(ATX_TYPES[state.type])} ของพื้นที่ที่เลือก${need.length ? ` และเปิด Issue ${need.length} รายการ` : ''} บันทึกแล้วแก้ไม่ได้ (admin ลบได้)`, async () => {
    const result = await a5Api(activity, 'audits', {
      method: 'POST',
      body: {
        type: state.type, areaId: Number(state.areaId), auditedAt: state.date, team: state.team,
        participated: [...state.participated], receivers: state.receivers.map((r) => r.employeeId),
        scores: state.scores, issues: need.map((i) => ({ checklistId: i.id, description: state.text[i.id] }))
      }
    });
    let failedPhotos = 0;
    for (const issue of result.issues || []) {
      try {
        await a5Api(activity, `issues/${issue.id}/photo`, { method: 'POST', body: { kind: 'BEFORE', image: state.photo[issue.checklist_id] } });
      } catch (err) { failedPhotos += 1; toast(`${issue.issue_no}: ${err.message}`, 'error'); }
    }
    toast(`บันทึก ${result.auditNo} แล้ว · ${result.percent}%${failedPhotos ? ` · รูปไม่ขึ้น ${failedPhotos} รายการ (แนบใหม่ที่แท็บ Issue)` : ''}`);
    atxAudits(body, activity, me).catch(onErr);
  }, 'บันทึก');
}

// ---------- issues ----------

async function atxIssues(body, activity) {
  const data = await a5Api(activity, `issues?year=${a5Year}`);
  const list = data.issues.filter((i) => atxIssueAll || i.status !== 'CLOSED');
  const count = (s) => data.issues.filter((i) => i.shownStatus === s).length;
  body.innerHTML = `
    <div class="toolbar a5-filters">${a5Seg('data-iall', { open: 'ยังไม่ปิด', all: 'ทั้งหมด' }, atxIssueAll ? 'all' : 'open')}
      <span class="sum-meta">ทั้งหมด ${data.issues.length} · รอแก้ ${count('OPEN')} · เลยกำหนด ${count('OVERDUE')} · แก้แล้วรอตรวจ ${count('ON_PLAN') + count('WAIT_VERIFY')} · ปิดแล้ว ${count('CLOSED')}</span></div>
    <div class="table-wrap sheet" id="atx-rows"></div>`;
  fillTable('atx-rows', ['เลขที่', 'พื้นที่', 'ข้อ', 'คะแนน', 'ปัญหา', 'ผู้รับผิดชอบ', 'กำหนดแก้', 'สถานะ', 'รูป'], list.map((i) => `<tr data-pick="${i.id}">
    <td>${esc(i.issue_no)}</td><td>${esc(i.area.code || '')} ${esc(i.area.name || '')}</td><td>${i.item.item_no || ''}</td><td>${Number(i.score)}</td>
    <td>${esc(i.description)}</td><td>${esc(i.responsibleName || i.responsible_id || '-')}</td><td>${i.due_date ? atxDate(i.due_date) : '<span class="sum-meta">รอกำหนด</span>'}</td>
    <td>${atxBadge(i.shownStatus)}</td><td>${i.photos.length}</td></tr>`).join(''), 'ไม่มี Issue');
  body.querySelectorAll('[data-iall]').forEach((node) => { node.onclick = () => { atxIssueAll = node.dataset.iall === 'all'; atxIssues(body, activity).catch(onErr); }; });
  bindRowSelect($('atx-rows'), (id) => atxIssueDetail(activity, data.issues.find((i) => String(i.id) === id), () => atxIssues(body, activity).catch(onErr)));
}

function atxIssueDetail(activity, issue, reload) {
  const before = issue.photos.filter((p) => p.kind === 'BEFORE');
  const after = issue.photos.filter((p) => p.kind === 'AFTER');
  const img = (p) => `<a href="${esc(p.url)}" target="_blank" rel="noopener"><img class="atx-photo" src="${esc(p.url)}" alt=""></a>`;
  let beforeData = '';
  let afterData = '';
  openPopup(`${esc(issue.issue_no)} · ${esc(issue.area.code || '')} ${esc(issue.area.name || '')}`, `<div class="plan-detail">
      <p>${atxBadge(issue.shownStatus)} <span class="sum-meta">ข้อ ${issue.item.item_no || ''} ${esc(issue.item.title || '')} · ได้ ${Number(issue.score)} · ใบตรวจ ${esc(issue.auditNo)} · ${atxDate(issue.issue_date)}</span></p>
      <p><strong>ปัญหา:</strong> ${esc(issue.description)}</p>
      <p class="sum-meta">ผู้รับผิดชอบ: ${esc(issue.responsibleName || issue.responsible_id || '-')} · กำหนดแก้: ${issue.due_date ? atxDate(issue.due_date) : 'รอกำหนดรอบถัดไป'}${issue.verify_audit_no ? ` · ยืนยันโดย ${esc(issue.verify_audit_no)} (${Number(issue.final_score)})` : ''}</p>
      <div class="atx-photos">${before.map(img).join('') || '<span class="sum-meta">ยังไม่มีรูปปัญหา</span>'}</div>
      ${issue.canAddBefore && !before.length ? field('แนบรูปปัญหา 16:9', '<input id="atx-before" type="file" accept="image/*"><img id="atx-before-preview" class="atx-photo d-none" alt="">') + button('atx-before-save', 'อัปโหลดรูปปัญหา') : ''}
      ${issue.action_description ? `<p><strong>สิ่งที่แก้ไข:</strong> ${esc(issue.action_description)} <span class="sum-meta">(${atxDate(issue.action_date)})</span></p>` : ''}
      <div class="atx-photos">${after.map(img).join('')}</div>
      ${issue.canAct ? `${field('สิ่งที่แก้ไข', `<textarea id="atx-action" rows="2" maxlength="2000">${esc(issue.action_description || '')}</textarea>`)}
        ${after.length ? '' : field('รูปหลังแก้ 16:9', '<input id="atx-after" type="file" accept="image/*"><img id="atx-after-preview" class="atx-photo d-none" alt="">')}
        ${button('atx-action-save', 'ส่ง Action', 'primary')}` : ''}
      ${issue.canEditDue ? `<div class="atx-due">${field('กำหนดแก้ (admin)', `<input id="atx-due" type="date" value="${esc(issue.due_date || '')}">`)}${button('atx-due-save', 'บันทึกกำหนด')}</div>` : ''}
    </div>`, () => closePopup(), 'ปิด');
  atxPhotoInput('atx-before', (d) => { beforeData = d; });
  atxPhotoInput('atx-after', (d) => { afterData = d; });
  if ($('atx-before-save')) $('atx-before-save').onclick = async () => {
    try {
      if (!beforeData) throw new Error('เลือกรูปก่อน');
      await a5Api(activity, `issues/${issue.id}/photo`, { method: 'POST', body: { kind: 'BEFORE', image: beforeData } });
      toast('แนบรูปแล้ว');
      closePopup();
      reload();
    } catch (err) { onErr(err); }
  };
  if ($('atx-action-save')) $('atx-action-save').onclick = async () => {
    try {
      const text = $('atx-action').value.trim();
      if (!text) throw new Error('ระบุสิ่งที่แก้ไข');
      if (!after.length && !afterData) throw new Error('แนบรูปหลังแก้');
      if (afterData) await a5Api(activity, `issues/${issue.id}/photo`, { method: 'POST', body: { kind: 'AFTER', image: afterData } });
      const r = await a5Api(activity, `issues/${issue.id}/action`, { method: 'POST', body: { description: text } });
      toast(r.status === 'ON_PLAN' ? 'ส่ง Action แล้ว (ตามกำหนด)' : 'ส่ง Action แล้ว (เลยกำหนด)');
      closePopup();
      reload();
    } catch (err) { onErr(err); }
  };
  if ($('atx-due-save')) $('atx-due-save').onclick = async () => {
    try {
      await a5Api(activity, `issues/${issue.id}`, { method: 'PATCH', body: { dueDate: $('atx-due').value || null } });
      toast('บันทึกกำหนดแล้ว');
      closePopup();
      reload();
    } catch (err) { onErr(err); }
  };
}

for (const id of A5_ON) VIEWS[`${id}-edit`] = (target) => atxPage(target, id);
