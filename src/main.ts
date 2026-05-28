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
import { AppModule } from './app.module';
import helmet from 'helmet';

async function bootstrap() {
  const isProd = process.env.NODE_ENV === 'production';

  const logger = WinstonModule.createLogger({
    transports: [
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
    ],
  });

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
}

void bootstrap();
