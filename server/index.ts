/**
 * Minimal Express server.
 *  - serves the built React app (dist/) in production
 *  - exposes /api/health and /api/providers so the UI can show honest provider status
 * There are no credentials, no external calls and no AWS / Amazon integration.
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '..', 'dist');
const app = express();
const port = Number(process.env.PORT ?? 3001);
const startedAt = Date.now();

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, app: 'LifePilot AI', uptimeSec: Math.round((Date.now() - startedAt) / 1000) });
});

app.get('/api/providers', (_req, res) => {
  res.json({
    default: 'local',
    providers: [
      { id: 'local', name: 'Local planner', available: true, requiresCredentials: false },
      { id: 'future-ai', name: 'Hosted AI planner', available: false, requiresCredentials: true },
    ],
  });
});

app.use('/api', (_req, res) => {
  res.status(404).json({ ok: false, error: 'Unknown API route' });
});

if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  app.get('/', (_req, res) => {
    res
      .status(200)
      .type('text/plain')
      .send('LifePilot AI API is running. Build the UI with "npm run build", or use "npm run dev" and open http://localhost:5173.');
  });
}

// Last-resort error handler: always JSON, never a stack trace.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : 'Unexpected server error';
  res.status(500).json({ ok: false, error: message });
});

app.listen(port, () => {
  console.log(`LifePilot AI server listening on http://localhost:${port}`);
});
