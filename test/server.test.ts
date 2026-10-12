import { createHmac } from 'node:crypto';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { buildServer } from '../src/server.js';
import type { Env } from '../src/config/env.js';

const env = {
  SLACK_BOT_TOKEN: 'xoxb-test',
  SLACK_DEFAULT_CHANNEL_ID: 'C1',
  GITHUB_WEBHOOK_SECRET: 'github-secret',
  BITBUCKET_WEBHOOK_SECRET: 'bitbucket-secret',
  DATABASE_URL: 'postgresql://x:y@ep-x-pooler.us-east-2.aws.neon.tech/db?sslmode=require',
  DATABASE_URL_DIRECT: 'postgresql://x:y@ep-x.us-east-2.aws.neon.tech/db?sslmode=require',
  CONFIG_PATH: './config.yaml',
  LOG_LEVEL: 'silent',
  PORT: 3000,
  NODE_ENV: 'test'
} satisfies Env;
const payload = JSON.stringify({
  action: 'opened',
  pull_request: {
    number: 4,
    title: 'A PR',
    user: { login: 'dev' },
    head: { ref: 'a' },
    base: { ref: 'b' }
  },
  repository: { full_name: 'org/repo' },
  sender: { login: 'dev' }
});
const signature = `sha256=${createHmac('sha256', env.GITHUB_WEBHOOK_SECRET).update(payload).digest('hex')}`;

describe('webhook HTTP route', () => {
  it('accepts a valid raw-body signature and schedules processing', async () => {
    const enqueue = vi.fn(() => true);
    const app = await buildServer({
      env,
      routing: { repos: {}, userMap: {} },
      queue: { enqueue },
      notifier: { processDelivery: vi.fn(async () => undefined) },
      healthCheck: vi.fn(async () => undefined),
      logger: pino({ level: 'silent' })
    });
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      payload,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature,
        'x-github-delivery': 'delivery-1',
        'x-github-event': 'pull_request'
      }
    });
    expect(response.statusCode).toBe(202);
    expect(enqueue).toHaveBeenCalledOnce();
    await app.close();
  });
});
