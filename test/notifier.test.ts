import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { Notifier } from '../src/services/notifier.js';
import type { PullRequestEvent, StoredPrMessage } from '../src/domain/types.js';

const event: PullRequestEvent = {
  platform: 'github',
  eventType: 'opened',
  repo: 'acme/api',
  prId: '42',
  title: 'A PR',
  url: 'https://github.com/acme/api/pull/42',
  author: 'author',
  sourceBranch: 'feature',
  targetBranch: 'main',
  description: '',
  reviewers: [],
  isDraft: false,
  status: 'opened',
  actor: 'author'
};

describe('Notifier', () => {
  it('creates one parent for the first event and replies to subsequent events', async () => {
    let stored: StoredPrMessage | null = null;
    const repository = {
      claimDelivery: vi.fn(async () => true),
      withPrLock: vi.fn(
        async (
          _event: PullRequestEvent,
          work: (
            current: StoredPrMessage | null,
            save: (value: StoredPrMessage) => Promise<void>
          ) => Promise<void>
        ) => {
          await work(stored, async (value) => {
            stored = value;
          });
        }
      )
    };
    const slack = {
      postMessage: vi.fn(async () => '123.45'),
      postReply: vi.fn(async () => undefined),
      updateMessage: vi.fn(async () => undefined)
    };
    const notifier = new Notifier(
      repository,
      slack,
      { repos: {}, userMap: {} },
      'C1',
      pino({ level: 'silent' })
    );
    await notifier.processDelivery('delivery-1', 'github', [event]);
    expect(slack.postMessage).toHaveBeenCalledOnce();
    await notifier.processDelivery('delivery-2', 'github', [
      { ...event, eventType: 'approved', status: 'approved' }
    ]);
    expect(slack.postReply).toHaveBeenCalledOnce();
    expect(slack.postMessage).toHaveBeenCalledOnce();
  });

  it('updates the parent status after a merge', async () => {
    const stored: StoredPrMessage = {
      platform: 'github',
      repo: 'acme/api',
      prId: '42',
      channelId: 'C1',
      slackTs: '123',
      status: 'opened'
    };
    const slack = {
      postMessage: vi.fn(),
      postReply: vi.fn(async () => undefined),
      updateMessage: vi.fn(async () => undefined)
    };
    const repository = {
      claimDelivery: vi.fn(async () => true),
      withPrLock: vi.fn(
        async (
          _event: PullRequestEvent,
          work: (
            current: StoredPrMessage | null,
            save: (value: StoredPrMessage) => Promise<void>
          ) => Promise<void>
        ) =>
          work(
            stored,
            vi.fn(async () => undefined)
          )
      )
    };
    const notifier = new Notifier(
      repository,
      slack,
      { repos: {}, userMap: {} },
      'C1',
      pino({ level: 'silent' })
    );
    await notifier.processDelivery('delivery-3', 'github', [
      { ...event, eventType: 'closed', status: 'merged' }
    ]);
    expect(slack.updateMessage).toHaveBeenCalledOnce();
  });

  it('creates a parent and a thread reply when a review arrives first', async () => {
    const slack = {
      postMessage: vi.fn(async () => '456.78'),
      postReply: vi.fn(async () => undefined),
      updateMessage: vi.fn(async () => undefined)
    };
    const repository = {
      claimDelivery: vi.fn(async () => true),
      withPrLock: vi.fn(
        async (
          _event: PullRequestEvent,
          work: (
            current: StoredPrMessage | null,
            save: (value: StoredPrMessage) => Promise<void>
          ) => Promise<void>
        ) =>
          work(
            null,
            vi.fn(async () => undefined)
          )
      )
    };
    const notifier = new Notifier(
      repository,
      slack,
      { repos: {}, userMap: {} },
      'C1',
      pino({ level: 'silent' })
    );
    await notifier.processDelivery('delivery-4', 'github', [
      { ...event, eventType: 'approved', status: 'approved' }
    ]);
    expect(slack.postMessage).toHaveBeenCalledOnce();
    expect(slack.postReply).toHaveBeenCalledOnce();
  });
});
