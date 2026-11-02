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
 * ## A reservation per upstream call, made just before that call
 *
 * Each upstream call is weighed and reserved on its own, right before it is sent: input estimated at
 * one token per character of what that call sends (the request after the server's own additions),
 * plus the output cap. The first call is weighed when the request arrives; a tool loop's later calls
 * are weighed again in `admitCall`, because each one carries the previous round's answer and tool
 * results and is larger than the one before. Reserving "the first call × the most rounds" up front
 * looked equivalent and was not: a later round could pass the per-call ceiling unweighed, and the
 * daily budget admitted less than the rounds actually sent. A later call that is too large or finds
 * the budget spent is never sent; the turn ends there with that refusal as a frame, since the 200 is
 * already out.
 *
 * The estimate only decides admission; each call is charged what the provider reports for it in its
 * own `usage` frames, and that may exceed its reservation (the limiter records the overrun). A call
 * whose stream ends without a usage frame — the client left, the wall clock cut it, the provider
 * failed midway — is charged its whole reservation, because unknown is not zero. So is a call that
 * was admitted and never metered. A call that failed **before** streaming (unknown model, provider
 * refusal, missing key) gives its reservation back whole: those answers come back before the
 * provider generated anything.
 *
 * The slot is the request's, not the call's: held from admission until the whole response ends.
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
}

/** One upstream call's share of the budget. */
export interface ManagedGenerationCall {
	/** Wraps that call's stream: charges its reported usage (or its whole reservation) when it ends. */
	meter(
		events: AsyncGenerator<ChatStreamEvent>,
	): AsyncGenerator<ChatStreamEvent>;
	/** The call failed before streaming: give its reservation back. */
	abandon(): Promise<void>;
}

export interface ManagedGenerationReservation {
	/** The first upstream call, already admitted. */
	readonly first: ManagedGenerationCall;
	/**
	 * Admits one more upstream call of this request: the per-call ceiling (413) and the daily budget
	 * (a 429, or a 503 when the store cannot be read), weighed on that call. Throws `ApiError` and holds
	 * nothing more when refused.
	 */
	admitCall(
		estimate: ManagedGenerationEstimate,
	): Promise<ManagedGenerationCall>;
	/**
	 * Wraps the whole response: when it ends, however it ends, every call not yet charged is charged
	 * its reservation and the slot is freed.
	 */
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

type TokenReservation = Awaited<ReturnType<typeof reserveRateLimit>>;

function requireWithinCallCeiling(estimate: ManagedGenerationEstimate): number {
	const perCall = perCallTokens(estimate);
	if (perCall > env.MANAGED_GENERATION_REQUEST_TOKENS)
		throw new ApiError(
			413,
			CHAT_ERROR_CODE.managedRequestTooLarge,
			"This request is larger than this server's default AI accepts at once.",
		);
	return perCall;
}

export async function reserveManagedGeneration(
	estimate: ManagedGenerationEstimate,
): Promise<ManagedGenerationReservation> {
	requireManagedProvider();
	requireWithinCallCeiling(estimate);

	const slot = await holdRateLimitSlot(
		"managedGenerationSlots",
		MANAGED_GENERATION_INSTANCE,
	);
	const open = new Set<TokenReservation>();
	let finished = false;

	const admit = async (
		call: ManagedGenerationEstimate,
	): Promise<ManagedGenerationCall> => {
		// After the response ended there is no slot under it, so nothing more is sent on this request.
		if (finished)
			throw new Error("managed generation request already finished");
		const perCall = requireWithinCallCeiling(call);
		const tokens = await reserveRateLimit(
			"managedGenerationTokens",
			MANAGED_GENERATION_INSTANCE,
			perCall,
		);
		open.add(tokens);
		const settle = async (charged: number) => {
			open.delete(tokens);
			await tokens.settle(charged);
		};
		return {
			abandon: () => settle(0),
			async *meter(events) {
				let reported: number | null = null;
				try {
					for await (const event of events) {
						if (event.type === "usage") {
							/**
							 * A provider that reports only one side leaves the other at its reserved estimate rather
							 * than at 0, for the same reason the whole call is charged when nothing is reported.
							 */
							reported =
								(reported ?? 0) +
								(event.inputTokens ?? call.inputChars) +
								(event.outputTokens ?? call.maxOutputTokens);
						}
						yield event;
					}
				} finally {
					await settle(reported ?? Number.NaN);
				}
			},
		};
	};

	let first: ManagedGenerationCall;
	try {
		first = await admit(estimate);
	} catch (error) {
		await slot.release();
		throw error;
	}

	/** Charges what is still open (`used` = NaN charges a reservation whole), then frees the slot. */
	const finish = async (used: number): Promise<void> => {
		finished = true;
		const pending = [...open];
		open.clear();
		await Promise.all(pending.map((tokens) => tokens.settle(used)));
		await slot.release();
	};

	return {
		first,
		admitCall: admit,
		abandon: () => finish(0),
		async *meter(events) {
			try {
				yield* events;
			} finally {
				await finish(Number.NaN);
			}
		},
	};
}
