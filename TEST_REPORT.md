# ProspectiveStay - Comprehensive Test Report

**Date:** 2026-03-07
**Scope:** Full backend + frontend code review

---

## Critical Issues

### C1. SQL Injection via Integer Parameter Coercion
**File:** `/server/routes/reservations.js:67` and `/server/routes/admin.js:56`
**Also:** `/server/routes/messages.js:101`, `:131`

The `req.params.id` values are passed directly to SQL queries without explicit integer parsing. While `pg` parameterized queries protect against SQL injection, passing a string like `"1; DROP TABLE"` would cause a Postgres cast error rather than a controlled 400 response. This is a defense-in-depth issue -- all `:id` params should be validated as integers before hitting the database.

**Suggested fix:** Add `parseInt(req.params.id)` validation and return 400 if `isNaN`.

---

### C2. Message Deletion Does Not Delete Nested Reply Reactions (Foreign Key Violation Risk)
**File:** `/server/routes/messages.js:139-141`

```js
// Delete replies first, then the message
await pool.query('DELETE FROM messages WHERE parent_id = $1', [req.params.id]);
await pool.query('DELETE FROM messages WHERE id = $1', [req.params.id]);
```

The `message_reactions` table has `ON DELETE CASCADE` for `message_id`, so deleting replies will cascade their reactions. However, this deletion is **not wrapped in a transaction**. If the first DELETE succeeds but the second fails, you end up with orphaned state (replies deleted but parent still exists). Also, if a reply itself has replies (deeply nested), those would not be deleted -- but the schema allows `parent_id` to reference any message, so a reply-to-a-reply scenario would leave orphans.

**Suggested fix:** Wrap in a transaction (`BEGIN/COMMIT`). Consider recursive deletion if deep nesting is possible.

---

### C3. No CORS Configuration for Production
**File:** `/server/index.js`

There is no CORS middleware configured. In development, the Vite proxy handles cross-origin requests. But if the frontend and backend are ever served from different origins in production (or a CDN is used), all API calls will fail. More critically, there's no explicit origin restriction, which means any site could make credentialed requests if cookies are set with `sameSite: 'lax'`.

**Suggested fix:** Add `cors` middleware with an explicit origin allowlist for production.

---

### C4. Avatar URL Not Sanitized -- Stored XSS via Image URL
**File:** `/server/routes/auth.js:68-71`

The avatar URL is accepted as any string and stored directly in the database. A malicious user could set their avatar to a `javascript:` URL or a data URI with malicious content. The frontend renders it as `<img src={user.avatar}>`, which is relatively safe for `<img>` tags (browsers don't execute JS from `src`), but the URL is also rendered in message board posts (`MessageBoardTab.jsx:195`, `269`). If the rendering ever changes to `<a href>` or similar, this becomes exploitable.

**Suggested fix:** Validate that the avatar URL starts with `https://` and matches expected Wikipedia thumbnail URL patterns.

---

### C5. No Rate Limiting on Any Endpoint
**File:** `/server/index.js`

There is no rate limiting on login, message posting, or any other endpoint. An attacker could:
- Brute-force user names via `/api/auth/login` (since login is name-only, this creates accounts)
- Flood the message board with spam
- Exhaust database connections with rapid requests

**Suggested fix:** Add `express-rate-limit` middleware, at minimum on `/api/auth/login` and `/api/messages`.

---

### C6. Authentication Middleware Missing Error Handling for Database Failures
**File:** `/server/middleware/auth.js:3-29`

The `requireAuth` middleware has no try/catch. If the database query throws (e.g., connection pool exhausted, network error), the error will be an unhandled promise rejection that crashes the Express error handling chain. Since this middleware is used on virtually every route, a transient DB failure would result in unhandled errors rather than 500 responses.

**Suggested fix:** Wrap the body of `requireAuth` in try/catch, returning `res.status(500)`.

---

## Medium Issues

### M1. Unused Dependencies in package.json
**File:** `/server/package.json:12`

`nodemailer` is listed as a dependency but never imported or used anywhere in the codebase.

**File:** `/client/package.json:9-10`

`@giphy/js-fetch-api` and `@giphy/react-components` are listed as dependencies but never imported. The GIF feature uses a custom proxy via `/api/giphy/search` instead.

**Suggested fix:** Remove unused dependencies.

---

### M2. Wikipedia API Avatar Lookup Does Not Match All Names
**File:** `/client/src/components/AvatarPicker.jsx:56`

The Wikipedia API lookup replaces spaces with underscores to form page titles: `n.replace(/ /g, '_')`. However, Wikipedia page titles are case-sensitive and may not match exactly. For example, `"Drake (musician)"` would look up `Drake_(musician)` which is correct, but the response key is `page.title` which may differ from the input (e.g., redirects). The photos lookup at line 66 uses `page.title` as the key (`map[page.title] = page.thumbnail.source`), but the avatar grid lookup at line 111 uses the original `celeb` name (`photos[celeb]`). If Wikipedia returns a different canonical title (e.g., `"The Weeknd"` vs `"The_Weeknd"`), the photo won't be found.

**Suggested fix:** Build a reverse mapping from the original name to the Wikipedia title returned.

---

### M3. Giphy API Key Exposed in Server Logs on Error
**File:** `/server/routes/giphy.js:19-20`

The full Giphy API URL including `api_key` is constructed inline. If the fetch fails and the error includes the URL (which many HTTP libraries do), the API key could end up in the error logs via `logError`.

**Suggested fix:** Avoid including the API key in logged URLs, or sanitize error messages before logging.

---

### M4. Calendar View Shows "Name (+0)" for Solo Guests
**File:** `/client/src/components/CalendarViewTab.jsx:108`

```jsx
{r.name} (+{r.size_of_party - 1})
```

When `size_of_party` is 1, this shows "John (+0)" which looks odd.

**Suggested fix:** Only show the extras count when `size_of_party > 1`.

---

### M5. `requireAdmin` Middleware Has Subtle Next() Bug
**File:** `/server/middleware/auth.js:31-40`

```js
async function requireAdmin(req, res, next) {
  await requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (res.headersSent) return;
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
}
```

`requireAuth` is an async function that calls `next()` synchronously within itself. But `requireAdmin` passes a custom callback as `next` to `requireAuth`. If `requireAuth` calls `res.status(401).json(...)` and then returns (without calling `next`), the custom callback is never invoked, and `requireAdmin` just resolves its await. This works correctly. However, if `requireAuth` throws an exception (e.g., database error -- see C6), the `await` will reject, but there's no catch, so the error propagates as an unhandled rejection rather than being passed to Express's error handler.

**Suggested fix:** Add try/catch around the await, calling `next(err)`.

---

### M6. Login Creates Duplicate Sessions Without Cleanup
**File:** `/server/routes/auth.js:27-33`

Every login creates a new session without deleting previous sessions for the same user. A user logging in repeatedly will accumulate sessions in the database. The hourly cleanup only removes expired sessions (after 30 days), so a user logging in 100 times creates 100 active sessions.

**Suggested fix:** Delete existing sessions for the user before creating a new one, or limit sessions per user.

---

### M7. Frontend Does Not Handle 403 on Admin Routes
**File:** `/client/src/components/AdminTab.jsx:33`

The AdminTab catches 401 (logging out) but does not handle 403 errors specially. If a non-admin user somehow navigates to the admin tab (e.g., by manipulating React state), they get a generic error message instead of being redirected.

**Suggested fix:** Handle 403 by showing "Access denied" or hiding the tab.

---

### M8. `size_of_party` Stored as String in Frontend State
**File:** `/client/src/components/ManageReservationTab.jsx:52`

```jsx
onChange={(e) => setForm({ ...form, size_of_party: e.target.value })}
```

`e.target.value` is always a string. The form submits `parseInt(form.size_of_party)` at line 28, which works, but if the user clears the field, `parseInt('')` returns `NaN`, which would fail backend validation. The `required` attribute prevents empty submission, but this is client-side only.

**Suggested fix:** Use `Number(e.target.value)` or handle the empty case.

---

### M9. DateRangePicker `minDate` Prevents Editing Past Reservations
**File:** `/client/src/components/DateRangePicker.jsx:78`

```js
const minDate = selecting === 'end' ? startDate : today;
```

When selecting a start date, dates before today are disabled. This is correct for new reservations, but the DateRangePicker is reused (potentially by admin edit). Currently admin uses raw `<input type="date">` so this isn't an immediate issue, but the component is inflexible.

---

### M10. Emoji Reaction Not Validated for Length/Content on Backend
**File:** `/server/routes/messages.js:97-98`

The emoji field only checks `!emoji || typeof emoji !== 'string'`. A user could send an arbitrarily long string as an "emoji", potentially a multi-KB string that would be stored in the database and rendered to all users.

**Suggested fix:** Add a max length check (e.g., 32 characters to accommodate complex emoji sequences).

---

### M11. `handleReply` in MessageBoardTab Passes Empty String Content for GIF Replies
**File:** `/client/src/components/MessageBoardTab.jsx:349`

```jsx
onSelect={async (url) => { setShowReplyGif(false); await onReply(msg.id, '', url); }}
```

This calls `onReply` with empty string content and a GIF URL. In `handleReply` (line 416), `if (content)` is falsy for empty string, so `body.content` is not set. The backend handler then checks `!hasContent && !hasGif` -- since `content` is not in the body, `hasContent` is false, and `hasGif` is true, so it passes. This works correctly, but the empty string path is fragile.

---

### M12. No Pagination on Messages Endpoint
**File:** `/server/routes/messages.js:11-19`

The GET `/api/messages` endpoint fetches ALL messages and ALL reactions from the database with no limit. As the message board grows, this query will become increasingly slow and the response payload will grow unboundedly.

**Suggested fix:** Add pagination with a `limit` and `offset` or cursor-based pagination.

---

## Low Issues

### L1. Duplicate `formatReservation` Function
**Files:** `/server/routes/reservations.js:10-16` and `/server/routes/admin.js:11-17`

The same `formatReservation` function is duplicated in both route files.

**Suggested fix:** Extract to a shared utility module.

---

### L2. Duplicate `logAudit` Function
**Files:** `/server/routes/reservations.js:44-49` and `/server/routes/admin.js:19-24`

Same as above -- duplicated audit logging function.

---

### L3. `user_id` Comparison Type Mismatch in Reactions
**File:** `/client/src/components/MessageBoardTab.jsx:164`

```js
if (r.user_id === userId) grouped[r.emoji].userReacted = true;
```

`r.user_id` comes from the API response (a number from Postgres), and `userId` comes from `user.id` in the auth context. These should both be numbers, but if one is ever a string, the strict equality would fail silently, causing the "active" highlight on reactions to not work.

---

### L4. Console Logging Notification Placeholder
**File:** `/server/routes/admin.js:127`

```js
console.log(`[NOTIFICATION] Reservation #${reservation.id} by ${reservation.user_name} has been ${status} by admin`);
```

This is a placeholder notification that just logs to console. It should either be implemented (email, push notification) or removed.

---

### L5. `error.log` File Written Synchronously
**File:** `/server/logger.js:9`

`fs.appendFileSync` blocks the event loop on every error log write. Under high error rates, this could degrade server performance.

**Suggested fix:** Use `fs.appendFile` (async) or a proper logging library.

---

### L6. `.email` CSS Class Defined but No Email in UI
**File:** `/client/src/App.module.css:68-70`

The `.email` class is defined and has a responsive `display: none` rule, but there's no email field in the application (auth is name-only). This is dead CSS.

---

### L7. `@vitejs/plugin-react` Listed as Dependency Instead of DevDependency
**File:** `/client/package.json:12`

`@vitejs/plugin-react` and `vite` are build tools and should be in `devDependencies`.

---

### L8. Missing `key` Prop Warning Potential
**File:** `/client/src/components/MessageBoardTab.jsx:528`

```jsx
{[...topLevel].reverse().map((msg) => (
```

Creating a new reversed array on every render is fine functionally, but could trigger unnecessary re-renders in large lists. Not a bug, but a minor performance concern.

---

### L9. `useEffect` Missing Dependencies
**File:** `/client/src/components/CancelReservationTab.jsx:30`

```jsx
useEffect(() => { fetchReservations(); }, []);
```

`fetchReservations` uses `user.id` and `logout` from the auth context. If these change, the effect won't re-run. Similarly in `AdminTab.jsx:40`, `MessageBoardTab.jsx:384`, and `ViewReservationsTab.jsx:18`. React's exhaustive-deps lint rule would flag these.

---

### L10. Giphy Proxy Returns 500 When API Key Not Set (No User-Facing Feedback)
**File:** `/server/routes/giphy.js:11-13`

When `GIPHY_API_KEY` is not configured, the endpoint returns 500 with `"Giphy API key not configured"`. The frontend GIF picker shows this as a generic error. A 503 (Service Unavailable) would be more appropriate, and the frontend could hide the GIF button entirely when the feature is unavailable.

---

### L11. `handleSelect` in DateRangePicker Resets When End Date <= Start Date
**File:** `/client/src/components/DateRangePicker.jsx:60`

```js
if (startDate && dateStr <= startDate) {
```

Uses string comparison for dates (e.g., `"2026-03-07" <= "2026-03-07"`). This works for ISO 8601 format, but the `<=` includes equality, meaning clicking the same date as the start date resets to picking a new start date. This might confuse users who want a single-day reservation (same start and end). They would need to click a different date first, then click the start date.

Wait -- re-reading the code: when the user clicks a date equal to the start date while selecting end, it treats it as a new start date (line 61: `onChange(dateStr, '')`). This means same-day stays cannot be easily selected.

**However**, looking at the database schema: `CHECK (end_date >= start_date)` allows `end_date = start_date`. So same-day reservations are allowed by the DB but hard to create via the UI.

**Suggested fix:** Change `<=` to `<` to allow same-day reservations.

---

### L12. No Viewport Meta Tag Check
**File:** Not found in source

The `index.html` file was not reviewed, but if it's missing `<meta name="viewport" content="width=device-width, initial-scale=1.0">`, the mobile CSS media queries would not work correctly on actual mobile devices.

---

### L13. GIF Picker Position Not Updated on Scroll/Resize
**File:** `/client/src/components/MessageBoardTab.jsx:17-29`

The GIF picker popup (and emoji picker) calculates its position once when `show` becomes true, based on `triggerRef.current.getBoundingClientRect()`. If the user scrolls or resizes the window while the picker is open, the picker stays at the stale position. Since pickers are rendered via portal with `position: fixed`, this can cause them to appear detached from their trigger button.

**Suggested fix:** Recalculate position on scroll/resize events, or close the picker on scroll.

---

### L14. `ssl: { rejectUnauthorized: false }` in Production
**File:** `/server/db.js:5`

This disables SSL certificate verification for the PostgreSQL connection in production. This is common for Heroku/Render-hosted Postgres but is insecure -- it allows man-in-the-middle attacks on the database connection.

**Suggested fix:** Use a proper CA certificate instead of disabling verification.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 6     |
| Medium   | 12    |
| Low      | 14    |

**Key areas of concern:**
1. **Security:** No rate limiting, no CORS, no avatar URL validation, no auth middleware error handling, SSL cert verification disabled
2. **Data integrity:** Message deletion not transactional, session accumulation, no emoji length validation
3. **Performance:** No message pagination, synchronous file logging, all reactions fetched on every load
4. **UX:** Same-day reservations hard to create, calendar shows "+0" for solo guests, picker positioning issues
5. **Code quality:** Duplicated functions, unused dependencies, missing React effect dependencies
