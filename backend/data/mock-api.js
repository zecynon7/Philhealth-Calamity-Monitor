const users = {
  cfb: { password: 'demo1234', role: 'CFB', region: 'National' },
  act: { password: 'demo1234', role: 'ACT', region: 'National' },
  exe: { password: 'demo1234', role: 'EXE', region: 'National' },
  aud: { password: 'demo1234', role: 'AUD', region: 'National' },
  adm: { password: 'demo1234', role: 'ADM', region: 'National' },
  ros_iva: { password: 'demo1234', role: 'ROS', region: 'IVA' },
  ros_vii: { password: 'demo1234', role: 'ROS', region: 'VII' },
  ros_xi: { password: 'demo1234', role: 'ROS', region: 'XI' },
  rvp_vii: { password: 'demo1234', role: 'RVP', region: 'VII' }
};

const state = {
  event: { id: 'CE-2026-001', name: 'Typhoon Daluyong', status: 'Active', budget: 1300000 },
  claims: [
    { ref: 'CLM-001-XI-00001', region: 'XI', token: 'PT-1024', type: 'Inpatient', status: 'Approved', claimed: 342000, approved: 318000, history: ['Submitted', 'Under review', 'Approved'] },
    { ref: 'CLM-001-VII-00012', region: 'VII', token: 'PT-0981', type: 'Outpatient', status: 'Paid', claimed: 270000, approved: 242000, history: ['Submitted', 'Approved', 'Paid'] },
    { ref: 'CLM-001-IVA-00009', region: 'IVA', token: 'PT-0877', type: 'Inpatient', status: 'Under review', claimed: 210000, approved: 184000, history: ['Submitted', 'Under review'] },
    { ref: 'CLM-001-XI-00017', region: 'XI', token: 'PT-1146', type: 'Outpatient', status: 'Approved', claimed: 362000, approved: 350000, history: ['Submitted', 'Approved'] }
  ],
  exceptions: [
    { id: 1, type: 'Late', claim: 'CLM-001-XI-00001', reason: 'Review exceeded target time.', resolved: false },
    { id: 2, type: 'Duplicate', claim: 'CLM-001-VII-00012', reason: 'Similar patient token and amount.', resolved: false },
    { id: 3, type: 'Outlier', claim: 'CLM-001-XI-00017', reason: 'Amount outside normal range.', resolved: false }
  ]
};

const copy = value => structuredClone(value);
const permitted = (user, claim) => user.role !== 'ROS' || claim.region === user.region;
const authorized = (user, ...roles) => roles.includes(user.role);

export async function callApi(path, options = {}, user = null) {
  const body = options.body ? JSON.parse(options.body) : {};
  if (path === '/login') {
    const account = users[body.username];
    if (!account || account.password !== body.password) throw new Error('Invalid username or password.');
    return { username: body.username, role: account.role, region: account.region };
  }
  if (!user) throw new Error('Please log in first.');
  if (path === '/me') return copy(user);
  if (path === '/dashboard') return copy({
    event: state.event,
    cards: [
      { label: 'Utilization', value: '84.15%', level: 'WARNING' },
      { label: 'Variance', value: '−₱206,000', note: 'Under budget · 15.85%' },
      { label: 'Committed vs budget', value: '₱1,094,000', note: 'of ₱1,300,000 allocation' },
      { label: 'Approved but unpaid', value: '₱852,000', note: '3 claims awaiting payment' }
    ],
    regions: [{ region: 'IVA', allocation: 450000, approved: 310000, paid: 170000, level: 'OK' }, { region: 'VII', allocation: 350000, approved: 275000, paid: 72000, level: 'OK' }, { region: 'XI', allocation: 500000, approved: 542500, paid: 0, level: 'CRITICAL' }]
  });
  if (path.startsWith('/claims?') || path === '/claims') {
    const query = new URLSearchParams(path.split('?')[1]);
    const q = (query.get('q') || '').toLowerCase();
    return copy(state.claims.filter(c => permitted(user, c) && (!q || Object.values(c).join(' ').toLowerCase().includes(q))));
  }
  if (path.startsWith('/claims/') && path.endsWith('/status')) {
    if (!authorized(user, 'CFB', 'ROS')) throw new Error('Your role is not allowed to perform this action.');
    const claim = state.claims.find(c => c.ref === path.split('/')[2]);
    if (!claim || !permitted(user, claim)) throw new Error('This claim is outside your permitted region.');
    claim.status = body.status; claim.history.push(body.status); return copy(claim);
  }
  if (path.startsWith('/claims/')) {
    const claim = state.claims.find(c => c.ref === path.split('/')[2]);
    if (!claim || !permitted(user, claim)) throw new Error('This claim is outside your permitted region.');
    return copy(claim);
  }
  if (path === '/exceptions') return copy(state.exceptions);
  if (path.startsWith('/exceptions/') && path.endsWith('/resolve')) {
    if (!authorized(user, 'CFB', 'ROS')) throw new Error('Your role is not allowed to perform this action.');
    const item = state.exceptions.find(e => e.id === Number(path.split('/')[2]));
    if (!item) throw new Error('Exception not found.'); item.resolved = true; return copy(item);
  }
  if (path === '/analytics') return { forecast: '₱1.42M', scenario: '+12%', monteCarlo: '₱1.38M', allocation: '3 regions', caption: 'Projected total exceeds the event ceiling by ₱120,000.' };
  if (path === '/audit') return { chainOk: true, rows: [{ when: '2026-10-21 09:12', user: 'cfb', action: 'APPROVE', record: 'Budget / CE-2026-001', reason: 'Approved revision 2' }, { when: '2026-10-20 16:44', user: 'ros_xi', action: 'CREATE', record: 'Claim / CLM-001-XI-00017', reason: 'Claim encoded' }] };
  throw new Error('This feature is not available in the Live Server demonstration.');
}
