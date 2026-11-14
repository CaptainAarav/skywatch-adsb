// Entry point: HTTP server + recorders, graceful shutdown on SIGTERM / SIGINT.
import { loadConfig } from './config.js';
import { createApp, VERSION } from './http.js';
import { startRecorders } from './recorder.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const server = createApp(cfg);
  const ac = new AbortController();
  server.listen(cfg.port, cfg.host, () => {
    console.log(`skywatch-server ${VERSION}: http://${cfg.host}:${cfg.port}/  data=${cfg.dataDir}  upstream=${cfg.readsbUrl ? 'configured' : 'none (static only)'}  publicDemo=${cfg.publicDemo}`);
  });
  const done = startRecorders(cfg, ac.signal);
  const stop = (sig: string): void => {
    console.log(`${sig}: shutting down`);
    ac.abort();
    server.close(() => void done.then(() => process.exit(0)));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}
main().catch((e) => { console.error('fatal:', (e as Error).message); process.exit(1); });
