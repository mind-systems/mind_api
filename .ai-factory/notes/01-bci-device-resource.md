# BCI Device Resource — Request from Mobile Team

**Date:** 2026-05-21
**From:** mind_mobile

## Context

We are integrating Neiry neurofeedback headbands into the mobile app. Each user can pair
one or more BCI headbands; we identify them by their hardware serial number.

On every app start and each time the BCI screen opens, the mobile app fetches the list of
serials the user has previously paired, so it can auto-connect to any device found in range.
The server is the source of truth for cross-device sync; we also cache the list locally on
the phone for offline startup.

## What we need

A lightweight **`BciDevice`** resource scoped to the authenticated user. This is **not** a
field on the User object — it owns its own lifecycle (add, remove, rename).

### Entity fields

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID FK | references `users.id`, cascade delete |
| `serial` | varchar | hardware serial from `neiry_kit` `DeviceInfo.serial` |
| `alias` | varchar, nullable | user-given name, e.g. "My Headband" |
| `last_connected_at` | timestamptz, nullable | updated on each successful session |
| `created_at` | timestamptz | insertion time |

Unique constraint on `(user_id, serial)` — a serial may only appear once per user.

### Endpoints needed

| Method | Path | Description |
|---|---|---|
| `GET` | `/bci/devices` | Return all `BciDevice` records for the current user |
| `POST` | `/bci/devices` | Register a new paired device (`serial` required, `alias` optional) |
| `PATCH` | `/bci/devices/:id` | Update `alias` and/or `last_connected_at` |
| `DELETE` | `/bci/devices/:id` | Remove a paired device |

All endpoints require a valid JWT (standard auth middleware). Guard against accessing another
user's devices.

### Proto contract

We will need a proto message and service for this once the REST endpoints are stable, so the
mobile gRPC client can consume it. Coordinate with the mobile team before authoring — the
contract must live in `mind_api/proto/` per the monorepo rules.

For now, REST is sufficient for the pairing screen.

## What we already have on mobile

- `neiry_kit` plugin wired up in `mind_mobile` (Flutter).
- `DeviceLocator.requestDevices()` → `Stream<List<DeviceInfo>>` where each `DeviceInfo` carries a `serial`.
- `BciDeviceManager` (to be implemented) will call this API on startup: fetch serials → scan → auto-connect match.

## Open questions for the API team

1. Should `last_connected_at` be updated by the mobile client on `PATCH`, or inferred server-side from a session event? (Mobile approach is simpler to start with.)
2. Is there an existing module / folder convention we should follow for a new `bci/` module in the NestJS app?
3. Any preference on whether the migration goes into a dedicated `bci_devices` table or piggybacks on an existing schema group?
