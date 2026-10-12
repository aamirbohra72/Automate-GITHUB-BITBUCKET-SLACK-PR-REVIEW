import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { Logger } from 'pino';
import type { Env } from './config/env.js';
import type { RoutingConfig } from './config/routing.js';
import { parseBitbucketWebhook } from './handlers/bitbucket.js';
import { parseGitHubWebhook } from './handlers/github.js';
import { verifyBitbucketSignature, verifyGitHubSignature } from './security/signature.js';
import type { Notifier } from './services/notifier.js';
import type { JobQueue } from './queue/jobQueue.js';

interface ServerDependencies {
  env: Env;
  routing: RoutingConfig;
  queue: Pick<JobQueue, 'enqueue'>;
  notifier: Pick<Notifier, 'processDelivery'>;
  healthCheck: () => Promise<void>;
  logger: Logger;
}

export async function buildServer(deps: ServerDependencies) {
  const app = Fastify({
    loggerInstance: deps.logger,
    bodyLimit: 1024 * 1024,
    genReqId: () => crypto.randomUUID()
  });
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

  app.get('/health', async (_request, reply) => {
    try {
      await deps.healthCheck();
      return reply.code(200).send({ status: 'ok' });
    } catch (error) {
      deps.logger.error({ error }, 'Health check failed');
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  app.post('/webhooks/github', async (request, reply) => {
    const raw = rawBody(request.body);
    if (
      !verifyGitHubSignature(
        raw,
        header(request, 'x-hub-signature-256'),
        deps.env.GITHUB_WEBHOOK_SECRET
      )
    ) {
      return reply.code(401).send({ error: 'invalid signature' });
    }
    return acceptWebhook({
      platform: 'github',
      raw,
      deliveryId: header(request, 'x-github-delivery'),
      eventName: header(request, 'x-github-event'),
      events: (eventName, payload) => parseGitHubWebhook(eventName, payload),
      reply,
      queue: deps.queue,
      notifier: deps.notifier,
      logger: deps.logger
    });
  });

  app.post('/webhooks/bitbucket', async (request, reply) => {
    const raw = rawBody(request.body);
    if (
      !verifyBitbucketSignature(
        raw,
        header(request, 'x-hub-signature'),
        deps.env.BITBUCKET_WEBHOOK_SECRET
      )
    ) {
      return reply.code(401).send({ error: 'invalid signature' });
    }
    return acceptWebhook({
      platform: 'bitbucket',
      raw,
      deliveryId: header(request, 'x-request-uuid'),
      eventName: header(request, 'x-event-key'),
      events: (eventName, payload) => parseBitbucketWebhook(eventName, payload),
      reply,
      queue: deps.queue,
      notifier: deps.notifier,
      logger: deps.logger
    });
  });

  return app;
}

interface AcceptInput {
  platform: 'github' | 'bitbucket';
  raw: Buffer;
  deliveryId: string | undefined;
  eventName: string | undefined;
  events: (
    eventName: string | undefined,
    payload: unknown
  ) => ReturnType<typeof parseGitHubWebhook>;
  reply: import('fastify').FastifyReply;
  queue: Pick<JobQueue, 'enqueue'>;
  notifier: Pick<Notifier, 'processDelivery'>;
  logger: Logger;
}

async function acceptWebhook(input: AcceptInput): Promise<import('fastify').FastifyReply> {
  let payload: unknown;
  try {
    payload = JSON.parse(input.raw.toString('utf8')) as unknown;
  } catch {
    return input.reply.code(400).send({ error: 'invalid JSON' });
  }
  const events = input.events(input.eventName, payload);
  if (!events.length) return input.reply.code(200).send({ status: 'ignored' });
  if (!input.deliveryId) return input.reply.code(400).send({ error: 'missing delivery ID' });

  const accepted = input.queue.enqueue(async () => {
    try {
      await input.notifier.processDelivery(input.deliveryId as string, input.platform, events);
    } catch (error) {
      input.logger.error(
        {
          platform: input.platform,
          eventType: input.eventName,
          repo: events[0]?.repo,
          prId: events[0]?.prId,
          deliveryId: input.deliveryId,
          error
        },
        'Webhook processing failed'
      );
    }
  });
  if (!accepted) return input.reply.code(503).send({ error: 'webhook queue is full' });
  return input.reply.code(202).send({ status: 'accepted' });
}

function rawBody(body: unknown): Buffer {
  return Buffer.isBuffer(body) ? body : Buffer.alloc(0);
}

function header(request: import('fastify').FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
