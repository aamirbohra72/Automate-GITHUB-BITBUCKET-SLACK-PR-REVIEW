import type { KnownBlock } from '@slack/web-api';
import type { PullRequestEvent, PullRequestStatus, StoredPrMessage } from '../domain/types.js';

const statusEmoji: Record<string, string> = {
  opened: ':large_blue_circle:',
  reopened: ':large_blue_circle:',
  ready_for_review: ':eyes:',
  review_requested: ':mag:',
  approved: ':white_check_mark:',
  changes_requested: ':warning:',
  commented: ':speech_balloon:',
  merged: ':merged:',
  declined: ':no_entry_sign:',
  closed: ':white_circle:',
  converted_to_draft: ':pencil:',
  updated: ':arrows_counterclockwise:',
  unapproved: ':arrows_counterclockwise:'
};

export function buildPullRequestBlocks(
  event: PullRequestEvent,
  userMap: Record<string, string>,
  status: PullRequestStatus = event.status
): KnownBlock[] {
  const title = event.url
    ? `<${safeUrl(event.url)}|${escapeText(event.title)}>`
    : escapeText(event.title);
  const reviewers = event.reviewers.length
    ? event.reviewers.map((reviewer) => formatReviewer(reviewer, userMap)).join(', ')
    : 'None';
  const description = truncate(
    event.description || event.commentText || 'No description provided',
    300
  );
  const branches = `${escapeText(event.sourceBranch || 'unknown')} -> ${escapeText(event.targetBranch || 'unknown')}`;
  const blocks: KnownBlock[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `${statusEmoji[status] ?? ':bell:'} *${title}*` }
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Repository*\n${escapeText(event.repo)}` },
        { type: 'mrkdwn', text: `*Author*\n${escapeText(event.author)}` },
        { type: 'mrkdwn', text: `*Branches*\n${branches}` },
        { type: 'mrkdwn', text: `*Reviewers*\n${reviewers}` }
      ]
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${statusLabel(status)}*\n${escapeText(description)}` }
    }
  ];
  if (event.commentText) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Comment by ${escapeText(event.actor)}` }]
    });
  }
  return blocks;
}

export function buildUpdatedParentBlocks(
  event: PullRequestEvent,
  stored: StoredPrMessage,
  userMap: Record<string, string>
): KnownBlock[] {
  return buildPullRequestBlocks(event, userMap, stored.status as PullRequestStatus);
}

export function buildFallbackText(event: PullRequestEvent): string {
  return `${statusEmoji[event.status] ?? ':bell:'} ${event.repo} #${event.prId}: ${event.title} (${statusLabel(event.status)})`;
}

function formatReviewer(reviewer: string, userMap: Record<string, string>): string {
  const slackId = userMap[reviewer];
  return slackId ? `<@${escapeText(slackId)}>` : escapeText(reviewer);
}

function safeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url.replace(/[<>|]/g, '') : '';
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function statusLabel(status: string): string {
  return status.replaceAll('_', ' ');
}
