# Patch: Fix `docs/auth/google-auth.md` — field naming consistency

**Review:** `58-fix-docs-auth-google-auth-md-review-1.md`, Suggestion #1
**Files:** 1

---

## Fix 1: Line 3 — camelCase `serverAuthCode` → snake_case `server_auth_code`

**File:** `docs/auth/google-auth.md`
**Line:** 3
**Problem:** Uses old DTO camelCase `serverAuthCode` while the rest of the document (lines 7, 35, 44) uses proto snake_case `server_auth_code`.

**Before:**
```
Вход через Google Sign-In поддерживает два flow — оба передают `serverAuthCode` на бэкенд, где Google-токены обрабатываются исключительно на сервере.
```

**After:**
```
Вход через Google Sign-In поддерживает два flow — оба передают `server_auth_code` на бэкенд, где Google-токены обрабатываются исключительно на сервере.
```

---

## Fix 2: Line 15 — camelCase `serverAuthCode` and `redirectUri` → snake_case

**File:** `docs/auth/google-auth.md`
**Line:** 15
**Problem:** Uses old DTO camelCase `serverAuthCode` and `redirectUri` while the rest of the document (lines 7, 19, 35, 37) uses proto snake_case `server_auth_code` and `redirect_uri`.

**Before:**
```
Мобильный клиент получает `serverAuthCode` напрямую от Google Sign-In SDK. Поле `redirectUri` не передаётся — `OAuth2Client.getToken` вызывается только с кодом.
```

**After:**
```
Мобильный клиент получает `server_auth_code` напрямую от Google Sign-In SDK. Поле `redirect_uri` не передаётся — `OAuth2Client.getToken` вызывается только с кодом.
```
