import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApiApp, normalizeVercelApiRequest } from '../server/apiApp';

const app = createApiApp();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  normalizeVercelApiRequest(req);
  return app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
