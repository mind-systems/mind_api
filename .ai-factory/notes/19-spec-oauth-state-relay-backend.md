# Spec — Phase 26: relay OAuth `state` through Google sign-in (backend half)

**Date:** 2026-05-31
**Source:** code review note 15 §MEDIUM
**Target:** `src/users/controller/google-callback.controller.ts`, `src/users/dto/google-code-exchange.dto.ts`
**Scope:** no migration, no proto. Pairs with `mind_web/.ai-factory/notes/13-oauth-state-csrf-requirements.md` — ships together.

## Problem
The Google sign-in is a relay flow: SPA hits `GET /auth/google` → backend redirects to Google → Google → `GET /auth/google/callback` → backend relays `code` to `APP_BASE_URL/auth/google/callback?googleCode=…` → SPA `POST /auth/google` exchanges it for a JWT. No `state` parameter anywhere → login-CSRF (victim logged into attacker's account). The backend holds no cookies/session; the SPA owns the OAuth session. Correct split: **SPA generates/stores/validates `state`; backend is a transparent relay.** This note is the backend half.

## Fix
1. **`startGoogleOAuth`** — add `@Query('state') state?: string`; include it in the Google auth `URLSearchParams` only when present: `...(state ? { state } : {})`.
2. **`googleCallback`** — capture `@Query('state') state?: string`; append it to the SPA relay redirect alongside `googleCode` / `googleError`. Build the query with `URLSearchParams` for consistent encoding.
3. **`GoogleCodeExchangeDto`** — add optional `@IsString() @IsOptional() state?: string`. The backend does **not** validate `state` (the SPA does); accept it only so the POST body passes `forbidNonWhitelisted` validation.

## Guards
- Do not touch `signInWithGoogle` logic or the `redirectUri` allow-list check in `exchangeGoogleCode`.
- The backend half is a no-op until the `mind_web` counterpart ships — keep them coordinated.
