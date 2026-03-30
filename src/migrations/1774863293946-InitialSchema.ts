import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1774863293946 implements MigrationInterface {
  name = 'InitialSchema1774863293946';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ------------------------------------------------------------------ //
    // 1. Extension
    // ------------------------------------------------------------------ //
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ------------------------------------------------------------------ //
    // 2. Enums
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."users_role_enum" AS ENUM('user', 'admin');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."module_sessions_status_enum" AS ENUM(
          'active', 'disconnected', 'completed', 'abandoned', 'interrupted', 'resumed'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."activity_type_enum" AS ENUM('breath');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."breath_sessions_timeOfDay_enum" AS ENUM('morning', 'midday', 'evening');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$
    `);

    // ------------------------------------------------------------------ //
    // 3. Tables (FK-dependency order)
    // ------------------------------------------------------------------ //

    // users
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"        uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email"     character varying NOT NULL,
        "name"      character varying NOT NULL,
        "language"  character varying(10) NOT NULL DEFAULT 'en',
        "role"      "public"."users_role_enum" NOT NULL DEFAULT 'user',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users_id"    PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_users_email" ON "users" ("email")`,
    );

    // auth_codes
    await queryRunner.query(`
      CREATE TABLE "auth_codes" (
        "id"        uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email"     character varying NOT NULL,
        "codeHash"  character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "expiresAt" TIMESTAMP NOT NULL,
        "used"      boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_auth_codes_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_auth_codes_email"     ON "auth_codes" ("email")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_auth_codes_code_hash" ON "auth_codes" ("codeHash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_auth_codes_expires_at" ON "auth_codes" ("expiresAt")`,
    );

    // user_sessions
    await queryRunner.query(`
      CREATE TABLE "user_sessions" (
        "id"         uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId"     uuid NOT NULL,
        "tokenHash"  character varying NOT NULL,
        "createdAt"  TIMESTAMP NOT NULL DEFAULT now(),
        "lastSeenAt" TIMESTAMP DEFAULT NULL,
        CONSTRAINT "PK_user_sessions"           PRIMARY KEY ("id"),
        CONSTRAINT "UQ_user_sessions_tokenHash" UNIQUE ("tokenHash"),
        CONSTRAINT "FK_user_sessions_userId"
          FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_user_sessions_tokenHash" ON "user_sessions" ("tokenHash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_sessions_userId"    ON "user_sessions" ("userId")`,
    );

    // devices
    await queryRunner.query(`
      CREATE TABLE "devices" (
        "id"              uuid NOT NULL DEFAULT uuid_generate_v4(),
        "installation_id" character varying NOT NULL,
        "platform"        character varying NOT NULL,
        "os_version"      character varying NOT NULL,
        "locale"          character varying NOT NULL,
        "timezone"        character varying NOT NULL,
        "screen_width"    integer NOT NULL,
        "screen_height"   integer NOT NULL,
        "app_version"     character varying NOT NULL,
        "build_number"    character varying NOT NULL,
        "model"           character varying DEFAULT NULL,
        "manufacturer"    character varying DEFAULT NULL,
        "last_seen_at"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "created_at"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_devices_id"              PRIMARY KEY ("id"),
        CONSTRAINT "UQ_devices_installation_id" UNIQUE ("installation_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_devices_last_seen_at" ON "devices" ("last_seen_at" DESC)`,
    );

    // breath_sessions
    await queryRunner.query(`
      CREATE TABLE "breath_sessions" (
        "id"          uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId"      uuid NOT NULL,
        "description" text NOT NULL,
        "exercises"   jsonb NOT NULL,
        "complexity"  double precision NOT NULL DEFAULT 0,
        "shared"      boolean NOT NULL DEFAULT false,
        "timeOfDay"   "public"."breath_sessions_timeOfDay_enum" DEFAULT NULL,
        "createdAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt"   TIMESTAMP WITH TIME ZONE DEFAULT NULL,
        CONSTRAINT "PK_breath_sessions_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_breath_sessions_userId"
          FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_breath_sessions_userId"           ON "breath_sessions" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_breath_sessions_shared"           ON "breath_sessions" ("shared")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_breath_sessions_createdAt"        ON "breath_sessions" ("createdAt" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_breath_sessions_userId_createdAt" ON "breath_sessions" ("userId", "createdAt" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_breath_sessions_shared_createdAt" ON "breath_sessions" ("shared", "createdAt" DESC)`,
    );

    // Trigger: keep updatedAt in sync for breath_sessions
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW."updatedAt" = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql'
    `);
    await queryRunner.query(`
      CREATE TRIGGER update_breath_sessions_updated_at
        BEFORE UPDATE ON "breath_sessions"
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
    `);

    // breath_session_settings
    await queryRunner.query(`
      CREATE TABLE "breath_session_settings" (
        "id"        uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId"    uuid NOT NULL,
        "sessionId" uuid NOT NULL,
        "starred"   boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_breath_session_settings_id"              PRIMARY KEY ("id"),
        CONSTRAINT "UQ_breath_session_settings_user_session"    UNIQUE ("userId", "sessionId"),
        CONSTRAINT "FK_breath_session_settings_userId"
          FOREIGN KEY ("userId")    REFERENCES "users"("id")           ON DELETE CASCADE,
        CONSTRAINT "FK_breath_session_settings_sessionId"
          FOREIGN KEY ("sessionId") REFERENCES "breath_sessions"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_breath_session_settings_userId_starred" ON "breath_session_settings" ("userId", "starred")`,
    );

    // user_stats
    await queryRunner.query(`
      CREATE TABLE "user_stats" (
        "id"                     uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId"                 character varying NOT NULL,
        "totalSessions"          integer NOT NULL DEFAULT 0,
        "totalDurationSeconds"   integer NOT NULL DEFAULT 0,
        "currentStreak"          integer NOT NULL DEFAULT 0,
        "longestStreak"          integer NOT NULL DEFAULT 0,
        "maxCompletedComplexity" double precision NOT NULL DEFAULT 0,
        "lastSessionDate"        date DEFAULT NULL,
        "updatedAt"              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_stats_id"     PRIMARY KEY ("id"),
        CONSTRAINT "UQ_user_stats_userId" UNIQUE ("userId")
      )
    `);

    // change_events
    await queryRunner.query(`
      CREATE TABLE "change_events" (
        "id"        SERIAL PRIMARY KEY,
        "entity"    character varying NOT NULL,
        "refId"     uuid NOT NULL,
        "action"    character varying NOT NULL,
        "userId"    uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "FK_change_events_userId"
          FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_change_events_userId_id" ON "change_events" ("userId", "id")`,
    );

    // personal_access_tokens
    await queryRunner.query(`
      CREATE TABLE "personal_access_tokens" (
        "id"         uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId"     uuid NOT NULL,
        "tokenHash"  character varying NOT NULL,
        "name"       character varying NOT NULL,
        "lastUsedAt" TIMESTAMP DEFAULT NULL,
        "createdAt"  TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_personal_access_tokens_id"       PRIMARY KEY ("id"),
        CONSTRAINT "UQ_personal_access_tokens_tokenHash" UNIQUE ("tokenHash")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_personal_access_tokens_userId" ON "personal_access_tokens" ("userId")`,
    );

    // module_sessions
    await queryRunner.query(`
      CREATE TABLE "module_sessions" (
        "id"             uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId"         character varying NOT NULL,
        "activityType"   "public"."activity_type_enum" NOT NULL,
        "activityRefId"  character varying DEFAULT NULL,
        "status"         "public"."module_sessions_status_enum" NOT NULL DEFAULT 'active',
        "startedAt"      TIMESTAMP NOT NULL,
        "disconnectedAt" TIMESTAMP WITH TIME ZONE DEFAULT NULL,
        "endedAt"        TIMESTAMP DEFAULT NULL,
        "lastActivityAt" TIMESTAMP NOT NULL,
        "metadata"       jsonb DEFAULT NULL,
        "createdAt"      TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_module_sessions_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_module_sessions_userId" ON "module_sessions" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_module_sessions_status" ON "module_sessions" ("status")`,
    );

    // session_stream_samples
    await queryRunner.query(`
      CREATE TABLE "session_stream_samples" (
        "id"              uuid NOT NULL DEFAULT uuid_generate_v4(),
        "moduleSessionId" character varying NOT NULL,
        "samples"         jsonb NOT NULL,
        "flushedAt"       TIMESTAMP NOT NULL,
        "createdAt"       TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_session_stream_samples_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_session_stream_samples_moduleSessionId" ON "session_stream_samples" ("moduleSessionId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse FK-dependency order

    // session_stream_samples
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_session_stream_samples_moduleSessionId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "session_stream_samples"`);

    // module_sessions
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_module_sessions_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_module_sessions_userId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "module_sessions"`);

    // personal_access_tokens
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_personal_access_tokens_userId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "personal_access_tokens"`);

    // change_events
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_change_events_userId_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "change_events"`);

    // user_stats
    await queryRunner.query(`DROP TABLE IF EXISTS "user_stats"`);

    // breath_session_settings
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_breath_session_settings_userId_starred"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "breath_session_settings"`);

    // breath_sessions (trigger + function + table)
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS update_breath_sessions_updated_at ON "breath_sessions"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS update_updated_at_column()`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_breath_sessions_shared_createdAt"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_breath_sessions_userId_createdAt"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_breath_sessions_createdAt"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_breath_sessions_shared"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_breath_sessions_userId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "breath_sessions"`);

    // devices
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_devices_last_seen_at"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "devices"`);

    // user_sessions
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_user_sessions_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_user_sessions_tokenHash"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "user_sessions"`);

    // auth_codes
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_auth_codes_expires_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_auth_codes_code_hash"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_auth_codes_email"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "auth_codes"`);

    // users
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_email"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users" CASCADE`);

    // Enums
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."breath_sessions_timeOfDay_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."activity_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."module_sessions_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."users_role_enum"`,
    );

    // Extension
    await queryRunner.query(`DROP EXTENSION IF EXISTS "uuid-ossp"`);
  }
}
