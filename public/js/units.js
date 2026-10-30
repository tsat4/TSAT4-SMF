// Unit catalog: ระบบงาน (PLANTS) and ระบบกิจกรรม (ACTIVITIES). Each unit gets placeholder Dashboard / transaction / Setting pages until it has its own module.
const PLANTS = [
  ['planning', 'PLANNING', 'calendar_month']
];
const ACTIVITIES = [
  ['100p', '100P', 'event'],
  ['5s', '5S', 'event'],
  ['cfo', 'CFO', 'event'],
  ['e-day', 'E-DAY', 'event'],
  ['kaizen', 'KAIZEN', 'event'],
  ['lean', 'LEAN', 'event'],
  ['qcc', 'QCC', 'event'],
  ['safety', 'SAFETY', 'event'],
  ['smf', 'SMF', 'event']
];
const PLANT_PAGES = [
  ['home', 'monitoring', 'Dashboard', 'ภาพรวม'],
  ['edit', 'edit_note', 'Transaction', 'รายการ'],
  ['setting', 'settings', 'Setting', 'ข้อมูลตั้งต้น']
];
for (const [id, label] of PLANTS) {
  const path = `ระบบงาน > ${label}`;
  TITLES[id] = [label, path];
  for (const [page, , title] of PLANT_PAGES) TITLES[`${id}-${page}`] = [title, path];
}
for (const [id, label] of ACTIVITIES) {
  const path = `ระบบกิจกรรม > ${label}`;
  TITLES[id] = [label, path];
  for (const [page, , title] of PLANT_PAGES) TITLES[`${id}-${page}`] = [title, path];
}
Object.assign(TITLES, {
  work: ['ระบบงาน', 'Work System'],
  activity: ['ระบบกิจกรรม', 'Activity']
});

function plantOf(name) {
  const groups = [[PLANTS, 'ระบบงาน'], [ACTIVITIES, 'ระบบกิจกรรม']];
  for (const [list, group] of groups) {
    const row = list.find(([id]) => name === id || name.startsWith(`${id}-`));
    if (row) return { row, group };
  }
  return null;
}

function plantRender(name) {
  const unit = plantOf(name);
  if (!unit) return async (target) => { target.innerHTML = cardView('ไม่พบหน้า', '', '<p class="empty">ไม่มีหน้านี้</p>'); };
  const id = unit.row[0];
  const page = name === id ? '' : name.slice(id.length + 1);
  return async (target) => (page ? renderPlantPage(target, id, page) : renderPlant(target, id));
}

async function renderWork(target) {
  modulePage(target, 'ระบบงาน', 'Work System', [
    ['store', 'warehouse', 'Store', 'คลังและรายการใช้งาน'],
    ...PLANTS.map(([id, label, icon]) => [id, icon, label, 'Dashboard, Transaction, Setting'])
  ]);
}

function renderPlant(target, id) {
  const unit = plantOf(id);
  const label = unit.row[1];
  modulePage(target, label, `${unit.group} > ${label}`, PLANT_PAGES.map(([page, icon, title, text]) => [`${id}-${page}`, icon, title, text]));
}

function renderPlantPage(target, id, page) {
  const unit = plantOf(id);
  const found = PLANT_PAGES.find((row) => row[0] === page);
  const title = found ? found[2] : page;
  const text = page === 'edit' ? 'ยังไม่มีรายการในส่วนนี้' : page === 'setting' ? 'ยังไม่มีการตั้งค่าในส่วนนี้' : 'ยังไม่มีข้อมูลในส่วนนี้';
  target.innerHTML = cardView(title, `${unit.group} > ${unit.row[1]}`, `<p class="empty">${text}</p>`);
}

async function renderActivity(target) {
  modulePage(target, 'ระบบกิจกรรม', 'Activity', ACTIVITIES.map(([id, label, icon]) => [id, icon, label, 'Dashboard, Transaction, Setting']));
}

function unitNav(rows) {
  return rows.map(([id, label, icon]) => `<div class="nav-acc is-collapsed" data-nav-acc="${id}">
  <div class="nav-split">
    <button class="nav-btn nav-parent" type="button" data-view="${id}" title="${label}"><span class="material-symbols-rounded">${icon}</span><span>${label}</span></button>
    <button class="nav-caret-btn" type="button" data-nav-toggle="${id}" aria-expanded="false" aria-label="ย่อ ${label}" title="ย่อ/ขยาย"><span class="material-symbols-rounded nav-caret">expand_more</span></button>
  </div>
  <div class="nav-sub" data-nav-panel="${id}">${PLANT_PAGES.map(([page, itemIcon, title]) => `<button class="nav-btn" data-view="${id}-${page}" title="${title}"><span class="material-symbols-rounded">${itemIcon}</span><span>${title}</span></button>`).join('')}</div>
</div>`).join('');
}

Object.assign(VIEWS, { work: renderWork, activity: renderActivity });
viewFallback = plantRender;
