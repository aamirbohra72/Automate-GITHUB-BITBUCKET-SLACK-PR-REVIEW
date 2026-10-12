import { WebClient, type KnownBlock } from '@slack/web-api';
import type { Logger } from 'pino';

const permanentErrors = new Set([
  'channel_not_found',
  'not_in_channel',
  'invalid_auth',
  'missing_scope',
  'not_authed',
  'account_inactive'
]);

export class SlackClient {
  private readonly client: WebClient;

  constructor(
    token: string,
    private readonly logger: Logger,
    apiUrl?: string
  ) {
    this.client = new WebClient(token, {
      retryConfig: { retries: 2, factor: 2, minTimeout: 500, maxTimeout: 5000 },
      ...(apiUrl ? { slackApiUrl: apiUrl } : {})
    });
  }

  async postMessage(channel: string, text: string, blocks: KnownBlock[]): Promise<string> {
    const result = await this.retry('chat.postMessage', () =>
      this.client.chat.postMessage({ channel, text, blocks })
    );
    if (!result.ts) throw new Error('Slack chat.postMessage returned no timestamp');
    return result.ts;
  }

  async postReply(
    channel: string,
    threadTs: string,
    text: string,
    blocks: KnownBlock[]
  ): Promise<void> {
    await this.retry('chat.postMessage', () =>
      this.client.chat.postMessage({ channel, thread_ts: threadTs, text, blocks })
    );
  }

  async updateMessage(
    channel: string,
    ts: string,
    text: string,
    blocks: KnownBlock[]
  ): Promise<void> {
    await this.retry('chat.update', () => this.client.chat.update({ channel, ts, text, blocks }));
  }

  private async retry<T>(operation: string, action: () => Promise<T>): Promise<T> {
    const maxAttempts = 5;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await action();
      } catch (error) {
        const slackError = describeSlackError(error);
        if (permanentErrors.has(slackError.code)) {
          this.logger.error(
            { operation, slackError: slackError.code },
            'Permanent Slack API error'
          );
          throw error;
        }
        if (attempt >= maxAttempts || !slackError.retryable) throw error;
        const exponential = Math.min(10_000, 500 * 2 ** (attempt - 1));
        const jittered = Math.floor(exponential * (0.5 + Math.random()));
        const delay = slackError.retryAfterMs ?? jittered;
        this.logger.warn(
          { operation, attempt, delayMs: delay, slackError: slackError.code },
          'Retrying Slack API call'
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
}

function describeSlackError(error: unknown): {
  code: string;
  retryable: boolean;
  retryAfterMs?: number;
} {
  const candidate =
    typeof error === 'object' && error !== null
      ? (error as {
          code?: unknown;
          data?: { error?: unknown };
          headers?: Record<string, unknown>;
          statusCode?: unknown;
          retryAfter?: unknown;
        })
      : {};
  const code =
    typeof candidate.data?.error === 'string'
      ? candidate.data.error
      : typeof candidate.code === 'string'
        ? candidate.code
        : '';
  const retryAfter = candidate.headers?.['retry-after'];
  const seconds =
    typeof candidate.retryAfter === 'number'
      ? candidate.retryAfter
      : typeof retryAfter === 'string'
        ? Number(retryAfter)
        : Number.NaN;
  const retryAfterMs = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
  const retryable =
    code === 'rate_limited' ||
    code === 'slack_webapi_rate_limited_error' ||
    candidate.statusCode === 429 ||
    (typeof candidate.statusCode === 'number' && candidate.statusCode >= 500) ||
    ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(code);
  return {
    code: code || 'unknown_error',
    retryable,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs })
  };
}
