import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { BioSessionSample } from '../entities/bio-session-sample.entity';
import { ModuleSession } from '../entities/module-session.entity';
import {
  BioSessionBuffer,
  BioSampleInternal,
} from '../interfaces/bio-session-buffer.interface';
import { SessionEvents } from '../events/session.events';
import { RealtimeConfig } from '../constants/realtime-config';

@Injectable()
export class BiometricStreamEngine
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(BiometricStreamEngine.name);
  private readonly buffers = new Map<string, BioSessionBuffer>();
  private readonly maxBufferBytes: number;
  private readonly maxSessions: number;
  private readonly _maxSamplesPerSecond: number;
  private readonly flushIntervalMs: number;
  private flushTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    @InjectRepository(BioSessionSample)
    private readonly sampleRepo: Repository<BioSessionSample>,
    @InjectRepository(ModuleSession)
    private readonly moduleSessionRepo: Repository<ModuleSession>,
    private readonly configService: ConfigService,
  ) {
    this.maxBufferBytes = this.configService.get<number>(
      RealtimeConfig.BIO_STREAM_MAX_BUFFER_BYTES,
      1048576,
    );
    this.maxSessions = this.configService.get<number>(
      RealtimeConfig.BIO_STREAM_MAX_SESSIONS,
      1000,
    );
    this._maxSamplesPerSecond = this.configService.get<number>(
      RealtimeConfig.BIO_BACKPRESSURE_SAMPLES_PER_SEC,
      50,
    );
    this.flushIntervalMs = this.configService.get<number>(
      RealtimeConfig.BIO_STREAM_FLUSH_INTERVAL_MS,
      5000,
    );
  }

  get maxSamplesPerSecond(): number {
    return this._maxSamplesPerSecond;
  }

  onApplicationBootstrap(): void {
    this.flushTimer = setInterval(() => {
      this.flushAll().catch((err: unknown) => {
        this.logger.error('Periodic flush failed', err);
      });
    }, this.flushIntervalMs);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.flushTimer !== undefined) {
      clearInterval(this.flushTimer);
    }
    await this.flushAll();
  }

  pushBatch(
    sessionId: string,
    samples: BioSampleInternal[],
  ): {
    acceptedCount: number;
    droppedCount: number;
    totalReceived: number;
    totalDropped: number;
  } {
    let buffer = this.buffers.get(sessionId);

    if (!buffer) {
      if (this.buffers.size >= this.maxSessions) {
        return {
          acceptedCount: 0,
          droppedCount: samples.length,
          totalReceived: 0,
          totalDropped: samples.length,
        };
      }
      buffer = {
        sessionId,
        samples: [],
        byteSize: 0,
        totalReceived: 0,
        totalDropped: 0,
      };
      this.buffers.set(sessionId, buffer);
    }

    let acceptedCount = 0;
    let droppedCount = 0;

    for (const sample of samples) {
      const sampleBytes = JSON.stringify(sample).length;

      if (buffer.byteSize + sampleBytes > this.maxBufferBytes) {
        buffer.totalDropped += 1;
        droppedCount += 1;
        // Continue — do not break. Preserves temporal density of accepted samples
        // around a drop; time-join analytics depends on neighbours being intact.
        continue;
      }

      buffer.samples.push(sample);
      buffer.byteSize += sampleBytes;
      buffer.totalReceived += 1;
      acceptedCount += 1;
    }

    return {
      acceptedCount,
      droppedCount,
      totalReceived: buffer.totalReceived,
      totalDropped: buffer.totalDropped,
    };
  }

  async flush(sessionId: string): Promise<void> {
    const buffer = this.buffers.get(sessionId);
    if (!buffer || buffer.samples.length === 0) {
      this.logger.debug(
        `flush: nothing to flush for sessionId=${sessionId} (buffer=${buffer ? 'exists, empty' : 'missing'})`,
      );
      return;
    }

    const samples = buffer.samples.slice();
    const now = new Date();

    await this.sampleRepo.save(
      this.sampleRepo.create({
        moduleSessionId: sessionId,
        samples: samples as unknown as Record<string, unknown>[],
        flushedAt: now,
      }),
    );

    // Clear only after successful save — do not reset cumulative counters
    buffer.samples = [];
    buffer.byteSize = 0;

    this.logger.log(
      `Flushed ${samples.length} bio samples for sessionId=${sessionId}`,
    );

    // Fire-and-forget — not awaited; a failure here is non-critical
    this.moduleSessionRepo
      .update({ id: sessionId }, { lastActivityAt: now })
      .catch((err: unknown) => {
        this.logger.error(
          `Failed to update lastActivityAt for sessionId=${sessionId}`,
          err,
        );
      });
  }

  async flushAll(): Promise<void> {
    const sessionIds = Array.from(this.buffers.keys());
    for (const sessionId of sessionIds) {
      try {
        await this.flush(sessionId);
      } catch (err: unknown) {
        this.logger.error(`Failed to flush sessionId=${sessionId}`, err);
      }
    }
  }

  @OnEvent(SessionEvents.COMPLETED)
  async onSessionCompleted(payload: { sessionId: string }): Promise<void> {
    this.logger.log(
      `onSessionCompleted: flushing bio buffer for sessionId=${payload.sessionId}`,
    );
    await this.flush(payload.sessionId);
    this.buffers.delete(payload.sessionId);
    this.logger.log(
      `onSessionCompleted: bio buffer cleared for sessionId=${payload.sessionId}`,
    );
  }

  @OnEvent(SessionEvents.ABANDONED)
  async onSessionAbandoned(payload: { sessionId: string }): Promise<void> {
    this.logger.log(
      `onSessionAbandoned: flushing bio buffer for sessionId=${payload.sessionId}`,
    );
    await this.flush(payload.sessionId);
    this.buffers.delete(payload.sessionId);
    this.logger.log(
      `onSessionAbandoned: bio buffer cleared for sessionId=${payload.sessionId}`,
    );
  }

  @OnEvent(SessionEvents.INTERRUPTED)
  async onSessionInterrupted(payload: { sessionId: string }): Promise<void> {
    this.logger.log(
      `onSessionInterrupted: flushing bio buffer for sessionId=${payload.sessionId}`,
    );
    await this.flush(payload.sessionId);
    this.buffers.delete(payload.sessionId);
    this.logger.log(
      `onSessionInterrupted: bio buffer cleared for sessionId=${payload.sessionId}`,
    );
  }

  @OnEvent(SessionEvents.REVOKED)
  async onSessionRevoked(payload: { sessionId: string }): Promise<void> {
    this.logger.log(
      `onSessionRevoked: flushing bio buffer for sessionId=${payload.sessionId}`,
    );
    await this.flush(payload.sessionId);
    this.buffers.delete(payload.sessionId);
    this.logger.log(
      `onSessionRevoked: bio buffer cleared for sessionId=${payload.sessionId}`,
    );
  }
}
