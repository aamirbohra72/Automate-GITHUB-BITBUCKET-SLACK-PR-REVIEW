import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseBitbucketWebhook } from '../src/handlers/bitbucket.js';
import { parseGitHubWebhook } from '../src/handlers/github.js';

const githubFixture = JSON.parse(
  await readFile(new URL('./fixtures/github-pull-request.json', import.meta.url), 'utf8')
) as unknown;
const bitbucketFixture = JSON.parse(
  await readFile(new URL('./fixtures/bitbucket-pull-request.json', import.meta.url), 'utf8')
) as unknown;

describe('webhook payload parsers', () => {
  it('normalizes GitHub pull requests and ignores unsupported actions', () => {
    const [event] = parseGitHubWebhook('pull_request', githubFixture);
    expect(event).toMatchObject({
      platform: 'github',
      repo: 'acme/api',
      prId: '42',
      status: 'opened'
    });
    expect(parseGitHubWebhook('push', githubFixture)).toEqual([]);
    expect(parseGitHubWebhook('pull_request', { action: 'labeled' })).toEqual([]);
  });

  it('normalizes Bitbucket Cloud pull request events defensively', () => {
    const [event] = parseBitbucketWebhook('pullrequest:approved', bitbucketFixture);
    expect(event).toMatchObject({
      platform: 'bitbucket',
      repo: 'acme/api',
      prId: '17',
      status: 'approved'
    });
    expect(parseBitbucketWebhook('pullrequest:created', {})).toEqual([]);
  });
});
