// Startup: bind the login forms, build the sidebar, restore theme and layout, then load the session. Loaded last.
$('login-form').onsubmit = async (event) => {
  event.preventDefault();
  $('login-error').textContent = '';
  const form = new FormData(event.target);
  try {
    me = (await api('/api/login', { method: 'POST', body: { employeeId: form.get('employeeId'), password: form.get('password') } })).user;
    if (me.passwordExpired) showPassword();
    else showShell();
  } catch (err) { $('login-error').textContent = err.message; }
};

$('password-form').onsubmit = async (event) => {
  event.preventDefault();
  $('password-error').textContent = '';
  const form = new FormData(event.target);
  try {
    await api('/api/password', { method: 'POST', body: { current: form.get('current'), password: form.get('password') } });
    me = (await api('/api/me')).user;
    showShell();
  } catch (err) { $('password-error').textContent = err.message; }
};

function logout() {
  fetch('/api/logout', { method: 'POST' }).finally(showLogin);
}
$('logout').onclick = logout;
$('password-logout').onclick = logout;
document.querySelector('[data-nav-panel="work"]').insertAdjacentHTML('beforeend', unitNav(PLANTS));
document.querySelector('[data-nav-panel="activity"]').insertAdjacentHTML('beforeend', unitNav(ACTIVITIES));
document.querySelectorAll('.nav-btn[data-view]').forEach((node) => { node.onclick = () => openView(node.dataset.view); });
document.querySelectorAll('[data-nav-toggle]').forEach((node) => {
  node.onclick = () => {
    const acc = node.closest('[data-nav-acc]');
    const open = acc.classList.contains('is-collapsed');
    acc.classList.toggle('is-collapsed', !open);
    node.setAttribute('aria-expanded', open ? 'true' : 'false');
    localStorage.setItem(`smf-nav-${node.dataset.navToggle}`, open ? 'open' : 'collapsed');
  };
});
document.querySelectorAll('[data-nav-acc]').forEach((acc) => {
  const name = acc.dataset.navAcc;
  const saved = localStorage.getItem(`smf-nav-${name}`);
  if (saved === 'collapsed') {
    acc.classList.add('is-collapsed');
    acc.querySelector('[data-nav-toggle]')?.setAttribute('aria-expanded', 'false');
  } else if (saved === 'open') {
    acc.classList.remove('is-collapsed');
    acc.querySelector('[data-nav-toggle]')?.setAttribute('aria-expanded', 'true');
  }
});
function updateSidebarIcon() {
  const icon = $('sidebar-toggle-icon');
  if (icon) icon.textContent = document.body.classList.contains('sidebar-collapsed') ? 'left_panel_open' : 'left_panel_close';
}
if (localStorage.getItem('smf-sidebar') === 'collapsed') document.body.classList.add('sidebar-collapsed');
updateSidebarIcon();
$('sidebar-toggle').onclick = () => {
  if (window.matchMedia('(max-width:650px)').matches) {
    document.body.classList.toggle('sidebar-open');
    return;
  }
  document.body.classList.toggle('sidebar-collapsed');
  localStorage.setItem('smf-sidebar', document.body.classList.contains('sidebar-collapsed') ? 'collapsed' : 'expanded');
  updateSidebarIcon();
};
$('sidebar-backdrop').onclick = () => document.body.classList.remove('sidebar-open');
$('user-menu-btn').onclick = (event) => {
  event.stopPropagation();
  $('user-menu').classList.toggle('open');
};
document.addEventListener('click', (event) => {
  if (!$('user-menu').contains(event.target)) $('user-menu').classList.remove('open');
  const toggle = event.target.closest('[data-pw-toggle]');
  if (!toggle) return;
  const input = toggle.closest('.pw-wrap')?.querySelector('input');
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  const icon = toggle.querySelector('.material-symbols-rounded');
  if (icon) icon.textContent = show ? 'visibility_off' : 'visibility';
});

const savedTheme = localStorage.getItem('smf-theme');
if (savedTheme === 'dark') document.documentElement.dataset.theme = 'dark';
function paintTheme() {
  const icon = document.documentElement.dataset.theme === 'dark' ? 'dark_mode' : 'light_mode';
  document.querySelectorAll('#theme-icon, .login-theme-icon').forEach((node) => { node.textContent = icon; });
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  if (next === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  localStorage.setItem('smf-theme', next);
  paintTheme();
}
paintTheme();
$('theme-toggle').onclick = toggleTheme;
document.querySelectorAll('[data-theme-login]').forEach((node) => { node.onclick = toggleTheme; });

api('/api/me').then((data) => {
  me = data.user;
  if (me.passwordExpired) showPassword();
  else showShell();
}).catch(() => showLogin());
