import type { AuthoringStore, DraftRecoveryStore } from "@rowcat/authoring";
import type { ChatStore, GenerationPreferenceStore } from "@rowcat/chat";
import type {
	RuntimeConversationStore,
	RuntimeSaveStore,
} from "@rowcat/runtime-persistence";
import type { DeviceKeyStore, SyncStore } from "@rowcat/sync";
import type {
	ProviderConnectionStore,
	ProviderCredentialAccess,
} from "#/lib/local-provider/store.ts";
import type { DraftCoverStore } from "../local-authoring/draft-cover.ts";
import type { AutoSyncPreferenceStore } from "../local-sync/preference.ts";
import type { LocalMutationSignal } from "./mutation-signal.ts";

/**
 * Owner of local-scope activation, kept outside React. It was split out of `scope.tsx` for two
 * reasons.
 *
 * First, ordering. If activation starts only inside an effect, there is a window where the viewer
 * is known but no store is ready, and a click on `Start conversation` or `New draft` fails there although nothing is
 * wrong. Held here, a click can start activation, and the effect just repeats the idempotent
 * request.
 *
 * Second, verification. The rules concern account isolation, and as a plain object the race can be
 * reproduced without rendering.
 *
 * How the database is opened is not decided here. The driver does that (`db.ts` and each domain's
 * `store.ts`).
 */

/**
 * Stores are opened as a group on purpose. Physically they are one database (`db.ts`). If each
 * domain ran its own activation, two owners would manage one connection, and depending on logout
 * order, one would keep using a connection the other had already closed. This type means one
 * member, one connection, several stores.
 */
export interface LocalDataStores {
	chat: ChatStore;
	authoring: AuthoringStore;
	/**
	 * Sync store, on the same connection as the two above. `applyPull` must write rooms, messages,
	 * drafts, children and the cursor in one transaction, and IndexedDB transactions are atomic only
	 * within one database. If the stores were split, nothing could stop the cursor from committing
	 * alone.
	 */
	sync: SyncStore;
	/**
	 * Local copy of the draft version discarded by a merge. It must share the connection with `sync`
	 * and be committed in the same transaction as the merge result. Otherwise a state where the
	 * canonical copy was overwritten but the losing copy does not exist could be represented, which is
	 * the loss this feature exists to prevent.
	 */
	draftRecovery: DraftRecoveryStore;
	/**
	 * Generation preference: not synced, but on the same connection. This port's records have no sync
	 * axes, so the protocol does not know it exists. Its lifetime still has to match. When logout
	 * closes the scope, this port is dropped with it, so the previous member's default cannot show
	 * after an account switch. A separate connection would turn 'erase this device's data' into a
	 * two-place deletion, which is the same reason the remembered DEK wrapper shares this connection.
	 */
	generation: GenerationPreferenceStore;
	/**
	 * Draft cover for an unpublished draft, same class as `generation` (not synced). It is not put on
	 * the shared `authoring` port, because that port is a contract a future Expo build fills with
	 * SQLite, and this value is a temporary holding for this web device only. Its lifetime must match
	 * the others, so an account switch never shows the previous person's cover.
	 */
	draftCover: DraftCoverStore;
	/**
	 * Device preference for auto sync, same nature as `generation`. No separate settings system was
	 * built because a slot already exists, and its scope (member plus device) exactly matches what
	 * this value needs (`local-sync/preference.ts`).
	 */
	/**
	 * Creator runtime player save: the opposite of the above in that it is synced. Its records carry
	 * all the sync axes, but it shares the authoring store's connection for the same reason: the
	 * revision must be issued in the same transaction as the save, and IndexedDB transactions are
	 * atomic only within one database.
	 */
	runtimeSave: RuntimeSaveStore;
	/**
	 * Runtime playthrough library line: same connection as `runtimeSave`, different port. The
	 * connection is shared because the revision is issued in the same transaction as the save. The
	 * port is separate for ownership reasons: the save port sits inside the serialized replay
	 * lifecycle, and recording a library line must not become a participant in it (see the header of
	 * `conversation.ts` in `@rowcat/runtime-persistence`).
	 */
	runtimeConversation: RuntimeConversationStore;
	autoSyncPreference: AutoSyncPreferenceStore;
	/**
	 * Provider connection (BYO), the port the screen sees. It exposes only a summary without
	 * credentials, plus connect and disconnect. Its lifetime must match the scope: after logout, the
	 * previous member's 'connected' state must not show. On account withdrawal, a separate connection
	 * would leave the deleted account's API key behind if one deletion step were missed.
	 */
	provider: ProviderConnectionStore;
	/**
	 * Runtime-only accessor on the same connection, which opens credentials only at execution time.
	 * Keeping it apart from the port above is this slice's security boundary. The settings screen sees
	 * only `provider` (narrowed by `local-provider/scope.ts`), while this flows only to the generation
	 * router. Merging them would put decryption into the render tree, where plaintext keys could reach
	 * React state, devtools, or error reports.
	 */
	providerCredentials: ProviderCredentialAccess;
	/**
	 * Local change signal: a fact emitted by the stores together, not a store. It is bound here
	 * because its lifetime must match. Subscribers such as auto sync work against this member's store
	 * instances, and closing the scope must end their subscriptions. At module scope, a logged-out
	 * member's subscription would persist for the tab's life. It carries no content; if it is ever
	 * made able to carry content, it will eventually (`mutation-signal.ts`).
	 */
	mutations: LocalMutationSignal;
	/**
	 * Remembered DEK wrapper, another narrow port on the same connection. Keeping it here makes 'erase
	 * this device's data' a single operation. In a separate store, deleting the database would not
	 * revoke trust and would leave a stale unlock, which the legacy code hit. Its lifetime must match,
	 * so it is dropped when the scope closes.
	 */
	deviceKey: DeviceKeyStore;
}

/** Domain name. Ownership checks use it to decide which store to ask. */
export type LocalDataDomain = keyof LocalDataStores;

/**
 * The hands that actually open and close the stores. Both functions are synchronous, and that
 * matters: if opening were async, another activation could slip in between the 'is this still the
 * right member?' check and the actual open, flipping the order so the previous member's database
 * opens last. Being synchronous leaves no gap for that.
 */
export interface LocalDataDriver {
	open(viewerId: string): LocalDataStores;
	reset(): void;
}

/**
 * Gets the driver without side effects. The default is a dynamic import because IndexedDB exists
 * only in browsers. The import itself opens nothing, so nothing is left behind even if the promise
 * resolves late.
 */
export type LocalDataDriverLoader = () => Promise<LocalDataDriver>;

const defaultLoader: LocalDataDriverLoader = async () => {
	const [
		{ activateLocalDbScope, resetLocalDbScope },
		{ createLocalDataStores },
	] = await Promise.all([import("./db.ts"), import("./stores.ts")]);
	return {
		/**
		 * Opens the database once, and all ports share it. Opening per domain would create two
		 * connections to the same name and make the single transaction that sync requires impossible.
		 *
		 * Assembly lives in `stores.ts` so that tests can build the same stores with the same function.
		 * Verifying against unwrapped stores would verify nothing.
		 */
		open: (viewerId) =>
			createLocalDataStores(activateLocalDbScope(viewerId), viewerId),
		reset: resetLocalDbScope,
	};
};

export interface LocalDataActivation {
	/**
	 * Opens this member's scope. If the same member's open is already in progress, returns that
	 * promise.
	 *
	 * Failure resolves to `null` (private mode, storage policy, database open failure) rather than
	 * rejecting. The waiter is usually a user click, and it needs an answer to 'can we write?', not an
	 * exception.
	 */
	ensure(viewerId: string): Promise<LocalDataStores | null>;
	/**
	 * Drops to guest state: invalidates any in-progress activation and releases the connection. Data
	 * is kept.
	 */
	release(): void;
	/**
	 * Permanently discards this member, for account withdrawal only. This is the opposite of
	 * `release()`, which only stops looking for now and reopens on sign-in.
	 *
	 * Some work still runs right after withdrawal (a late auto-save, an in-flight sync round trip,
	 * cleanup on unmount). If any of it calls `ensure()`, the database that was just deleted would be
	 * recreated. Bumping the generation alone is not enough, since it marks results stale without
	 * blocking the next request. So the member stays on the list and `ensure()` returns null
	 * immediately.
	 *
	 * The list stays small: withdrawals in one tab are few, and it disappears when the tab closes.
	 * Member IDs are never reused, so no future account is blocked by mistake.
	 *
	 * It does not delete data. `deleteLocalDbForViewer` in `db.ts` does that. Combining the two would
	 * leave the retry point inside this object, which is unreachable once the scope has dropped to
	 * guest.
	 */
	abandon(viewerId: string): void;
	/** Owner of the current activation. Null in guest state or after release. */
	owner(): string | null;
}

export interface LocalDataActivationOptions {
	/** Called when the scope opens. React state publishing attaches here. */
	onOpen(viewerId: string, stores: LocalDataStores): void;
	/**
	 * Driver loader. The default is a dynamic import; tests swap in their own to control ordering.
	 */
	load?: LocalDataDriverLoader;
}

export function createLocalDataActivation({
	onOpen,
	load = defaultLoader,
}: LocalDataActivationOptions): LocalDataActivation {
	/**
	 * Generation of intent. It is bumped once whenever what is being attempted changes, whether
	 * activation or release.
	 *
	 * Comparing member IDs is not enough. A path like Alice, then guest, then Alice returns to the
	 * same value, so a late result from the first Alice would pass as the second Alice's result. The
	 * generation only increases, so that confusion cannot happen.
	 */
	let generation = 0;
	/**
	 * Current or already-finished activation. A second request from the same member joins it directly.
	 */
	let pending: {
		viewerId: string;
		promise: Promise<LocalDataStores | null>;
	} | null = null;
	/** Members abandoned by withdrawal. They are never reopened while this tab lives. */
	const abandoned = new Set<string>();

	return {
		ensure(viewerId) {
			// A deleted account's scope is never reopened, since a late write would resurrect it.
			if (abandoned.has(viewerId)) return Promise.resolve(null);
			if (pending?.viewerId === viewerId) return pending.promise;

			const claimed = ++generation;
			const promise = (async (): Promise<LocalDataStores | null> => {
				try {
					const driver = await load();
					/**
					 * Critical section entry. There must be no `await` between this check and the `open` below. If
					 * there were, another member's activation could open the database in that gap, and this one
					 * would then overwrite it as the previous member's. When the check fails, the point is to
					 * finish without opening, so a late activation never touches another member's connection.
					 */
					if (claimed !== generation) return null;
					const stores = driver.open(viewerId);
					onOpen(viewerId, stores);
					return stores;
				} catch (error) {
					console.error("[local-data] could not open the local store", error);
					/**
					 * Failures are not cached. A cached `null` would make every later request for the same member
					 * fail permanently, turning a transient failure (storage briefly full, another tab holding an
					 * upgrade) into a permanent one for that tab. If the generation has already moved on,
					 * `pending` belongs to the next activation and is left alone.
					 */
					if (claimed === generation) pending = null;
					return null;
				}
			})();

			pending = { viewerId, promise };
			return promise;
		},

		release() {
			const claimed = ++generation;
			pending = null;
			void load().then(
				(driver) => {
					/**
					 * A late release must not close a scope that was just opened. This overlaps in practice when
					 * the same account signs in again right after logout. Without the check, the database just
					 * opened would be closed by the previous logout's release.
					 */
					if (claimed === generation) driver.reset();
				},
				(error) => {
					// Release failed. The reference has already been dropped, so the next activation opens a new
					// connection.
					console.error(
						"[local-data] could not release the local scope",
						error,
					);
				},
			);
		},

		abandon(viewerId) {
			/**
			 * Bumping the generation comes first. An activation in progress must not write anywhere after
			 * this point: a late `onOpen` would republish the scope that was just dropped, and the
			 * generation comparison enforces that.
			 */
			generation++;
			abandoned.add(viewerId);
			// The in-flight promise is not retained, since nothing needs its result.
			if (pending?.viewerId === viewerId) pending = null;
		},

		owner: () => pending?.viewerId ?? null,
	};
}
