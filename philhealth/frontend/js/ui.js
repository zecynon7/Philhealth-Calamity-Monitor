export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== undefined && value !== null) node.setAttribute(key, value);
  }
  node.append(...children.flat().filter(value => value !== null && value !== undefined).map(value =>
    value instanceof Node ? value : document.createTextNode(String(value))));
  return node;
}

export function money(value) {
  return `₱${Number(value || 0).toLocaleString('en-PH')}`;
}

export function toast(message) {
  const note = el('p', { class: 'toast' }, message);
  document.querySelector('#toasts').append(note);
  setTimeout(() => note.remove(), 3200);
}

export function table(headers, rows) {
  const head = el('thead', {}, el('tr', {}, headers.map(text => el('th', {}, text))));
  const body = el('tbody', {}, rows.map(row => el('tr', {}, row.map(cell => el('td', {}, cell)))));
  return el('div', { class: 'table-wrap' }, el('table', {}, head, body));
}
