import pino, { type Logger } from 'pino';

export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: {
      paths: [
        'SLACK_BOT_TOKEN',
        'GITHUB_WEBHOOK_SECRET',
        'BITBUCKET_WEBHOOK_SECRET',
        'DATABASE_URL',
        'DATABASE_URL_DIRECT',
        'req.headers.authorization',
        'req.headers.x-hub-signature',
        'req.headers.x-hub-signature-256'
      ],
      censor: '[REDACTED]'
    },
    serializers: {
      err: pino.stdSerializers.err,
      req(request) {
        return { id: request.id, method: request.method, url: request.url };
      }
    }
  });
}
