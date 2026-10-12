import type { Logger } from 'pino';

type Job = () => Promise<void>;

export class JobQueue {
  private readonly pending: Job[] = [];
  private running = 0;
  private accepting = true;
  private idleResolvers: Array<() => void> = [];

  constructor(
    private readonly concurrency: number,
    private readonly maxPending: number,
    private readonly logger: Logger
  ) {}

  enqueue(job: Job): boolean {
    if (!this.accepting || this.pending.length >= this.maxPending) return false;
    this.pending.push(job);
    this.pump();
    return true;
  }

  async close(): Promise<void> {
    this.accepting = false;
    if (this.running === 0 && this.pending.length === 0) return;
    await new Promise<void>((resolve) => this.idleResolvers.push(resolve));
  }

  private pump(): void {
    while (this.running < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift();
      if (!job) continue;
      this.running += 1;
      void job()
        .catch((error: unknown) => this.logger.error({ error }, 'Background webhook job failed'))
        .finally(() => {
          this.running -= 1;
          if (this.running === 0 && this.pending.length === 0) {
            this.idleResolvers.splice(0).forEach((resolve) => resolve());
          }
          this.pump();
        });
    }
  }
}
