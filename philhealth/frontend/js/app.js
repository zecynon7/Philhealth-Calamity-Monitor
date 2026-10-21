import { api, setCsrfToken } from './api.js';
import { el, toast } from './ui.js';
import { loginView } from './views/login.js';
import { dashboardView } from './views/dashboard.js';
import { claimsView } from './views/claims.js';

const root = document.querySelector('#app');
let user;
const pages = [['dashboard', 'Dashboard', ['CFB', 'ROS', 'RVP', 'EXE', 'AUD', 'ACT']], ['claims', 'Claims', ['CFB', 'ROS', 'RVP', 'EXE', 'AUD', 'ACT']], ['exceptions', 'Exceptions', ['CFB', 'ROS', 'ACT']], ['analytics', 'Analytics', ['CFB', 'EXE']], ['reports', 'Reports', ['CFB', 'ROS', 'RVP', 'EXE', 'AUD', 'ACT']], ['audit', 'Audit trail', ['AUD', 'CFB']], ['settings', 'Admin', ['ADM']]];

async function basicView(route) {
  if (route === 'analytics') { const data = await api('/analytics'); return el('section', {}, el('h1', {}, 'Forecast and optimization'), el('p', { class: 'intro' }, data.method), el('pre', { class: 'card' }, JSON.stringify(data.regression, null, 2))); }
  if (route === 'audit') { const data = await api('/audit'); return el('section', {}, el('h1', {}, 'Audit trail'), el('p', { class: 'notice' }, data.chainOk ? 'Hash chain verified.' : 'Hash chain requires review.')); }
  if (route === 'reports') return el('section', {}, el('h1', {}, 'Reports'), el('a', { class: 'primary', href: '/api/reports.csv' }, 'Download CSV'));
  return el('section', {}, el('h1', {}, route === 'settings' ? 'Administration' : 'Exception center'), el('p', { class: 'intro' }, 'Use the API-backed workflow to complete this task.'));
}

async function render() {
  try {
    if (!user) { const session = await api('/me'); user = session.user; setCsrfToken(session.csrfToken); }
    const route = location.hash.slice(1) || 'dashboard';
    if (!pages.find(page => page[0] === route)?.[2]?.includes(user.role)) throw new Error('Your role is not allowed to view this page.');
    const nav = el('nav', { class: 'nav' }, pages.filter(page => page[2].includes(user.role)).map(page => el('a', { href: `#${page[0]}`, class: route === page[0] ? 'active' : '' }, page[1])));
    const logout = el('button', { class: 'primary', onclick: async () => { try { await api('/logout', { method: 'POST' }); user = null; setCsrfToken(''); render(); } catch (error) { toast(error.message); } } }, 'Log out');
    const dark = el('button', { class: 'theme-toggle', onclick: () => document.body.classList.toggle('dark') }, 'Theme');
    const view = route === 'dashboard' ? await dashboardView() : route === 'claims' ? await claimsView() : await basicView(route);
    root.replaceChildren(el('section', { class: 'shell' }, el('aside', { class: 'side' }, el('strong', {}, 'PhilHealth Monitor'), nav), el('main', { class: 'work' }, el('header', { class: 'top' }, `${user.username} · ${user.role}`, dark, logout), view)));
  } catch (error) { user = null; setCsrfToken(''); root.replaceChildren(loginView(next => { user = next; render(); })); if (error.message !== 'Authentication required.') toast(error.message); }
}

window.addEventListener('hashchange', render);
render();
