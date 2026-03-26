# Patch: 04-breath-sessions-grpc-controller-ts

Review: `reviews/04-breath-sessions-grpc-controller-ts-review-1.md`

---

## Fix 1 — Replace `user!.sub` with explicit guard in `createSession`

**File:** `src/breath-sessions/breath-sessions.grpc.controller.ts`
**Problem:** `user!.sub` on line 56 violates RULES.md ("NEVER use non-null assertion operator").
**Pattern:** Match `AuthGrpcController.createToken` (line 94) and `UsersGrpcController.updateProfile` (line 31).

**Replace:**

```typescript
  async createSession(
    request: CreateSessionRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<BreathSessionDto> {
    const session = await this.breathSessionsService.create(user!.sub, {
```

**With:**

```typescript
  async createSession(
    request: CreateSessionRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<BreathSessionDto> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Authentication required',
      });
    }
    const session = await this.breathSessionsService.create(user.sub, {
```

---

## Fix 2 — Replace `user!.sub` with explicit guard in `getSuggestions`

**File:** `src/breath-sessions/breath-sessions.grpc.controller.ts`
**Problem:** `user!.sub` on line 92 violates RULES.md.

**Replace:**

```typescript
  async getSuggestions(
    request: GetSuggestionsRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<GetSuggestionsResponse> {
    const timeOfDay = fromProtoTimeOfDay(request.timeOfDay);
    const sessions = await this.breathSessionsService.findSuggestions(
      user!.sub,
      timeOfDay,
    );
```

**With:**

```typescript
  async getSuggestions(
    request: GetSuggestionsRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<GetSuggestionsResponse> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Authentication required',
      });
    }
    const timeOfDay = fromProtoTimeOfDay(request.timeOfDay);
    const sessions = await this.breathSessionsService.findSuggestions(
      user.sub,
      timeOfDay,
    );
```

---

## Fix 3 — Replace `user!.sub` with explicit guard in `updateSession`

**File:** `src/breath-sessions/breath-sessions.grpc.controller.ts`
**Problem:** `user!.sub` on line 152 violates RULES.md.

**Replace:**

```typescript
  async updateSession(
    request: UpdateSessionRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<BreathSessionDto> {
    const dto: {
```

**With:**

```typescript
  async updateSession(
    request: UpdateSessionRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<BreathSessionDto> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Authentication required',
      });
    }
    const dto: {
```

And also replace the call site — **Replace:**

```typescript
    const session = await this.breathSessionsService.update(
      request.id,
      user!.sub,
      dto,
    );
```

**With:**

```typescript
    const session = await this.breathSessionsService.update(
      request.id,
      user.sub,
      dto,
    );
```

---

## Fix 4 — Replace `user!.sub` with explicit guard in `replaceSession`

**File:** `src/breath-sessions/breath-sessions.grpc.controller.ts`
**Problem:** `user!.sub` on line 164 violates RULES.md.

**Replace:**

```typescript
  async replaceSession(
    request: ReplaceSessionRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<BreathSessionDto> {
    const session = await this.breathSessionsService.replace(
      request.id,
      user!.sub,
      {
```

**With:**

```typescript
  async replaceSession(
    request: ReplaceSessionRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<BreathSessionDto> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Authentication required',
      });
    }
    const session = await this.breathSessionsService.replace(
      request.id,
      user.sub,
      {
```

---

## Fix 5 — Replace `user!.sub` with explicit guard in `updateSessionSettings`

**File:** `src/breath-sessions/breath-sessions.grpc.controller.ts`
**Problem:** `user!.sub` on line 184 violates RULES.md.

**Replace:**

```typescript
  async updateSessionSettings(
    request: UpdateSessionSettingsRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<UpdateSessionSettingsResponse> {
    await this.breathSessionsService.findOne(request.id);
    const result = await this.breathSessionSettingsService.upsert(
      user!.sub,
```

**With:**

```typescript
  async updateSessionSettings(
    request: UpdateSessionSettingsRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<UpdateSessionSettingsResponse> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Authentication required',
      });
    }
    await this.breathSessionsService.findOne(request.id);
    const result = await this.breathSessionSettingsService.upsert(
      user.sub,
```

---

## Fix 6 — Replace `user!.sub` with explicit guard in `deleteSession`

**File:** `src/breath-sessions/breath-sessions.grpc.controller.ts`
**Problem:** `user!.sub` on line 195 violates RULES.md.

**Replace:**

```typescript
  async deleteSession(
    request: DeleteSessionRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<DeleteSessionResponse> {
    await this.breathSessionsService.remove(request.id, user!.sub);
```

**With:**

```typescript
  async deleteSession(
    request: DeleteSessionRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<DeleteSessionResponse> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Authentication required',
      });
    }
    await this.breathSessionsService.remove(request.id, user.sub);
```

---

## Fix 7 — Throw on unrecognized `ProtoTimeOfDay` instead of defaulting to MORNING

**File:** `src/grpc/grpc-mappers.ts`
**Problem:** `fromProtoTimeOfDay` (line 72-73) silently maps any unknown enum value to `TimeOfDay.MORNING`. A client sending `UNRECOGNIZED` (-1) or a future enum value would get their data silently corrupted.

**Replace:**

```typescript
export function fromProtoTimeOfDay(tod: ProtoTimeOfDay): TimeOfDay {
  switch (tod) {
    case ProtoTimeOfDay.MORNING:
      return TimeOfDay.MORNING;
    case ProtoTimeOfDay.MIDDAY:
      return TimeOfDay.MIDDAY;
    case ProtoTimeOfDay.EVENING:
      return TimeOfDay.EVENING;
    default:
      return TimeOfDay.MORNING;
  }
}
```

**With:**

```typescript
export function fromProtoTimeOfDay(tod: ProtoTimeOfDay): TimeOfDay {
  switch (tod) {
    case ProtoTimeOfDay.MORNING:
      return TimeOfDay.MORNING;
    case ProtoTimeOfDay.MIDDAY:
      return TimeOfDay.MIDDAY;
    case ProtoTimeOfDay.EVENING:
      return TimeOfDay.EVENING;
    default:
      throw new Error(`Unknown TimeOfDay value: ${tod}`);
  }
}
```

Note: This throws a plain `Error`, not `RpcException`, because `grpc-mappers.ts` is a pure utility module with no gRPC dependency. The `GrpcExceptionFilter` will catch it and convert to `INTERNAL`. If a more specific gRPC status code is desired, the calling controller can wrap the call in a try/catch and rethrow as `INVALID_ARGUMENT`.

---

## Fix 8 — Throw on unrecognized `StepType` instead of defaulting to 'inhale'

**File:** `src/grpc/grpc-mappers.ts`
**Problem:** `fromProtoStepType` (line 118-119) silently maps any unknown enum value to `'inhale'`. An exercise with the wrong step type changes the breathing pattern and the complexity calculation.

**Replace:**

```typescript
function fromProtoStepType(type: StepType): 'inhale' | 'exhale' | 'hold' {
  switch (type) {
    case StepType.EXHALE:
      return 'exhale';
    case StepType.HOLD:
      return 'hold';
    case StepType.INHALE:
    default:
      return 'inhale';
  }
}
```

**With:**

```typescript
function fromProtoStepType(type: StepType): 'inhale' | 'exhale' | 'hold' {
  switch (type) {
    case StepType.INHALE:
      return 'inhale';
    case StepType.EXHALE:
      return 'exhale';
    case StepType.HOLD:
      return 'hold';
    default:
      throw new Error(`Unknown StepType value: ${type}`);
  }
}
```
