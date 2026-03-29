import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ModuleSession } from '../entities/module-session.entity';
import { SessionStatus } from '../enums/session-status.enum';

@Injectable()
export class StartupRecoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StartupRecoveryService.name);

  constructor(
    @InjectRepository(ModuleSession)
    private readonly repo: Repository<ModuleSession>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const orphans = await this.repo.find({
      where: [
        { status: SessionStatus.ACTIVE },
        { status: SessionStatus.DISCONNECTED },
      ],
    });
    if (orphans.length === 0) return;
    const now = new Date();
    await this.repo.save(
      orphans.map((s) => ({
        ...s,
        status: SessionStatus.ABANDONED,
        endedAt: now,
      })),
    );
    this.logger.warn(
      `Startup recovery: abandoned ${orphans.length} orphan session(s)`,
    );
  }
}
