# Patch: Remove stale documentation references to Swagger/OpenAPI

**Review:** `24-remove-swagger-review-1.md`

---

## Fix 1: Remove "full OpenAPI documentation" from DESCRIPTION.md overview

**Problem:** The overview sentence still claims the project provides "full OpenAPI documentation". Swagger was fully removed — this claim is stale.

**File:** `.ai-factory/DESCRIPTION.md`
**Line:** 4

**Current code:**

```
Mind Awake API is a NestJS-based REST backend for a mindfulness breathing application. It provides passwordless email-code authentication, JWT session management, CRUD operations for breath sessions (with shared/public access), structured logging, and full OpenAPI documentation.
```

**Fixed code:**

```
Mind Awake API is a NestJS-based REST backend for a mindfulness breathing application. It provides passwordless email-code authentication, JWT session management, CRUD operations for breath sessions (with shared/public access), and structured logging.
```

---

## Fix 2: Remove "автоматическую документацию" from README.md description

**Problem:** The Russian description paragraph still claims the project provides automatic documentation ("автоматическую документацию"). Same class of issue as Fix 1.

**File:** `README.md`
**Line:** 26

**Current code:**

```
Mind Awake API — это бэкенд на базе NestJS для приложения осознанного дыхания. Проект реализует беспарольную аутентификацию (email OTP и Google Sign-In), управление сессиями дыхания, продвинутое логирование и автоматическую документацию.
```

**Fixed code:**

```
Mind Awake API — это бэкенд на базе NestJS для приложения осознанного дыхания. Проект реализует беспарольную аутентификацию (email OTP и Google Sign-In), управление сессиями дыхания и продвинутое логирование.
```
