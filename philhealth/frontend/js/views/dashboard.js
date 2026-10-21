import { api } from '../api.js';
import { el, money, table } from '../ui.js';

export async function dashboardView() {
  const data = await api('/dashboard');
  const cards = data.cards.map(card => el('article', { class: 'card' }, el('span', { class: 'muted' }, card.label), el('b', { class: 'value' }, card.value), card.note ? el('small', { class: 'muted' }, card.note) : el('small', { class: `chip ${card.level.toLowerCase()}` }, card.level)));
  const rows = data.regions.map(row => [row.region, money(row.allocation), money(row.approved), money(row.paid), row.level]);
  const metrics = Object.entries(data.kpis || {}).map(([label, value]) => el('article', { class: 'card' }, el('span', { class: 'muted' }, label), el('b', { class: 'value' }, String(value))));
  return el('section', {}, el('h1', {}, data.event.name), el('p', { class: 'intro' }, 'Live budget and claim monitoring.'), el('section', { class: 'grid kpis' }, cards), el('h2', {}, 'Regional performance'), table(['Region', 'Allocation', 'Approved', 'Paid', 'Signal'], rows), el('h2', {}, 'Operational KPIs'), el('section', { class: 'grid kpis' }, metrics));
}
