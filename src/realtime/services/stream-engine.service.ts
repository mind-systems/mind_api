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
import { SessionStreamSample } from '../entities/session-stream-sample.entity';
import { ModuleSession } from '../entities/module-session.entity';
import {
  SessionBuffer,
  TelemetrySample,
} from '../interfaces/session-buffer.interface';
import { SessionEvents } from '../events/session.events';
import { RealtimeConfig } from '../constants/realtime-config';

export interface PushResult {
  accepted: boolean;
  droppedCount: number;
  totalReceived: number;
}

@Injectable()
export class StreamEngine
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(StreamEngine.name);
  private readonly buffers = new Map<string, SessionBuffer>();
  private readonly maxBufferBytes: number;
  private readonly maxSessions: number;
  private readonly _maxSamplesPerSecond: number;
  private readonly flushIntervalMs: number;
  private flushTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    @InjectRepository(SessionStreamSample)
    private readonly sampleRepo: Repository<SessionStreamSample>,
    @InjectRepository(ModuleSession)
    private readonly moduleSessionRepo: Repository<ModuleSession>,
    private readonly configService: ConfigService,
  ) {
    this.maxBufferBytes = this.configService.get<number>(
      RealtimeConfig.STREAM_MAX_BUFFER_BYTES,
      204800,
    );
    this.maxSessions = this.configService.get<number>(
      RealtimeConfig.STREAM_MAX_SESSIONS,
      1000,
    );
    this._maxSamplesPerSecond = this.configService.get<number>(
      RealtimeConfig.BACKPRESSURE_SAMPLES_PER_SEC,
      50,
    );
    this.flushIntervalMs = this.configService.get<number>(
      RealtimeConfig.STREAM_FLUSH_INTERVAL_MS,
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

  push(sessionId: string, sample: TelemetrySample): PushResult {
    let buffer = this.buffers.get(sessionId);

    if (!buffer) {
      if (this.buffers.size >= this.maxSessions) {
        return { accepted: false, droppedCount: 1, totalReceived: 0 };
      }
      buffer = { sessionId, samples: [], byteSize: 0, totalReceived: 0 };
      this.buffers.set(sessionId, buffer);
    }

    const sampleBytes = JSON.stringify(sample).length;

    if (buffer.byteSize + sampleBytes > this.maxBufferBytes) {
      return {
        accepted: false,
        droppedCount: 1,
        totalReceived: buffer.totalReceived,
      };
    }

    buffer.samples.push(sample);
    buffer.byteSize += sampleBytes;
    buffer.totalReceived += 1;

    return {
      accepted: true,
      droppedCount: 0,
      totalReceived: buffer.totalReceived,
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
        liveSessionId: sessionId,
        samples,
        flushedAt: now,
      }),
    );

    // Clear only after successful save — preserves data on DB error
    buffer.samples = [];
    buffer.byteSize = 0;

    this.logger.log(
      `Flushed ${samples.length} samples for sessionId=${sessionId}`,
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
      `onSessionCompleted: flushing sessionId=${payload.sessionId}`,
    );
    await this.flush(payload.sessionId);
    this.buffers.delete(payload.sessionId);
    this.logger.log(
      `onSessionCompleted: buffer cleared for sessionId=${payload.sessionId}`,
    );
  }

  @OnEvent(SessionEvents.ABANDONED)
  async onSessionAbandoned(payload: { sessionId: string }): Promise<void> {
    this.logger.log(
      `onSessionAbandoned: flushing sessionId=${payload.sessionId}`,
    );
    await this.flush(payload.sessionId);
    this.buffers.delete(payload.sessionId);
    this.logger.log(
      `onSessionAbandoned: buffer cleared for sessionId=${payload.sessionId}`,
    );
  }

  @OnEvent(SessionEvents.INTERRUPTED)
  async onSessionInterrupted(payload: { sessionId: string }): Promise<void> {
    this.logger.log(
      `onSessionInterrupted: flushing sessionId=${payload.sessionId}`,
    );
    await this.flush(payload.sessionId);
    this.buffers.delete(payload.sessionId);
    this.logger.log(
      `onSessionInterrupted: buffer cleared for sessionId=${payload.sessionId}`,
    );
  }
}
