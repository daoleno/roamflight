import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';

const port = Number(process.env.PORT || 4177);
const host = process.env.HOST || '0.0.0.0';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const server = createApp(root).listen(port, host, () =>
  console.log(`Geographical Adventures listening on ${host}:${port}`),
);
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.keepAliveTimeout = 5000;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
