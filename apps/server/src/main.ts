import { buildApp } from './app.js';
import { runCli } from './cli.js';
import { loadConfig } from './config.js';

const config = loadConfig();
if (process.argv.length > 2) process.exit(runCli(process.argv.slice(2), config));
const { app } = await buildApp(config);

const shutdown = async (signal: string) => {
  app.log.info(`${signal} empfangen, fahre herunter`);
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.host, port: config.port });
