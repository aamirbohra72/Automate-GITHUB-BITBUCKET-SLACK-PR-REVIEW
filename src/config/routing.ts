import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import { z } from 'zod';

const repoSettingsSchema = z.object({
  channelId: z.string().min(1),
  notifyDrafts: z.boolean().optional(),
  ignoreAuthors: z.array(z.string()).optional(),
  events: z.array(z.string()).optional()
});

const routingSchema = z.object({
  repos: z.record(z.string(), repoSettingsSchema).default({}),
  userMap: z.record(z.string(), z.string()).default({})
});

export type RoutingConfig = z.infer<typeof routingSchema>;
export type RepoRouting = {
  channelId: string;
  notifyDrafts: boolean;
  ignoreAuthors: string[];
  events?: string[];
};

export async function loadRouting(path: string): Promise<RoutingConfig> {
  let raw: unknown;
  try {
    raw = YAML.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read routing config at ${path}: ${errorMessage(error)}`);
  }
  const parsed = routingSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid routing config: ${details}`);
  }
  return parsed.data;
}

export function resolveRouting(
  config: RoutingConfig,
  repo: string,
  fallbackChannelId: string
): RepoRouting {
  const defaults = config.repos.default;
  const specific = config.repos[repo];
  const selected = specific ?? defaults;
  const events = selected?.events ?? defaults?.events;
  return {
    channelId: selected?.channelId ?? fallbackChannelId,
    notifyDrafts: selected?.notifyDrafts ?? defaults?.notifyDrafts ?? false,
    ignoreAuthors: selected?.ignoreAuthors ?? defaults?.ignoreAuthors ?? [],
    ...(events === undefined ? {} : { events })
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
