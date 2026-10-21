import { api } from '../api.js';
import { el, table, toast } from '../ui.js';

function row(setting, reload) {
  const value = el('input', { value: setting.value, 'aria-label': `${setting.key} value` });
  const reason = el('input', { placeholder: 'Reason for change', 'aria-label': `${setting.key} reason` });
  const save = el('button', {
    class: 'primary',
    onclick: async () => {
      try {
        await api(`/settings/${encodeURIComponent(setting.key)}`, {
          method: 'PUT', body: JSON.stringify({ value: value.value, reason: reason.value })
        });
        toast(`${setting.key} updated.`); reload();
      } catch (error) { toast(error.message); }
    }
  }, 'Save');
  return [setting.key, value, reason, save];
}

export async function settingsView(reload) {
  const settings = await api('/settings');
  return el('section', {}, el('h1', {}, 'Administration'),
    el('p', { class: 'intro' }, 'Update monitoring thresholds and the reporting as-of date. Every change requires a reason and is audited.'),
    table(['Setting', 'Value', 'Reason', ''], settings.map(setting => row(setting, reload))));
}
