import { and, eq, lt, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { PullRequestEvent, StoredPrMessage } from '../domain/types.js';
import { withDatabaseRetry, type Database } from './client.js';
import { prMessages, processedDeliveries } from './schema.js';

export class Repository {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger
  ) {}

  async claimDelivery(deliveryId: string, platform: string): Promise<boolean> {
    const inserted = await withDatabaseRetry(
      () =>
        this.db
          .insert(processedDeliveries)
          .values({ deliveryId, platform })
          .onConflictDoNothing({ target: processedDeliveries.deliveryId })
          .returning({ deliveryId: processedDeliveries.deliveryId }),
      this.logger,
      'claim-delivery'
    );
    return inserted.length > 0;
  }

  async withPrLock(
    event: PullRequestEvent,
    work: (
      existing: StoredPrMessage | null,
      save: (message: StoredPrMessage) => Promise<void>
    ) => Promise<void>
  ): Promise<void> {
    const lockKey = `${event.platform}:${event.repo}:${event.prId}`;
    await this.db.transaction(async (transaction) => {
      // The transaction-scoped advisory lock serializes the Slack parent lookup/create for this PR.
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
      const [row] = await transaction
        .select()
        .from(prMessages)
        .where(
          and(
            eq(prMessages.platform, event.platform),
            eq(prMessages.repo, event.repo),
            eq(prMessages.prId, event.prId)
          )
        )
        .limit(1);
      const existing: StoredPrMessage | null = row
        ? {
            platform: row.platform as StoredPrMessage['platform'],
            repo: row.repo,
            prId: row.prId,
            channelId: row.channelId,
            slackTs: row.slackTs,
            status: row.status
          }
        : null;
      await work(existing, async (message) => {
        await transaction
          .insert(prMessages)
          .values({
            platform: message.platform,
            repo: message.repo,
            prId: message.prId,
            channelId: message.channelId,
            slackTs: message.slackTs,
            status: message.status
          })
          .onConflictDoUpdate({
            target: [prMessages.platform, prMessages.repo, prMessages.prId],
            set: {
              channelId: message.channelId,
              slackTs: message.slackTs,
              status: message.status,
              updatedAt: new Date()
            }
          });
      });
    });
  }

  async cleanupDeliveries(): Promise<number> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const deleted = await withDatabaseRetry(
      () =>
        this.db
          .delete(processedDeliveries)
          .where(lt(processedDeliveries.receivedAt, cutoff))
          .returning({ deliveryId: processedDeliveries.deliveryId }),
      this.logger,
      'cleanup-deliveries'
    );
    return deleted.length;
  }

  async healthCheck(): Promise<void> {
    await withDatabaseRetry(() => this.db.execute(sql`SELECT 1`), this.logger, 'health-check');
  }
}
