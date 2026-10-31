import type {
	KeyringDto,
	PullResponse,
	PushResponse,
	SyncPairingDto,
} from "@rowcat/contracts";
import {
	KeyringRewrapRequest,
	KeyringSetupRequest,
	KeyringVerifyRequest,
	PushRequest,
	SYNC_ERROR_CODE,
	SyncIdempotencyKey,
	SyncPairingApproveRequest,
	SyncPairingLookupRequest,
	SyncPairingStartRequest,
} from "@rowcat/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import {
	requireFreshSession,
	sessionStillValid,
} from "../../auth/session-id.ts";
import { ApiError, invalidInput } from "../../lib/errors.ts";
import { requireActiveViewer, requireViewer } from "../../lib/gates.ts";
import { checkRateLimit } from "../../lib/rate-limit/index.ts";
import { getViewer } from "../../middleware/viewer.ts";
import { requireFeatureEnabled } from "../../services/ops.ts";
import {
	getKeyring,
	pullRecords,
	pushRecords,
	replaceKeyring,
	resetSyncNamespace,
	setupKeyring,
	verifyKeyring,
} from "../../services/sync/index.ts";
import {
	approvePairing,
	cancelPairing,
	readPairing,
	startPairing,
} from "../../services/sync/pairing.ts";
import {
	openSyncWakeStream,
	SYNC_WAKE_HEADERS,
} from "../../services/sync/wake.ts";

/**
 * `/v2/me/sync/*` — encrypted sync.
 *
 * The owner comes only from the session. No handler reads `owner` from the body, query or headers,
 * and the contract schemas have no such field. When reading this router, check one thing: is there
 * any value other than `viewer.id` that could become the owner?
 *
 * Mounted under the `me` router (`me.route("/sync", sync)`) so `routes/index.ts` only knows `/me`
 * and the RPC types stay aligned with the real URLs.
 */

/**
 * Reads and writes use different gates.
 *
 * ```text
 * writes (push, keyring setup/rewrap, pairing start/approve)   requireActiveViewer
 * reads  (keyring get, verify, pull, events, pairing lookup/cancel)  requireViewer
 * ```
 *
 * The asymmetry is intentional: a suspended account has no reason to keep growing server storage,
 * but blocking it from carrying its own data to another device would turn the restriction into
 * holding that data hostage. Do not "make it consistent".
 *
 * `POST /keyring/verify` is POST only because it carries a body; it is read-only, hence
 * `requireViewer`. If a locked device could not even check its own key, a restricted account could
 * never retrieve its data.
 */
export const sync = new Hono<AppEnv>()
	/**
	 * `no-store` on every route: pull responses vary by cursor and are all private data, so a single
	 * page left in an intermediate cache is a leak surface, even as ciphertext, and could be served to
	 * someone else's request.
	 */
	.use("*", async (c, next) => {
		await next();
		c.header("Cache-Control", "no-store");
	})

	.get("/keyring", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		const body: KeyringDto = await getKeyring(viewer.id);
		return c.json(body);
	})

	.post("/keyring", async (c) => {
		const viewer = requireActiveViewer(await getViewer(c));
		const parsed = KeyringSetupRequest.safeParse(
			await c.req.json().catch(() => null),
		);
		if (!parsed.success) throw invalidInput(parsed.error);
		const body: KeyringDto = await setupKeyring(viewer.id, parsed.data);
		return c.json(body);
	})

	.put("/keyring", async (c) => {
		const viewer = requireActiveViewer(await getViewer(c));
		const parsed = KeyringRewrapRequest.safeParse(
			await c.req.json().catch(() => null),
		);
		if (!parsed.success) throw invalidInput(parsed.error);
		const body: KeyringDto = await replaceKeyring(viewer.id, parsed.data);
		return c.json(body);
	})

	/**
	 * Resets the namespace (keyring and all ciphertext). Requires a recent login instead of proof of
	 * possession, since whoever needs this cannot produce proof (see `services/sync/index.ts`). No
	 * body; idempotent. `requireActiveViewer` because it is a write.
	 */
	.delete("/keyring", async (c) => {
		const viewer = requireActiveViewer(await getViewer(c));
		await requireFreshSession(c.req.raw.headers);
		await resetSyncNamespace(viewer.id);
		return c.body(null, 204);
	})

	/** Possession check: 204 means valid, 403 means a definite mismatch; nothing in between. */
	.post("/keyring/verify", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		const parsed = KeyringVerifyRequest.safeParse(
			await c.req.json().catch(() => null),
		);
		if (!parsed.success) throw invalidInput(parsed.error);
		await verifyKeyring(viewer.id, parsed.data);
		return c.body(null, 204);
	})

	.get("/records", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		const body: PullResponse = await pullRecords(viewer.id, {
			since: readInt(c.req.query("since"), 0),
			...(c.req.query("limit") !== undefined
				? { limit: readInt(c.req.query("limit"), 0) }
				: {}),
		});
		return c.json(body);
	})

	.post("/records", async (c) => {
		const viewer = requireActiveViewer(await getViewer(c));
		/**
		 * Breaker for sync push only (`ops` slice); `GET /records` is deliberately not gated. Closing
		 * push stops server-side writes, while closing pull would block devices from retrieving their own
		 * data, which is hostage-taking, not a breaker. Blocked devices keep writing locally; records
		 * stay dirty and the next run uploads them once the switch is back.
		 */
		await requireFeatureEnabled("sync");
		/**
		 * The idempotency key is a header, not a body field: it must stay out of the request hash, or a
		 * retry of the same chunk would hash differently each time and idempotency would be void.
		 */
		const key = SyncIdempotencyKey.safeParse(c.req.header("Idempotency-Key"));
		if (!key.success)
			throw new ApiError(
				400,
				SYNC_ERROR_CODE.recordInvalid,
				"The Idempotency-Key header is required.",
			);
		const parsed = PushRequest.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) throw invalidInput(parsed.error);

		const body: PushResponse = await pushRecords(viewer.id, {
			items: parsed.data.items,
			idempotencyKey: key.data,
		});
		/**
		 * Conflicts are also 200: an optimistic-concurrency conflict is an expected outcome, and the
		 * response must carry the `serverVersion` list, which `ApiErrorBody` has no slot for.
		 */
		return c.json(body);
	})

	/* Device pairing: the four relay handlers share one property, the server never knows the
	 * code. No request has a slot for it, and it is both the HKDF salt and the AAD, so without it
	 * an envelope can be neither built nor opened. A leak of this router (logs, proxies, DB dump)
	 * reveals only that someone tried to connect a device.
	 *
	 * The hash rides in the body, not the path: path parameters land in access logs, referrers
	 * and proxy cache keys, and the hash is the session's only key. */

	/**
	 * Start: the new device deposits its public key. A write (`requireActiveViewer`). Restricted
	 * accounts cannot pair a new device because this creates server state; they can still reach their
	 * data with the recovery code, so this is consistent with leaving pull open.
	 */
	.post("/pairing", async (c) => {
		const viewer = requireActiveViewer(await getViewer(c));
		/**
		 * Limits how fast sessions are minted; the cap on open sessions is the service's
		 * `pairingMaxActive`, a different problem (it clears by cancelling one). A new request never
		 * replaces an open session — that would cancel another device's pairing mid-flight — so open
		 * sessions only end by expiry, cancel or approval, and this limit is what keeps one session of
		 * the account from holding all of them open. The error codes differ too (`pairingRateLimited` vs `pairingTooMany`) because the next action
		 * differs: wait vs cancel one.
		 *
		 * `/pairing/status` has no such gate: it is designed polling (about every 2s while the screen is
		 * open) and a cap would block legitimate users mid-pairing.
		 */
		await checkRateLimit("syncPairingCreate", viewer.id);
		const parsed = SyncPairingStartRequest.safeParse(
			await c.req.json().catch(() => null),
		);
		if (!parsed.success) throw invalidInput(parsed.error);
		const body: SyncPairingDto = await startPairing(viewer.id, parsed.data);
		return c.json(body);
	})

	/**
	 * Lookup: read-only, so `requireViewer` (same axis as pull and verify). POST only because the hash
	 * goes in the body. It does not consume the payload; the device that actually remembered the key
	 * does that via `DELETE`.
	 */
	.post("/pairing/status", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		const parsed = SyncPairingLookupRequest.safeParse(
			await c.req.json().catch(() => null),
		);
		if (!parsed.success) throw invalidInput(parsed.error);
		const body: SyncPairingDto = await readPairing(viewer.id, parsed.data);
		return c.json(body);
	})

	/** Approve: a trusted device deposits the sealed DEK; the server neither opens nor alters that string. */
	.post("/pairing/approve", async (c) => {
		const viewer = requireActiveViewer(await getViewer(c));
		const parsed = SyncPairingApproveRequest.safeParse(
			await c.req.json().catch(() => null),
		);
		if (!parsed.success) throw invalidInput(parsed.error);
		await approvePairing(viewer.id, parsed.data);
		return c.body(null, 204);
	})

	/**
	 * Cancel and post-consume cleanup are the same operation. Idempotent: a missing session is also
	 * 204. `requireViewer` is intentional since this only deletes state, and an account restricted
	 * mid-pairing must still be able to close the relay it created.
	 */
	.delete("/pairing", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		const parsed = SyncPairingLookupRequest.safeParse(
			await c.req.json().catch(() => null),
		);
		if (!parsed.success) throw invalidInput(parsed.error);
		await cancelPairing(viewer.id, parsed.data);
		return c.body(null, 204);
	})

	/**
	 * Wake stream: carries notifications only. What this route deliberately lacks:
	 *
	 * ```text
	 * owner in query/headers/body   the owner comes only from the session
	 * keyring proof of possession   no ciphertext leaves, so no reason to demand the key
	 * records, types, content       the only payload is one cursor (SyncWakeEvent in contracts)
	 * ```
	 *
	 * The gate matches pull: suspended or blocked accounts may open it, otherwise only a latency
	 * optimization would silently vanish for them. Proof is not required either: a locked new device
	 * cannot pull anyway (no DEK) and the controller already knows that, and demanding proof would
	 * make the notification plane aware of crypto state. The web client simply does not connect while
	 * locked, which is the client's choice to save waste.
	 */
	.get("/events", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		/**
		 * The `await` is half the race defence: 200 goes out only after the subscription is installed and
		 * the durable cursor read, so a DB failure surfaces as a normal error envelope before the stream
		 * opens. The other half (subscribe before read) is in the service.
		 */
		const headers = c.req.raw.headers;
		const body = await openSyncWakeStream({
			owner: viewer.id,
			signal: c.req.raw.signal,
			stillSignedIn: () => sessionStillValid(headers),
		});
		for (const [name, value] of Object.entries(SYNC_WAKE_HEADERS))
			c.header(name, value);
		return c.body(body);
	});

/**
 * Parse failures are passed through rather than folded to the default: folding `NaN` to 0 would
 * silently turn a bad cursor request into "start over". The service must see `NaN` and answer 400
 * so the client learns about its bug.
 */
function readInt(value: string | undefined, fallback: number): number {
	if (value === undefined) return fallback;
	return Number(value);
}
