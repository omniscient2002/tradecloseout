import { NextFunction, Request, Response } from 'express';

/**
 * Applied before Nest routes, including unauthenticated endpoints and streamed
 * document responses. Intentionally does not set X-Frame-Options or
 * frame-ancestors on the API: same-site document previews may use an iframe.
 * Page framing is restricted separately in Next.js middleware.
 */
export function securityHeadersMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'private, no-store');
  next();
}
