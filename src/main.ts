import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { join } from 'path';
import * as winston from 'winston';
import {
  WinstonModule,
  utilities as nestWinstonModuleUtilities,
} from 'nest-winston';
import DailyRotateFile = require('winston-daily-rotate-file');
import { init, flush, shutdown } from 'observe-js';
import { ObserveTransport } from 'observe-js/winston';
import { AppModule } from './app.module';
import helmet from 'helmet';

async function bootstrap() {
  const isProd = process.env.NODE_ENV === 'production';

  // Real env only — createLogger runs before ConfigModule parses .env.
  const logDestination = process.env.LOG_DESTINATION ?? 'file'; // file | grafana | both
  const logToFile = logDestination !== 'grafana';
  const logToGrafana = logDestination === 'grafana' || logDestination === 'both';
  const otlpEndpoint =
    process.env.OTLP_ENDPOINT ?? 'http://localhost:3100/otlp/v1/logs';

  if (logToGrafana) {
    init({
      project: 'mind',
      service: 'mind_api',
      endpoint: otlpEndpoint,
      onError: isProd ? undefined : (err) => console.error('[observe-js]', err),
    });
  }

  const transports: winston.transport[] = [];
  if (logToFile) {
    transports.push(
      new winston.transports.Console({
        level: process.env.LOG_LEVEL ?? 'info',
        format: isProd
          ? winston.format.json()
          : winston.format.combine(
              winston.format.timestamp(),
              winston.format.ms(),
              nestWinstonModuleUtilities.format.nestLike('MindAwakeAPI', {
                colors: true,
                prettyPrint: true,
              }),
            ),
      }),
      new DailyRotateFile({
        filename: 'logs/error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '14d',
        level: 'error',
      }),
      new DailyRotateFile({
        filename: 'logs/combined-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '14d',
      }),
    );
  }
  if (logToGrafana) {
    transports.push(new ObserveTransport());
  }

  const logger = WinstonModule.createLogger({ transports });

  const app = await NestFactory.create(AppModule, {
    logger,
  });

  const grpcUrl = process.env.GRPC_URL ?? '0.0.0.0:50051';
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      url: grpcUrl,
      package: 'mind',
      protoPath: [
        join(process.cwd(), 'proto', 'auth.proto'),
        join(process.cwd(), 'proto', 'breath_sessions.proto'),
        join(process.cwd(), 'proto', 'device.proto'),
        join(process.cwd(), 'proto', 'module_state.proto'),
        join(process.cwd(), 'proto', 'module_instruction_stream.proto'),
        join(process.cwd(), 'proto', 'stats.proto'),
        join(process.cwd(), 'proto', 'sync.proto'),
        join(process.cwd(), 'proto', 'users.proto'),
        join(process.cwd(), 'proto', 'bci_devices.proto'),
        join(process.cwd(), 'proto', 'module_biometric_stream.proto'),
        join(process.cwd(), 'proto', 'nfb_calibration.proto'),
        join(process.cwd(), 'proto', 'meditation_notes.proto'),
        join(process.cwd(), 'proto', 'meditation_poses.proto'),
      ],
    },
  });

  // Security
  app.use(helmet());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:8000',
    credentials: true,
    exposedHeaders: ['Authorization'], // чтобы видеть JWT
  });

  const port = process.env.CONTAINER_API_PORT || 3000;
  await app.startAllMicroservices();
  Logger.log(`gRPC server running on: ${grpcUrl}`);
  await app.listen(port);
  Logger.log(`🚀 Application is running on: http://localhost:${port}`);

  let shuttingDown = false;
  const onSignal = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Watchdog: never let a hung close block termination forever.
    setTimeout(() => process.exit(1), 10_000).unref();
    try {
      await app.close(); // FIRST: drain in-flight requests; their logs are captured
      if (logToGrafana) {
        await flush(); // THEN: drain the SDK buffer (incl. close-time logs)
        await shutdown();
      }
    } catch (err) {
      if (!isProd) console.error('[shutdown]', err); // non-prod only, raw console — never the host logger
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}

void bootstrap();
