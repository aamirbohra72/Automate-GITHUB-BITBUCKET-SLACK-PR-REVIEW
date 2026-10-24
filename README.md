# Pull Request Slack Notifier

A long-running Node.js service that verifies GitHub and Bitbucket Cloud webhook signatures, normalizes pull request events, and delivers Block Kit notifications to Slack. Fastify acknowledges signed, supported events with `202` and sends them through a bounded in-process queue. Neon Postgres stores delivery IDs and Slack parent-message references.

## Architecture

```mermaid
flowchart TB
    subgraph Providers["1 · Webhook providers"]
        direction LR
        GitHub["GitHub<br/>pull requests, reviews, comments"]
        Bitbucket["Bitbucket Cloud<br/>pull request events"]
    end

    subgraph Service["2 · Node.js 22 service · Fastify"]
        direction TB
        Routes["Webhook routes<br/>1 MiB body limit · 120 req/min"]
        Verify["Verify raw-body HMAC-SHA256<br/>constant-time comparison"]
        Parse["Parse provider payload<br/>ignore unsupported actions"]
        Normalize["Normalize to PullRequestEvent"]
        Queue["Bounded in-memory queue<br/>4 workers · 1,000 pending jobs"]
        Notify["Notifier<br/>filters · repo/channel routing"]
        SlackClient["Slack client<br/>retry · rate-limit handling"]
        Config[".env + config.yaml<br/>secrets · repo routes · user map"]
        Health["GET /health"]
        Cleanup["Daily cleanup<br/>delivery records older than 7 days"]
        Routes --> Verify --> Parse --> Normalize --> Queue --> Notify --> SlackClient
        Config --> Notify
    end

    Database[("Neon Postgres<br/>processed_deliveries · pr_messages")]
    Slack["Slack workspace<br/>channel parent messages · threaded replies"]
    GitHub -->|signed POST| Routes
    Bitbucket -->|signed POST| Routes
    Verify -->|invalid signature: 401| Reject["Reject request"]
    Notify -->|claim delivery ID<br/>ON CONFLICT DO NOTHING| Database
    Notify -->|transaction advisory lock per PR<br/>load/save Slack message reference| Database
    SlackClient -->|post · reply · update| Slack
    Health -->|SELECT 1| Database
    Cleanup -->|delete expired rows| Database

    subgraph Build["3 · Build and release"]
        direction LR
        Source["TypeScript source<br/>src/ + config.yaml"] --> Install["npm ci"]
        Install --> Checks["npm run lint<br/>npm test"]
        Checks --> Compile["npm run build<br/>tsc → dist/"]
        Compile --> Image["Docker multi-stage image<br/>production dependencies · non-root user"]
        Image --> Run["Docker Compose or persistent host<br/>port 3000 · graceful shutdown"]
        Schema["src/db/schema.ts + drizzle/ migrations"] -->|db:migrate<br/>DATABASE_URL_DIRECT| Database
    end

    classDef provider fill:#dbeafe,stroke:#2563eb,color:#172554,stroke-width:2px
    classDef ingress fill:#fef3c7,stroke:#d97706,color:#451a03,stroke-width:2px
    classDef worker fill:#dcfce7,stroke:#16a34a,color:#052e16,stroke-width:2px
    classDef config fill:#fce7f3,stroke:#db2777,color:#500724,stroke-width:2px
    classDef data fill:#cffafe,stroke:#0891b2,color:#083344,stroke-width:2px
    classDef external fill:#ede9fe,stroke:#7c3aed,color:#2e1065,stroke-width:2px
    classDef build fill:#ffedd5,stroke:#ea580c,color:#431407,stroke-width:2px
    classDef reject fill:#fee2e2,stroke:#dc2626,color:#450a0a,stroke-width:2px
    class GitHub,Bitbucket provider
    class Routes,Verify,Parse,Normalize ingress
    class Queue,Notify,SlackClient,Health,Cleanup worker
    class Config config
    class Database data
    class Slack external
    class Source,Install,Checks,Compile,Image,Run,Schema build
    class Reject reject
```

Both provider parsers produce the same normalized event contract. Delivery IDs are claimed with `ON CONFLICT DO NOTHING`, and a transaction-scoped Postgres advisory lock serializes Slack parent-message creation for each `(platform, repo, PR ID)`. The queue is in memory, so queued work is not durable across process crashes. Migrations run separately from app startup using the direct Neon URL; the running service uses the pooled URL.

## Requirements

- Node.js 20 or newer and npm
- A Neon Postgres project with pooled and direct connection strings
- A Slack app/bot installed in the destination workspace
- Public HTTPS endpoint for provider webhooks (a tunnel is enough for local testing)

## Setup

### 1. Neon

Create a Neon project and database. Copy both connection strings from the connection details panel: select the pooled endpoint for `DATABASE_URL` (hostname contains `-pooler`) and the direct/unpooled endpoint for `DATABASE_URL_DIRECT`. Add `?sslmode=require` if it is not already present. The application uses the pooled connection; Drizzle migrations use the direct one. Neon may suspend compute while idle, so the first connection/query after a quiet period can take longer; the app retries transient connection failures three times with short backoff.

```sh
cp .env.example .env
# Set DATABASE_URL and DATABASE_URL_DIRECT in .env
npm ci
npm run db:migrate
```

The repository includes the initial Drizzle migration. When you change `src/db/schema.ts`, run `npm run db:generate`, review and commit the generated migration, then apply it with `npm run db:migrate`.

### 2. Slack

1. Create an app at <https://api.slack.com/apps> and add the bot scope `chat:write`. `chat:write.public` is optional; the recommended setup invites the bot into channels explicitly.
2. Install the app to the workspace and copy its `xoxb-` token into `SLACK_BOT_TOKEN`.
3. Invite the bot to each destination channel with `/invite @your-bot-name`.
4. Copy channel IDs from the channel details panel or channel URL, then set `SLACK_DEFAULT_CHANNEL_ID` and channel IDs in `config.yaml`.
5. Optional: add `users:read` if you later extend the app to resolve users at runtime. This service uses the explicit `userMap` for reviewer mentions and does not need that scope.

### 3. GitHub

In repository or organization **Settings -> Webhooks**, add `https://<host>/webhooks/github`, choose `application/json`, set a strong secret matching `GITHUB_WEBHOOK_SECRET`, and select **Pull requests**, **Pull request reviews**, and **Issue comments**. The service handles PR issue comments only; ordinary issue comments are ignored.

### 4. Bitbucket Cloud

In **Repository settings -> Webhooks**, add `https://<host>/webhooks/bitbucket`, configure the same secret as `BITBUCKET_WEBHOOK_SECRET`, and select all Pull Request triggers. The parser uses `X-Event-Key` to normalize Cloud event names.

### 5. Local testing

Set all required variables in `.env`, start the server with `npm run dev`, and expose port 3000 with ngrok or cloudflared. Configure provider webhooks with the tunnel URL. To send a correctly signed sample GitHub event to the running service:

```sh
WEBHOOK_URL=https://<your-tunnel-host> GITHUB_WEBHOOK_SECRET=<same-secret> npm run send-test-webhook
```

In PowerShell, set `$env:WEBHOOK_URL` and `$env:GITHUB_WEBHOOK_SECRET` before running `npm run send-test-webhook`. The automated suite uses realistic fixture payloads and signs an HTTP request; `npm test` runs it locally. `npm run build` checks strict TypeScript compilation.

### Build from source

After completing the Neon and Slack configuration above:

```sh
npm ci
npm run db:migrate
npm run lint
npm test
npm run build
npm start
```

`npm start` runs the compiled `dist/index.js` service. For watch mode during development, use `npm run dev` instead. To build and start the production container after setting `.env` and applying migrations, run `docker compose up --build -d`; Compose reads `.env`, publishes the configured port, and restarts the service unless stopped.

### 6. Deploy

Build and run with Docker Compose:

```sh
docker compose up --build -d
```

The image runs a long-lived Node process and accepts `SIGTERM`, stops HTTP traffic, drains queued work, and closes the database pool. Render, Railway, Fly.io, or a VM are suitable when configured as a persistent web service. This design is not safe for serverless request lifetimes such as Vercel functions: background work after the response may be terminated. For serverless, use a durable queue and a separate worker, or complete processing before responding (which can exceed webhook response deadlines).

## Configuration

Copy `.env.example` to `.env`. All environment values are validated at startup. `DATABASE_URL` must be a pooled Neon URL; `DATABASE_URL_DIRECT` must be unpooled. Both require `sslmode=require`. Webhook secrets and the Slack token must be non-empty.

`config.yaml` accepts repo keys as `owner/repo` or `workspace/repo-slug`. Each entry has a `channelId` and optional `notifyDrafts`, `ignoreAuthors`, and `events` list. The `default` entry supplies fallback settings; `SLACK_DEFAULT_CHANNEL_ID` is used when no repo/default route is present. Event filters match normalized event names or statuses. `userMap` maps provider usernames/account IDs to Slack IDs.

Supported normalized event types include `opened`, `reopened`, `ready_for_review`, `review_requested`, `approved`, `changes_requested`, `commented`, `comment_created`, `merged`, `declined`, `closed`, `converted_to_draft`, `updated`, and `unapproved`.

## Reliability and operations

- Webhook body size is limited to 1 MiB and routes are rate-limited to 120 requests per minute per client IP.
- GitHub `X-Hub-Signature-256` and Bitbucket `X-Hub-Signature` are verified against the captured raw bytes with HMAC-SHA256 and constant-time comparison.
- Slack calls use the SDK retry policy plus bounded application retries; rate limits honor `Retry-After`. Permanent channel/auth errors are logged and not retried.
- `processed_deliveries` rows older than seven days are removed by a daily in-process cleanup task.
- Logs are structured JSON; credentials and signature headers are redacted. Webhook payloads and tokens are never logged.

## Troubleshooting

- **`not_in_channel` / `channel_not_found`:** invite the bot and verify the channel ID in `config.yaml` or `SLACK_DEFAULT_CHANNEL_ID`.
- **401 / invalid signature:** verify the secret and provider header. Signature verification uses the exact raw request body; do not parse and re-serialize before verification.
- **Duplicate messages:** confirm provider delivery IDs are present and database migrations ran. The idempotency key is provider delivery UUID; the PR parent key is `(platform, repo, pr_id)`.
- **Nothing arrives:** check `events`, ignored authors, draft settings, provider delivery logs, and application logs. Unsupported event/action shapes intentionally receive 200 and are ignored.
- **Neon connection timeout after idle:** allow for autosuspend cold starts and check the pooled URL hostname, password, and `sslmode=require`. Transient connection errors are retried, but a sustained outage still fails the job.

## Development

```sh
npm run dev
npm run build
npm test
npm run lint
```

## End-to-end checklist

- [ ] Apply migrations against the direct Neon URL.
- [ ] Start the persistent service and confirm `GET /health` reports `200`.
- [ ] Confirm the bot can post to an invited channel.
- [ ] Deliver GitHub and Bitbucket opened events and verify title, branches, reviewers, and author.
- [ ] Deliver a review/comment event and confirm it appears in the original Slack thread.
- [ ] Merge or decline a PR and confirm the root message updates.
- [ ] Replay a delivery and confirm it is ignored; test draft, ignored-author, and event filters.
- [ ] Verify invalid signatures return `401`, oversized requests are rejected, and shutdown drains jobs.

## Future improvements

A durable queue (for crash-safe delivery), Slack interactive buttons, GitHub App authentication, and Bitbucket Server/Data Center support are natural next steps.
