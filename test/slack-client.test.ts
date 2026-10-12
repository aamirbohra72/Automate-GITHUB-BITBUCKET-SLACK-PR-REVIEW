import nock from 'nock';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { SlackClient } from '../src/slack/client.js';

const scope = 'https://slack.com';
afterEach(() => nock.cleanAll());

describe('SlackClient', () => {
  it('posts a message through the Slack Web API', async () => {
    nock(scope).post('/api/chat.postMessage').reply(200, { ok: true, channel: 'C1', ts: '123.45' });
    const client = new SlackClient('xoxb-test', pino({ level: 'silent' }));
    await expect(client.postMessage('C1', 'hello', [])).resolves.toBe('123.45');
    expect(nock.isDone()).toBe(true);
  });
});
