# HL Manufacturing — Production Tracker

Web-based production tracking system for HL Manufacturing. Built with Node.js + Express backend and vanilla HTML/CSS/JS frontend. No framework.

## Running the app

```bash
cd production-tracker
npm install
node src/server.js
# Opens at http://localhost:3000
```

## File structure

```
production-tracker/
  src/
    server.js       # Express API — all REST endpoints
    db.js           # SQLite database setup and schema
  public/
    index.html      # Single-page app shell, sidebar nav
    css/style.css   # All styles
    js/
      api.js        # API.get / API.post / API.put / API.delete helpers
      app.js        # Page router, today() helper, effClass() helper
      dashboard.js  # Dashboard page
      log.js        # Log Production page
      history.js    # History page
      reports.js    # Reports page with CSV export
      setup.js      # Customers & Parts, Employees, Scrap Reasons pages
  db/
    production.db   # SQLite database file (created on first run)
```

## Tech stack

- **Backend:** Node.js, Express, `better-sqlite3` (synchronous SQLite)
- **Frontend:** Vanilla JS, no framework, no build step
- **Database:** SQLite via `better-sqlite3` — writes directly to `db/production.db`
- **Styles:** Custom CSS, sidebar layout, cards, badges

## Database schema

```sql
customers       id, name (UNIQUE), created_at
parts           id, customer_id, part_number, description, target_rate  -- UNIQUE(customer_id, part_number)
employees       id, name (UNIQUE), employee_id, active (0/1), created_at
scrap_reasons   id, reason (UNIQUE)
production_logs id, date, shift, employee_id, part_id, qty_produced, qty_scrap, hours_run, notes, created_at
scrap_log       id, production_log_id, scrap_reason_id, qty
```

Default scrap reasons seeded on startup: Dimensional, Surface Finish, Wrong Material, Operator Error, Tooling Issue, Machine Issue, Burr/Sharp Edge, Other.

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/customers | All customers |
| POST | /api/customers | Add customer |
| PUT | /api/customers/:id | Rename customer |
| DELETE | /api/customers/:id | Delete customer + cascade |
| POST | /api/customers/bulk | Bulk add customers |
| GET | /api/parts | All parts (optional ?customer_id=) |
| POST | /api/parts | Add part |
| PUT | /api/parts/:id | Edit part |
| DELETE | /api/parts/:id | Delete part + cascade |
| POST | /api/parts/bulk | Bulk add parts |
| GET | /api/employees | Active employees (add ?include_inactive=1 for all) |
| POST | /api/employees | Add employee |
| PUT | /api/employees/:id | Edit employee or toggle active |
| DELETE | /api/employees/:id | Delete employee |
| POST | /api/employees/bulk | Bulk add employees |
| GET | /api/scrap-reasons | All scrap reasons |
| POST | /api/scrap-reasons | Add scrap reason |
| GET | /api/production | Production logs (filters: date_from, date_to, employee_id, part_id, customer_id) |
| POST | /api/production | Log production entry |
| DELETE | /api/production/:id | Delete production log + scrap detail |
| GET | /api/reports/summary | Summary report (date_from, date_to) |

## Key implementation details

### Cascade deletes
Deleting a customer, part, or production log cascades manually in transactions:
- Customer delete → deletes scrap_log, production_logs, parts for that customer
- Part delete → deletes scrap_log, production_logs for that part
- Production log delete → deletes scrap_log entries

SQLite foreign key constraints are enforced — do NOT delete parent records directly in DB Browser without deleting children first.

### Edit modals
`showModal({ title, fields, onSave })` in `setup.js` — reusable modal overlay. Supports field types: `text`, `number`, `select`. Call `onSave(values)` which should return a promise; returning an error string shows it inline.

### Bulk import (parts)
Bulk parts import in `setup.js` auto-creates missing customers — if a customer name in the import doesn't exist yet, it is inserted before the part.

### Employee active/inactive
`PUT /api/employees/:id` with `{ active: 0|1 }` toggles status. With `{ name, employee_id }` renames. The Employees page has a "Show Inactive" toggle that includes deactivated employees with a Reactivate button.

### CSV export
Reports page has "Export Production CSV" and "Export Scrap CSV" buttons that appear after running a report. Files are named `production-report-YYYY-MM-DD-YYYY-MM-DD.csv` etc. No server involvement — pure client-side Blob download.

### DB Browser for SQLite
You can open `db/production.db` in DB Browser for SQLite. The server can be running while you browse read-only, but stop the server before writing changes from DB Browser, otherwise the app will overwrite them on the next write operation.

## GitHub

Code is stored in `tharig327/production-tracker`. Development branch for Claude Code sessions: `claude/production-tracking-system-kiof7p`. Open PR: #8.

When pushing via GitHub MCP tools (when direct git push is blocked by session proxy), use `mcp__github__push_files` targeting `tharig327/hl-log` or `tharig327/production-tracker`.
