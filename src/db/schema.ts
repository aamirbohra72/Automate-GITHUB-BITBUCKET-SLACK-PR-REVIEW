import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const prMessages = pgTable(
  'pr_messages',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    platform: text('platform').notNull(),
    repo: text('repo').notNull(),
    prId: text('pr_id').notNull(),
    channelId: text('channel_id').notNull(),
    slackTs: text('slack_ts').notNull(),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('pr_messages_platform_repo_pr_id_unique').on(table.platform, table.repo, table.prId)
  ]
);

export const processedDeliveries = pgTable('processed_deliveries', {
  deliveryId: text('delivery_id').primaryKey(),
  platform: text('platform').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow()
});
