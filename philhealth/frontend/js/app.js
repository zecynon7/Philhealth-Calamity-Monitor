import { api, setCsrfToken } from './api.js';
import { el, money, table, toast } from './ui.js';
import { loginView } from './views/login.js';
import { dashboardView } from './views/dashboard.js';
import { claimsView } from './views/claims.js';
import { settingsView } from './views/settings.js';

const root = document.querySelector('#app');
const pages = [['dashboard', 'Dashboard', ['CFB', 'ROS', 'RVP', 'EXE', 'AUD', 'ACT']], ['claims', 'Claims', ['CFB', 'ROS', 'RVP', 'EXE', 'AUD', 'ACT']], ['exceptions', 'Exceptions', ['CFB', 'ROS', 'ACT']], ['analytics', 'Analytics', ['CFB', 'EXE']], ['reports', 'Reports', ['CFB', 'ROS', 'RVP', 'EXE', 'AUD', 'ACT']], ['audit', 'Audit trail', ['AUD', 'CFB']], ['settings', 'Admin', ['ADM']]];
let user;

const label = value => value.replaceAll(/([A-Z])/g, ' $1').replace(/^./, char => char.toUpperCase());
const cards = data => el('section', { class: 'grid kpis' }, Object.entries(data).map(([key, value]) => el('article', { class: 'card' }, el('span', { class: 'muted' }, label(key)), el('b', { class: 'value' }, String(value)))));

async function exceptionsView() {
  const items = await api('/exceptions');
  return el('section', { class: 'view' }, el('h1', {}, 'Exception center'), el('p', { class: 'intro' }, 'Active claim issues detected by the monitoring rules.'), table(['Claim', 'Type', 'Reason', 'State'], items.map(item => [item.claim, item.type, item.reason, el('span', { class: `chip ${item.resolved ? 'ok' : 'warning'}` }, item.resolved ? 'Resolved' : 'Open')])));
}
async function analyticsView() { const data = await api('/analytics'); return el('section', { class: 'view' }, el('h1', {}, 'Forecast and optimization'), el('p', { class: 'intro' }, data.method), cards({ forecast: data.forecast, scenario: data.scenario, monteCarlo: data.monteCarlo, allocation: data.allocation }), el('p', { class: 'notice' }, data.caption)); }
async function auditView() { const data = await api('/audit'); return el('section', { class: 'view' }, el('h1', {}, 'Audit trail'), el('p', { class: data.chainOk ? 'notice' : 'notice danger' }, data.chainOk ? 'Audit hash chain verified.' : 'Audit hash chain requires review.'), table(['When', 'User', 'Action', 'Record', 'Reason'], data.rows.map(row => [row.when, row.user, row.action, row.record, row.reason]))); }
async function reportsView() { const data = await api('/reports'); return el('section', { class: 'view' }, el('h1', {}, 'Reports'), el('p', { class: 'intro' }, data.title), cards({ budget: money(data.budget), approved: money(data.approved), variance: money(data.variance) }), el('a', { class: 'primary', href: '/api/reports.csv' }, 'Download CSV report')); }
async function pageView(route) {
  if (route === 'dashboard') return dashboardView(); if (route === 'claims') return claimsView(); if (route === 'settings') return settingsView(render); if (route === 'exceptions') return exceptionsView(); if (route === 'analytics') return analyticsView(); if (route === 'audit') return auditView(); return reportsView();
}
async function render() {
  try {
    if (!user) { const session = await api('/me'); user = session.user; setCsrfToken(session.csrfToken); }
    let route = location.hash.slice(1) || 'dashboard'; const available = pages.filter(page => page[2].includes(user.role));
    if (!available.some(page => page[0] === route)) { route = available[0][0]; history.replaceState(null, '', `#${route}`); }
    const nav = el('nav', { class: 'nav', 'aria-label': 'Primary navigation' }, available.map(page => el('a', { href: `#${page[0]}`, class: route === page[0] ? 'active' : '' }, page[1])));
    const logout = el('button', { class: 'primary', onclick: async () => { try { await api('/logout', { method: 'POST' }); user = undefined; setCsrfToken(''); render(); } catch (error) { toast(error.message); } } }, 'Log out');
    const theme = el('button', { class: 'theme-toggle', onclick: () => document.body.classList.toggle('dark') }, 'Theme');
    const brand = el('a', { class: 'brand', href: '#dashboard' }, el('img', { src: 'assets/philhealth-seal.png', alt: '' }), el('span', {}, el('strong', {}, 'PhilHealth'), el('small', {}, 'CALAMITY CLAIMS MONITOR')));
    root.replaceChildren(el('section', { class: 'shell' }, el('aside', { class: 'side' }, brand, nav), el('main', { class: 'work' }, el('header', { class: 'top' }, el('span', { class: 'user grow' }, `${user.username} · ${user.role} · ${user.region}`), theme, logout), await pageView(route))));
  } catch (error) { user = undefined; setCsrfToken(''); root.replaceChildren(loginView(next => { user = next; render(); })); if (error.message !== 'Authentication required.') toast(error.message); }
}
window.addEventListener('hashchange', render);
document.querySelector('#closeDialog').addEventListener('click', () => document.querySelector('#dialog').close());
render();
