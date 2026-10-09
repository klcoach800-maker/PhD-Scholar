# RAC Portal Backend
PhD Scholar Academic Monitoring & RAC Management System. Designed by Hashim Veeran A.
Node 20+, Express, SQLite. One server, one database file, uploads on disk.

## Run
```
npm install
cp .env.example .env        # set JWT_SECRET (openssl rand -hex 32), ADMIN_PASSWORD
export $(grep -v '^#' .env | xargs)
npm start                   # first start prints admin ID and password if ADMIN_PASSWORD empty
```
Put the web front end files in `./public`.

## Rules built in
- Login ID = roll no / staff ID. First password = same ID. Every API call except /me, /password is blocked until it is changed (min 8, not the ID).
- Passwords: bcrypt. Session: httpOnly, SameSite=Strict, Secure cookie (production), 8 h. Login rate limit. Failed logins audited.
- Scholar sees only self. Supervisor sees only scholars who chose them. HOD sees all. Staff: list, profile, attendance only, read-only. Admin: users, attendance, RAC stages, audit; no scholar research data.
- Only supervisor/HOD change RAC status. Verified RAC date locks for scholar.
- Uploads: PDF, DOC, DOCX, JPG, PNG, 10 MB, random file names, stored outside web root, download checks access.
- `history` and `audit` tables are append-only (DB triggers block UPDATE/DELETE).
- RAC stages are data. Admin adds RAC 6, 7, 8: appears for every scholar automatically.
- CSV report escapes formula injection.

## Main API
| Who | Call |
|---|---|
| all | POST /api/login, /api/logout, /api/password, GET /api/me, /api/stages |
| admin | POST /api/admin/users, POST /api/admin/import (xlsx/csv: ID, Name, Role, Attendance), PATCH /api/admin/users/:id {active, attendance}, POST /api/admin/users/:id/reset, POST /api/admin/stages, PATCH /api/admin/stages/:id |
| admin, hod | GET /api/audit |
| supervisor, hod, staff | GET /api/scholars?q=rollno-or-name, GET /api/scholars/:sid |
| scholar | PATCH /api/scholars/:sid (own profile), POST /api/progress, /api/publications, /api/remarks/:id/respond |
| scholar, reviewer | PATCH /api/scholars/:sid/rac/:stage, POST .../documents (multipart: file, kind), GET /api/documents/:id, GET /api/remarks, /api/history |
| supervisor, hod | POST /api/remarks, POST /api/remarks/:id/close {status}, POST /api/documents/:id/verify, GET /api/reports/department?format=csv |

## Deploy checklist
1. HTTPS only: nginx or Caddy in front, proxy to port 3000, NODE_ENV=production.
2. Daily backup of DATA_DIR: `sqlite3 data/rac.db ".backup /backups/rac-$(date +%F).db"` plus copy `data/uploads`.
3. Run under systemd or pm2. Keep Node and packages updated (`npm audit`).
4. Server on a university network or VPS you control. Check university data-protection rules before loading real scholar data.
5. Have your IT team review before go-live. Not yet penetration tested.

## Front end
Ready in `public/` (index.html, app.js, style.css). Served by the same server, same origin, so the session cookie works. No inline scripts, so the strict helmet CSP stays on. Open http://localhost:3000 after `npm start`.
Screens: login, forced password change, scholar (dashboard, My Profile, RAC with uploads, remarks, progress, publications, documents, history), supervisor/HOD (overview, scholars, remarks, reports, history, audit), staff (scholar list, read-only profile), admin (users, Excel import, attendance, RAC stages, audit).
Not tested against a running server in the build environment. Test every role before go-live.
