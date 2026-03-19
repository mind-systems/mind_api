/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */

// Запуск (БД локально / как сервис):
// userId=<uuid> npx ts-node --project tsconfig.json src/scripts/seed-breath-sessions.ts
//
// Запуск (БД в Docker):
// userId=<uuid> envFile=.env.seed.dev npx ts-node --project tsconfig.json src/scripts/seed-breath-sessions.ts

import 'reflect-metadata';
import { config } from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import {
  DataSource,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Index,
} from 'typeorm';

// 1. Load env
const envFile = process.env.envFile || '.env';
config({ path: path.resolve(process.cwd(), envFile), override: true });

// 2. Minimal entity definition (no src/ aliases)
@Entity('breath_sessions')
@Index(['userId', 'createdAt'])
@Index(['shared', 'createdAt'])
class BreathSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'userId' })
  @Index()
  userId: string;

  @Column('text')
  description: string;

  @Column('jsonb')
  exercises: object[];

  @Column({ type: 'float', default: 0 })
  complexity: number;

  @Column('boolean', { default: false })
  @Index()
  shared: boolean;

  @Column({ type: 'varchar', nullable: true })
  timeOfDay: string | null;

  @Column('timestamptz', { name: 'createdAt' })
  @Index()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

// 3. DataSource inline
const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.CONTAINER_DB_PORT || '5432'),
  username: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
  database: process.env.POSTGRES_DB || 'postgres',
  entities: [BreathSession],
  synchronize: false,
});

async function main() {
  const userId = process.env.userId;
  if (!userId) {
    console.error('Error: userId env variable is required');
    process.exit(1);
  }

  const jsonPath = path.resolve(__dirname, 'breath-sessions.json');
  const raw = fs.readFileSync(jsonPath, 'utf-8');
  const sessions = JSON.parse(raw);

  await AppDataSource.initialize();

  try {
    const repo = AppDataSource.getRepository(BreathSession);

    const now = new Date();
    const records = sessions.map((s: any, i: number) => ({
      userId,
      description: s.description,
      exercises: s.exercises,
      complexity: s.complexity ?? 0,
      shared: s.shared ?? false,
      timeOfDay: s.timeOfDay ?? null,
      createdAt: new Date(now.getTime() - i * 24 * 60 * 60 * 1000),
    }));

    await repo.insert(records);

    console.log(
      `Inserted ${records.length} breath sessions for userId=${userId}`,
    );
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
