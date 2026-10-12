import type { Logger } from 'pino';
import { resolveRouting, type RoutingConfig } from '../config/routing.js';
import type { PullRequestEvent, StoredPrMessage } from '../domain/types.js';
import type { Repository } from '../db/repository.js';
import {
  buildFallbackText,
  buildPullRequestBlocks,
  buildUpdatedParentBlocks
} from '../slack/formatters.js';
import type { SlackClient } from '../slack/client.js';

const finalStatuses = new Set(['merged', 'declined']);

export class Notifier {
  constructor(
    private readonly repository: Pick<Repository, 'claimDelivery' | 'withPrLock'>,
    private readonly slack: Pick<SlackClient, 'postMessage' | 'postReply' | 'updateMessage'>,
    private readonly routing: RoutingConfig,
    private readonly fallbackChannel: string,
    private readonly logger: Logger
  ) {}

  async processDelivery(
    deliveryId: string,
    platform: 'github' | 'bitbucket',
    events: PullRequestEvent[]
  ): Promise<void> {
    if (!(await this.repository.claimDelivery(deliveryId, platform))) {
      this.logger.info({ platform, deliveryId }, 'Duplicate webhook delivery ignored');
      return;
    }
    for (const event of events) {
      await this.processEvent(event, deliveryId);
    }
  }

  private async processEvent(event: PullRequestEvent, deliveryId: string): Promise<void> {
    const route = resolveRouting(this.routing, event.repo, this.fallbackChannel);
    if (
      route.events &&
      !route.events.includes(event.eventType) &&
      !route.events.includes(event.status)
    )
      return;
    if (route.ignoreAuthors.some((author) => author.toLowerCase() === event.author.toLowerCase()))
      return;
    if (event.isDraft && !route.notifyDrafts && event.status !== 'ready_for_review') return;

    await this.repository
      .withPrLock(event, async (existing, save) => {
        const blocks = buildPullRequestBlocks(event, this.routing.userMap);
        const text = buildFallbackText(event);
        if (!existing) {
          const parentEvent = isInitialEvent(event)
            ? event
            : { ...event, eventType: 'opened', status: 'opened' as const };
          const parentText = buildFallbackText(parentEvent);
          const parentBlocks = buildPullRequestBlocks(parentEvent, this.routing.userMap);
          const slackTs = await this.slack.postMessage(route.channelId, parentText, parentBlocks);
          const created: StoredPrMessage = {
            platform: event.platform,
            repo: event.repo,
            prId: event.prId,
            channelId: route.channelId,
            slackTs,
            status: event.status
          };
          await save(created);
          if (!isInitialEvent(event)) {
            await this.slack.postReply(route.channelId, slackTs, text, blocks);
          }
          if (finalStatuses.has(event.status)) {
            const updated = { ...created, status: event.status };
            await this.slack.updateMessage(
              route.channelId,
              slackTs,
              text,
              buildUpdatedParentBlocks(event, updated, this.routing.userMap)
            );
            await save(updated);
          }
          return;
        }

        await this.slack.postReply(existing.channelId, existing.slackTs, text, blocks);
        if (finalStatuses.has(event.status)) {
          const updated: StoredPrMessage = { ...existing, status: event.status };
          await this.slack.updateMessage(
            existing.channelId,
            existing.slackTs,
            buildFallbackText(event),
            buildUpdatedParentBlocks(event, updated, this.routing.userMap)
          );
          await save(updated);
        } else {
          await save({ ...existing, status: event.status });
        }
      })
      .catch((error: unknown) => {
        this.logger.error(
          {
            platform: event.platform,
            repo: event.repo,
            prId: event.prId,
            deliveryId,
            error
          },
          'Pull request notification failed'
        );
        throw error;
      });
  }
}

function isInitialEvent(event: PullRequestEvent): boolean {
  return ['opened', 'reopened', 'ready_for_review'].includes(event.status);
}
