import type { PushMessagePayload } from "@rowcat/contracts";

/**
 * Expo Push Service adapter: nothing outside this file knows `exp.host`. The delivery service sees
 * `sendPushMessages`, `readPushReceipts` and classified outcomes; the provider's HTTP shape, error
 * codes and batch limits end here.
 *
 * - `expo-server-sdk` is not used: it only does token-shape checks (the contract already does),
 *   100-item chunking (one constant) and fetch wrapping, at the price of a runtime dependency in
 *   the API image.
 * - A ticket and a receipt are different facts. A ticket means Expo accepted the request; only
 *   the receipt (what APNs/FCM answered) reveals dead tokens. Stopping at tickets would keep the
 *   registration of a device that deleted the app alive forever.
 * - Classification uses Expo's structured `details.error` code, never message substrings, which
 *   silently lose branches when the provider rewords. An unknown code folds to permanent failure,
 *   not retry; resending for an unknown reason would hold that registration in the batch forever.
 */

/** The destination is a constant; see the `lib/push-config.ts` header for why it is not an env var. */
const EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";

/** Messages Expo accepts per request; this is the batch cap. */
export const EXPO_SEND_BATCH = 100;

/** Receipt lookup batch cap; Expo's docs recommend the same number. */
export const EXPO_RECEIPT_BATCH = 100;

/**
 * Per-request deadline so one hanging request cannot hold the whole delivery job. A timed-out batch
 * folds to a transient failure and the next cycle looks again (at-least-once, so resending is the
 * normal path).
 */
const REQUEST_TIMEOUT_MS = 15_000;

export interface PushMessage {
	token: string;
	title: string;
	body: string;
	data: PushMessagePayload;
	/**
	 * Android channel; iOS ignores it. Must equal the channel id the app creates, or Android draws on
	 * the default channel and turning off our channel does nothing.
	 */
	channelId: string;
}

/**
 * One message's result; only classified values leave. `retry` may succeed later, `permanent` gives
 * the same result again, and `unregistered` is kept apart because the action differs: settle one
 * delivery versus disable the registration.
 */
export type PushSendOutcome =
	| { status: "accepted"; ticketId: string | null }
	| { status: "retry"; code: string }
	| { status: "permanent"; code: string }
	| { status: "unregistered"; code: string };

export type PushReceiptOutcome =
	| { status: "delivered" }
	/** Not ready yet. Not a failure; look again later. */
	| { status: "pending" }
	| { status: "retry"; code: string }
	| { status: "permanent"; code: string }
	| { status: "unregistered"; code: string };

interface ExpoErrorDetails {
	error?: unknown;
}

interface ExpoTicket {
	status?: unknown;
	id?: unknown;
	details?: ExpoErrorDetails | null;
}

/**
 * Provider code to our branch. Only `MessageRateExceeded` retries; the rest give the same result
 * for the same token and body. `InvalidCredentials` is a configuration mistake but is not retried
 * here: the fix is a deployment, and endless resends would bury that failure in the logs.
 */
function classifyErrorCode(
	code: string,
): Exclude<PushSendOutcome, { status: "accepted" }> {
	switch (code) {
		case "DeviceNotRegistered":
			return { status: "unregistered", code };
		case "MessageRateExceeded":
			return { status: "retry", code };
		default:
			return { status: "permanent", code };
	}
}

const errorCodeOf = (details: ExpoErrorDetails | null | undefined): string =>
	typeof details?.error === "string" ? details.error : "unknown";

async function postJson(
	url: string,
	body: unknown,
	accessToken: string | null,
): Promise<{ ok: true; json: unknown } | { ok: false; code: string }> {
	const controller = new AbortController();
	/** Abort on deadline so one hanging batch cannot hold the whole job. */
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json",
				...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
			},
			body: JSON.stringify(body),
			signal: controller.signal,
		});
		/**
		 * Status code first: 5xx and 429 are transient on the provider side, 4xx means our request shape
		 * is wrong and resending gives the same result.
		 */
		if (!response.ok)
			return {
				ok: false,
				code:
					response.status >= 500 || response.status === 429
						? `http_${response.status}_retry`
						: `http_${response.status}`,
			};
		return { ok: true, json: await response.json() };
	} catch (error) {
		/**
		 * Network failure and timeout are retryable; folding them to permanent would drop notifications
		 * sent during a brief outage. Only deterministic failures are final.
		 */
		return {
			ok: false,
			code:
				error instanceof Error && error.name === "AbortError"
					? "timeout"
					: "network",
		};
	} finally {
		clearTimeout(timer);
	}
}

const retryable = (code: string): boolean =>
	code === "network" || code === "timeout" || code.endsWith("_retry");

const transportFailure = (
	code: string,
): Exclude<PushSendOutcome, { status: "accepted" }> =>
	retryable(code) ? { status: "retry", code } : { status: "permanent", code };

/**
 * Sends one batch. The result has the same order and length as the input: Expo returns tickets in
 * request order, and losing that mapping would hide which device failed. A short response folds the
 * remainder to transient failure (an unknown result is never recorded as success).
 */
export async function sendPushMessages(
	messages: readonly PushMessage[],
	accessToken: string | null,
): Promise<PushSendOutcome[]> {
	if (messages.length === 0) return [];

	const result = await postJson(
		EXPO_SEND_URL,
		messages.map((message) => ({
			to: message.token,
			title: message.title,
			body: message.body,
			data: message.data,
			sound: "default",
			channelId: message.channelId,
			/** A user-visible notification, so wake immediately; not a silent data push. */
			priority: "high",
		})),
		accessToken,
	);

	if (!result.ok) return messages.map(() => transportFailure(result.code));

	const tickets = (result.json as { data?: unknown } | null)?.data;
	if (!Array.isArray(tickets))
		return messages.map(() => ({
			status: "retry",
			code: "malformed_response",
		}));

	return messages.map((_, index): PushSendOutcome => {
		const ticket = tickets[index] as ExpoTicket | undefined;
		if (!ticket) return { status: "retry", code: "missing_ticket" };
		if (ticket.status === "ok")
			return {
				status: "accepted",
				ticketId: typeof ticket.id === "string" ? ticket.id : null,
			};
		return classifyErrorCode(errorCodeOf(ticket.details));
	});
}

/**
 * Reads receipts for tickets, keyed by ticket id. A ticket missing from the response is `pending`,
 * not a failure: Expo omits the key until the receipt is ready, so folding it to failure would
 * record half of normal deliveries as failed.
 */
export async function readPushReceipts(
	ticketIds: readonly string[],
	accessToken: string | null,
): Promise<Map<string, PushReceiptOutcome>> {
	const outcomes = new Map<string, PushReceiptOutcome>();
	if (ticketIds.length === 0) return outcomes;

	const result = await postJson(
		EXPO_RECEIPTS_URL,
		{ ids: [...ticketIds] },
		accessToken,
	);

	if (!result.ok) {
		const failure = transportFailure(result.code);
		for (const id of ticketIds)
			outcomes.set(
				id,
				failure.status === "retry"
					? { status: "retry", code: failure.code }
					: { status: "permanent", code: failure.code },
			);
		return outcomes;
	}

	const receipts = (result.json as { data?: unknown } | null)?.data;
	if (!receipts || typeof receipts !== "object") {
		for (const id of ticketIds)
			outcomes.set(id, { status: "retry", code: "malformed_response" });
		return outcomes;
	}

	for (const id of ticketIds) {
		const receipt = (receipts as Record<string, ExpoTicket | undefined>)[id];
		if (!receipt) {
			outcomes.set(id, { status: "pending" });
			continue;
		}
		if (receipt.status === "ok") {
			outcomes.set(id, { status: "delivered" });
			continue;
		}
		outcomes.set(id, classifyErrorCode(errorCodeOf(receipt.details)));
	}
	return outcomes;
}
