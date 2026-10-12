export type Platform = 'github' | 'bitbucket';

export type PullRequestStatus =
  | 'opened'
  | 'reopened'
  | 'ready_for_review'
  | 'review_requested'
  | 'approved'
  | 'changes_requested'
  | 'commented'
  | 'merged'
  | 'declined'
  | 'closed'
  | 'converted_to_draft'
  | 'updated'
  | 'unapproved';

export interface PullRequestEvent {
  platform: Platform;
  eventType: string;
  repo: string;
  prId: string;
  title: string;
  url: string;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  description: string;
  reviewers: string[];
  isDraft: boolean;
  status: PullRequestStatus;
  actor: string;
  commentText?: string;
}

export interface StoredPrMessage {
  platform: Platform;
  repo: string;
  prId: string;
  channelId: string;
  slackTs: string;
  status: string;
}
