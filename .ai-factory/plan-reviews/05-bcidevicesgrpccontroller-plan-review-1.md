# Plan Review: `05-bcidevicesgrpccontroller.md`

**Risk Level:** 🟡 Medium — one task is based on a false premise about the current state of the codebase; otherwise sound.

## Context Gates

- **ARCHITECTURE.md / RULES.md / ROADMAP.md** — Plan aligns with the modular monolith rule (no cross-module `@InjectRepository`), the `@Payload()` + `@GrpcCurrentUser()` rule in `.ai-factory/RULES.md`, and the Phase 16 milestone in `ROADMAP.md`. No gate failures.

## Critical Issues

### 1. Task 5 is based on a false premise (file paths to "fix" are already correct)

The plan claims:

> The current stub uses absolute `src/grpc/...` imports for `GrpcExceptionFilter` and `GrpcAuthInterceptor`. Change both to relative paths...

Reading the current stub (`src/bci/bci-devices.grpc.controller.ts`, lines 1–11):

```ts
import { Controller, UseFilters, UseInterceptors } from '@nestjs/common';
import { GrpcExceptionFilter } from '../grpc/grpc-exception.filter';
import { GrpcAuthInterceptor } from '../grpc/grpc-auth.interceptor';
import { BciDeviceService } from './bci-device.service';
```

Both imports already use relative paths (`../grpc/...`). Task 5 has nothing to do. The corresponding Commit 2 ("Normalize imports and verify build") then collapses into a build/lint-only commit.

**Recommendation:** Delete Task 5 entirely and fold Task 6 into Commit 1, OR re-scope Task 5 to verify import style consistency (no edits expected) and merge with Task 6.

## Issues

### 2. Mapper helper location diverges from project convention without justification

Task 1 places the entity → proto mapper as a file-local function at the bottom of `bci-devices.grpc.controller.ts`, with the rationale that this "matches the `toProto*` mapper style used in `src/grpc/grpc-mappers.ts`".

That rationale is reversed: `src/grpc/grpc-mappers.ts` is the **central, exported** location for `toProto*` mappers (`toProtoUserDto`, `toProtoBreathSession`, …) — they are not file-local in their respective controller files. Putting the mapper in the controller file is a deviation from the existing pattern, not a match.

Either is workable for a single small mapper, but the justification quoted in the plan is incorrect. If consistency with `grpc-mappers.ts` is the goal, the mapper should be added there as `toProtoBciDevice` and imported. If file-local is the deliberate choice (because there's only one mapper and it's trivial), the rationale should say so explicitly rather than claiming an inverted precedent.

**Recommendation:** Either (a) place the mapper in `src/grpc/grpc-mappers.ts` to match the actual project convention, or (b) keep it file-local but correct the rationale in Task 1.

### 3. Import bullet syntax is shorthand and should be made explicit

Task 2's import list includes:

> - `type { JwtPayload }` from `../users/interfaces/auth.interface`

This is shorthand for `import type { JwtPayload } from '...'`. The neighboring `sync-stream.grpc.controller.ts` uses the full `import type { JwtPayload } from '../users/interfaces/auth.interface'` form. A literal reader of the bullet might write `import { type JwtPayload }` instead, which works but mixes styles. Clarify to explicitly call out `import type { ... }`.

## Notes (non-blocking)

- **Signatures match the generated proto controller interface** (`BciDevicesServiceController` in `proto/generated/bci_devices.ts:234–240`): `list` returns `Promise<ListBciDevicesResponse>`, `register` returns `Promise<BciDevice>`, `delete` returns `void | Promise<void>` — the plan's `Promise<Empty>` is a strict supertype-compatible choice and matches the `return {}` body. ✅
- **`JwtPayload.sub` is the correct user id field** (`src/users/interfaces/auth.interface.ts:2-6`). ✅
- **`BciDeviceService` method signatures match what the plan calls**: `listForUser(userId)`, `register(userId, serial)`, `delete(userId, id)` — verified against `src/bci/bci-device.service.ts:15–66`. ✅
- **Date → ISO-8601 conversion** correctly handled in the mapper (`createdAt.toISOString()`); matches Phase 16 milestone requirement and the `SyncEventDto` precedent. ✅
- **No DTO validation in the controller** — correctly noted that `RegisterBciDeviceDto` (created in milestone 3) is for REST-style class-validator, not gRPC. The generated proto messages already enforce field types. ✅
- **Auth interceptor handles missing/invalid token** before the method runs; the explicit `if (!user)` guard in each RPC is defense-in-depth and matches the sync-stream precedent. ✅
- **Commit Plan**: with Task 5 dropped/folded, Commit 2 becomes "verify build" only — consider dropping the second commit and squashing into a single commit (the verification step changes no files).

## Positive Notes

- Plan explicitly cites `.ai-factory/RULES.md` for the `@Payload()` requirement and explains the runtime consequence (NestJS explicit injection mode) — exactly the kind of guard that prevents the bug from recurring.
- The `BciDevice` (entity) vs `BciDeviceProto` (proto) symbol collision is identified and resolved up front by import aliasing, rather than discovered at compile time.
- Service method contracts (`listForUser`, `register`, `delete`) and their existing error handling (`NOT_FOUND` / `PERMISSION_DENIED` raised inside the service) are correctly delegated; the controller does not re-throw or wrap.
- Modelled on `sync-stream.grpc.controller.ts` as the milestone requires; relative-import style, decorator stack, and `JwtPayload | null` typing all match.

