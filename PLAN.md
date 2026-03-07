# ProspectiveStay - Implementation Plan

A reservation management system for staying at "PPW". Users can create, manage, and view reservations. Admins can accept, reject, or modify reservations. Authentication is passwordless via email magic links.

---

## 1. Tech Stack

| Layer | Technology | Reason |
|-------|-----------|--------|
| Backend | Node.js + Express | Simple, well-supported, fast to build |
| Database | SQLite via `better-sqlite3` | No separate server, single file, perfect for this scale |
| Frontend | React 18 + Vite | Fast dev experience, modern tooling |
| Styling | CSS Modules (plain CSS) | No extra dependencies, scoped styles |
| Email | Console-based simulation | Logs magic link to server console for dev/demo |
| Session | `cookie` + `crypto.randomUUID()` | Simple httpOnly cookie-based sessions |
| Package Manager | npm | Standard, no extra setup |

---

## 2. File Structure

```
ProspectiveStay/
├── package.json              # Root package.json with convenience scripts
├── PLAN.md
│
├── server/
│   ├── package.json
│   ├── index.js              # Express app entry point, starts server
│   ├── db.js                 # SQLite connection + schema initialization
│   ├── middleware/
│   │   └── auth.js           # requireAuth, requireAdmin middleware
│   ├── routes/
│   │   ├── auth.js           # /api/auth/* routes
│   │   ├── reservations.js   # /api/reservations/* routes
│   │   └── admin.js          # /api/admin/* routes
│   └── seed.js               # Optional: seed admin user + sample data
│
├── client/
│   ├── package.json
│   ├── index.html
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx          # React entry point
│       ├── App.jsx           # Root component with tab navigation
│       ├── App.module.css
│       ├── api.js            # Fetch wrapper for API calls
│       ├── context/
│       │   └── AuthContext.jsx  # Auth state provider
│       ├── components/
│       │   ├── LoginTab.jsx
│       │   ├── LoginTab.module.css
│       │   ├── ManageReservationTab.jsx
│       │   ├── ManageReservationTab.module.css
│       │   ├── ViewReservationsTab.jsx
│       │   ├── ViewReservationsTab.module.css
│       │   ├── CalendarViewTab.jsx
│       │   ├── CalendarViewTab.module.css
│       │   ├── AdminTab.jsx
│       │   └── AdminTab.module.css
│       └── index.css         # Global styles
```

---

## 3. Database Schema

All tables created in `server/db.js` on startup using `better-sqlite3` synchronous API.

**Important**: `db.js` must run `PRAGMA foreign_keys = ON;` immediately after opening the connection. SQLite does NOT enforce foreign keys by default.

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS login_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  size_of_party INTEGER NOT NULL DEFAULT 1,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  CHECK (status IN ('Pending', 'Accepted', 'Cancelled', 'Rejected', 'Completed')),
  CHECK (end_date >= start_date),
  CHECK (size_of_party >= 1)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  user_email TEXT NOT NULL,
  action TEXT NOT NULL,
  changes_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### Indexes

```sql
CREATE INDEX IF NOT EXISTS idx_reservations_user_id ON reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_reservations_dates ON reservations(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_audit_log_reservation_id ON audit_log(reservation_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_login_tokens_user_id ON login_tokens(user_id);
```

### Important Schema Notes

- **`updated_at` is NOT auto-updated by SQLite.** Every UPDATE statement must explicitly set `updated_at = datetime('now')`.
- **`audit_log` is append-only.** Application code must NEVER issue UPDATE or DELETE on this table. Only INSERT.
- **`audit_log.user_email` is denormalized** to preserve the actor's email even if users are modified later.
- **Users are never deleted** from the system to preserve audit trail integrity.

### Seed Data (server/seed.js)

Insert an admin user on first run:
```js
// email: admin@ppw.com, is_admin: 1, name: 'Admin'
// Uses INSERT OR IGNORE to be idempotent
```

---

## 4. Authentication Flow

### Design Decisions

- **Open registration**: Any email can create an account automatically. This is intentional for this application. If restricted access is needed later, an admin-managed allowlist can be added.
- **CSRF protection**: Since the API uses JSON `Content-Type` headers, browsers enforce CORS preflight for cross-origin requests. Combined with `SameSite=Lax` cookies, this prevents CSRF attacks. No additional CSRF tokens are needed.

### Step-by-step:

1. **User enters email** on LoginTab and clicks "Send Login Link"
2. **Backend** (`POST /api/auth/request-login`):
   - Rate limited: max 3 requests per email per 5 minutes (tracked via login_tokens table - count recent tokens for that email)
   - Looks up or creates user by email (auto-registration)
   - **Invalidates all previous unused login tokens** for this user (sets `used = 1`)
   - Generates a random 6-digit code using `crypto.randomInt(100000, 999999)` (cryptographically secure)
   - Generates a UUID token using `crypto.randomUUID()`
   - Stores both in `login_tokens` with 15-minute expiry, `failed_attempts = 0`
   - Logs the magic link to console: `[MAGIC LINK] http://localhost:5173/?token=<uuid>`
   - Also logs the 6-digit code: `[LOGIN CODE] 123456 for user@example.com`
   - Returns `{ success: true, message: "Check your email for a login link" }`
3. **User clicks link** (auto-fills token) OR **enters 6-digit code** manually
4. **Backend** (`POST /api/auth/verify`):
   - Accepts either `{ token }` (UUID from link) or `{ email, code }` (6-digit code)
   - **Brute-force protection**: Each failed verification increments `failed_attempts` on the token. After 5 failed attempts, the token is invalidated (marked as used). This limits an attacker to 5 guesses per token.
   - Validates token/code exists, not expired, not used, `failed_attempts < 5`
   - On failure: increment `failed_attempts`, return error
   - On success: marks login_token as used, creates a session with 7-day expiry
   - Sets `session_token` as httpOnly cookie
   - Cookie settings: `httpOnly: true, sameSite: 'lax', path: '/', maxAge: 7 * 24 * 60 * 60 * 1000, secure: process.env.NODE_ENV === 'production'`
   - Returns `{ success: true, user: { id, email, name, is_admin } }`
5. **Subsequent requests**: `requireAuth` middleware reads `session_token` cookie, looks up session, attaches `req.user`
6. **Logout** (`POST /api/auth/logout`): Deletes session from DB, clears cookie

### Token/Session Cleanup

On server startup and every 60 minutes (via `setInterval`), run:
```sql
DELETE FROM login_tokens WHERE expires_at < datetime('now');
DELETE FROM sessions WHERE expires_at < datetime('now');
```

### Admin detection:
- `is_admin` flag on `users` table
- `requireAdmin` middleware checks `req.user.is_admin === 1`
- Seed script creates the initial admin user

---

## 5. API Routes

All routes prefixed with `/api`. Request/response bodies are JSON.

### 5.1 Auth Routes (`server/routes/auth.js`)

#### `POST /api/auth/request-login`
- **Body**: `{ "email": "user@example.com" }`
- **Validation**: email is required and must be a valid email format
- **Rate limit**: Max 3 requests per email per 5 minutes (count recent login_tokens for user). Return `429` if exceeded.
- **Action**: Create user if not exists, invalidate previous tokens for this user, generate new login token + code, log to console
- **Response**: `{ "success": true, "message": "Login link sent to your email" }`
- **Errors**: `400` if email missing/invalid, `429` if rate limited

#### `POST /api/auth/verify`
- **Body (option A - magic link)**: `{ "token": "uuid-string" }`
- **Body (option B - code)**: `{ "email": "user@example.com", "code": "123456" }`
- **Brute-force protection**: Max 5 failed attempts per token, then token is invalidated
- **Action**: Verify token/code, mark as used, create session, set cookie
- **Response**: `{ "success": true, "user": { "id": 1, "email": "user@example.com", "name": "", "is_admin": false } }`
- **Errors**: `400` if invalid/expired/used token, `429` if too many failed attempts

#### `POST /api/auth/logout`
- **Auth**: Required
- **Action**: Delete session from DB, clear cookie
- **Response**: `{ "success": true }`

#### `GET /api/auth/me`
- **Auth**: Required
- **Action**: Return current user from session
- **Response**: `{ "user": { "id": 1, "email": "user@example.com", "name": "John", "is_admin": false } }`
- **Errors**: `401` if not authenticated

#### `PUT /api/auth/profile`
- **Auth**: Required
- **Body**: `{ "name": "John Doe" }`
- **Validation**: `name` must be a non-empty string, max 100 characters
- **Action**: Update current user's name, set updated_at
- **Response**: `{ "user": { "id": 1, "email": "user@example.com", "name": "John Doe", "is_admin": false } }`
- **Errors**: `400` if validation fails

### 5.2 Reservation Routes (`server/routes/reservations.js`)

#### `GET /api/reservations`
- **Auth**: Required
- **Action**: List current user's reservations, ordered by start_date DESC
- **Response**: `{ "reservations": [ { "id": 1, "name": "...", "size_of_party": 2, "start_date": "2026-03-15", "end_date": "2026-03-20", "status": "Pending", "notes": "...", "created_at": "...", "updated_at": "..." } ] }`

#### `POST /api/reservations`
- **Auth**: Required
- **Body**: `{ "name": "Family Visit", "size_of_party": 4, "start_date": "2026-03-15", "end_date": "2026-03-20", "notes": "Arriving late" }`
- **Validation**:
  - `name` required, non-empty string
  - `size_of_party` required, integer >= 1
  - `start_date` required, valid date string (YYYY-MM-DD), must be today or later
  - `end_date` required, valid date string, must be >= start_date
  - `notes` optional, defaults to empty string
- **Action**: Insert reservation with status "Pending", log to audit_log (action: "created", changes_json contains all initial field values: `{ "name": "Family Visit", "size_of_party": 4, "start_date": "2026-03-15", "end_date": "2026-03-20", "notes": "Arriving late", "status": "Pending" }`)
- **Response**: `{ "reservation": { ...full reservation object } }`
- **Errors**: `400` with validation error messages

#### `PUT /api/reservations/:id`
- **Auth**: Required (owner only)
- **Body**: `{ "name": "...", "size_of_party": 3, "start_date": "...", "end_date": "...", "notes": "..." }`
- **Validation**: Same field validation as create. User can only edit their own reservations. Cannot edit if status is "Cancelled", "Rejected", or "Completed".
- **Status reset**: If the reservation was "Accepted" and the user modifies it, the status is automatically reset to "Pending" (requires re-approval by admin).
- **Action**: Update fields, set `updated_at = datetime('now')`, log to audit_log (action: "updated", changes_json records `{ "field": { "old": "val1", "new": "val2" } }` for each changed field, including the status reset if applicable)
- **Response**: `{ "reservation": { ...updated reservation } }`
- **Errors**: `403` if not owner, `400` if validation fails or status is Cancelled/Rejected/Completed, `404` if not found

#### `DELETE /api/reservations/:id`
- **Auth**: Required (owner only)
- **Action**: Sets status to "Cancelled" (soft delete), logs to audit_log (action: "cancelled")
- **Restriction**: Cannot cancel if status is already "Cancelled", "Rejected", or "Completed"
- **Response**: `{ "reservation": { ...updated reservation with status "Cancelled" } }`
- **Errors**: `403` if not owner, `404` if not found, `400` if status is Cancelled, Rejected, or Completed

#### `GET /api/reservations/calendar`
- **Auth**: Required
- **Query params**: `?month=3&year=2026` (both required)
- **Privacy**: Returns ALL non-cancelled/rejected reservations visible to all logged-in users (this is a shared calendar for PPW). Only includes: id, name (reservation name, not user info), start_date, end_date, status, size_of_party. User email is NOT exposed to non-admin users.
- **Logic**: A reservation overlaps a month if `start_date <= last_day_of_month AND end_date >= first_day_of_month`
- **Response**: `{ "reservations": [ { "id": 1, "name": "...", "start_date": "...", "end_date": "...", "status": "...", "size_of_party": 2 } ], "month": 3, "year": 2026 }`

#### `GET /api/reservations/:id/audit`
- **Auth**: Required (owner or admin)
- **Action**: Return audit trail for a specific reservation
- **Response**: `{ "audit": [ { "id": 1, "action": "created", "changes_json": "{...}", "user_email": "user@example.com", "created_at": "..." } ] }`
- **Errors**: `403` if not owner or admin, `404` if reservation not found

### 5.3 Admin Routes (`server/routes/admin.js`)

#### `GET /api/admin/reservations`
- **Auth**: Admin required
- **Query params**: `?status=Pending` (optional filter)
- **Action**: List all reservations with user email, ordered by created_at DESC
- **Response**: `{ "reservations": [ { ...reservation, "user_email": "user@example.com" } ] }`

#### `PUT /api/admin/reservations/:id`
- **Auth**: Admin required
- **Body**: `{ "status": "Accepted", "notes": "admin note" }` (any combination of: status, name, size_of_party, start_date, end_date, notes)
- **Validation**: If status provided, must be one of the valid status values. Same field validations apply for dates and size_of_party.
- **Overlap warning**: When accepting a reservation, check for existing Accepted reservations with overlapping dates. If found, include a `warning` field in the response: `{ "reservation": {...}, "warning": "Overlaps with 2 other accepted reservations" }`. The accept still goes through (admin decides).
- **Action**: Update reservation, set `updated_at = datetime('now')`, log to audit_log (action: "admin_updated", changes_json records old vs new values)
- **Notifications**: Log to console: `[NOTIFICATION] Reservation #<id> by <email> has been <status> by admin` (simulates email notification to user)
- **Response**: `{ "reservation": { ...updated reservation }, "warning": "..." (optional) }`
- **Errors**: `404` if not found, `400` if validation fails

---

## 6. Middleware (`server/middleware/auth.js`)

### `requireAuth(req, res, next)`
1. Read `session_token` from `req.cookies`
2. Look up session in DB where token matches and `expires_at > datetime('now')`
3. If not found: return `401 { error: "Not authenticated" }`
4. Look up user by `session.user_id`
5. Attach `req.user = { id, email, name, is_admin }` and call `next()`

### `requireAdmin(req, res, next)`
1. Call `requireAuth` first
2. If `req.user.is_admin !== 1`: return `403 { error: "Admin access required" }`
3. Otherwise call `next()`

---

## 7. Frontend Components

### 7.1 App.jsx - Root Component
- Uses `AuthContext` to track logged-in user
- On mount: calls `GET /api/auth/me` to restore session from cookie
- **On mount**: checks `window.location.search` for `?token=...` param (magic link). If present, auto-verifies via `POST /api/auth/verify`, then clears the URL with `window.history.replaceState({}, '', '/')`
- **Loading state**: While initial auth check is in flight, shows a centered loading spinner (not the login form)
- If not logged in: shows only LoginTab
- If logged in: shows tab navigation bar with tabs:
  - "Manage Reservations" (default)
  - "View Reservations"
  - "Calendar"
  - "Admin" (only visible if `user.is_admin`)
- Shows user email, user name, and "Logout" button in header when logged in
- Tab state managed via `useState` (no router needed - single page with tabs)

### 7.2 AuthContext.jsx
- Provides: `{ user, setUser, loading, logout }`
- `loading` is true while initial `/api/auth/me` call is in flight
- `logout()` calls `POST /api/auth/logout` then sets user to null

### 7.3 api.js - Fetch Wrapper
```js
// Base wrapper that handles JSON and credentials
async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    credentials: 'include',  // send cookies
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
export const api = {
  get: (path) => apiFetch(path),
  post: (path, body) => apiFetch(path, { method: 'POST', body }),
  put: (path, body) => apiFetch(path, { method: 'PUT', body }),
  delete: (path) => apiFetch(path, { method: 'DELETE' }),
};
```

**401 handling**: All components that call the API should catch errors. If `err.status === 401`, call `logout()` from AuthContext to clear state and show the login form. This handles session expiry during use.

### 7.4 LoginTab.jsx
- **State**: `email`, `codeSent`, `code`, `error`, `loading`
- **Step 1**: Email input + "Send Login Link" button
  - Calls `POST /api/auth/request-login` with email
  - On success: set `codeSent = true`
- **Step 2**: Shows "Enter the 6-digit code from the server console" + code input + "Verify" button
  - Calls `POST /api/auth/verify` with `{ email, code }`
  - On success: update AuthContext user, tab switches to Manage Reservations
- Shows error messages for invalid email, expired code, rate limit exceeded, etc.
- **Name prompt**: After first login (when user.name is empty), show a simple inline prompt "What's your name?" with a text input, calling `PUT /api/auth/profile` to save it.

### 7.5 ManageReservationTab.jsx
- **Two sections**:
  1. **Reservation Form** (create or edit mode):
     - Fields: Name (text), Size of Party (number), Start Date (date picker), End Date (date picker), Notes (textarea)
     - "Create Reservation" or "Save Changes" button depending on mode
     - "Cancel Edit" button when in edit mode
     - Validation: all required fields, end >= start, size >= 1, start date >= today (for new reservations)
  2. **My Reservations List**:
     - Fetches `GET /api/reservations` on mount
     - Table/list showing: Name, Party Size, Dates, Status (with color badge), Notes
     - Each row has "Edit" button (loads into form above) and "Cancel" button (with confirmation dialog)
     - "Edit" disabled if status is Cancelled, Rejected, or Completed
     - "Cancel" disabled if status is Cancelled, Rejected, or Completed
     - Clicking "Edit" populates the form and switches to edit mode
     - Status badges: Pending (yellow), Accepted (green), Cancelled (gray), Rejected (red), Completed (blue)

### 7.6 ViewReservationsTab.jsx
- Fetches `GET /api/reservations` on mount
- Shows only upcoming reservations (start_date >= today) that are not Cancelled/Rejected
- Read-only list/cards with: Name, Party Size, Date Range, Status, Notes
- Click a reservation to view its audit trail (fetches `GET /api/reservations/:id/audit`)
- Audit trail shown in a collapsible section or modal

### 7.7 CalendarViewTab.jsx
- **State**: `currentMonth`, `currentYear`, `reservations`
- **Navigation**: Left/Right arrows to change month, display "March 2026" etc.
- **Data**: Fetches `GET /api/reservations/calendar?month=M&year=Y` when month/year changes
- **Calendar grid algorithm**:
  1. Compute first day of month: `new Date(year, month - 1, 1).getDay()` (0=Sun, 6=Sat)
  2. Compute days in month: `new Date(year, month, 0).getDate()`
  3. Create 6 rows x 7 columns grid. Fill leading cells with empty/gray cells for days before the 1st. Fill trailing cells similarly.
  4. For each day cell, check which reservations overlap that day (`start_date <= day <= end_date`). Shade the cell accordingly.
- **Grid**: Standard 7-column calendar grid (Sun-Sat)
  - Days with reservations are shaded/highlighted
  - Multiple reservations on same day: show count badge
  - Clicking a shaded day shows a tooltip/popover listing the reservations on that day (name, party size, status)
- **Color coding by status**: Pending (yellow), Accepted (green)

### 7.8 AdminTab.jsx
- **Auth**: Only rendered if `user.is_admin`
- **Filter bar**: Dropdown to filter by status (All, Pending, Accepted, Cancelled, Rejected, Completed)
- **Reservations list**: Fetches `GET /api/admin/reservations?status=...`
  - Shows: User Email, Name, Party Size, Dates, Status, Notes
  - Each row has action buttons:
    - "Accept" (sets status to Accepted) - shown for Pending, **with confirmation dialog**
    - "Reject" (sets status to Rejected) - shown for Pending, **with confirmation dialog** ("Are you sure you want to reject this reservation?")
    - "Edit" (opens inline edit form for name, size_of_party, dates, notes, status)
  - Uses `PUT /api/admin/reservations/:id`
  - If response contains `warning` (overlap), display it prominently
- **Inline edit**: When "Edit" is clicked, row expands to show editable fields + "Save" / "Cancel" buttons

---

## 8. Audit Trail

### What gets logged:

| Action | Trigger | changes_json content |
|--------|---------|---------------------|
| `created` | User creates reservation | Full initial values: `{ "name": "...", "size_of_party": 4, "start_date": "...", "end_date": "...", "notes": "...", "status": "Pending" }` |
| `updated` | User edits their reservation | `{ "field": { "old": "val1", "new": "val2" } }` for each changed field (including status reset to Pending if applicable) |
| `cancelled` | User cancels their reservation | `{ "status": { "old": "Pending", "new": "Cancelled" } }` |
| `admin_updated` | Admin modifies a reservation | Same format as `updated`, records which fields changed |

### Implementation:
- Before updating a reservation, read the current values
- Compare each field, build the changes_json object with old/new values
- Insert into audit_log with the acting user's ID AND email (denormalized)
- The `user_id` in audit_log is the person who made the change (could be admin)
- The audit_log table is append-only: the application NEVER issues UPDATE or DELETE on it

### Completed Status

Reservations transition to "Completed" status **manually by the admin** via the admin update endpoint. There is no automatic completion. Admins should mark reservations as Completed after the stay ends. This is logged in the audit trail like any other admin update.

---

## 9. Express Server Configuration (`server/index.js`)

```js
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { initDb, cleanupExpiredTokens } = require('./db');

const app = express();
app.use(express.json());
app.use(cookieParser());

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/reservations', require('./routes/reservations'));
app.use('/api/admin', require('./routes/admin'));

// Serve frontend in production
app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

initDb(); // Create tables, indexes, enable foreign keys
cleanupExpiredTokens(); // Clean on startup
setInterval(cleanupExpiredTokens, 60 * 60 * 1000); // Clean every hour

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
```

### Vite Dev Config (`client/vite.config.js`)

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001'
    }
  }
});
```

---

## 10. Package Dependencies

### server/package.json
```json
{
  "name": "prospective-stay-server",
  "scripts": {
    "start": "node index.js",
    "dev": "node --watch index.js",
    "seed": "node seed.js"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "cookie-parser": "^1.4.6",
    "express": "^4.21.0"
  }
}
```

### client/package.json
```json
{
  "name": "prospective-stay-client",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^5.4.0"
  }
}
```

### Root package.json
```json
{
  "name": "prospective-stay",
  "private": true,
  "scripts": {
    "dev:server": "cd server && npm run dev",
    "dev:client": "cd client && npm run dev",
    "seed": "cd server && npm run seed",
    "build": "cd client && npm run build"
  }
}
```

---

## 11. Development Workflow

1. `npm install` in both `server/` and `client/`
2. `cd server && npm run seed` to create admin user (admin@ppw.com)
3. Terminal 1: `cd server && npm run dev` (runs on port 3001)
4. Terminal 2: `cd client && npm run dev` (runs on port 5173, proxies /api to 3001)
5. Open http://localhost:5173
6. To log in: enter any email, check server console for the 6-digit code
7. To test admin: use admin@ppw.com

---

## 12. Key Implementation Notes

- **Dates**: All dates stored as ISO strings (YYYY-MM-DD) in SQLite TEXT columns. Frontend uses `<input type="date">` which provides native date pickers.
- **Time zone**: All dates are date-only (no time component), avoiding timezone issues. Server uses UTC for timestamps.
- **Error handling**: Express routes wrapped in try/catch, return `{ error: "message" }` with appropriate HTTP status codes.
- **CORS**: Not needed since frontend and backend are same-origin (via Vite proxy in dev, static serving in prod).
- **CSRF protection**: The API requires `Content-Type: application/json` which triggers CORS preflight for cross-origin requests. Combined with `SameSite=Lax` cookies, this prevents CSRF. No additional tokens needed.
- **Security**: httpOnly cookies prevent XSS token theft. No passwords to leak. Session tokens are cryptographically random UUIDs.
- **Token generation**: Use `crypto.randomUUID()` for session tokens and magic link tokens. Use `crypto.randomInt(100000, 999999)` for 6-digit codes (cryptographically secure).
- **Cookie settings**: `httpOnly: true, sameSite: 'lax', path: '/', maxAge: 7 * 24 * 60 * 60 * 1000` (7 days), `secure: process.env.NODE_ENV === 'production'`.
- **Foreign keys**: `PRAGMA foreign_keys = ON` must be set on every connection to SQLite.
- **Session expiry handling**: Frontend detects 401 responses and triggers logout/redirect to login.
- **Pagination**: Not implemented initially. The app is for a single property (PPW) so reservation volume will be low. If needed later, add `?limit=N&offset=M` to list endpoints.
