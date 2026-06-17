import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { extract, objectCarrier, runWithContext } from 'observe-js';

@Injectable()
export class TraceContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const carrier = objectCarrier(req.headers as Record<string, string>);
    const ctx = extract(carrier);

    if (!ctx) {
      next();
      return;
    }

    runWithContext(ctx, () => next());
  }
}
