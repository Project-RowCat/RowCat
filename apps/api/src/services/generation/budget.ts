import { CHAT_ERROR_CODE, type ChatStreamEvent } from "@rowcat/contracts";
import { env } from "../../env.ts";
import { ApiError } from "../../lib/errors.ts";
import {
	holdRateLimitSlot,
	reserveRateLimit,
} from "../../lib/rate-limit/index.ts";
import { requireManagedProvider } from "./chat.ts";

/**
 * **How much** of the operator's key the whole instance may spend — the instance-wide half of the
 * spending defences in `access.ts`. That file decides who; the per-member windows decide how fast one
 * account goes; this decides how much everyone together may have open and spend:
 *
 * ```text
 * request    one upstream call's estimate ≤ MANAGED_GENERATION_REQUEST_TOKENS   413, nothing reserved
 * slots      streams open at once ≤ MANAGED_GENERATION_CONCURRENCY             429, held until the stream ends
 * tokens     tokens per 24 h ≤ MANAGED_GENERATION_DAILY_TOKENS                 429, reserved then settled
 * ```
 *
 * Both managed routes call `reserveManagedGeneration` after the per-member windows and before the
 * upstream call, so a refused request never goes out and never holds anything. All three fail closed
 * (`policy.ts`): an unreadable store refuses rather than running uncounted.
 *
 * ## What a reservation costs, and why it is settled from the stream
 *
 * The amount reserved is the estimate times the rounds the request may take: input estimated at one
 * token per character of what is sent (the request after the server's own additions), plus the
 * output cap. The estimate only decides admission; the charge is what the provider reports in `usage`
 * frames, summed over every round, and it may exceed the reservation (the limiter records the
 * overrun). A stream that ends without any usage frame — the client left, the wall clock cut it,
 * the provider failed midway — is charged the whole reservation, because unknown is not zero.
 *
 * A request that failed **before** streaming (unknown model, provider refusal, missing key) gives
 * the reservation back whole: those answers come back before the provider generated anything.
 *
 * BYO generation never reaches this file: it goes from the device to the provider, on the member's
 * own key, and no instance ceiling applies to it.
 */

/** The one subject every instance-wide ceiling counts against. */
export const MANAGED_GENERATION_INSTANCE = "managed-generation";

export interface ManagedGenerationEstimate {
	/** Characters of what one upstream call sends. */
	readonly inputChars: number;
	readonly maxOutputTokens: number;
	/** Upstream calls this request may make (1, or the tool loop's maximum). */
	readonly rounds: number;
}

export interface ManagedGenerationReservation {
	/** Wraps the stream: sums usage, then settles and frees the slot when the stream ends, however it ends. */
	meter(
		events: AsyncGenerator<ChatStreamEvent>,
	): AsyncGenerator<ChatStreamEvent>;
	/** The request failed before streaming: give everything back. */
	abandon(): Promise<void>;
}

/** Characters of one upstream call's body: the request as the server will send it, guards included. */
export function inputCharsOf(request: object): number {
	return JSON.stringify(request).length;
}

export function perCallTokens(estimate: ManagedGenerationEstimate): number {
	return estimate.inputChars + estimate.maxOutputTokens;
}

export async function reserveManagedGeneration(
	estimate: ManagedGenerationEstimate,
): Promise<ManagedGenerationReservation> {
	requireManagedProvider();
	const perCall = perCallTokens(estimate);
	if (perCall > env.MANAGED_GENERATION_REQUEST_TOKENS)
		throw new ApiError(
			413,
			CHAT_ERROR_CODE.managedRequestTooLarge,
			"This request is larger than this server's default AI accepts at once.",
		);

	const slot = await holdRateLimitSlot(
		"managedGenerationSlots",
		MANAGED_GENERATION_INSTANCE,
	);
	const reserved = perCall * estimate.rounds;
	let tokens: Awaited<ReturnType<typeof reserveRateLimit>>;
	try {
		tokens = await reserveRateLimit(
			"managedGenerationTokens",
			MANAGED_GENERATION_INSTANCE,
			reserved,
		);
	} catch (error) {
		await slot.release();
		throw error;
	}

	const finish = async (charged: number): Promise<void> => {
		await tokens.settle(charged);
		await slot.release();
	};

	return {
		abandon: () => finish(0),
		async *meter(events) {
			let reported: number | null = null;
			try {
				for await (const event of events) {
					if (event.type === "usage") {
						/**
						 * A provider that reports only one side leaves the other at its reserved estimate rather
						 * than at 0, for the same reason the whole stream is charged when nothing is reported.
						 */
						reported =
							(reported ?? 0) +
							(event.inputTokens ?? estimate.inputChars) +
							(event.outputTokens ?? estimate.maxOutputTokens);
					}
					yield event;
				}
			} finally {
				await finish(reported ?? Number.NaN);
			}
		},
	};
}
