import { z } from 'zod';

const pooledDatabaseUrl = z
  .string()
  .url()
  .refine((value) => {
    const parsed = new URL(value);
    return parsed.hostname.includes('-pooler') && parsed.searchParams.get('sslmode') === 'require';
  }, 'must be a pooled Neon URL with sslmode=require');

const directDatabaseUrl = z
  .string()
  .url()
  .refine((value) => {
    const parsed = new URL(value);
    return !parsed.hostname.includes('-pooler') && parsed.searchParams.get('sslmode') === 'require';
  }, 'must be an unpooled Neon URL with sslmode=require');

const envSchema = z.object({
  SLACK_BOT_TOKEN: z.string().min(1),
  SLACK_DEFAULT_CHANNEL_ID: z.string().min(1),
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
  BITBUCKET_WEBHOOK_SECRET: z.string().min(1),
  DATABASE_URL: pooledDatabaseUrl,
  DATABASE_URL_DIRECT: directDatabaseUrl,
  CONFIG_PATH: z.string().default('./config.yaml'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production')
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return parsed.data;
}
