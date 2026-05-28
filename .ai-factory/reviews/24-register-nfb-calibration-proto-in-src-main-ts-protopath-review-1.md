# Code Review: Register `nfb_calibration.proto` in `src/main.ts` protoPath

## Scope of change

Single-line append to the `protoPath` array in `src/main.ts` (one new entry at line 71):

```ts
join(process.cwd(), 'proto', 'nfb_calibration.proto'),
```

No other source files modified. The accompanying `.ai-factory/plans/` and `.ai-factory/plan-reviews/` markdown files are documentation only.

## Verification

- **Proto file exists.** `proto/nfb_calibration.proto` is present in the repo. ✅
- **Package matches.** The proto declares `package mind;`, matching the `package: 'mind'` configured on the microservice. The new service will be exposed under the same package as the other registered protos. ✅
- **Service is wired.** `NfbCalibrationModule` is imported in `src/app.module.ts:17,36`. `NfbCalibrationGrpcController` registers `@GrpcMethod('NfbCalibrationService', 'record')` and `@GrpcMethod('NfbCalibrationService', 'list')`, matching the service name and RPCs declared in the proto. ✅
- **Formatting.** New entry uses the same `join(process.cwd(), 'proto', '<file>'),` style with matching indentation as surrounding entries. ✅
- **Placement.** Appended to the end of the array, preserving the existing additive ordering convention. ✅

## Runtime risk assessment

- **No migrations** required for this change.
- **No type mismatches** — the entry is a `string` joined from string literals, matching the array's element type.
- **No race conditions** — bootstrap is synchronous up to the `connectMicroservice` call.
- **No startup-error risk** for the proto load itself: file exists, syntax is valid proto3, package name aligns.
- **gRPC method name casing.** Proto declares `rpc Record` / `rpc List` (PascalCase). The controller registers handlers as `'record'` / `'list'` (camelCase). This is the standard NestJS gRPC convention — `@nestjs/microservices` normalizes RPC names to camelCase when matching `@GrpcMethod` handlers. Other controllers in this repo use the same lowercase convention (consistency check), so this is not a regression introduced here. Not a finding.

## Findings

None.

REVIEW_PASS
