import { Request, Response, NextFunction } from 'express';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  // SSE routes flush headers early. Writing a JSON error body onto a response
  // that is already streaming throws ERR_HTTP_HEADERS_SENT and destroys the
  // socket, which the client sees as a stream that stopped without [DONE].
  // Close it cleanly instead and keep the original error in the log.
  if (res.headersSent) {
    if (!(err instanceof ApiError)) console.error('[Unhandled Error after headers sent]', err);
    res.end();
    return;
  }

  if (err instanceof ApiError) {
    const body: Record<string, unknown> = { error: err.message };
    if (err.details && process.env.NODE_ENV !== 'production') {
      body.details = err.details;
    }
    res.status(err.statusCode).json(body);
    return;
  }

  console.error('[Unhandled Error]', err);
  res.status(500).json({ error: 'Internal server error' });
}

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: 'Route not found' });
}
