import { ArgumentsHost, Catch, Logger } from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';
import { HttpException } from '@nestjs/common';
import { Socket } from 'socket.io';
import { WS_EXCEPTION } from '../events/live.events';

@Catch(WsException, HttpException)
export class WsExceptionFilter extends BaseWsExceptionFilter {
  private readonly logger = new Logger(WsExceptionFilter.name);

  // NOTE: super.catch() is intentionally NOT called.
  // BaseWsExceptionFilter.catch() would emit 'exception' to the client itself —
  // calling it here would result in the client receiving two 'exception' events.
  // We handle the emit manually below.
  catch(exception: WsException | HttpException, host: ArgumentsHost): void {
    const client = host.switchToWs().getClient<Socket>();
    const event = host.switchToWs().getPattern();

    let messages: string | string[];
    if (exception instanceof WsException) {
      const error = exception.getError();
      messages =
        typeof error === 'string'
          ? error
          : ((error as { message?: string | string[] }).message ??
            String(error));
    } else {
      const response = exception.getResponse();
      messages =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message ??
            exception.message);
    }

    const messageList = Array.isArray(messages) ? messages : [messages];

    this.logger.warn(
      `WS validation error — event="${event ?? 'unknown'}" socketId=${client.id} errors=${JSON.stringify(messageList)}`,
    );

    client.emit(WS_EXCEPTION, {
      status: 'error',
      event,
      message: messageList,
    });
  }
}
