import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WsException } from '@nestjs/websockets';

@Injectable()
export class WsPayloadSizeGuard implements CanActivate {
  private readonly maxPayloadBytes: number;

  constructor(configService: ConfigService) {
    this.maxPayloadBytes = configService.get<number>(
      'WS_MAX_PAYLOAD_BYTES',
      65536,
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const wsContext = context.switchToWs();
    const payload: unknown = wsContext.getData();
    let size: number;
    try {
      size = JSON.stringify(payload).length;
    } catch {
      throw new WsException('Payload is not serializable');
    }
    if (size > this.maxPayloadBytes) {
      throw new WsException(
        `Payload too large (${size} bytes, max ${this.maxPayloadBytes})`,
      );
    }
    return true;
  }
}
