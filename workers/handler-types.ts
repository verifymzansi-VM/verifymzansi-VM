/** Shared minimal handler contracts for the standalone Workers. */
interface ScheduledEvent {
  cron: string;
  scheduledTime: number;
}
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
export interface ScheduledWorker<Environment> {
  fetch?(request: Request, env: Environment, ctx: ExecutionContext): Promise<Response>;
  scheduled?(event: ScheduledEvent, env: Environment, ctx: ExecutionContext): Promise<void>;
}
