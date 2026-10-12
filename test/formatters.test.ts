import { describe, expect, it } from 'vitest';
import { buildPullRequestBlocks } from '../src/slack/formatters.js';
import type { PullRequestEvent } from '../src/domain/types.js';

const event: PullRequestEvent = {
  platform: 'github',
  eventType: 'opened',
  repo: 'acme/api',
  prId: '42',
  title: 'Add <export>',
  url: 'https://github.com/acme/api/pull/42',
  author: 'octocat',
  sourceBranch: 'feature/export',
  targetBranch: 'main',
  description: 'x'.repeat(350),
  reviewers: ['reviewer-one'],
  isDraft: false,
  status: 'opened',
  actor: 'octocat'
};

describe('Slack formatting', () => {
  it('formats linked PR details, maps reviewers, and truncates descriptions', () => {
    const blocks = buildPullRequestBlocks(event, { 'reviewer-one': 'U123' });
    const serialized = JSON.stringify(blocks);
    expect(serialized).toContain('<@U123>');
    expect(serialized).toContain('&lt;export&gt;');
    expect(serialized).toContain('feature/export');
    expect(serialized).not.toContain('x'.repeat(350));
  });
});
