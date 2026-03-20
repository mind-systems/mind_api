# Patch: Batch Fetch Endpoint — Review 1

**Review:** `.ai-factory/reviews/05-batch-fetch-endpoint-review-1.md`

## Fix 1: Remove duplicate `@ApiQuery` decorator

**File:** `src/breath-sessions/breath-sessions.controller.ts`
**Problem:** The `@ApiQuery({ name: 'ids' })` decorator duplicates the `ids` query parameter in Swagger UI. The parameter is already auto-generated from `BatchQueryDto`'s `@ApiProperty` on the `ids` field. Other DTO-based query routes (`findList`, `getSuggestions`) don't use explicit `@ApiQuery`.

**Fix:** Delete the `@ApiQuery` decorator (lines 121–125) and remove the unused `ApiQuery` import.

```diff
 import {
   ApiBearerAuth,
   ApiOkResponse,
   ApiOperation,
-  ApiQuery,
   ApiResponse,
   ApiTags,
 } from '@nestjs/swagger';
```

```diff
   @UseGuards(OptionalJwtAuthGuard)
   @ApiOperation({ summary: 'Fetch multiple breath sessions by IDs' })
   @ApiResponse({ status: 200, type: [BreathSession] })
-  @ApiQuery({
-    name: 'ids',
-    required: true,
-    description: 'Comma-separated UUIDs (max 50)',
-  })
   @Get('batch')
   async findBatch(@Request() req, @Query() query: BatchQueryDto) {
```

## Fix 2: Use valid UUIDs in `@ApiProperty` example

**File:** `src/breath-sessions/dto/breath-session.dto.ts`
**Problem:** `example: 'uuid1,uuid2'` are not valid UUIDs. Using "Try it out" in Swagger UI will send these literal strings, which fail `@IsUUID('4')` validation and return a 400 error — making the example useless.

**Fix:** Replace with real v4 UUID-formatted strings.

```diff
 export class BatchQueryDto {
   @ApiProperty({
     description: 'Comma-separated session UUIDs (max 50)',
-    example: 'uuid1,uuid2',
+    example: '550e8400-e29b-41d4-a716-446655440000,6ba7b810-9dad-11d1-80b4-00c04fd430c8',
   })
```
