# Project Rules

## NEVER use non-null assertion operator (`!`)

`payload.email!` — forbidden. Always use an explicit check:

```typescript
// WRONG
email = payload.email!;

// CORRECT
if (!payload.email) {
  throw new Error('...');
}
email = payload.email;
```

Force-unwrapping silently pushes undefined downstream. Explicit checks fail loudly with a meaningful error message in the logs.

## NEVER log sensitive data

Email addresses, tokens, OTP codes, passwords, payment details, and any PII must never appear in logs — not even at DEBUG level. Log IDs and outcomes only.

```typescript
// WRONG
this.logger.log(`sendCode: email=${email} code=${code}`);

// CORRECT
this.logger.log(`sendCode: sent codeId=${savedCode.id}`);
```

## Keep logs lean

Do NOT log function entry/exit or intermediate state. Log errors and key business outcomes only.

## Always use `@Payload()` on the request parameter in gRPC methods that also use `@GrpcCurrentUser()`

If any parameter in a gRPC method has a custom decorator (`@GrpcCurrentUser()`), NestJS
switches to explicit injection mode and only fills parameters that are explicitly decorated.
The request parameter without `@Payload()` will be `undefined` at runtime.

```typescript
// WRONG
async getChanges(
  request: GetChangesRequest,
  @GrpcCurrentUser() user: JwtPayload,
)

// CORRECT
async getChanges(
  @Payload() request: GetChangesRequest,
  @GrpcCurrentUser() user: JwtPayload,
)
```

This applies to every gRPC method that uses `@GrpcCurrentUser()`, regardless of whether
the method is required-auth or optional-auth.
