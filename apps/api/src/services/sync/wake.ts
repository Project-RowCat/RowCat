import {
	SYNC_WAKE_CONTENT_TYPE,
	SYNC_WAKE_EVENT,
	SYNC_WAKE_HEARTBEAT_MS,
	type SyncWakeEvent,
} from "@rowcat/contracts";
import { readSyncCursor } from "./index.ts";

/**
 * Sync wake-up: the notification plane, no data travels here. It reads no records, touches no
 * ciphertext, does not merge, has no domain type vocabulary, does not know what changed and owns no
 * persistent state. The only thing sent is the owner's current `seq`, and a receiving device only
 * uses it to wake automatic sync; replication is still `/me/sync/records`.
 *
 * Authority is not here: the source of truth is `sync_state.seq` (PostgreSQL) and the broker knows
 * only currently attached subscribers. A restart forgets everything safely, since a reconnecting
 * device gets the durable cursor in its initial frame and one pull covers the gap. So no
 * `sync_event`/`sse_outbox` table: the durable cursor solves the same problem more accurately than
 * an event log.
 *
 * Deployment assumption: one API process. The broker spreads only within the process, which is
 * enough for the single `api` service in `docker-compose.yml`; pub/sub is not added just because
 * Redis is in the stack. With more than one replica the fix is narrow: make `publish` cross the
 * process boundary (Redis pub/sub or Postgres `LISTEN/NOTIFY`) and nothing in routes, contract or
 * clients changes. Until then the symptom is latency, not errors: a device on another process
 * misses the wake-up and catches up on startup, foreground or reconnect triggers.
 */

export type SyncWakeListener = (cursor: number) => void;
/** How a subscription evicted by the cap closes its own stream; registered with the listener. */
export type SyncWakeEvict = () => void;

/** Per-member concurrent subscription cap: well above real device and tab counts, but bounds process resources. */
export const MAX_SUBSCRIBERS_PER_OWNER = 20;

export interface SyncWakeBroker {
	/** Returns an unsubscribe function; one owner may have many devices and tabs attached. */
	subscribe(
		owner: string,
		listener: SyncWakeListener,
		onEvict?: SyncWakeEvict,
	): () => void;
	/** Announces a committed cursor. Never throws: it runs after a successful push, and a leak would report an already-committed transaction as failed. */
	publish(owner: string, cursor: number): void;
	/**
	 * Observation window for tests. Not exposed as a diagnostic endpoint: the number is "how many
	 * devices this member has on", which the notification plane may know but must not publish.
	 */
	subscriberCount(owner?: string): number;
}

interface Subscription {
	listener: SyncWakeListener;
	onEvict: SyncWakeEvict | undefined;
}

export function createSyncWakeBroker(): SyncWakeBroker {
	const owners = new Map<string, Set<Subscription>>();

	return {
		subscribe(owner, listener, onEvict) {
			let set = owners.get(owner);
			if (!set) {
				set = new Set();
				owners.set(owner, set);
			}
			const subscription: Subscription = { listener, onEvict };
			/**
			 * Over the per-member cap the oldest subscription is closed: each stream holds a socket,
			 * listener and heartbeat timer, so without a cap one account could exhaust memory and FDs. Old
			 * ones are closed rather than refusing new ones because the real pattern is opening a new tab
			 * without closing the old, and the live newest tab must wake. `Set` keeps insertion order, so
			 * the first entry is the oldest.
			 */
			if (set.size >= MAX_SUBSCRIBERS_PER_OWNER) {
				const oldest = set.values().next().value;
				if (oldest) {
					set.delete(oldest);
					oldest.onEvict?.();
				}
			}
			set.add(subscription);

			let released = false;
			return () => {
				// Idempotent: abort and stream cancel both running is a normal path.
				if (released) return;
				released = true;
				const current = owners.get(owner);
				if (!current) return;
				current.delete(subscription);
				// Leaving an empty set would accumulate one key per member that ever connected.
				if (current.size === 0) owners.delete(owner);
			};
		},

		publish(owner, cursor) {
			const set = owners.get(owner);
			if (!set) return;
			// Iterates a snapshot: a listener unsubscribing itself (publish right after a disconnect) is
			// normal.
			for (const { listener } of [...set]) {
				try {
					listener(cursor);
				} catch {
					// One listener's failure must not block other devices, and throwing here would report an
					// already-committed push as failed; wake-up is an optimization.
				}
			}
		},

		subscriberCount(owner) {
			if (owner !== undefined) return owners.get(owner)?.size ?? 0;
			let total = 0;
			for (const set of owners.values()) total += set.size;
			return total;
		},
	};
}

/** This process's broker; routes and the push path share the instance. */
export const syncWakeBroker = createSyncWakeBroker();

const encoder = new TextEncoder();

/**
 * Named event + one JSON line + blank line. The NDJSON helper is not reused: framing differs, and
 * merging would produce an SSE stream EventSource cannot read.
 */
const wakeFrame = (cursor: number): Uint8Array => {
	const event: SyncWakeEvent = { cursor };
	return encoder.encode(
		`event: ${SYNC_WAKE_EVENT}\ndata: ${JSON.stringify(event)}\n\n`,
	);
};

/**
 * Heartbeat as an SSE comment, not an event: client parsers drop `:` lines, so it fires no callback
 * and wakes no sync. Its only job is telling proxies that would close idle connections the stream
 * is alive.
 */
const HEARTBEAT_FRAME = encoder.encode(": ping\n\n");

export interface SyncWakeStreamOptions {
	owner: string;
	/** Client disconnect; this alone cleans up the subscription and timers. */
	signal: AbortSignal;
	broker?: SyncWakeBroker;
	/** Reads the owner's durable cursor; tests swap it to widen the race window. */
	readCursor?: (owner: string) => Promise<number>;
	heartbeatMs?: number;
	/**
	 * Whether the session that opened this stream still stands, asked at each heartbeat. The session was
	 * checked once, at open, and a stream never ended on its own: after a password reset, a session
	 * revoke or account deletion, whoever held the old cookie kept receiving the owner's cursor (when
	 * they are active) indefinitely. `false` ends the stream; a failed check keeps it (this plane is an
	 * optimization, and our own outage is not evidence the session ended).
	 *
	 * Asked before a wake frame too, once a heartbeat interval has passed since the last answer. A
	 * frame resets the heartbeat timer, so while the owner pushes more often than that the heartbeat
	 * never fires — and a check tied only to it never ran exactly while there was activity to leak.
	 */
	stillSignedIn?: () => Promise<boolean>;
	/**
	 * A stream ends after this long regardless, and the client reconnects (it already does, with backoff
	 * that a healthy connection resets). Without it nothing bounds a stream, and shutdown waits on
	 * every open one.
	 */
	maxLifetimeMs?: number;
	/** The clock the session-check interval reads; tests replace it. */
	now?: () => number;
}

/** How long one stream may live before the client is made to reconnect (`maxLifetimeMs`). */
export const SYNC_WAKE_MAX_LIFETIME_MS = 30 * 60 * 1000;

/**
 * Subscribe, then read the durable cursor, then stream; the order is the whole function. The naive
 * order silently loses wake-ups:
 *
 * ```text
 * read seq (10)
 * another device pushes (11) -> publish -> nobody listening
 * subscribe
 * client knows only 10, 11 never arrives
 * ```
 *
 * Subscribing first means a commit in between is caught either way: the subscription receives it
 * (publish after subscribe) or the read sees it (commit before read). The same cursor going out
 * twice is harmless: cursors merge toward the larger and clients tolerate duplicates.
 *
 * Failure happens before the stream opens: a failed durable read throws into an ordinary error
 * envelope (500) and the client reconnects with backoff. Sending 200 first and then an empty stream
 * would be indistinguishable from "connected but nothing arrives".
 */
export async function openSyncWakeStream(
	options: SyncWakeStreamOptions,
): Promise<ReadableStream<Uint8Array>> {
	const {
		owner,
		signal,
		broker = syncWakeBroker,
		readCursor = readSyncCursor,
		heartbeatMs = SYNC_WAKE_HEARTBEAT_MS,
		stillSignedIn,
		maxLifetimeMs = SYNC_WAKE_MAX_LIFETIME_MS,
		now = Date.now,
	} = options;

	/**
	 * Only the largest cursor to send is kept; no queue for slow subscribers. When 100, 101 and 102
	 * pile up the client needs just the latest (the pull fetches everything after its cursor), and
	 * avoiding an unbounded queue is the backpressure answer.
	 */
	let pending: number | null = null;
	/**
	 * Largest cursor already sent; this is what keeps the stream from going backwards. `pending` alone
	 * is not enough since it empties on send and a later lower cursor would go out. The server cannot
	 * publish one today (seq is monotonic under `FOR UPDATE`), but a monotonic stream reduces what
	 * readers must assume.
	 */
	let sent = -1;
	let closed = false;
	let resume: (() => void) | null = null;
	let heartbeat: ReturnType<typeof setTimeout> | null = null;

	const wakeWaiter = (): void => {
		if (heartbeat !== null) {
			clearTimeout(heartbeat);
			heartbeat = null;
		}
		const pendingResume = resume;
		resume = null;
		pendingResume?.();
	};

	const offer = (cursor: number): void => {
		if (closed) return;
		// Never backwards; the initial frame racing a concurrent publish still resolves to the larger.
		if (cursor <= sent) return;
		if (pending !== null && pending >= cursor) return;
		pending = cursor;
		wakeWaiter();
	};

	// Subscribe first: the only order that does not lose a commit landing during the durable read. The
	// third argument is the eviction path; `close` is defined below but called later.
	const unsubscribe = broker.subscribe(owner, offer, () => close());

	let lifetime: ReturnType<typeof setTimeout> | null = null;

	const close = (): void => {
		if (closed) return;
		closed = true;
		if (lifetime !== null) clearTimeout(lifetime);
		unsubscribe();
		wakeWaiter();
	};

	if (signal.aborted) close();
	else signal.addEventListener("abort", close, { once: true });
	if (!closed) lifetime = setTimeout(close, maxLifetimeMs);

	// Then the durable read; on failure the stream is never opened.
	try {
		offer(await readCursor(owner));
	} catch (error) {
		close();
		throw error;
	}

	/** The session was checked at open, so the first interval starts now. */
	let sessionCheckedAt = now();
	/** `false` once the session is known to have ended; a failed check counts as still signed in. */
	const sessionStands = async (): Promise<boolean> => {
		if (!stillSignedIn) return true;
		sessionCheckedAt = now();
		return stillSignedIn().catch(() => true);
	};

	/** Waits until there is something to send, a heartbeat is due, or the connection ends. */
	const waitForWork = (): Promise<void> =>
		new Promise((settle) => {
			resume = settle;
			heartbeat = setTimeout(() => {
				heartbeat = null;
				resume = null;
				settle();
			}, heartbeatMs);
		});

	return new ReadableStream<Uint8Array>({
		/**
		 * Built in `pull`, not `start`: the next frame is made only when the consumer is ready, so a slow
		 * client cannot pile frames up in memory. The heartbeat timer lives only inside this wait; a
		 * separate `setInterval` would leave an orphan timer that wakes after disconnect and throws
		 * writing to a closed controller.
		 */
		async pull(controller) {
			for (;;) {
				if (closed) {
					controller.close();
					return;
				}
				if (
					pending !== null &&
					now() - sessionCheckedAt >= heartbeatMs &&
					!(await sessionStands())
				) {
					close();
					controller.close();
					return;
				}
				if (pending !== null) {
					const cursor = pending;
					pending = null;
					sent = cursor;
					controller.enqueue(wakeFrame(cursor));
					return;
				}
				await waitForWork();
				if (closed) {
					controller.close();
					return;
				}
				if (pending === null) {
					if (!(await sessionStands())) {
						close();
						controller.close();
						return;
					}
					controller.enqueue(HEARTBEAT_FRAME);
					return;
				}
			}
		},

		/** The consumer dropped the stream (disconnect); cleanup is idempotent even alongside abort. */
		cancel() {
			close();
		},
	});
}

/** Response headers; blocks both intermediate caching and buffering. */
export const SYNC_WAKE_HEADERS: Readonly<Record<string, string>> = {
	"Content-Type": `${SYNC_WAKE_CONTENT_TYPE}; charset=utf-8`,
	// A private stream: one frame left in an intermediate cache could be served to someone else, and
	// the cursor reveals how active the account is.
	"Cache-Control": "private, no-store",
	// If a reverse proxy (nginx, some CDNs) buffers the response, wake-ups wait until a 4KB buffer
	// fills, turning this into sync that occasionally runs minutes later.
	"X-Accel-Buffering": "no",
};

/**
 * Do not compress this stream. `apps/api/src/app.ts` has no compression middleware today; if
 * someone enables it globally, this path must be excluded, since a compressor holds frames until
 * enough bytes accumulate to flush and a tiny wake-up never does. The symptom is wake-ups arriving
 * minutes late, not an error.
 */
