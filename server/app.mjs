import express from 'express';
import helmet from 'helmet';
import sirv from 'sirv';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function createApp(root) {
  if (!existsSync(join(root, 'index.html')))
    throw new Error('Build missing: run npm run build first.');
  const app = express();
  app.disable('x-powered-by');
  app.use(
    helmet({
      strictTransportSecurity: false,
      contentSecurityPolicy: {
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'connect-src': ["'self'"],
          'font-src': ["'self'"],
          'object-src': ["'none'"],
          'upgrade-insecure-requests': null,
        },
      },
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
  app.get('/healthz', (_req, res) =>
    res
      .set('Cache-Control', 'no-store')
      .json({ status: 'ok', service: 'geographical-adventures', version: '0.2.0' }),
  );
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return res.status(405).set('Allow', 'GET, HEAD').end();
    next();
  });
  app.use(
    sirv(root, {
      etag: true,
      brotli: true,
      gzip: true,
      dotfiles: false,
      setHeaders(res, path) {
        if (/\.(?:bytes|bin|fbx)(?:\.(?:br|gz))?$/.test(path)) {
          res.setHeader('Content-Type', 'application/octet-stream');
        }
        const html = path === '/' || /\.html(?:\.(?:br|gz))?$/.test(path);
        const hashed = /-[\w-]{8,}\.(?:js|css)(?:\.(?:br|gz))?$/.test(path);
        res.setHeader(
          'Cache-Control',
          html
            ? 'no-cache'
            : hashed
              ? 'public, max-age=31536000, immutable'
              : 'public, max-age=3600, must-revalidate',
        );
      },
    }),
  );
  app.use((_req, res) => res.status(404).type('text').send('Not found'));
  app.use((error, _req, res, _next) => {
    console.error('Request failed:', error.message);
    res.status(500).type('text').send('Internal server error');
  });
  return app;
}
