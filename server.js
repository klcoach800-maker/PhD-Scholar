'use strict';
// PhD Scholar Academic Monitoring & RAC Management System - API. Designed by Hashim Veeran A
const express = require('express'), Database = require('better-sqlite3'), bcrypt = require('bcryptjs'),
  jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser'), helmet = require('helmet'),
  rateLimit = require('express-rate-limit'), multer = require('multer'), XLSX = require('xlsx'),
  path = require('path'), fs = require('fs'), crypto = require('crypto');

const PROD = process.env.NODE_ENV === 'production', PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) { console.error('Set JWT_SECRET (32+ chars).'); process.exit(1); }
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data'), UP = path.join(DATA, 'uploads');
fs.mkdirSync(UP, { recursive: true });
const db = new Database(path.join(DATA, 'rac.db'));
db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY COLLATE NOCASE, name TEXT NOT NULL, role TEXT NOT NULL,
  pw_hash TEXT NOT NULL, must_change INTEGER DEFAULT 1, active INTEGER DEFAULT 1, attendance REAL, att_date TEXT);
CREATE TABLE IF NOT EXISTS scholars(user_id TEXT PRIMARY KEY REFERENCES users(id), title TEXT DEFAULT '', area TEXT DEFAULT '',
  supervisor_id TEXT REFERENCES users(id), reg_date TEXT DEFAULT '', exp_date TEXT DEFAULT '', stage TEXT DEFAULT 'Coursework');
CREATE TABLE IF NOT EXISTS rac_stages(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, ord INTEGER NOT NULL,
  required INTEGER DEFAULT 1, active INTEGER DEFAULT 1, description TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS rac_records(scholar_id TEXT, stage_id INTEGER, meeting_date TEXT DEFAULT '', status TEXT DEFAULT 'Not Scheduled',
  verified_by TEXT, verified_date TEXT, PRIMARY KEY(scholar_id, stage_id));
CREATE TABLE IF NOT EXISTS documents(id INTEGER PRIMARY KEY AUTOINCREMENT, scholar_id TEXT, stage_id INTEGER, kind TEXT, orig_name TEXT,
  stored_name TEXT, uploaded_by TEXT, uploaded_at TEXT, status TEXT DEFAULT 'Pending', verified_by TEXT, verified_at TEXT);
CREATE TABLE IF NOT EXISTS remarks(id INTEGER PRIMARY KEY AUTOINCREMENT, scholar_id TEXT, stage_id INTEGER, type TEXT, text TEXT,
  action TEXT, deadline TEXT, priority TEXT, status TEXT DEFAULT 'Open', by_user TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS remark_responses(id INTEGER PRIMARY KEY AUTOINCREMENT, remark_id INTEGER, text TEXT, by_user TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS progress(id INTEGER PRIMARY KEY AUTOINCREMENT, scholar_id TEXT, at TEXT, kind TEXT, work TEXT, plan TEXT);
CREATE TABLE IF NOT EXISTS publications(id INTEGER PRIMARY KEY AUTOINCREMENT, scholar_id TEXT, title TEXT, journal TEXT, status TEXT);
CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, who TEXT, scholar_id TEXT, stage TEXT, remark TEXT, action TEXT, status TEXT);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, user TEXT, action TEXT, record TEXT, prev TEXT, next TEXT);
CREATE TRIGGER IF NOT EXISTS audit_nu BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_nd BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER IF NOT EXISTS hist_nu BEFORE UPDATE ON history BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER IF NOT EXISTS hist_nd BEFORE DELETE ON history BEGIN SELECT RAISE(ABORT,'append-only'); END;
`);

const ROLES = ['scholar', 'supervisor', 'hod', 'staff', 'admin'], REV = ['supervisor', 'hod'];
const STATUSES = ['Not Scheduled', 'Scheduled', 'Completed', 'Report Submitted', 'Under Review', 'Verified', 'Correction Required'];
const STAGES = ['Coursework', 'Research Proposal', 'RAC', 'Literature Review', 'Tool Development', 'Pilot Study', 'Data Collection',
  'Data Analysis', 'Paper Preparation', 'Thesis Writing', 'Pre-Viva', 'Thesis Submission', 'Viva', 'PhD Completed'];
const KINDS = ['RAC Report', 'RAC Letter', 'Additional Document'], DATE = /^\d{4}-\d{2}-\d{2}$/;
const now = () => new Date().toISOString(), q = (s, ...a) => db.prepare(s).all(...a), one = (s, ...a) => db.prepare(s).get(...a), run = (s, ...a) => db.prepare(s).run(...a);
const audit = (u, a, rec, p, n) => run('INSERT INTO audit(ts,user,action,record,prev,next) VALUES(?,?,?,?,?,?)', now(), u, a, rec ?? '', p ?? '', n ?? '');
const hist = (who, sid, stage, rem, act, st) => run('INSERT INTO history(ts,who,scholar_id,stage,remark,action,status) VALUES(?,?,?,?,?,?,?)', now(), who, sid, stage, rem, act, st);
const pub = u => ({ id: u.id, name: u.name, role: u.role, mustChange: !!u.must_change, attendance: u.attendance, attendanceDate: u.att_date });
const att = v => { v = parseFloat(v); return isNaN(v) ? null : Math.min(100, Math.max(0, v)); };

if (!one('SELECT 1 FROM rac_stages')) {
  ['RAC 1', 'RAC 2', 'RAC 3', 'RAC 4', 'RAC 5'].forEach((n, i) => run('INSERT INTO rac_stages(name,ord) VALUES(?,?)', n, i + 1));
  run('INSERT INTO rac_stages(name,ord) VALUES(?,?)', 'Pre-Viva', 1000);
}
if (!one('SELECT 1 FROM users')) {
  const id = process.env.ADMIN_ID || 'admin', pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  run('INSERT INTO users(id,name,role,pw_hash) VALUES(?,?,?,?)', id, 'System Administrator', 'admin', bcrypt.hashSync(pw, 12));
  console.log(`First admin created. ID: ${id}  Password: ${pw}  (change at first login)`);
}

function createUser(o, by) { // initial password = ID, must change at first login
  const id = String(o.id ?? '').trim(), name = String(o.name ?? '').trim(), role = String(o.role || 'scholar').trim().toLowerCase();
  if (!ROLES.includes(role)) return 'Invalid role';
  if (!/^[a-z0-9._-]{3,20}$/i.test(id)) return 'Invalid ID (3-20 letters, digits, . _ -)';
  if (!name) return 'Name missing';
  if (one('SELECT 1 FROM users WHERE id=?', id)) return 'Duplicate ID';
  const a = att(o.attendance);
  run('INSERT INTO users(id,name,role,pw_hash,attendance,att_date) VALUES(?,?,?,?,?,?)', id, name, role, bcrypt.hashSync(id, 10), a, a === null ? null : now().slice(0, 10));
  if (role === 'scholar') run('INSERT INTO scholars(user_id) VALUES(?)', id);
  audit(by, 'Account created', id, '', role); return '';
}

const app = express();
if (PROD) app.set('trust proxy', 1);
app.use(helmet()); app.use(express.json({ limit: '100kb' })); app.use(cookieParser());

app.post('/api/login', rateLimit({ windowMs: 15 * 60e3, max: 20, standardHeaders: true }), (req, res) => {
  const { id, password } = req.body || {};
  const u = one('SELECT * FROM users WHERE id=? AND active=1', String(id || ''));
  if (!u || !bcrypt.compareSync(String(password || ''), u.pw_hash)) { audit(String(id || '?').slice(0, 40), 'Failed login'); return res.status(401).json({ error: 'Invalid ID or password' }); }
  res.cookie('t', jwt.sign({ uid: u.id }, SECRET, { expiresIn: '8h' }), { httpOnly: true, sameSite: 'strict', secure: PROD, maxAge: 8 * 3600e3 });
  audit(u.id, 'Login'); res.json(pub(u));
});
app.post('/api/logout', (req, res) => { res.clearCookie('t'); res.json({ ok: 1 }); });

app.use('/api', (req, res, next) => { // authentication + forced first-login password change
  try {
    const u = one('SELECT * FROM users WHERE id=? AND active=1', jwt.verify(req.cookies.t || '', SECRET).uid);
    if (!u) throw 0; req.u = u;
  } catch { return res.status(401).json({ error: 'Login required' }); }
  if (req.u.must_change && !['/me', '/password'].includes(req.path)) return res.status(403).json({ error: 'Change password first', mustChange: true });
  next();
});
const need = (...roles) => (req, res, next) => roles.includes(req.u.role) ? next() : res.status(403).json({ error: 'Forbidden' });

app.get('/api/me', (req, res) => res.json(pub(req.u)));
app.post('/api/password', (req, res) => {
  const { current, next } = req.body || {};
  if (!bcrypt.compareSync(String(current || ''), req.u.pw_hash)) return res.status(400).json({ error: 'Current password wrong' });
  if (String(next || '').length < 8 || String(next).toLowerCase() === req.u.id.toLowerCase()) return res.status(400).json({ error: 'Min 8 characters, not your ID' });
  run('UPDATE users SET pw_hash=?, must_change=0 WHERE id=?', bcrypt.hashSync(String(next), 12), req.u.id);
  audit(req.u.id, 'Password changed'); res.json({ ok: 1 });
});

// ---- Admin: users, bulk import, attendance, RAC stages, audit
app.get('/api/admin/users', need('admin'), (req, res) => res.json(q('SELECT id,name,role,active,must_change,attendance,att_date FROM users ORDER BY role,id')));
app.post('/api/admin/users', need('admin'), (req, res) => { const e = createUser(req.body || {}, req.u.id); e ? res.status(400).json({ error: e }) : res.json({ ok: 1 }); });
const mem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 }, fileFilter: (r, f, cb) => /\.(xlsx|xls|csv)$/i.test(f.originalname) ? cb(null, true) : cb(new Error('Use .xlsx, .xls or .csv')) });
app.post('/api/admin/import', need('admin'), mem.single('file'), (req, res) => { // columns: ID, Name, Role, Attendance
  if (!req.file) return res.status(400).json({ error: 'File missing' });
  const wb = XLSX.read(req.file.buffer, { type: 'buffer' }), rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const key = h => { h = String(h).toLowerCase().replace(/[^a-z0-9]/g, ''); return /^(id|rollno|staffid|loginid|userid)$/.test(h) ? 'id' : /^(name|fullname)$/.test(h) ? 'name' : h === 'role' ? 'role' : /^attendance/.test(h) ? 'attendance' : h; };
  const hd = (rows[0] || []).map(key); let added = 0; const skipped = [];
  db.transaction(() => rows.slice(1).filter(r => r.some(c => String(c).trim())).forEach(r => {
    const o = {}; hd.forEach((h, i) => o[h] = r[i]);
    const e = createUser(o, req.u.id); e ? skipped.push(`${o.id || '?'}: ${e}`) : added++;
  }))();
  audit(req.u.id, 'Bulk import', '', '', `${added} added, ${skipped.length} skipped`); res.json({ added, skipped });
});
app.patch('/api/admin/users/:id', need('admin'), (req, res) => {
  const u = one('SELECT * FROM users WHERE id=?', req.params.id); if (!u) return res.sendStatus(404);
  const { active, attendance } = req.body || {};
  if (active !== undefined) { if (u.id === req.u.id) return res.status(400).json({ error: 'Cannot disable yourself' }); run('UPDATE users SET active=? WHERE id=?', active ? 1 : 0, u.id); audit(req.u.id, 'Account status', u.id, u.active, active ? 1 : 0); }
  if (attendance !== undefined) { const a = att(attendance); run('UPDATE users SET attendance=?, att_date=? WHERE id=?', a, now().slice(0, 10), u.id); audit(req.u.id, 'Attendance updated', u.id, u.attendance, a); }
  res.json({ ok: 1 });
});
app.post('/api/admin/users/:id/reset', need('admin'), (req, res) => { // password back to ID, forced change
  const u = one('SELECT * FROM users WHERE id=?', req.params.id); if (!u) return res.sendStatus(404);
  run('UPDATE users SET pw_hash=?, must_change=1 WHERE id=?', bcrypt.hashSync(u.id, 10), u.id); audit(req.u.id, 'Password reset to ID', u.id); res.json({ ok: 1 });
});
app.get('/api/stages', (req, res) => res.json(q(`SELECT * FROM rac_stages ${req.u.role === 'admin' && req.query.all ? '' : 'WHERE active=1'} ORDER BY ord`)));
app.get('/api/supervisors', (req, res) => res.json(q("SELECT id,name FROM users WHERE role='supervisor' AND active=1 ORDER BY name")));
app.post('/api/admin/stages', need('admin'), (req, res) => {
  const { name, ord, required, description } = req.body || {};
  if (!String(name || '').trim() || !Number.isFinite(+ord)) return res.status(400).json({ error: 'Name and numeric order required' });
  try { run('INSERT INTO rac_stages(name,ord,required,description) VALUES(?,?,?,?)', String(name).trim(), +ord, required === false ? 0 : 1, description || ''); }
  catch { return res.status(400).json({ error: 'Stage name exists' }); }
  audit(req.u.id, 'RAC stage added', name); res.json({ ok: 1 });
});
app.patch('/api/admin/stages/:id', need('admin'), (req, res) => {
  const { active, ord } = req.body || {};
  if (active !== undefined) run('UPDATE rac_stages SET active=? WHERE id=?', active ? 1 : 0, req.params.id);
  if (ord !== undefined && Number.isFinite(+ord)) run('UPDATE rac_stages SET ord=? WHERE id=?', +ord, req.params.id);
  audit(req.u.id, 'RAC stage changed', req.params.id, '', JSON.stringify(req.body)); res.json({ ok: 1 });
});
app.get('/api/audit', need('admin', 'hod'), (req, res) => res.json(q('SELECT * FROM audit ORDER BY id DESC LIMIT 500')));

// ---- Scholar access control: scholar=self only, supervisor=assigned only, hod=all, staff=read-only profile, admin=none
function access(req, sid, full) {
  const s = one('SELECT * FROM scholars WHERE user_id=?', sid), r = req.u.role;
  if (!s) return 404;
  if (r === 'scholar') return req.u.id === sid ? 0 : 403;
  if (r === 'supervisor') return s.supervisor_id === req.u.id ? 0 : 403;
  if (r === 'hod') return 0;
  if (r === 'staff') return full ? 403 : 0;
  return 403;
}
const guard = full => (req, res, next) => { const c = access(req, req.params.sid, full); c ? res.sendStatus(c) : next(); };

app.get('/api/scholars', need('supervisor', 'hod', 'staff'), (req, res) => {
  const t = `%${String(req.query.q || '').trim()}%`, sup = req.u.role === 'supervisor';
  res.json(q(`SELECT u.id roll_no,u.name,u.attendance,s.stage,s.area,sv.name supervisor FROM scholars s JOIN users u ON u.id=s.user_id
    LEFT JOIN users sv ON sv.id=s.supervisor_id WHERE u.active=1 AND (u.id LIKE ? OR u.name LIKE ?) ${sup ? 'AND s.supervisor_id=?' : ''} ORDER BY u.id`, ...(sup ? [t, t, req.u.id] : [t, t])));
});
app.get('/api/scholars/:sid', guard(false), (req, res) => {
  const sid = req.params.sid, p = one('SELECT u.id roll_no,u.name,u.attendance,u.att_date,s.*,(SELECT name FROM users WHERE id=s.supervisor_id) supervisor FROM scholars s JOIN users u ON u.id=s.user_id WHERE s.user_id=?', sid);
  p.rac = q(`SELECT g.id stage_id,g.name,g.required,r.meeting_date,COALESCE(r.status,'Not Scheduled') status,r.verified_by,r.verified_date FROM rac_stages g
    LEFT JOIN rac_records r ON r.stage_id=g.id AND r.scholar_id=? WHERE g.active=1 ORDER BY g.ord`, sid); // new stages appear automatically
  res.json(p);
});
app.patch('/api/scholars/:sid', guard(true), need('scholar'), (req, res) => { // scholar fills own details
  const b = req.body || {}, s = one('SELECT * FROM scholars WHERE user_id=?', req.u.id);
  if (b.supervisor_id && !one("SELECT 1 FROM users WHERE id=? AND role='supervisor' AND active=1", b.supervisor_id)) return res.status(400).json({ error: 'Unknown supervisor' });
  if (b.stage && !STAGES.includes(b.stage)) return res.status(400).json({ error: 'Bad stage' });
  for (const k of ['reg_date', 'exp_date']) if (b[k] && !DATE.test(b[k])) return res.status(400).json({ error: 'Date format YYYY-MM-DD' });
  run('UPDATE scholars SET title=?,area=?,supervisor_id=?,reg_date=?,exp_date=?,stage=? WHERE user_id=?', String(b.title ?? s.title).slice(0, 300), String(b.area ?? s.area).slice(0, 120),
    b.supervisor_id ?? s.supervisor_id, b.reg_date ?? s.reg_date, b.exp_date ?? s.exp_date, b.stage ?? s.stage, req.u.id);
  audit(req.u.id, 'Profile updated', req.u.id); res.json({ ok: 1 });
});

app.patch('/api/scholars/:sid/rac/:stage', guard(true), (req, res) => {
  const { sid, stage } = req.params, { date, status } = req.body || {}, g = one('SELECT * FROM rac_stages WHERE id=?', stage);
  if (!g) return res.sendStatus(404);
  const cur = one('SELECT * FROM rac_records WHERE scholar_id=? AND stage_id=?', sid, stage) || { meeting_date: '', status: 'Not Scheduled' };
  if (status !== undefined && (!REV.includes(req.u.role) || !STATUSES.includes(status))) return res.status(403).json({ error: 'Only supervisor/HOD can set status' });
  if (date !== undefined && date !== '' && !DATE.test(date)) return res.status(400).json({ error: 'Date format YYYY-MM-DD' });
  if (date !== undefined && req.u.role === 'scholar' && cur.status === 'Verified') return res.status(403).json({ error: 'Verified record is locked' });
  const ns = status ?? cur.status, nd = date ?? cur.meeting_date, ver = ns === 'Verified' && cur.status !== 'Verified';
  run(`INSERT INTO rac_records(scholar_id,stage_id,meeting_date,status,verified_by,verified_date) VALUES(?,?,?,?,?,?)
    ON CONFLICT(scholar_id,stage_id) DO UPDATE SET meeting_date=excluded.meeting_date,status=excluded.status,
    verified_by=COALESCE(excluded.verified_by,verified_by),verified_date=COALESCE(excluded.verified_date,verified_date)`, sid, stage, nd, ns, ver ? req.u.name : null, ver ? now().slice(0, 10) : null);
  audit(req.u.id, `${g.name} updated`, sid, `${cur.status} ${cur.meeting_date}`, `${ns} ${nd}`); hist(req.u.name, sid, g.name, 'RAC record updated', status ? 'Status ' + ns : 'Date ' + nd, ns);
  res.json({ ok: 1 });
});

const store = multer({ // access-controlled uploads, random names, outside web root
  storage: multer.diskStorage({ destination: UP, filename: (r, f, cb) => cb(null, crypto.randomBytes(16).toString('hex')) }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (r, f, cb) => /\.(pdf|docx?|jpe?g|png)$/i.test(f.originalname) ? cb(null, true) : cb(new Error('Allowed: PDF, DOC, DOCX, JPG, PNG'))
});
app.post('/api/scholars/:sid/rac/:stage/documents', guard(true), (req, res, next) => store.single('file')(req, res, e => e ? next(e) : next()), (req, res) => {
  const { sid, stage } = req.params, kind = KINDS.includes(req.body.kind) ? req.body.kind : 'Additional Document', g = one('SELECT * FROM rac_stages WHERE id=?', stage);
  if (!req.file || !g) { if (req.file) fs.unlinkSync(req.file.path); return res.status(400).json({ error: 'File or stage invalid' }); }
  run('INSERT INTO documents(scholar_id,stage_id,kind,orig_name,stored_name,uploaded_by,uploaded_at) VALUES(?,?,?,?,?,?,?)', sid, stage, kind, req.file.originalname.slice(0, 200), req.file.filename, req.u.id, now());
  if (req.u.role === 'scholar') run(`INSERT INTO rac_records(scholar_id,stage_id,status) VALUES(?,?,'Report Submitted') ON CONFLICT(scholar_id,stage_id) DO UPDATE SET status=CASE WHEN status IN ('Verified') THEN status ELSE 'Report Submitted' END`, sid, stage);
  run("UPDATE remarks SET status='Responded' WHERE scholar_id=? AND stage_id=? AND status='Open'", sid, stage);
  audit(req.u.id, `${kind} uploaded`, sid, '', req.file.originalname); hist(req.u.name, sid, g.name, kind, 'Document uploaded', 'Under Review'); res.json({ ok: 1 });
});
app.get('/api/scholars/:sid/documents', guard(true), (req, res) => res.json(q('SELECT d.id,g.name stage,d.kind,d.orig_name,d.uploaded_by,d.uploaded_at,d.status,d.verified_by,d.verified_at FROM documents d JOIN rac_stages g ON g.id=d.stage_id WHERE scholar_id=? ORDER BY d.id DESC', req.params.sid)));
app.get('/api/documents/:id', (req, res) => {
  const d = one('SELECT * FROM documents WHERE id=?', req.params.id); if (!d) return res.sendStatus(404);
  const c = access(req, d.scholar_id, true); if (c) return res.sendStatus(c);
  res.download(path.join(UP, d.stored_name), d.orig_name);
});
app.post('/api/documents/:id/verify', need(...REV), (req, res) => {
  const d = one('SELECT * FROM documents WHERE id=?', req.params.id); if (!d) return res.sendStatus(404);
  const c = access(req, d.scholar_id, true); if (c) return res.sendStatus(c);
  run("UPDATE documents SET status='Verified',verified_by=?,verified_at=? WHERE id=?", req.u.name, now(), d.id); audit(req.u.id, 'Document verified', d.scholar_id, d.status, 'Verified'); res.json({ ok: 1 });
});

// ---- Remarks workflow: reviewer sends -> scholar responds/uploads -> reviewer resolves or requests correction. Never deleted.
app.post('/api/remarks', need(...REV), (req, res) => {
  const b = req.body || {}, c = access(req, b.scholar_id, true); if (c) return res.sendStatus(c);
  const g = one('SELECT * FROM rac_stages WHERE id=?', b.stage_id); if (!String(b.text || '').trim() || !g) return res.status(400).json({ error: 'Stage and remark required' });
  if (b.deadline && !DATE.test(b.deadline)) return res.status(400).json({ error: 'Date format YYYY-MM-DD' });
  const r = run('INSERT INTO remarks(scholar_id,stage_id,type,text,action,deadline,priority,by_user,created_at) VALUES(?,?,?,?,?,?,?,?,?)', b.scholar_id, g.id, b.type || 'General', String(b.text).slice(0, 2000), b.action || '', b.deadline || '', ['Low', 'Medium', 'High', 'Urgent'].includes(b.priority) ? b.priority : 'Medium', req.u.name, now());
  audit(req.u.id, 'Remark added', b.scholar_id, '', g.name); hist(req.u.name, b.scholar_id, g.name, b.text, 'Remark sent', 'Open'); res.json({ id: r.lastInsertRowid });
});
app.get('/api/remarks', need('scholar', ...REV), (req, res) => {
  const r = req.u.role, base = 'SELECT m.*,g.name stage FROM remarks m JOIN rac_stages g ON g.id=m.stage_id';
  const rows = r === 'scholar' ? q(base + ' WHERE m.scholar_id=? ORDER BY m.id DESC', req.u.id) : r === 'hod' ? q(base + ' ORDER BY m.id DESC') :
    q(base + ' JOIN scholars s ON s.user_id=m.scholar_id WHERE s.supervisor_id=? ORDER BY m.id DESC', req.u.id);
  rows.forEach(m => m.responses = q('SELECT text,by_user,at FROM remark_responses WHERE remark_id=?', m.id)); res.json(rows);
});
app.post('/api/remarks/:id/respond', need('scholar'), (req, res) => {
  const m = one('SELECT * FROM remarks WHERE id=? AND scholar_id=?', req.params.id, req.u.id); if (!m || !String(req.body?.text || '').trim()) return res.sendStatus(400);
  run('INSERT INTO remark_responses(remark_id,text,by_user,at) VALUES(?,?,?,?)', m.id, String(req.body.text).slice(0, 2000), req.u.name, now()); run("UPDATE remarks SET status='Responded' WHERE id=?", m.id);
  hist(req.u.name, m.scholar_id, String(m.stage_id), m.text, 'Scholar responded', 'Responded'); audit(req.u.id, 'Remark response', m.scholar_id); res.json({ ok: 1 });
});
app.post('/api/remarks/:id/close', need(...REV), (req, res) => {
  const m = one('SELECT * FROM remarks WHERE id=?', req.params.id); if (!m) return res.sendStatus(404);
  const c = access(req, m.scholar_id, true); if (c) return res.sendStatus(c);
  const st = req.body?.status === 'Resolved' ? 'Resolved' : 'Open'; run('UPDATE remarks SET status=? WHERE id=?', st, m.id);
  hist(req.u.name, m.scholar_id, String(m.stage_id), m.text, st === 'Resolved' ? 'Verified by reviewer' : 'Correction required', st); audit(req.u.id, 'Remark status', m.scholar_id, m.status, st); res.json({ ok: 1 });
});
app.get('/api/history', need('scholar', ...REV), (req, res) => {
  const r = req.u.role; res.json(r === 'scholar' ? q('SELECT * FROM history WHERE scholar_id=? ORDER BY id DESC', req.u.id) : r === 'hod' ? q('SELECT * FROM history ORDER BY id DESC LIMIT 1000') :
    q('SELECT h.* FROM history h JOIN scholars s ON s.user_id=h.scholar_id WHERE s.supervisor_id=? ORDER BY h.id DESC', req.u.id));
});

// ---- Progress and publications (scholar writes own; reviewers read)
app.post('/api/progress', need('scholar'), (req, res) => { const b = req.body || {}; run('INSERT INTO progress(scholar_id,at,kind,work,plan) VALUES(?,?,?,?,?)', req.u.id, now().slice(0, 10), ['Monthly', 'Semester', 'Annual'].includes(b.kind) ? b.kind : 'Monthly', String(b.work || '').slice(0, 3000), String(b.plan || '').slice(0, 3000)); audit(req.u.id, 'Progress submitted'); res.json({ ok: 1 }); });
app.get('/api/scholars/:sid/progress', guard(true), (req, res) => res.json(q('SELECT * FROM progress WHERE scholar_id=? ORDER BY id DESC', req.params.sid)));
app.post('/api/publications', need('scholar'), (req, res) => { const b = req.body || {}; if (!String(b.title || '').trim()) return res.sendStatus(400); run('INSERT INTO publications(scholar_id,title,journal,status) VALUES(?,?,?,?)', req.u.id, String(b.title).slice(0, 300), String(b.journal || '').slice(0, 200), ['Published', 'Accepted', 'Under Review', 'Submitted', 'In Preparation'].includes(b.status) ? b.status : 'In Preparation'); res.json({ ok: 1 }); });
app.get('/api/scholars/:sid/publications', guard(true), (req, res) => res.json(q('SELECT * FROM publications WHERE scholar_id=?', req.params.sid)));

// ---- Department report (JSON or CSV for Excel)
app.get('/api/reports/department', need(...REV), (req, res) => {
  const stages = q('SELECT * FROM rac_stages WHERE active=1 ORDER BY ord'), sup = req.u.role === 'supervisor';
  const sch = q(`SELECT u.id,u.name,u.attendance,s.stage FROM scholars s JOIN users u ON u.id=s.user_id WHERE u.active=1 ${sup ? 'AND s.supervisor_id=?' : ''} ORDER BY u.id`, ...(sup ? [req.u.id] : []));
  const rows = sch.map(s => ({ ...s, rac: Object.fromEntries(stages.map(g => [g.name, (one('SELECT status FROM rac_records WHERE scholar_id=? AND stage_id=?', s.id, g.id) || { status: 'Not Scheduled' }).status])) }));
  if (req.query.format !== 'csv') return res.json({ stages: stages.map(g => g.name), rows });
  const safe = v => { v = String(v ?? ''); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return `"${v.replace(/"/g, '""')}"`; }; // blocks CSV formula injection
  res.type('text/csv').attachment('department-report.csv').send([['Roll No', 'Name', 'Stage', 'Attendance', ...stages.map(g => g.name)], ...rows.map(r => [r.id, r.name, r.stage, r.attendance, ...stages.map(g => r.rac[g.name])])].map(r => r.map(safe).join(',')).join('\n'));
});

app.use(express.static(path.join(__dirname, 'public'))); // put the web front end in ./public
app.use((e, req, res, next) => res.status(e.status || 400).json({ error: e.message || 'Error' }));
app.listen(PORT, () => console.log(`RAC portal API on :${PORT}`));
