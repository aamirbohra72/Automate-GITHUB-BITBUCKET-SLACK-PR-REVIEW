import 'dotenv/config';
import { setTimeout as delay } from 'node:timers/promises';
import { loadEnv } from './config/env.js';
import { loadRouting } from './config/routing.js';
import { createDatabase } from './db/client.js';
import { Repository } from './db/repository.js';
import { JobQueue } from './queue/jobQueue.js';
import { buildServer } from './server.js';
import { SlackClient } from './slack/client.js';
import { Notifier } from './services/notifier.js';
import { createLogger } from './utils/logger.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const routing = await loadRouting(env.CONFIG_PATH);
  const { pool, db } = createDatabase(env.DATABASE_URL, logger);
  const repository = new Repository(db, logger);
  const slack = new SlackClient(env.SLACK_BOT_TOKEN, logger);
  const notifier = new Notifier(repository, slack, routing, env.SLACK_DEFAULT_CHANNEL_ID, logger);
  const queue = new JobQueue(4, 1000, logger);
  const app = await buildServer({
    env,
    routing,
    queue,
    notifier,
    healthCheck: () => repository.healthCheck(),
    logger
  });

  const cleanupTimer = setInterval(
    () => {
      void repository
        .cleanupDeliveries()
        .then((deleted) => logger.info({ deleted }, 'Expired delivery records cleaned up'))
        .catch((error: unknown) => logger.error({ error }, 'Delivery cleanup failed'));
    },
    24 * 60 * 60 * 1000
  );
  cleanupTimer.unref();

  await app.listen({ host: '0.0.0.0', port: env.PORT });
  logger.info({ port: env.PORT }, 'PR Slack notifier started');

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    clearInterval(cleanupTimer);
    await app.close();
    await queue.close();
    await pool.end();
    await delay(0);
  };

  process.once(
    'SIGTERM',
    () =>
      void shutdown('SIGTERM').catch((error: unknown) => {
        logger.error({ error }, 'Shutdown failed');
        process.exitCode = 1;
      })
  );
  process.once(
    'SIGINT',
    () =>
      void shutdown('SIGINT').catch((error: unknown) => {
        logger.error({ error }, 'Shutdown failed');
        process.exitCode = 1;
      })
  );
}

main().catch((error: unknown) => {
  const logger = createLogger(process.env.LOG_LEVEL ?? 'info');
  logger.fatal({ error }, 'Service startup failed');
  process.exitCode = 1;
});
