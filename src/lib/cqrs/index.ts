/**
 * CQRS (Command Query Responsibility Segregation) layer.
 *
 * Commands = side-effect operations (create, update, delete)
 * Queries  = read-only data fetching
 *
 * This separation:
 *  • Makes intent explicit (read vs. write)
 *  • Centralizes validation + authorization
 *  • Enables independent caching of queries
 *  • Facilitates audit logging for commands
 */

import { createClient } from "@/lib/supabase/server";
import { mapListingCategory } from "@/lib/utils/enum-compat";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("CQRS");

// ────────────────────────────────────────────────────────
//  Types
// ────────────────────────────────────────────────────────

export interface CommandResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface QueryResult<T> {
  data: T | null;
  error?: string;
}

type CommandHandler<TInput, TOutput = void> = (
  input: TInput,
  ctx: CommandContext
) => Promise<CommandResult<TOutput>>;

type QueryHandler<TInput, TOutput> = (
  input: TInput,
  ctx: QueryContext
) => Promise<QueryResult<TOutput>>;

interface CommandContext {
  userId: string;
  userRole: string;
}

interface QueryContext {
  userId?: string;
}

// ────────────────────────────────────────────────────────
//  Registry
// ────────────────────────────────────────────────────────

const commands = new Map<string, CommandHandler<unknown, unknown>>();
const queries = new Map<string, QueryHandler<unknown, unknown>>();

/**
 * Register a command handler.
 */
export function registerCommand<TInput, TOutput = void>(
  name: string,
  handler: CommandHandler<TInput, TOutput>
): void {
  commands.set(name, handler as CommandHandler<unknown, unknown>);
}

/**
 * Register a query handler.
 */
export function registerQuery<TInput, TOutput>(
  name: string,
  handler: QueryHandler<TInput, TOutput>
): void {
  queries.set(name, handler as QueryHandler<unknown, unknown>);
}

/**
 * Execute a registered command.
 */
export async function executeCommand<TInput, TOutput = void>(
  name: string,
  input: TInput,
  ctx: CommandContext
): Promise<CommandResult<TOutput>> {
  const handler = commands.get(name);
  if (!handler) {
    return { success: false, error: `Unknown command: ${name}` };
  }

  try {
    return (await handler(input, ctx)) as CommandResult<TOutput>;
  } catch (err) {
    log.error(`Command "${name}" failed`, {
      error: err instanceof Error ? err.message : "unknown error",
    });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Command execution failed",
    };
  }
}

/**
 * Execute a registered query.
 */
export async function executeQuery<TInput, TOutput>(
  name: string,
  input: TInput,
  ctx: QueryContext = {}
): Promise<QueryResult<TOutput>> {
  const handler = queries.get(name);
  if (!handler) {
    return { data: null, error: `Unknown query: ${name}` };
  }

  try {
    return (await handler(input, ctx)) as QueryResult<TOutput>;
  } catch (err) {
    log.error(`Query "${name}" failed`, {
      error: err instanceof Error ? err.message : "unknown error",
    });
    return {
      data: null,
      error: err instanceof Error ? err.message : "Query execution failed",
    };
  }
}

// ────────────────────────────────────────────────────────
//  Registered commands & queries
// ────────────────────────────────────────────────────────

/** Create a new listing. */
registerCommand<
  { title: string; description: string; priceCents: number; category: string },
  { id: string }
>("listing.create", async (input, ctx) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("listings")
    .insert({
      title: input.title,
      description: input.description,
      price_cents: input.priceCents,
      category: mapListingCategory(input.category),
      user_id: ctx.userId,
      status: "pending_moderation",
    })
    .select("id")
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, data: { id: data.id } };
});

/** Fetch active listings for the marketplace (public). */
registerQuery<
  { page?: number; limit?: number; category?: string },
  { listings: unknown[]; total: number }
>("listing.list", async (input) => {
  const supabase = await createClient();
  const page = input.page ?? 1;
  const limit = input.limit ?? 20;
  const from = (page - 1) * limit;

  let query = supabase
    .from("listings")
    .select("*", { count: "exact" })
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .range(from, from + limit - 1);

  if (input.category) {
    query = query.eq("category", mapListingCategory(input.category));
  }

  const { data, count, error } = await query;
  if (error) return { data: null, error: error.message };

  return { data: { listings: data ?? [], total: count ?? 0 } };
});
