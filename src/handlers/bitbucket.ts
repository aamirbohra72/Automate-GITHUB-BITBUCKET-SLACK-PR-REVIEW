import { z } from 'zod';
import type { PullRequestEvent, PullRequestStatus } from '../domain/types.js';

const recordSchema = z.record(z.string(), z.unknown());
type UnknownRecord = Record<string, unknown>;

const eventStatuses: Record<string, PullRequestStatus> = {
  'pullrequest:created': 'opened',
  'pullrequest:updated': 'updated',
  'pullrequest:approved': 'approved',
  'pullrequest:unapproved': 'unapproved',
  'pullrequest:changes_request_created': 'changes_requested',
  'pullrequest:fulfilled': 'merged',
  'pullrequest:rejected': 'declined',
  'pullrequest:comment_created': 'commented'
};

export function parseBitbucketWebhook(
  eventName: string | undefined,
  payload: unknown
): PullRequestEvent[] {
  const status = eventName ? eventStatuses[eventName] : undefined;
  const root = asRecord(payload);
  const pr = asRecord(root?.pullrequest);
  const repository = asRecord(root?.repository);
  if (!status || !root || !pr || !repository) return [];

  const repo = text(repository.full_name);
  const prId = text(pr.id);
  if (!repo || !prId) return [];

  const author = asRecord(pr.author);
  const source = asRecord(pr.source);
  const destination = asRecord(pr.destination);
  const sourceBranch = asRecord(source?.branch);
  const targetBranch = asRecord(destination?.branch);
  const reviewers = Array.isArray(pr.reviewers)
    ? pr.reviewers.map((value) => reviewerName(value)).filter(isDefined)
    : [];
  const comment = asRecord(root.comment);
  const event: PullRequestEvent = {
    platform: 'bitbucket',
    eventType: eventName ?? status,
    repo,
    prId,
    title: text(pr.title) ?? 'Untitled pull request',
    url: nestedText(pr.links, 'html', 'href') ?? '',
    author: accountName(author) ?? 'unknown',
    sourceBranch: text(sourceBranch?.name) ?? '',
    targetBranch: text(targetBranch?.name) ?? '',
    description: text(pr.description) ?? '',
    reviewers,
    isDraft: pr.draft === true,
    status,
    actor: accountName(root.actor) ?? 'unknown',
    ...(eventName === 'pullrequest:comment_created'
      ? { commentText: text(asRecord(comment?.content)?.raw) ?? '' }
      : {})
  };
  return [event];
}

function accountName(value: unknown): string | undefined {
  const record = asRecord(value);
  return text(record?.display_name) ?? text(record?.nickname) ?? text(record?.account_id);
}

function reviewerName(value: unknown): string | undefined {
  const reviewer = asRecord(value);
  return (
    text(reviewer?.account_id) ??
    text(reviewer?.nickname) ??
    text(reviewer?.uuid) ??
    accountName(reviewer)
  );
}

function nestedText(value: unknown, first: string, second: string): string | undefined {
  return text(asRecord(asRecord(value)?.[first])?.[second]);
}

function asRecord(value: unknown): UnknownRecord | undefined {
  const result = recordSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
