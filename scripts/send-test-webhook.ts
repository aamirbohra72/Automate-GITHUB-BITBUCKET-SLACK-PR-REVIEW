import { createHmac } from 'node:crypto';

const target = process.env.WEBHOOK_URL;
const secret = process.env.GITHUB_WEBHOOK_SECRET;
if (!target || !secret) throw new Error('Set WEBHOOK_URL and GITHUB_WEBHOOK_SECRET.');

const payload = JSON.stringify({
  action: 'opened',
  pull_request: {
    number: 1,
    title: 'Test notification',
    html_url: 'https://github.com/example/repo/pull/1',
    body: 'Locally generated test event.',
    draft: false,
    user: { login: 'test-user' },
    head: { ref: 'feature/test' },
    base: { ref: 'main' },
    requested_reviewers: []
  },
  repository: { full_name: 'example/repo' },
  sender: { login: 'test-user' }
});
const signature = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
const response = await fetch(`${target.replace(/\/$/, '')}/webhooks/github`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-hub-signature-256': signature,
    'x-github-delivery': crypto.randomUUID(),
    'x-github-event': 'pull_request'
  },
  body: payload
});
console.log(`Webhook response: ${response.status} ${await response.text()}`);
