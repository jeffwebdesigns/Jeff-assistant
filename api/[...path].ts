import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApiApp } from '../server/apiApp';

const app = createApiApp();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const rawUrl = req.url ?? '/';
  if (!rawUrl.startsWith('/api')) {
    req.url = rawUrl.startsWith('/') ? `/api${rawUrl}` : `/api/${rawUrl}`;
  }
  return app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
