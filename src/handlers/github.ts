import { z } from 'zod';
import type { PullRequestEvent, PullRequestStatus } from '../domain/types.js';

const recordSchema = z.record(z.string(), z.unknown());

type UnknownRecord = Record<string, unknown>;

export function parseGitHubWebhook(
  eventName: string | undefined,
  payload: unknown
): PullRequestEvent[] {
  const root = asRecord(payload);
  if (!root || !eventName) return [];

  if (eventName === 'pull_request') {
    const action = text(root.action);
    const pr = asRecord(root.pull_request);
    if (!pr || !action) return [];
    const status = githubPrAction(action, pr);
    const event = status ? fromPullRequest(root, pr, status, action) : undefined;
    return event ? [event] : [];
  }

  if (eventName === 'pull_request_review') {
    const pr = asRecord(root.pull_request);
    const review = asRecord(root.review);
    const state = text(review?.state)?.toLowerCase();
    if (!pr || !review || !state) return [];
    const status: PullRequestStatus | undefined =
      state === 'approved'
        ? 'approved'
        : state === 'changes_requested'
          ? 'changes_requested'
          : state === 'commented'
            ? 'commented'
            : undefined;
    if (!status) return [];
    const event = fromPullRequest(root, pr, status, status);
    if (!event) return [];
    event.actor = nestedText(review.user, 'login') ?? 'unknown';
    return [event];
  }

  if (eventName === 'issue_comment' && root.action === 'created') {
    const issue = asRecord(root.issue);
    const comment = asRecord(root.comment);
    const repository = asRecord(root.repository);
    if (!issue || !comment || !asRecord(issue.pull_request)) return [];
    const repo = text(repository?.full_name);
    const prId = text(issue.number);
    if (!repo || !prId) return [];
    return [
      {
        platform: 'github',
        eventType: 'comment_created',
        repo,
        prId,
        title: text(issue.title) ?? 'Untitled pull request',
        url: text(issue.html_url) ?? '',
        author: nestedText(issue.user, 'login') ?? 'unknown',
        sourceBranch: '',
        targetBranch: '',
        description: '',
        reviewers: [],
        isDraft: false,
        status: 'commented',
        actor: nestedText(comment.user, 'login') ?? 'unknown',
        commentText: text(comment.body) ?? ''
      }
    ];
  }
  return [];
}

function githubPrAction(action: string, pr: UnknownRecord): PullRequestStatus | undefined {
  switch (action) {
    case 'opened':
    case 'reopened':
    case 'ready_for_review':
    case 'review_requested':
    case 'converted_to_draft':
      return action;
    case 'closed':
      return pr.merged === true ? 'merged' : 'closed';
    default:
      return undefined;
  }
}

function fromPullRequest(
  root: UnknownRecord,
  pr: UnknownRecord,
  status: PullRequestStatus,
  eventType: string
): PullRequestEvent | undefined {
  const repository = asRecord(root.repository);
  const repo = text(repository?.full_name);
  const prId = text(pr.number);
  if (!repo || !prId) return undefined;
  const requested = Array.isArray(pr.requested_reviewers)
    ? pr.requested_reviewers.map((item) => nestedText(item, 'login')).filter(isDefined)
    : [];
  if (Array.isArray(pr.requested_teams)) {
    requested.push(...pr.requested_teams.map((item) => nestedText(item, 'slug')).filter(isDefined));
  }
  return {
    platform: 'github',
    eventType,
    repo,
    prId,
    title: text(pr.title) ?? 'Untitled pull request',
    url: text(pr.html_url) ?? '',
    author: nestedText(pr.user, 'login') ?? 'unknown',
    sourceBranch: nestedText(pr.head, 'ref') ?? '',
    targetBranch: nestedText(pr.base, 'ref') ?? '',
    description: text(pr.body) ?? '',
    reviewers: requested,
    isDraft: pr.draft === true,
    status,
    actor: nestedText(root.sender, 'login') ?? 'unknown'
  };
}

function asRecord(value: unknown): UnknownRecord | undefined {
  const result = recordSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

function nestedText(value: unknown, key: string): string | undefined {
  return text(asRecord(value)?.[key]);
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
