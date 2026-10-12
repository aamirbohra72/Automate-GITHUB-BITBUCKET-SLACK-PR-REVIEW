CREATE TABLE "pr_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"repo" text NOT NULL,
	"pr_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"slack_ts" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_deliveries" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pr_messages_platform_repo_pr_id_unique" ON "pr_messages" USING btree ("platform","repo","pr_id");