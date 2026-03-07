#!/usr/bin/env bash
#
# ProspectiveStay Regression Test Suite
# Usage: ./tests/run_tests.sh
# Results are written to tests/results.log
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SERVER_DIR="$PROJECT_DIR/server"
CLIENT_DIR="$PROJECT_DIR/client"
LOG_FILE="$SCRIPT_DIR/results.log"
COOKIE_JAR_USER="/tmp/ps_test_user_cookies.txt"
COOKIE_JAR_ADMIN="/tmp/ps_test_admin_cookies.txt"
COOKIE_JAR_OTHER="/tmp/ps_test_other_cookies.txt"
SERVER_LOG="/tmp/ps_test_server.log"
BASE_URL="http://localhost:3001"
SERVER_PID=""

PASS_COUNT=0
FAIL_COUNT=0
TOTAL_COUNT=0

# --- helpers ---

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$COOKIE_JAR_USER" "$COOKIE_JAR_ADMIN" "$COOKIE_JAR_OTHER"
}
trap cleanup EXIT

log() {
  echo "$1" | tee -a "$LOG_FILE"
}

assert_status() {
  local test_name="$1"
  local expected="$2"
  local actual="$3"
  TOTAL_COUNT=$((TOTAL_COUNT + 1))
  if [ "$actual" = "$expected" ]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    log "  PASS: $test_name (HTTP $actual)"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    log "  FAIL: $test_name (expected HTTP $expected, got HTTP $actual)"
  fi
}

assert_body_contains() {
  local test_name="$1"
  local needle="$2"
  local body="$3"
  TOTAL_COUNT=$((TOTAL_COUNT + 1))
  if echo "$body" | grep -qF "$needle"; then
    PASS_COUNT=$((PASS_COUNT + 1))
    log "  PASS: $test_name"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    log "  FAIL: $test_name (body does not contain '$needle')"
    log "        Body: $(echo "$body" | head -c 200)"
  fi
}

assert_body_not_contains() {
  local test_name="$1"
  local needle="$2"
  local body="$3"
  TOTAL_COUNT=$((TOTAL_COUNT + 1))
  if echo "$body" | grep -qF "$needle"; then
    FAIL_COUNT=$((FAIL_COUNT + 1))
    log "  FAIL: $test_name (body unexpectedly contains '$needle')"
  else
    PASS_COUNT=$((PASS_COUNT + 1))
    log "  PASS: $test_name"
  fi
}

assert_cookie_httponly() {
  local test_name="$1"
  local jar="$2"
  TOTAL_COUNT=$((TOTAL_COUNT + 1))
  if grep -q "#HttpOnly_" "$jar" 2>/dev/null; then
    PASS_COUNT=$((PASS_COUNT + 1))
    log "  PASS: $test_name"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    log "  FAIL: $test_name (cookie not marked HttpOnly)"
  fi
}

# Extract login code from server log for a given email
get_login_code() {
  local email="$1"
  grep "\\[LOGIN CODE\\]" "$SERVER_LOG" | grep "$email" | tail -1 | grep -oP '\d{6}'
}

# Do a full login flow, storing cookie in the given jar
do_login() {
  local email="$1"
  local jar="$2"
  curl -s -X POST "$BASE_URL/api/auth/request-login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\"}" > /dev/null
  sleep 0.3
  local code
  code=$(get_login_code "$email")
  curl -s -c "$jar" -X POST "$BASE_URL/api/auth/verify" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"code\":\"$code\"}" > /dev/null
}

# --- setup ---

setup_server() {
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

  cd "$SERVER_DIR"
  rm -f prospective_stay.db
  node seed.js > /dev/null 2>&1

  node index.js > "$SERVER_LOG" 2>&1 &
  SERVER_PID=$!

  # wait for server to be ready
  for i in $(seq 1 20); do
    if curl -s "$BASE_URL/api/auth/me" > /dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done
}

# ============================================================
# TEST CATEGORIES
# ============================================================

test_auth_request_login() {
  log ""
  log "=== 1. Auth: request-login ==="

  # 1a Valid email
  local body status
  body=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/auth/request-login" \
    -H 'Content-Type: application/json' -d '{"email":"user1@test.com"}')
  assert_status "Valid email returns 200" "200" "$body"

  # 1b Invalid email
  body=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/auth/request-login" \
    -H 'Content-Type: application/json' -d '{"email":"not-an-email"}')
  assert_status "Invalid email returns 400" "400" "$body"

  # 1c Missing email
  body=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/auth/request-login" \
    -H 'Content-Type: application/json' -d '{}')
  assert_status "Missing email returns 400" "400" "$body"

  # 1d Empty body
  body=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/auth/request-login" \
    -H 'Content-Type: application/json' -d '{"email":""}')
  assert_status "Empty email returns 400" "400" "$body"
}

test_auth_rate_limiting() {
  log ""
  log "=== 2. Auth: rate limiting ==="

  local email="ratelimit@test.com"
  local s1 s2 s3 s4

  s1=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/auth/request-login" \
    -H 'Content-Type: application/json' -d "{\"email\":\"$email\"}")
  s2=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/auth/request-login" \
    -H 'Content-Type: application/json' -d "{\"email\":\"$email\"}")
  s3=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/auth/request-login" \
    -H 'Content-Type: application/json' -d "{\"email\":\"$email\"}")
  s4=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/auth/request-login" \
    -H 'Content-Type: application/json' -d "{\"email\":\"$email\"}")

  assert_status "1st login request succeeds" "200" "$s1"
  assert_status "2nd login request succeeds" "200" "$s2"
  assert_status "3rd login request succeeds" "200" "$s3"
  assert_status "4th login request rate-limited" "429" "$s4"
}

test_auth_verify() {
  log ""
  log "=== 3. Auth: verify ==="

  local email="verify@test.com"
  curl -s -X POST "$BASE_URL/api/auth/request-login" \
    -H 'Content-Type: application/json' -d "{\"email\":\"$email\"}" > /dev/null
  sleep 0.3

  # 3a Wrong code
  local status body
  status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/auth/verify" \
    -H 'Content-Type: application/json' -d "{\"email\":\"$email\",\"code\":\"000000\"}")
  assert_status "Wrong code returns 400" "400" "$status"

  # 3b Correct code
  local code
  code=$(get_login_code "$email")
  body=$(curl -s -c "$COOKIE_JAR_USER" -w '\n%{http_code}' -X POST "$BASE_URL/api/auth/verify" \
    -H 'Content-Type: application/json' -d "{\"email\":\"$email\",\"code\":\"$code\"}")
  status=$(echo "$body" | tail -1)
  local json
  json=$(echo "$body" | sed '$d')
  assert_status "Correct code returns 200" "200" "$status"
  assert_body_contains "Response has user object" '"user"' "$json"
  assert_body_contains "Response has email" "$email" "$json"

  # 3c HttpOnly cookie set
  assert_cookie_httponly "Session cookie is HttpOnly" "$COOKIE_JAR_USER"

  # 3d Missing token and code
  status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/auth/verify" \
    -H 'Content-Type: application/json' -d '{}')
  assert_status "Missing token+code returns 400" "400" "$status"
}

test_auth_bruteforce() {
  log ""
  log "=== 4. Auth: brute-force protection (code path) ==="

  local email="bruteforce@test.com"
  curl -s -X POST "$BASE_URL/api/auth/request-login" \
    -H 'Content-Type: application/json' -d "{\"email\":\"$email\"}" > /dev/null
  sleep 0.3
  local code
  code=$(get_login_code "$email")

  # Send 5 wrong codes
  for i in 1 2 3 4 5; do
    curl -s -X POST "$BASE_URL/api/auth/verify" \
      -H 'Content-Type: application/json' -d "{\"email\":\"$email\",\"code\":\"000000\"}" > /dev/null
  done

  # 6th attempt with correct code should be rejected
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/auth/verify" \
    -H 'Content-Type: application/json' -d "{\"email\":\"$email\",\"code\":\"$code\"}")

  # After 5 failures, correct code should NOT work (400 or 429)
  TOTAL_COUNT=$((TOTAL_COUNT + 1))
  if [ "$status" = "400" ] || [ "$status" = "429" ]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    log "  PASS: Correct code rejected after 5 failures (HTTP $status)"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    log "  FAIL: Correct code should be rejected after 5 failures (got HTTP $status, expected 400 or 429)"
  fi
}

test_auth_me() {
  log ""
  log "=== 5. Auth: /me endpoint ==="

  # 5a Without cookie
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/auth/me")
  assert_status "/me without cookie returns 401" "401" "$status"

  # 5b With valid cookie (use the cookie from verify test)
  local body
  body=$(curl -s -b "$COOKIE_JAR_USER" -w '\n%{http_code}' "$BASE_URL/api/auth/me")
  status=$(echo "$body" | tail -1)
  assert_status "/me with cookie returns 200" "200" "$status"

  # 5c With invalid cookie
  status=$(curl -s -o /dev/null -w '%{http_code}' -b "session_token=invalid-fake-token" "$BASE_URL/api/auth/me")
  assert_status "/me with invalid cookie returns 401" "401" "$status"
}

test_auth_profile() {
  log ""
  log "=== 6. Auth: profile update ==="

  # 6a Valid name
  local body status
  body=$(curl -s -b "$COOKIE_JAR_USER" -w '\n%{http_code}' -X PUT "$BASE_URL/api/auth/profile" \
    -H 'Content-Type: application/json' -d '{"name":"Test User"}')
  status=$(echo "$body" | tail -1)
  assert_status "Profile update returns 200" "200" "$status"
  assert_body_contains "Name is updated" '"Test User"' "$(echo "$body" | sed '$d')"

  # 6b Empty name
  status=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR_USER" -X PUT "$BASE_URL/api/auth/profile" \
    -H 'Content-Type: application/json' -d '{"name":""}')
  assert_status "Empty name returns 400" "400" "$status"

  # 6c Name too long (101 chars)
  local long_name
  long_name=$(python3 -c "print('A' * 101)")
  status=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR_USER" -X PUT "$BASE_URL/api/auth/profile" \
    -H 'Content-Type: application/json' -d "{\"name\":\"$long_name\"}")
  assert_status "Name > 100 chars returns 400" "400" "$status"
}

test_auth_logout() {
  log ""
  log "=== 7. Auth: logout ==="

  # Login fresh user for logout test
  do_login "logoutuser@test.com" "/tmp/ps_test_logout_cookies.txt"

  # Verify logged in
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' -b "/tmp/ps_test_logout_cookies.txt" "$BASE_URL/api/auth/me")
  assert_status "Logged in before logout" "200" "$status"

  # Logout
  status=$(curl -s -o /dev/null -w '%{http_code}' -b "/tmp/ps_test_logout_cookies.txt" -X POST "$BASE_URL/api/auth/logout")
  assert_status "Logout returns 200" "200" "$status"

  # Verify session invalidated
  status=$(curl -s -o /dev/null -w '%{http_code}' -b "/tmp/ps_test_logout_cookies.txt" "$BASE_URL/api/auth/me")
  assert_status "Session invalid after logout" "401" "$status"

  rm -f "/tmp/ps_test_logout_cookies.txt"
}

test_reservations_crud() {
  log ""
  log "=== 8. Reservations: CRUD ==="

  # Login as test user
  do_login "crud@test.com" "$COOKIE_JAR_USER"

  # 8a Create valid reservation
  local body status json
  body=$(curl -s -b "$COOKIE_JAR_USER" -w '\n%{http_code}' -X POST "$BASE_URL/api/reservations" \
    -H 'Content-Type: application/json' \
    -d '{"name":"Family Visit","size_of_party":4,"start_date":"2026-03-15","end_date":"2026-03-20","notes":"Arriving late"}')
  status=$(echo "$body" | tail -1)
  json=$(echo "$body" | sed '$d')
  assert_status "Create reservation returns 200" "200" "$status"
  assert_body_contains "Status is Pending" '"Pending"' "$json"
  assert_body_contains "Name saved" '"Family Visit"' "$json"

  # Extract reservation id
  local res_id
  res_id=$(echo "$json" | grep -oP '"id":\s*\K\d+' | head -1)

  # 8b List reservations
  body=$(curl -s -b "$COOKIE_JAR_USER" -w '\n%{http_code}' "$BASE_URL/api/reservations")
  status=$(echo "$body" | tail -1)
  json=$(echo "$body" | sed '$d')
  assert_status "List reservations returns 200" "200" "$status"
  assert_body_contains "List contains reservation" '"Family Visit"' "$json"

  # 8c Update reservation
  body=$(curl -s -b "$COOKIE_JAR_USER" -w '\n%{http_code}' -X PUT "$BASE_URL/api/reservations/$res_id" \
    -H 'Content-Type: application/json' \
    -d '{"name":"Updated Visit","size_of_party":5,"start_date":"2026-03-15","end_date":"2026-03-22","notes":"New notes"}')
  status=$(echo "$body" | tail -1)
  json=$(echo "$body" | sed '$d')
  assert_status "Update reservation returns 200" "200" "$status"
  assert_body_contains "Name updated" '"Updated Visit"' "$json"
  assert_body_contains "Party size updated" '"size_of_party":5' "$json"

  # 8d Create second reservation and cancel it
  body=$(curl -s -b "$COOKIE_JAR_USER" -w '\n%{http_code}' -X POST "$BASE_URL/api/reservations" \
    -H 'Content-Type: application/json' \
    -d '{"name":"Weekend Trip","size_of_party":2,"start_date":"2026-04-01","end_date":"2026-04-03","notes":""}')
  local res2_id
  res2_id=$(echo "$body" | sed '$d' | grep -oP '"id":\s*\K\d+' | head -1)

  body=$(curl -s -b "$COOKIE_JAR_USER" -w '\n%{http_code}' -X DELETE "$BASE_URL/api/reservations/$res2_id")
  status=$(echo "$body" | tail -1)
  json=$(echo "$body" | sed '$d')
  assert_status "Cancel reservation returns 200" "200" "$status"
  assert_body_contains "Status is Cancelled" '"Cancelled"' "$json"

  # 8e Cancel already cancelled
  status=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR_USER" -X DELETE "$BASE_URL/api/reservations/$res2_id")
  assert_status "Cancel already cancelled returns 400" "400" "$status"

  # 8f Edit cancelled reservation
  status=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR_USER" -X PUT "$BASE_URL/api/reservations/$res2_id" \
    -H 'Content-Type: application/json' \
    -d '{"name":"Nope","size_of_party":1,"start_date":"2026-04-01","end_date":"2026-04-03"}')
  assert_status "Edit cancelled reservation returns 400" "400" "$status"

  # Store res_id for later tests
  echo "$res_id" > /tmp/ps_test_res_id.txt
}

test_reservations_validation() {
  log ""
  log "=== 9. Reservations: validation ==="

  # 9a Missing fields
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR_USER" -X POST "$BASE_URL/api/reservations" \
    -H 'Content-Type: application/json' -d '{"name":""}')
  assert_status "Empty name rejected" "400" "$status"

  # 9b Bad dates
  status=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR_USER" -X POST "$BASE_URL/api/reservations" \
    -H 'Content-Type: application/json' \
    -d '{"name":"Bad","size_of_party":1,"start_date":"2026-03-20","end_date":"2026-03-15"}')
  assert_status "end < start rejected" "400" "$status"

  # 9c Past date
  status=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR_USER" -X POST "$BASE_URL/api/reservations" \
    -H 'Content-Type: application/json' \
    -d '{"name":"Past","size_of_party":1,"start_date":"2020-01-01","end_date":"2020-01-05"}')
  assert_status "Past start date rejected" "400" "$status"

  # 9d Party size 0
  status=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR_USER" -X POST "$BASE_URL/api/reservations" \
    -H 'Content-Type: application/json' \
    -d '{"name":"Zero","size_of_party":0,"start_date":"2026-04-01","end_date":"2026-04-02"}')
  assert_status "Party size 0 rejected" "400" "$status"

  # 9e Party size as string
  status=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR_USER" -X POST "$BASE_URL/api/reservations" \
    -H 'Content-Type: application/json' \
    -d '{"name":"Str","size_of_party":"3","start_date":"2026-04-01","end_date":"2026-04-02"}')
  assert_status "Party size as string rejected" "400" "$status"

  # 9f No auth
  status=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/reservations")
  assert_status "Reservations without auth returns 401" "401" "$status"

  status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/reservations" \
    -H 'Content-Type: application/json' \
    -d '{"name":"No Auth","size_of_party":1,"start_date":"2026-04-01","end_date":"2026-04-02"}')
  assert_status "Create without auth returns 401" "401" "$status"
}

test_reservations_ownership() {
  log ""
  log "=== 10. Reservations: ownership ==="

  local res_id
  res_id=$(cat /tmp/ps_test_res_id.txt)

  # Login as different user
  do_login "other@test.com" "$COOKIE_JAR_OTHER"

  # Try to edit
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR_OTHER" -X PUT "$BASE_URL/api/reservations/$res_id" \
    -H 'Content-Type: application/json' \
    -d '{"name":"Hacked","size_of_party":1,"start_date":"2026-03-15","end_date":"2026-03-22"}')
  assert_status "Edit other's reservation returns 403" "403" "$status"

  # Try to cancel
  status=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR_OTHER" -X DELETE "$BASE_URL/api/reservations/$res_id")
  assert_status "Cancel other's reservation returns 403" "403" "$status"

  # Try to view audit
  status=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR_OTHER" "$BASE_URL/api/reservations/$res_id/audit")
  assert_status "View other's audit returns 403" "403" "$status"
}

test_admin() {
  log ""
  log "=== 11. Admin endpoints ==="

  do_login "admin@ppw.com" "$COOKIE_JAR_ADMIN"
  local res_id
  res_id=$(cat /tmp/ps_test_res_id.txt)

  # 11a List all reservations
  local body status json
  body=$(curl -s -b "$COOKIE_JAR_ADMIN" -w '\n%{http_code}' "$BASE_URL/api/admin/reservations")
  status=$(echo "$body" | tail -1)
  json=$(echo "$body" | sed '$d')
  assert_status "Admin list returns 200" "200" "$status"
  assert_body_contains "Admin list has user_email" '"user_email"' "$json"

  # 11b Filter by status
  body=$(curl -s -b "$COOKIE_JAR_ADMIN" -w '\n%{http_code}' "$BASE_URL/api/admin/reservations?status=Pending")
  status=$(echo "$body" | tail -1)
  assert_status "Admin filter by status returns 200" "200" "$status"

  # 11c Accept reservation
  body=$(curl -s -b "$COOKIE_JAR_ADMIN" -w '\n%{http_code}' -X PUT "$BASE_URL/api/admin/reservations/$res_id" \
    -H 'Content-Type: application/json' -d '{"status":"Accepted"}')
  status=$(echo "$body" | tail -1)
  json=$(echo "$body" | sed '$d')
  assert_status "Admin accept returns 200" "200" "$status"
  assert_body_contains "Status changed to Accepted" '"Accepted"' "$json"

  # 11d Non-admin access denied
  status=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR_USER" "$BASE_URL/api/admin/reservations")
  assert_status "Non-admin list returns 403" "403" "$status"

  status=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR_USER" -X PUT "$BASE_URL/api/admin/reservations/$res_id" \
    -H 'Content-Type: application/json' -d '{"status":"Rejected"}')
  assert_status "Non-admin update returns 403" "403" "$status"

  # 11e No auth
  status=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/admin/reservations")
  assert_status "Admin list without auth returns 401" "401" "$status"
}

test_admin_status_reset() {
  log ""
  log "=== 12. User edit resets Accepted to Pending ==="

  local res_id
  res_id=$(cat /tmp/ps_test_res_id.txt)

  # Reservation was accepted above. User edits it -> should reset to Pending
  local body status json
  body=$(curl -s -b "$COOKIE_JAR_USER" -w '\n%{http_code}' -X PUT "$BASE_URL/api/reservations/$res_id" \
    -H 'Content-Type: application/json' \
    -d '{"name":"Modified After Accept","size_of_party":5,"start_date":"2026-03-15","end_date":"2026-03-22","notes":"changed"}')
  status=$(echo "$body" | tail -1)
  json=$(echo "$body" | sed '$d')
  assert_status "User edit accepted reservation returns 200" "200" "$status"
  assert_body_contains "Status reset to Pending" '"Pending"' "$json"
}

test_admin_reject_and_overlap() {
  log ""
  log "=== 13. Admin: reject and overlap warning ==="

  local res_id
  res_id=$(cat /tmp/ps_test_res_id.txt)

  # Re-accept reservation
  curl -s -b "$COOKIE_JAR_ADMIN" -X PUT "$BASE_URL/api/admin/reservations/$res_id" \
    -H 'Content-Type: application/json' -d '{"status":"Accepted"}' > /dev/null

  # Create overlapping reservation
  local body json overlap_id
  body=$(curl -s -b "$COOKIE_JAR_USER" -X POST "$BASE_URL/api/reservations" \
    -H 'Content-Type: application/json' \
    -d '{"name":"Overlap Test","size_of_party":2,"start_date":"2026-03-18","end_date":"2026-03-25","notes":""}')
  overlap_id=$(echo "$body" | grep -oP '"id":\s*\K\d+' | head -1)

  # Accept overlapping -> should get warning
  body=$(curl -s -b "$COOKIE_JAR_ADMIN" -w '\n%{http_code}' -X PUT "$BASE_URL/api/admin/reservations/$overlap_id" \
    -H 'Content-Type: application/json' -d '{"status":"Accepted"}')
  local status
  status=$(echo "$body" | tail -1)
  json=$(echo "$body" | sed '$d')
  assert_status "Accept overlapping returns 200" "200" "$status"
  assert_body_contains "Overlap warning present" '"warning"' "$json"

  # Reject it
  body=$(curl -s -b "$COOKIE_JAR_ADMIN" -w '\n%{http_code}' -X PUT "$BASE_URL/api/admin/reservations/$overlap_id" \
    -H 'Content-Type: application/json' -d '{"status":"Rejected"}')
  status=$(echo "$body" | tail -1)
  json=$(echo "$body" | sed '$d')
  assert_status "Admin reject returns 200" "200" "$status"
  assert_body_contains "Status is Rejected" '"Rejected"' "$json"

  # User cannot edit rejected reservation
  status=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR_USER" -X PUT "$BASE_URL/api/reservations/$overlap_id" \
    -H 'Content-Type: application/json' \
    -d '{"name":"Nope","size_of_party":1,"start_date":"2026-03-18","end_date":"2026-03-25"}')
  assert_status "Cannot edit rejected reservation" "400" "$status"
}

test_calendar() {
  log ""
  log "=== 14. Calendar ==="

  local body status json

  # 14a Valid calendar query
  body=$(curl -s -b "$COOKIE_JAR_USER" -w '\n%{http_code}' "$BASE_URL/api/reservations/calendar?month=3&year=2026")
  status=$(echo "$body" | tail -1)
  json=$(echo "$body" | sed '$d')
  assert_status "Calendar returns 200" "200" "$status"
  assert_body_contains "Calendar has month" '"month":3' "$json"
  assert_body_contains "Calendar has year" '"year":2026' "$json"
  assert_body_not_contains "Calendar excludes Rejected" '"Rejected"' "$json"
  assert_body_not_contains "Calendar excludes Cancelled" '"Cancelled"' "$json"

  # 14b Missing params
  status=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR_USER" "$BASE_URL/api/reservations/calendar")
  assert_status "Calendar without params returns 400" "400" "$status"

  # 14c No auth
  status=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/reservations/calendar?month=3&year=2026")
  assert_status "Calendar without auth returns 401" "401" "$status"
}

test_audit_trail() {
  log ""
  log "=== 15. Audit trail ==="

  local res_id
  res_id=$(cat /tmp/ps_test_res_id.txt)

  # 15a Owner can view audit
  local body status json
  body=$(curl -s -b "$COOKIE_JAR_USER" -w '\n%{http_code}' "$BASE_URL/api/reservations/$res_id/audit")
  status=$(echo "$body" | tail -1)
  json=$(echo "$body" | sed '$d')
  assert_status "Owner view audit returns 200" "200" "$status"
  assert_body_contains "Audit has created action" '"created"' "$json"
  assert_body_contains "Audit has updated action" '"updated"' "$json"
  assert_body_contains "Audit has admin_updated action" '"admin_updated"' "$json"
  assert_body_contains "Audit has user_email" '"user_email"' "$json"
  assert_body_contains "Audit has created_at" '"created_at"' "$json"
  assert_body_contains "Audit has changes_json" '"changes_json"' "$json"

  # 15b Admin can view audit
  status=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR_ADMIN" "$BASE_URL/api/reservations/$res_id/audit")
  assert_status "Admin view audit returns 200" "200" "$status"

  # 15c Non-owner non-admin denied
  status=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR_OTHER" "$BASE_URL/api/reservations/$res_id/audit")
  assert_status "Non-owner audit returns 403" "403" "$status"

  # 15d Non-existent reservation
  status=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR_USER" "$BASE_URL/api/reservations/99999/audit")
  assert_status "Non-existent reservation audit returns 404" "404" "$status"
}

test_api_404() {
  log ""
  log "=== 16. API 404 handling ==="

  local body status content_type
  body=$(curl -s -w '\n%{content_type}\n%{http_code}' "$BASE_URL/api/nonexistent")
  status=$(echo "$body" | tail -1)
  content_type=$(echo "$body" | tail -2 | head -1)

  TOTAL_COUNT=$((TOTAL_COUNT + 1))
  if echo "$content_type" | grep -q "application/json"; then
    PASS_COUNT=$((PASS_COUNT + 1))
    log "  PASS: Non-existent API route returns JSON (content-type: $content_type)"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    log "  FAIL: Non-existent API route returns non-JSON (content-type: $content_type) -- should return JSON 404"
  fi
}

test_frontend_build() {
  log ""
  log "=== 17. Frontend build ==="

  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

  local output
  output=$(cd "$CLIENT_DIR" && npx vite build 2>&1)
  TOTAL_COUNT=$((TOTAL_COUNT + 1))
  if echo "$output" | grep -q "built in"; then
    PASS_COUNT=$((PASS_COUNT + 1))
    log "  PASS: Frontend builds successfully"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    log "  FAIL: Frontend build failed"
    log "        Output: $(echo "$output" | tail -5)"
  fi
}

test_code_quality() {
  log ""
  log "=== 18. Code quality checks ==="

  # 18a crypto.randomInt used
  TOTAL_COUNT=$((TOTAL_COUNT + 1))
  if grep -rq 'crypto\.randomInt' "$SERVER_DIR/routes/"; then
    PASS_COUNT=$((PASS_COUNT + 1))
    log "  PASS: crypto.randomInt used for code generation"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    log "  FAIL: crypto.randomInt not found"
  fi

  # 18b Math.random NOT used
  TOTAL_COUNT=$((TOTAL_COUNT + 1))
  if grep -rq 'Math\.random' "$SERVER_DIR/routes/" "$SERVER_DIR/middleware/"; then
    FAIL_COUNT=$((FAIL_COUNT + 1))
    log "  FAIL: Math.random found in server code (insecure)"
  else
    PASS_COUNT=$((PASS_COUNT + 1))
    log "  PASS: Math.random not used in server code"
  fi

  # 18c PRAGMA foreign_keys
  TOTAL_COUNT=$((TOTAL_COUNT + 1))
  if grep -q 'foreign_keys' "$SERVER_DIR/db.js"; then
    PASS_COUNT=$((PASS_COUNT + 1))
    log "  PASS: PRAGMA foreign_keys is set"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    log "  FAIL: PRAGMA foreign_keys not found in db.js"
  fi

  # 18d No UPDATE/DELETE on audit_log
  TOTAL_COUNT=$((TOTAL_COUNT + 1))
  if grep -rqP '(UPDATE|DELETE)\s+.*audit_log' "$SERVER_DIR/routes/" "$SERVER_DIR/middleware/"; then
    FAIL_COUNT=$((FAIL_COUNT + 1))
    log "  FAIL: UPDATE or DELETE on audit_log found (should be append-only)"
  else
    PASS_COUNT=$((PASS_COUNT + 1))
    log "  PASS: audit_log is append-only (no UPDATE/DELETE)"
  fi
}

# ============================================================
# MAIN
# ============================================================

main() {
  > "$LOG_FILE"  # truncate log

  local start_time
  start_time=$(date +%s)

  log "============================================"
  log "ProspectiveStay Regression Test Suite"
  log "Date: $(date '+%Y-%m-%d %H:%M:%S')"
  log "============================================"

  log ""
  log "Setting up server..."
  setup_server
  log "Server started (PID: $SERVER_PID)"

  test_auth_request_login
  test_auth_rate_limiting
  test_auth_verify
  test_auth_bruteforce
  test_auth_me
  test_auth_profile
  test_auth_logout
  test_reservations_crud
  test_reservations_validation
  test_reservations_ownership
  test_admin
  test_admin_status_reset
  test_admin_reject_and_overlap
  test_calendar
  test_audit_trail
  test_api_404
  test_frontend_build
  test_code_quality

  local end_time elapsed
  end_time=$(date +%s)
  elapsed=$((end_time - start_time))

  log ""
  log "============================================"
  log "RESULTS: $PASS_COUNT passed, $FAIL_COUNT failed, $TOTAL_COUNT total"
  log "Time: ${elapsed}s"
  log "============================================"

  rm -f /tmp/ps_test_res_id.txt

  if [ "$FAIL_COUNT" -gt 0 ]; then
    exit 1
  fi
}

main "$@"
