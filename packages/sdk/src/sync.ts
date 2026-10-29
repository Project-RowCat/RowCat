import {
	KeyringDto,
	type KeyringRewrapRequest,
	type KeyringSetupRequest,
	type KeyringVerifyRequest,
	PullResponse,
	type PushItem,
	PushResponse,
	SYNC_ERROR_CODE,
	SYNC_WAKE_CONTENT_TYPE,
	SYNC_WAKE_EVENT,
	type SyncPairingApproveRequest,
	SyncPairingDto,
	type SyncPairingLookupRequest,
	type SyncPairingStartRequest,
	SyncWakeEvent,
} from "@rowcat/contracts";
import type { RequestOptions, RowCatTransport } from "./client.ts";
import {
	invalidResponse,
	invalidStreamFrame,
	isRowCatApiError,
} from "./errors.ts";
import { readSse } from "./sse.ts";

/**
 * Encrypted sync transport.
 *
 * This file knows eleven paths, that the idempotency key is a header, and how to read responses
 * against the contract. It does not know what to send or when, how conflicts converge, or what the
 * DEK is. All of that belongs to @rowcat/sync. This package does not import that package. If either
 * direction of import appeared, transport and orchestration would merge into one unit, and a future
 * Expo app could not use the same SDK with a different engine.
 *
 * Neither plaintext nor the DEK passes through this file. Only encrypted strings and server
 * bookkeeping (version, cursor) are visible here, and that fact must show in the shape of this
 * interface.
 */
export interface SyncApi {
	/** Returns `{ keyring: string | null }`. `authKey` has no slot in the contract. */
	getKeyring(options?: RequestOptions): Promise<KeyringDto>;
	/** Initial registration. If a keyring already exists, throws `sync_keyring_exists` (409). */
	setupKeyring(
		input: KeyringSetupRequest,
		options?: RequestOptions,
	): Promise<KeyringDto>;
	/**
	 * Reissues the recovery code. If the proof of possession is wrong, throws
	 * `sync_keyring_proof_invalid` (403).
	 */
	rewrapKeyring(
		input: KeyringRewrapRequest,
		options?: RequestOptions,
	): Promise<KeyringDto>;
	/**
	 * Namespace reset: the keyring and all ciphertext. Requires a recent login, otherwise
	 * `recent_login_required` (403). Takes no body and is idempotent.
	 */
	resetKeyring(options?: RequestOptions): Promise<void>;
	/**
	 * Possession check. A confirmed mismatch returns `false`. A network or server failure throws.
	 *
	 * This split is why the function returns a boolean. The caller (auto-unlock) should discard its
	 * locally remembered key only on a confirmed mismatch. Discarding it on a network failure would
	 * make a user who failed once on a plane find the recovery code again.
	 */
	verifyKeyring(
		input: KeyringVerifyRequest,
		options?: RequestOptions,
	): Promise<boolean>;
	/** Incremental pull. `since` is the last cursor that was applied locally. */
	pull(
		input: { since: number; limit?: number },
		options?: RequestOptions,
	): Promise<PullResponse>;
	/** Batch push. Conflicts do not come as exceptions. They arrive as `{ ok: false, conflicts }`. */
	push(
		input: { items: PushItem[]; idempotencyKey: string },
		options?: RequestOptions,
	): Promise<PushResponse>;

	/*
	 * Pairing relay. The four methods carry only hashes and two opaque strings. Neither the pairing
	 * code, the private key, nor the DEK passes through this file. The signatures show this: no
	 * argument has a place where a code could go.
	 */

	/**
	 * New device: hands over the code hash and public key. If the same hash already exists, throws
	 * `sync_pairing_exists` (409).
	 */
	startPairing(
		input: SyncPairingStartRequest,
		options?: RequestOptions,
	): Promise<SyncPairingDto>;
	/** Session lookup. Not found, expired, and cancelled all return `sync_pairing_not_found` (404). */
	readPairing(
		input: SyncPairingLookupRequest,
		options?: RequestOptions,
	): Promise<SyncPairingDto>;
	/**
	 * Trusted device: hands over the sealed DEK. A late approval returns
	 * `sync_pairing_already_approved` (409).
	 */
	approvePairing(
		input: SyncPairingApproveRequest,
		options?: RequestOptions,
	): Promise<void>;
	/**
	 * Closes the relay. Cancellation and post-consumption cleanup are the same call. A nonexistent
	 * session also succeeds.
	 */
	cancelPairing(
		input: SyncPairingLookupRequest,
		options?: RequestOptions,
	): Promise<void>;
	/**
	 * Wake stream: only notifications arrive. Unlike the request/response methods, this stays open for
	 * a long time.
	 *
	 * The contract pins that only a cursor can be carried (`SyncWakeEvent`). This method therefore
	 * knows less than anything else in this file. It does not know what changed or what to do with the
	 * cursor. Whether to call pull with the received value is the caller's decision.
	 *
	 * Ending the stream is done through `options.signal`. A `break` out of `for await` also cleans up,
	 * because the generator's return() cancels the reader. The lifecycle manager, however, must hold
	 * the signal so it can cut the stream from outside the loop.
	 */
	wakeStream(options?: RequestOptions): AsyncGenerator<SyncWakeEvent>;
}

export function createSyncApi({
	requestJson,
	requestVoid,
	requestStream,
}: RowCatTransport): SyncApi {
	/**
	 * Why not native `EventSource`.
	 *
	 * Both can send cookies (`withCredentials`). The difference is how failures are known. EventSource
	 * gives the same `error` event for any non-200 response, with no status code. So 401 (re-login
	 * needed) and 503 (retry later) cannot be told apart. Per the spec both are permanent closures, so
	 * it never reconnects after a 5xx.
	 *
	 * With fetch, `requestStream` converts failures into a RowCatApiError that carries the status and
	 * `code`. 401 and 403 stop, while 5xx and network errors back off. That branching comes for free.
	 *
	 * Reconnect timing is controlled by this code (jitter, stopping while offline), and the parser can
	 * be tested in Node as-is. This package still has no DOM types. `ReadableStream` and `AbortSignal`
	 * are standard web APIs, and Expo uses them too.
	 */
	async function* wakeStream(
		options?: RequestOptions,
	): AsyncGenerator<SyncWakeEvent> {
		const stream = await requestStream({
			method: "GET",
			path: "/me/sync/events",
			accept: SYNC_WAKE_CONTENT_TYPE,
			signal: options?.signal,
		});

		for await (const frame of readSse(stream)) {
			/**
			 * Unknown event names are silently ignored. Heartbeats are comments, so they never arrive here.
			 * If a second frame kind appears later, old clients will not mistake it for a wake event. The
			 * naming is why.
			 */
			if (frame.event !== SYNC_WAKE_EVENT) continue;

			let json: unknown;
			try {
				json = JSON.parse(frame.data);
			} catch {
				throw invalidStreamFrame();
			}
			/**
			 * Not cast. If an unvalidated shape passed, an `undefined` cursor would flow to the lifecycle
			 * layer, which tries to compare it with the local cursor. Stopping here makes the caller treat
			 * it as a connection failure and reconnect after backoff, which is a diagnosable failure.
			 */
			const parsed = SyncWakeEvent.safeParse(json);
			if (!parsed.success) throw invalidResponse("/me/sync/events");
			yield parsed.data;
		}
	}

	const readKeyring = (json: unknown, path: string): KeyringDto => {
		const parsed = KeyringDto.safeParse(json);
		/**
		 * Validation matters especially here. If a field outside the contract arrives through a server
		 * mistake, the schema drops it. When `auth_key` leaked this way, this one line was the last
		 * defense.
		 */
		if (!parsed.success) throw invalidResponse(path);
		return parsed.data;
	};

	/**
	 * Pairing responses are also read through the contract, for the same reason as the keyring. If the
	 * server adds a field by mistake (device name, last connection, owner id), the value is dropped.
	 * One promise of this slice is that the server holds no device identity. That promise breaks first
	 * in a client that passes responses through unchanged.
	 */
	const parsePairing = (json: unknown): SyncPairingDto => {
		const parsed = SyncPairingDto.safeParse(json);
		if (!parsed.success) throw invalidResponse("/me/sync/pairing");
		return parsed.data;
	};

	return {
		async getKeyring(options) {
			return readKeyring(
				await requestJson({
					method: "GET",
					path: "/me/sync/keyring",
					signal: options?.signal,
				}),
				"/me/sync/keyring",
			);
		},

		async setupKeyring(input, options) {
			return readKeyring(
				await requestJson({
					method: "POST",
					path: "/me/sync/keyring",
					body: input,
					signal: options?.signal,
				}),
				"/me/sync/keyring",
			);
		},

		async rewrapKeyring(input, options) {
			return readKeyring(
				await requestJson({
					method: "PUT",
					path: "/me/sync/keyring",
					body: input,
					signal: options?.signal,
				}),
				"/me/sync/keyring",
			);
		},

		async resetKeyring(options) {
			await requestVoid({
				method: "DELETE",
				path: "/me/sync/keyring",
				signal: options?.signal,
			});
		},

		async verifyKeyring(input, options) {
			try {
				await requestVoid({
					method: "POST",
					path: "/me/sync/keyring/verify",
					body: input,
					signal: options?.signal,
				});
				return true;
			} catch (error) {
				/**
				 * Only a confirmed mismatch folds to false. A 404 (no keyring), 401, 5xx, or network failure is
				 * rethrown. Those mean 'could not verify', not 'this key is wrong'. Treating them as the same
				 * value would make the caller drop trust while offline.
				 */
				if (
					isRowCatApiError(error) &&
					error.status === 403 &&
					error.code === SYNC_ERROR_CODE.keyringProofInvalid
				)
					return false;
				throw error;
			}
		},

		async pull(input, options) {
			const search = new URLSearchParams({ since: String(input.since) });
			if (input.limit !== undefined) search.set("limit", String(input.limit));
			const json = await requestJson({
				method: "GET",
				path: "/me/sync/records",
				search,
				signal: options?.signal,
			});
			const parsed = PullResponse.safeParse(json);
			if (!parsed.success) throw invalidResponse("/me/sync/records");
			return parsed.data;
		},

		async push(input, options) {
			const json = await requestJson({
				method: "POST",
				path: "/me/sync/records",
				body: { items: input.items },
				/**
				 * The idempotency key must be a header; that is part of the protocol. In the body it would be
				 * mixed into the server's request hash, so retries of the same chunk would produce different
				 * hashes and idempotency would fail.
				 */
				headers: { "Idempotency-Key": input.idempotencyKey },
				signal: options?.signal,
			});
			const parsed = PushResponse.safeParse(json);
			if (!parsed.success) throw invalidResponse("/me/sync/records");
			return parsed.data;
		},

		async startPairing(input, options) {
			return parsePairing(
				await requestJson({
					method: "POST",
					path: "/me/sync/pairing",
					body: input,
					signal: options?.signal,
				}),
			);
		},

		async readPairing(input, options) {
			return parsePairing(
				await requestJson({
					method: "POST",
					path: "/me/sync/pairing/status",
					body: input,
					signal: options?.signal,
				}),
			);
		},

		async approvePairing(input, options) {
			await requestVoid({
				method: "POST",
				path: "/me/sync/pairing/approve",
				body: input,
				signal: options?.signal,
			});
		},

		async cancelPairing(input, options) {
			await requestVoid({
				method: "DELETE",
				path: "/me/sync/pairing",
				body: input,
				signal: options?.signal,
			});
		},

		wakeStream,
	};
}
