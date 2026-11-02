import { z } from "zod";

/**
 * What the operations console reads about the operator's key: how much of the instance's ceiling is
 * left, and which gate would refuse a managed request right now.
 *
 * ```text
 * GET /v2/admin/generation/budget    staff and admin — counts and states, never a credential
 * ```
 *
 * The ceilings are instance-wide, across every member and every replica (they live in the rate-limit
 * store, `apps/api/src/lib/rate-limit/`), on top of the per-member windows:
 *
 * ```text
 * concurrency    streams open at once             MANAGED_GENERATION_CONCURRENCY
 * daily tokens   tokens charged in the window     MANAGED_GENERATION_DAILY_TOKENS
 * request        one upstream call's weight       MANAGED_GENERATION_REQUEST_TOKENS
 * per member     30 / min · 400 / 24 h            the rate-limit policy table
 * ```
 *
 * What this shape cannot carry is the point: no key, no key prefix, no upstream slug, no provider
 * account. `configured` is one boolean — a console that showed even the key's last four characters
 * would put a fragment of it into screenshots and support threads. No member identity either: the
 * per-member windows are reported as their limits, not as who is near them.
 *
 * `null` usage means the store could not be read (Redis configured but down). It is not 0: 0 would
 * say "nothing spent", which nobody knows, while requests are refused (the ceilings are fail-closed).
 */

/** Which gate refuses a managed request now. A closed list; the console names each one. */
export const MANAGED_GENERATION_BLOCKERS = [
	/** OPENROUTER_API_KEY is empty: managed generation does not exist in this deployment. */
	"unconfigured",
	/** The `chat` feature switch is off in the console. */
	"switched_off",
	/** The counter store cannot be read; the ceilings refuse rather than run without a count. */
	"store_unavailable",
	/** The daily token budget is spent. */
	"budget_exhausted",
	/** Every concurrent slot is taken. */
	"slots_full",
] as const;
export type ManagedGenerationBlocker =
	(typeof MANAGED_GENERATION_BLOCKERS)[number];

const Usage = z
	.object({
		used: z.number().int().nonnegative().nullable(),
		limit: z.number().int().positive(),
		/** Milliseconds until the window ends; `null` while no window is open (nothing spent yet). */
		resetsInMs: z.number().int().nonnegative().nullable(),
	})
	.strict();

export const ManagedGenerationBudgetDto = z
	.object({
		/** Whether this deployment has an operator key at all. */
		configured: z.boolean(),
		/** `MANAGED_GENERATION_ACCESS`: who may draw on the key. */
		access: z.enum(["allowlist", "everyone"]),
		/** Where the counters live. `memory` counts this process only (no REDIS_URL). */
		store: z.enum(["redis", "memory"]),
		dailyTokens: Usage,
		concurrency: z
			.object({
				active: z.number().int().nonnegative().nullable(),
				limit: z.number().int().positive(),
			})
			.strict(),
		requestTokenLimit: z.number().int().positive(),
		perMember: z
			.object({
				perMinute: z.number().int().positive(),
				perDay: z.number().int().positive(),
			})
			.strict(),
		/** Every gate that would refuse a managed request now, in the order the API checks them. */
		blockers: z.array(z.enum(MANAGED_GENERATION_BLOCKERS)),
	})
	.strict();
export type ManagedGenerationBudgetDto = z.infer<
	typeof ManagedGenerationBudgetDto
>;
