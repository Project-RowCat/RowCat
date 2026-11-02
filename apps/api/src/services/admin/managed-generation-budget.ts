import type {
	ManagedGenerationBlocker,
	ManagedGenerationBudgetDto,
} from "@rowcat/contracts";
import { env, managedGenerationAccess } from "../../env.ts";
import {
	observeRateLimit,
	rateLimitPolicy,
	rateLimitStore,
} from "../../lib/rate-limit/index.ts";
import { MANAGED_GENERATION_INSTANCE } from "../generation/budget.ts";
import { readFeatureState } from "../ops.ts";

/**
 * The console's view of the instance ceilings on the operator's key: what is left, and which gate
 * would refuse a managed request now. It only reads; nothing here decides admission
 * (`services/generation/budget.ts` does, through the limiter, and this file is the one caller of
 * `observeRateLimit` — `boundaries.test.ts`).
 *
 * The limits reported are the ones enforced, read from the same `rateLimitPolicy` the doors use, so a
 * deployment's `MANAGED_GENERATION_*` values and the console cannot disagree. A store that cannot be
 * read is reported as unknown (`null`) and as a blocker: the ceilings are fail-closed, so while it is
 * down every managed request is refused, and the screen must say that rather than show a full budget.
 */
export async function readManagedGenerationBudget(): Promise<ManagedGenerationBudgetDto> {
	const tokens = rateLimitPolicy("managedGenerationTokens");
	const slots = rateLimitPolicy("managedGenerationSlots");

	let storeDown = false;
	const observe = async (
		policy: "managedGenerationTokens" | "managedGenerationSlots",
	) => {
		try {
			return {
				value: await observeRateLimit(policy, MANAGED_GENERATION_INSTANCE),
			};
		} catch {
			storeDown = true;
			return null;
		}
	};
	const [spent, open, chat] = await Promise.all([
		observe("managedGenerationTokens"),
		observe("managedGenerationSlots"),
		readFeatureState("chat"),
	]);

	const used = spent === null ? null : (spent.value?.count ?? 0);
	const active = open === null ? null : (open.value?.count ?? 0);

	/** In the order the API checks them, so the first line is the one a request meets first. */
	const blockers: ManagedGenerationBlocker[] = [];
	if (!env.OPENROUTER_API_KEY) blockers.push("unconfigured");
	if (!chat.enabled) blockers.push("switched_off");
	if (storeDown) blockers.push("store_unavailable");
	if (active !== null && active >= slots.max) blockers.push("slots_full");
	if (used !== null && used >= tokens.max) blockers.push("budget_exhausted");

	return {
		configured: Boolean(env.OPENROUTER_API_KEY),
		access: managedGenerationAccess,
		store: rateLimitStore().kind,
		dailyTokens: {
			used,
			limit: tokens.max,
			resetsInMs: spent?.value ? Math.round(spent.value.resetMs) : null,
		},
		concurrency: { active, limit: slots.max },
		requestTokenLimit: env.MANAGED_GENERATION_REQUEST_TOKENS,
		perMember: {
			perMinute: rateLimitPolicy("managedGeneration").max,
			perDay: rateLimitPolicy("managedGenerationDaily").max,
		},
		blockers,
	};
}
