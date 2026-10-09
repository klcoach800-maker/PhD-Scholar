'use strict';
// Front end for the RAC portal API. No inline handlers (server CSP blocks them). Designed by Hashim Veeran A
const $ = s => document.querySelector(s), val = i => $('#' + i).value;
const E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STAT = ['Not Scheduled', 'Scheduled', 'Completed', 'Report Submitted', 'Under Review', 'Verified', 'Correction Required'];
const STG = ['Coursework', 'Research Proposal', 'RAC', 'Literature Review', 'Tool Development', 'Pilot Study', 'Data Collection', 'Data Analysis', 'Paper Preparation', 'Thesis Writing', 'Pre-Viva', 'Thesis Submission', 'Viva', 'PhD Completed'];
const ROLEL = { scholar: 'PhD Scholar', supervisor: 'Research Supervisor', hod: 'Department Head', staff: 'Administrative Staff', admin: 'System Administrator' };
const cls = s => s.replace(/ /g, ''), bd = s => `<span class="b ${cls(s)}">${E(s)}</span>`;
const fd = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Pending';
const opt = (arr, sel) => arr.map(x => `<option ${x == sel ? 'selected' : ''}>${E(x)}</option>`).join('');
const attB = v => v == null ? '<span class="m">Not updated</span>' : `<b style="color:var(--${v >= 75 ? 'ok' : 'bad'})">${v}%</b>`;
const done = g => g.status == 'Completed' || g.status == 'Verified';
let ME = null, TAB = '', SEL = null;

async function api(p, m = 'GET', b) {
  const o = { method: m, credentials: 'same-origin' };
  if (b instanceof FormData) o.body = b; else if (b) { o.headers = { 'Content-Type': 'application/json' }; o.body = JSON.stringify(b); }
  const r = await fetch('/api' + p, o), j = (r.headers.get('content-type') || '').includes('json') ? await r.json() : null;
  if (r.status === 401 && p !== '/login') { ME = null; showLogin(); throw new Error('Session ended'); }
  if (!r.ok) throw new Error((j && j.error) || 'Error ' + r.status);
  return j;
}
const toast = (t, bad) => { const d = $('#toast'); d.textContent = t; d.className = 'toast show' + (bad ? ' bad' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => d.className = 'toast', 3500); };
const TABS = {
  scholar: [['dash', 'Dashboard'], ['me', 'My Profile'], ['rac', 'RAC'], ['rem', 'Remarks'], ['prog', 'Progress'], ['pub', 'Publications'], ['docs', 'Documents'], ['hist', 'Review History']],
  supervisor: [['ov', 'Overview'], ['sch', 'Scholars'], ['rem', 'Remarks'], ['rep', 'Reports'], ['hist', 'Review History']],
  hod: [['ov', 'Overview'], ['sch', 'Scholars'], ['rem', 'Remarks'], ['rep', 'Reports'], ['hist', 'Review History'], ['aud', 'Audit Log']],
  staff: [['sch', 'Scholars']], admin: [['usr', 'Users & Attendance'], ['stg', 'RAC Stages'], ['aud', 'Audit Log']]
};
const isRev = () => ME && (ME.role == 'supervisor' || ME.role == 'hod');

function showLogin() {
  $('header').classList.add('hide'); $('#nav').classList.add('hide'); $('#app').classList.add('hide');
  let d = $('#lg'); if (!d) { d = document.createElement('div'); d.id = 'lg'; document.body.appendChild(d); }
  d.className = 'lgw';
  d.innerHTML = `<div class="lgc"><div style="color:#e6c97a;font-size:12px;letter-spacing:2px">UNIVERSITY RESEARCH PORTAL</div><h2 style="margin:6px 0 2px">PhD Scholar Academic Monitoring &amp; RAC Management System</h2><div style="opacity:.75;font-size:13px">Track. Review. Communicate. Progress.</div>
  <label style="color:#cdd6ee">Roll No / Staff ID</label><input id="lu" autocomplete="username"><label style="color:#cdd6ee">Password</label><input id="lp" type="password" autocomplete="current-password">
  <button class="gb" data-act="login">Sign in</button><div style="opacity:.6;font-size:12px;margin-top:10px">First password = your Roll No / Staff ID. You will be asked to change it.</div><div style="opacity:.7;font-size:12px;margin-top:14px;text-align:center">Designed by Hashim Veeran A</div></div>`;
  $('#lu').focus();
}
function enter() {
  const d = $('#lg'); if (d) d.remove();
  $('header').classList.remove('hide'); $('#nav').classList.remove('hide'); $('#app').classList.remove('hide');
  TAB = ME.mustChange ? 'pw' : TABS[ME.role][0][0]; SEL = null; go();
}
async function go() {
  if (!ME) return showLogin();
  const force = ME.mustChange;
  $('#uinfo').innerHTML = `<b>${E(ME.name)}</b><small>${ROLEL[ME.role]} · ${E(ME.id)}</small>`;
  $('#nav').innerHTML = force ? '' : TABS[ME.role].map(([k, l]) => `<button class="${TAB == k ? 'on' : ''}" data-act="tab" data-k="${k}">${E(l)}</button>`).join('');
  try {
    $('#app').innerHTML = force ? '<div class="warnb">🔑 First login: set a new password to continue.</div>' + pwV() : await (SEL && TAB == 'sch' ? profileV(SEL) : V[TAB]());
  } catch (e) { if (e.message !== 'Session ended') $('#app').innerHTML = `<div class="c">${E(e.message)}</div>`; }
}

function timeline(p) {
  const it = [{ n: 'Registration', d: p.reg_date, ok: 1 }];
  const first = p.rac.findIndex(g => !done(g));
  p.rac.forEach((g, i) => it.push({ n: g.name, d: g.meeting_date, ok: done(g), a: i == first }));
  it.push({ n: 'Thesis Submission' }, { n: 'Viva' }, { n: 'PhD Completed' });
  return `<div class="tl">${it.map(i => `<div class="st ${i.ok ? 'd' : ''} ${i.a ? 'a' : ''}"><div class="dot">${i.ok ? '✓' : '○'}</div><b>${E(i.n)}</b><div class="m">${i.ok || i.d ? fd(i.d) : 'Pending'}</div></div>`).join('')}</div>`;
}
function racTable(sid, p, docs, canDocs) {
  const rv = isRev(), canEdit = ME.role == 'scholar' || rv, S = E(sid);
  return `<div class="tw"><table><tr><th>RAC Stage</th><th>Meeting Date</th><th>Status</th><th>Documents</th><th>Verified By</th></tr>${p.rac.map(g => {
    const ds = (docs || []).filter(d => d.stage == g.name), at = `data-sid="${S}" data-st="${g.stage_id}"`;
    return `<tr><td><b>${E(g.name)}</b>${g.required ? '' : ' <span class="m">(optional)</span>'}</td>
<td>${canEdit ? `<input type="date" value="${E(g.meeting_date)}" data-chg="date" ${at}>` : fd(g.meeting_date)}</td>
<td>${rv ? `<select data-chg="status" ${at}>${opt(STAT, g.status)}</select>` : bd(g.status)}</td>
<td>${canDocs ? (ds.map(d => `<div class="m">📄 <a href="/api/documents/${d.id}">${E(d.orig_name)}</a> (${E(d.kind)}, ${fd(d.uploaded_at)}) ${d.status == 'Verified' ? '✔ ' + E(d.verified_by) : rv ? `<button class="s" data-act="vdoc" data-id="${d.id}">Verify</button>` : ''}</div>`).join('') || '<span class="m">No documents</span>') : '<span class="m">—</span>'}
${canDocs && canEdit ? `<div class="row"><select id="k${g.stage_id}">${opt(['RAC Report', 'RAC Letter', 'Additional Document'])}</select><input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" data-chg="upload" ${at}></div>` : ''}</td>
<td>${g.verified_by ? E(g.verified_by) + '<br>' + fd(g.verified_date) : '—'}</td></tr>`;
  }).join('')}</table></div>`;
}

// ---------- scholar views
async function dash() {
  const [p, rem] = await Promise.all([api('/scholars/' + ME.id), api('/remarks')]), open = rem.filter(r => r.status != 'Resolved');
  const n = p.rac.filter(done).length, pct = p.rac.length ? Math.round(n / p.rac.length * 100) : 0;
  const pend = p.rac.filter(g => g.status == 'Correction Required').map(g => `<div class="badb">🔴 Correct ${E(g.name)} submission</div>`)
    .concat(open.map(r => `<div class="warnb">🟡 ${E(r.stage)}: ${E(r.action || r.text)}</div>`), p.rac.filter(g => g.status == 'Verified').map(g => `<div class="okb">🟢 ${E(g.name)} Verified</div>`));
  return `<h2>Welcome, ${E(ME.name)}</h2><div class="g"><div class="c"><h3>Research Status</h3><div class="m">Stage</div><b>${E(p.stage)}</b><div class="m">Supervisor</div>${E(p.supervisor) || '—'}<div class="m">Registered / Expected completion</div>${fd(p.reg_date)} → ${fd(p.exp_date)}</div>
<div class="c"><h3>RAC Progress</h3><div class="k">${n}/${p.rac.length}</div><div class="bar"><i style="width:${pct}%"></i></div><div class="m">${pct}% milestones complete</div></div>
<div class="c"><h3>Attendance</h3><div class="k">${p.attendance == null ? '—' : p.attendance + '%'}</div><div class="bar"><i style="width:${p.attendance || 0}%"></i></div><div class="m">${p.attendance == null ? 'Not updated by admin yet' : 'Updated ' + fd(p.att_date)}</div></div></div>
<div class="c"><h3>Research Title</h3>${E(p.title) || '<span class="m">Not added yet. Add it in My Profile.</span>'}</div><div class="c"><h3>RAC Timeline</h3>${timeline(p)}</div>
<div class="g"><div class="c"><h3>Pending Actions</h3>${pend.join('') || '<span class="m">None</span>'}</div><div class="c"><h3>🔔 Notifications</h3>${open.map(r => `<div class="warnb"><b>${E(r.stage)} — Action Required</b><br>“${E(r.text)}”</div>`).join('') || '<span class="m">No new remarks</span>'}</div></div>`;
}
async function me() {
  const [p, sup] = await Promise.all([api('/scholars/' + ME.id), api('/supervisors')]);
  return `<h2>My Profile</h2><div class="c"><p class="m">Roll No: ${E(p.roll_no)}. Fill your own details. Academic Profile stays optional.</p><label>Research title</label><input id="mt" value="${E(p.title)}">
<div class="row"><div><label>Research area</label><input id="ma" value="${E(p.area)}"></div><div><label>Supervisor</label><select id="ms"><option value="">— choose —</option>${sup.map(u => `<option value="${E(u.id)}" ${u.id == p.supervisor_id ? 'selected' : ''}>${E(u.name)}</option>`).join('')}</select></div></div>
<div class="row"><div><label>Registration date</label><input id="md" type="date" value="${E(p.reg_date)}"></div><div><label>Expected completion</label><input id="mx" type="date" value="${E(p.exp_date)}"></div><div><label>Research stage</label><select id="mg">${opt(STG, p.stage)}</select></div></div>
<p><button class="p" data-act="saveme">Save</button></p></div>`;
}
async function rac() { const [p, d] = await Promise.all([api('/scholars/' + ME.id), api(`/scholars/${ME.id}/documents`)]); return `<h2>RAC Management</h2><div class="c">${timeline(p)}</div><div class="c">${racTable(ME.id, p, d, true)}</div>`; }
async function prog() {
  const L = await api(`/scholars/${ME.id}/progress`);
  return `<h2>Research Progress</h2><div class="c"><div class="row"><div><label>Type</label><select id="pk">${opt(['Monthly', 'Semester', 'Annual'])}</select></div><div><label>Work completed</label><input id="pw"></div><div><label>Future plan</label><input id="pf"></div></div><p><button class="p" data-act="addprog">Submit Progress</button></p></div>
<div class="c tw"><table><tr><th>Date</th><th>Type</th><th>Work completed</th><th>Future plan</th></tr>${L.map(x => `<tr><td>${fd(x.at)}</td><td>${E(x.kind)}</td><td>${E(x.work)}</td><td>${E(x.plan)}</td></tr>`).join('')}</table></div>`;
}
async function pub() {
  const L = await api(`/scholars/${ME.id}/publications`);
  return `<h2>Publications</h2><div class="c"><div class="row"><input id="ut" placeholder="Article title"><input id="uj" placeholder="Journal / ISSN / DOI"><select id="us">${opt(['Published', 'Accepted', 'Under Review', 'Submitted', 'In Preparation'], 'In Preparation')}</select><button class="p" data-act="addpub">Add</button></div></div>
<div class="c tw"><table><tr><th>Title</th><th>Journal</th><th>Status</th></tr>${L.map(x => `<tr><td>${E(x.title)}</td><td>${E(x.journal)}</td><td>${E(x.status)}</td></tr>`).join('')}</table></div>`;
}
async function docs() {
  const L = await api(`/scholars/${ME.id}/documents`);
  return `<h2>Documents</h2><div class="c tw"><table><tr><th>Name</th><th>Category</th><th>Stage</th><th>Uploaded</th><th>By</th><th>Status</th><th>Verified by</th></tr>${L.map(d => `<tr><td><a href="/api/documents/${d.id}">${E(d.orig_name)}</a></td><td>${E(d.kind)}</td><td>${E(d.stage)}</td><td>${fd(d.uploaded_at)}</td><td>${E(d.uploaded_by)}</td><td>${E(d.status)}</td><td>${E(d.verified_by || '—')}</td></tr>`).join('') || '<tr><td class="m">No documents</td></tr>'}</table></div>`;
}
// ---------- shared: remarks + history
async function rem() {
  const L = await api('/remarks');
  let form = '';
  if (isRev()) {
    const [sc, st] = await Promise.all([api('/scholars'), api('/stages')]);
    form = `<div class="c"><h3>+ Add Remark</h3><div class="row"><div><label>Scholar</label><select id="fs">${sc.map(s => `<option value="${E(s.roll_no)}">${E(s.name)} (${E(s.roll_no)})</option>`).join('')}</select></div><div><label>Stage</label><select id="fst">${st.map(g => `<option value="${g.id}">${E(g.name)}</option>`).join('')}</select></div><div><label>Remark Type</label><select id="ft">${opt(['Academic', 'Research', 'RAC', 'Documentation', 'Administrative', 'Correction Required', 'Important', 'General'])}</select></div><div><label>Priority</label><select id="fp">${opt(['Low', 'Medium', 'High', 'Urgent'], 'Medium')}</select></div></div>
<label>Remark</label><textarea id="fr" rows="2"></textarea><div class="row"><div><label>Action Required</label><input id="fa"></div><div><label>Deadline</label><input type="date" id="fd"></div></div><p><button class="p" data-act="remsend">Send Remark</button></p></div>`;
  }
  return `<h2>Remarks</h2>${form}${L.map(r => `<div class="c"><div class="row"><b>${E(r.stage)} — ${E(r.type)}</b><span>${bd(r.priority)} ${bd(r.status)}</span></div><div class="m">${isRev() ? E(r.scholar_id) + ' · ' : ''}by ${E(r.by_user)} · ${fd(r.created_at)} · Deadline ${fd(r.deadline)}</div><p>“${E(r.text)}”</p><div class="m">Action: ${E(r.action || '—')}</div>
${r.responses.map(x => `<div class="okb">${fd(x.at)} ${E(x.by_user)}: ${E(x.text)}</div>`).join('')}
${ME.role == 'scholar' && r.status != 'Resolved' ? `<div class="row"><input id="rp${r.id}" placeholder="Write response…"><button class="p" data-act="respond" data-id="${r.id}">Respond</button><button class="s" data-act="tab" data-k="rac">Upload Document</button></div>` : ''}
${isRev() && r.status != 'Resolved' ? `<div class="row"><button class="p" data-act="close" data-id="${r.id}" data-s="Resolved">Verify / Resolve</button><button class="s" data-act="close" data-id="${r.id}" data-s="Open">Correction Required</button></div>` : ''}</div>`).join('') || '<div class="c m">No remarks.</div>'}`;
}
async function hist() {
  const L = await api('/history');
  return `<h2>Review History</h2><div class="c tw"><table><tr><th>Date</th><th>Reviewer</th><th>Scholar</th><th>Stage</th><th>Remark</th><th>Action</th><th>Status</th></tr>${L.map(h => `<tr><td>${fd(h.ts)}</td><td>${E(h.who)}</td><td>${E(h.scholar_id)}</td><td>${E(h.stage)}</td><td>${E(h.remark)}</td><td>${E(h.action)}</td><td>${E(h.status)}</td></tr>`).join('')}</table></div><p class="m">Records are permanent and cannot be deleted.</p>`;
}
// ---------- reviewer / staff views
async function ov() {
  const [r, rem] = await Promise.all([api('/reports/department'), api('/remarks')]), n = r.rows.length, k = (l, v) => `<div class="c"><div class="m">${l}</div><div class="k">${v}</div></div>`;
  const dn = g => r.rows.filter(x => ['Completed', 'Verified'].includes(x.rac[g])).length, pendDocs = r.rows.reduce((a, x) => a + Object.values(x.rac).filter(s => s == 'Report Submitted' || s == 'Under Review').length, 0);
  return `<h2>RAC Overview</h2><div class="g">${k('Total Scholars', n)}${r.stages.map(g => k(g + ' Completed', dn(g))).join('')}${k('Documents Requiring Verification', pendDocs)}${k('Open Remarks', rem.filter(x => x.status != 'Resolved').length)}${ME.attendance != null ? k('My Attendance', ME.attendance + '%') : ''}</div>
<div class="c"><h3>Completion by stage</h3>${r.stages.map(g => `<div class="m">${E(g)} — ${dn(g)}/${n}</div><div class="bar"><i style="width:${n ? dn(g) / n * 100 : 0}%"></i></div>`).join('')}</div>`;
}
const schRows = L => L.map(s => `<tr><td>${E(s.roll_no)}</td><td>${E(s.name)}</td><td>${E(s.supervisor || '—')}</td><td>${E(s.stage)}</td><td>${attB(s.attendance)}</td><td><button class="p" data-act="open" data-id="${E(s.roll_no)}">Open</button></td></tr>`).join('');
async function sch() {
  const L = await api('/scholars');
  return `<h2>Scholars</h2><div class="c"><input id="q" placeholder="Search by Roll No or name"></div><div class="c tw"><table><tr><th>Roll No</th><th>Scholar</th><th>Supervisor</th><th>Research Stage</th><th>Attendance</th><th></th></tr><tbody id="tbl">${schRows(L)}</tbody></table></div>`;
}
async function profileV(sid) {
  const p = await api('/scholars/' + sid), full = ME.role != 'staff', [d, pr, pb] = full ? await Promise.all([api(`/scholars/${sid}/documents`), api(`/scholars/${sid}/progress`), api(`/scholars/${sid}/publications`)]) : [[], [], []];
  return `<button class="s" data-act="back">← Back</button><h2>${E(p.name)} <span class="m">${E(p.roll_no)}</span></h2><div class="g"><div class="c"><h3>Overview</h3><b>${E(p.title) || '—'}</b><div class="m">${E(p.area)} · ${E(p.stage)}</div><div class="m">Supervisor: ${E(p.supervisor) || '—'}</div><div class="m">Attendance: ${attB(p.attendance)}</div></div>
<div class="c"><h3>Publications</h3>${pb.map(x => E(x.title) + ' — ' + E(x.status)).join('<br>') || '<span class="m">None</span>'}</div><div class="c"><h3>Progress</h3>${pr.map(x => fd(x.at) + ': ' + E(x.work)).join('<br>') || '<span class="m">None</span>'}</div></div>
<div class="c"><h3>RAC Timeline</h3>${timeline(p)}</div><div class="c"><h3>RAC Records</h3>${racTable(sid, p, d, full)}</div><p><button class="s" data-act="print">Print / Save as PDF</button></p>`;
}
async function rep() {
  const r = await api('/reports/department');
  return `<h2>Department Report</h2><div class="c tw"><table><tr><th>Scholar</th><th>Stage</th><th>Attendance</th>${r.stages.map(g => `<th>${E(g)}</th>`).join('')}</tr>${r.rows.map(x => `<tr><td>${E(x.name)} <span class="m">${E(x.id)}</span></td><td>${E(x.stage)}</td><td>${attB(x.attendance)}</td>${r.stages.map(g => `<td>${bd(x.rac[g])}</td>`).join('')}</tr>`).join('')}</table></div>
<p class="row"><button class="p" data-act="print">PDF Export (Print)</button><a href="/api/reports/department?format=csv"><button class="s">Excel Export (CSV)</button></a></p>`;
}
async function aud() {
  const L = await api('/audit');
  return `<h2>Audit Log</h2><div class="c tw"><table><tr><th>Date / Time</th><th>User</th><th>Action</th><th>Record</th><th>Previous</th><th>New</th></tr>${L.map(a => `<tr><td>${E(new Date(a.ts).toLocaleString())}</td><td>${E(a.user)}</td><td>${E(a.action)}</td><td>${E(a.record)}</td><td>${E(a.prev)}</td><td>${E(a.next)}</td></tr>`).join('')}</table></div>`;
}
// ---------- admin
async function usr() {
  const U = await api('/admin/users');
  return `<h2>Users &amp; Attendance</h2><p class="m">Login ID = Roll No / Staff ID. First password = same ID, changed at first login. Scholars add their own title, area, supervisor and dates.</p>
<div class="c"><h3>Bulk add from Excel</h3><div class="tw"><table><tr><th>ID</th><th>Name</th><th>Role</th><th>Attendance</th></tr><tr><td>PE26001</td><td>Meera S</td><td>scholar</td><td>92</td></tr><tr><td>STF010</td><td>Dr. A Kumar</td><td>supervisor</td><td>95</td></tr></table></div><p class="m">First row = headings. Role: scholar, supervisor, hod, staff, admin (blank = scholar). Attendance optional.</p>
<div class="row"><input type="file" id="impf" accept=".xlsx,.xls,.csv"><button class="p" data-act="imp">Import</button></div><div id="bm" class="m"></div></div>
<div class="c"><h3>+ Add one user</h3><div class="row"><div><label>Roll No / Staff ID</label><input id="ai"></div><div><label>Full name</label><input id="an"></div><div><label>Role</label><select id="ar"><option value="scholar">PhD Scholar</option><option value="supervisor">Research Supervisor</option><option value="hod">Department Head / HOD</option><option value="staff">Administrative Staff</option><option value="admin">System Administrator</option></select></div><div><label>Attendance %</label><input id="ax" type="number" min="0" max="100"></div></div><p><button class="p" data-act="addone">Create Login</button></p></div>
<div class="c tw"><h3>All Accounts &amp; Attendance</h3><table><tr><th>Login ID</th><th>Name</th><th>Role</th><th>Attendance %</th><th>Status</th><th>Password</th></tr>${U.map(u => `<tr><td>${E(u.id)}</td><td>${E(u.name)}</td><td>${E(u.role)}</td><td>${u.role == 'admin' ? '—' : `<div class="row"><input type="number" min="0" max="100" id="at_${E(u.id)}" value="${u.attendance ?? ''}"><button class="s" data-act="attsave" data-id="${E(u.id)}">Save</button></div><div class="m">${u.att_date ? 'Updated ' + fd(u.att_date) : 'Not updated'}</div>`}</td>
<td><button class="s" data-act="active" data-id="${E(u.id)}" data-v="${u.active ? 0 : 1}">${u.active ? 'Active' : 'Disabled'}</button></td><td><button class="s" data-act="reset" data-id="${E(u.id)}">Reset to ID</button>${u.must_change ? '<div class="m">Default password</div>' : ''}</td></tr>`).join('')}</table></div>`;
}
async function stg() {
  const L = await api('/stages?all=1');
  return `<h2>RAC Stage Management</h2><div class="c"><h3>+ Add RAC Stage</h3><div class="row"><input id="sn" placeholder="Stage name e.g. RAC 6"><input id="so" type="number" placeholder="Order" value="6"><select id="sr"><option value="1">Required</option><option value="0">Optional</option></select><button class="p" data-act="addstage">Add Stage</button></div><p class="m">New stage appears at once in every scholar's timeline, RAC table and HOD overview. No code change.</p></div>
<div class="c tw"><table><tr><th>Order</th><th>Stage</th><th>Required</th><th>Status</th></tr>${L.map(x => `<tr><td>${x.ord}</td><td>${E(x.name)}</td><td>${x.required ? 'Yes' : 'No'}</td><td><button class="s" data-act="stgact" data-id="${x.id}" data-v="${x.active ? 0 : 1}">${x.active ? 'Active' : 'Inactive'}</button></td></tr>`).join('')}</table></div>`;
}
function pwV() { return `<h2>Change Password</h2><div class="c" style="max-width:380px"><label>Current password</label><input id="po" type="password" autocomplete="current-password"><label>New password (min 8, not your ID)</label><input id="pn" type="password" autocomplete="new-password"><label>Repeat new password</label><input id="pn2" type="password" autocomplete="new-password"><p><button class="p" data-act="chpw">Update</button></p></div>`; }
const V = { dash, me, rac, rem, prog, pub, docs, hist, ov, sch, rep, aud, usr, stg, pw: async () => pwV() };

// ---------- actions
const A = {
  async login() {
    const r = await api('/login', 'POST', { id: val('lu').trim(), password: val('lp') }); ME = r; enter();
  },
  tab(b) { TAB = b.dataset.k; SEL = null; go(); }, pwtab() { TAB = 'pw'; SEL = null; go(); }, open(b) { SEL = b.dataset.id; go(); }, back() { SEL = null; go(); }, print() { window.print(); },
  async logout() { await api('/logout', 'POST').catch(() => { }); ME = null; showLogin(); },
  async chpw() {
    if (val('pn') !== val('pn2')) throw new Error('New passwords do not match');
    await api('/password', 'POST', { current: val('po'), next: val('pn') }); ME = await api('/me'); toast('Password updated'); enter();
  },
  async saveme() { await api('/scholars/' + ME.id, 'PATCH', { title: val('mt'), area: val('ma'), supervisor_id: val('ms') || null, reg_date: val('md'), exp_date: val('mx'), stage: val('mg') }); toast('Profile saved'); go(); },
  async addprog() { await api('/progress', 'POST', { kind: val('pk'), work: val('pw'), plan: val('pf') }); toast('Progress submitted'); go(); },
  async addpub() { await api('/publications', 'POST', { title: val('ut'), journal: val('uj'), status: val('us') }); go(); },
  async remsend() { await api('/remarks', 'POST', { scholar_id: val('fs'), stage_id: +val('fst'), type: val('ft'), priority: val('fp'), text: val('fr'), action: val('fa'), deadline: val('fd') }); toast('Remark sent'); go(); },
  async respond(b) { await api(`/remarks/${b.dataset.id}/respond`, 'POST', { text: val('rp' + b.dataset.id) }); go(); },
  async close(b) { await api(`/remarks/${b.dataset.id}/close`, 'POST', { status: b.dataset.s }); go(); },
  async vdoc(b) { await api(`/documents/${b.dataset.id}/verify`, 'POST'); go(); },
  async addone() { await api('/admin/users', 'POST', { id: val('ai'), name: val('an'), role: val('ar'), attendance: val('ax') }); toast('Account created'); go(); },
  async imp() {
    const f = $('#impf').files[0]; if (!f) throw new Error('Choose a file'); const fm = new FormData(); fm.append('file', f);
    const r = await api('/admin/import', 'POST', fm), msg = `<b>${r.added} accounts added.</b>${r.skipped.length ? '<br>Skipped:<br>' + r.skipped.map(E).join('<br>') : ''}`; await go(); $('#bm').innerHTML = msg;
  },
  async attsave(b) { await api('/admin/users/' + b.dataset.id, 'PATCH', { attendance: val('at_' + b.dataset.id) }); toast('Attendance saved'); go(); },
  async active(b) { await api('/admin/users/' + b.dataset.id, 'PATCH', { active: b.dataset.v == '1' }); go(); },
  async reset(b) { await api(`/admin/users/${b.dataset.id}/reset`, 'POST'); toast('Password reset to ID'); go(); },
  async addstage() { await api('/admin/stages', 'POST', { name: val('sn'), ord: +val('so'), required: val('sr') == '1' }); go(); },
  async stgact(b) { await api('/admin/stages/' + b.dataset.id, 'PATCH', { active: b.dataset.v == '1' }); go(); }
};
const run = async (f, b) => { try { await f(b); } catch (e) { if (e.message !== 'Session ended') toast(e.message, 1); } };
document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && A[b.dataset.act]) run(A[b.dataset.act], b); });
document.addEventListener('keydown', e => { if (e.key == 'Enter' && e.target.id == 'lp') run(A.login); });
document.addEventListener('change', e => run(async () => {
  const t = e.target, a = t.dataset.chg; if (!a) return; const u = `/scholars/${t.dataset.sid}/rac/${t.dataset.st}`;
  if (a == 'date') await api(u, 'PATCH', { date: t.value });
  else if (a == 'status') await api(u, 'PATCH', { status: t.value });
  else if (a == 'upload') { const f = t.files[0]; if (!f) return; const fm = new FormData(); fm.append('kind', val('k' + t.dataset.st)); fm.append('file', f); await api(u + '/documents', 'POST', fm); toast('Uploaded'); }
  go();
}));
let qt; document.addEventListener('input', e => { if (e.target.id != 'q') return; clearTimeout(qt); qt = setTimeout(() => run(async () => { $('#tbl').innerHTML = schRows(await api('/scholars?q=' + encodeURIComponent(e.target.value))); }), 250); });
(async () => { try { ME = await api('/me'); enter(); } catch { showLogin(); } })();
