import { api } from '../api.js';
import { el, money, table, toast } from '../ui.js';

export async function claimsView() {
  const rows = await api('/claims');
  const search = el('input', { placeholder: 'Claim reference or token' });
  const output = el('div');
  const render = values => output.replaceChildren(table(['Claim', 'Region', 'Token', 'Status', 'Approved'], values.map(row => [row.ref, row.region, row.token, row.status, money(row.approved)])));
  const button = el('button', { class: 'primary', onclick: async () => {
    try { render(await api(`/claims?q=${encodeURIComponent(search.value)}`)); } catch (error) { toast(error.message); }
  } }, 'Filter');
  render(rows);
  return el('section', {}, el('h1', {}, 'Claims'), el('p', { class: 'intro' }, 'Search protected, tokenized claim records.'), el('div', { class: 'toolbar' }, search, button), output);
}
