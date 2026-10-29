import type { AuthoringStore, DraftRecoveryStore } from "@rowcat/authoring";
import type { ChatStore, GenerationPreferenceStore } from "@rowcat/chat";
import type {
	RuntimeConversationStore,
	RuntimeSaveStore,
} from "@rowcat/runtime-persistence";
import type { DeviceKeyStore, SyncStore } from "@rowcat/sync";
import {
	createProviderConnectionStore,
	createProviderCredentialAccess,
	type ProviderConnectionStore,
	type ProviderCredentialAccess,
} from "../local-provider/store.ts";
import {
	createMobileDeviceKeyStore,
	type SecureKeyStorage,
} from "../local-sync/device-key.ts";
import { syncCodecRegistry } from "../local-sync/registry.ts";
import { createAuthoringStore } from "./authoring-store.ts";
import {
	type AutoSyncPreferenceStore,
	createAutoSyncPreferenceStore,
} from "./auto-sync-preference.ts";
import { createChatStore } from "./chat-store.ts";
import { viewerDraftCoverDirName } from "./database.ts";
import {
	createMobileDraftCoverStore,
	type DraftCoverFiles,
	type DraftCoverStore,
} from "./draft-cover-store.ts";
import { createGenerationPreferenceStore } from "./generation-store.ts";
import {
	createLocalMutationSignal,
	type LocalMutationSignal,
	withMutationSignal,
} from "./mutation-signal.ts";
import { createMobileDraftRecoveryStore } from "./recovery-store.ts";
import { createSqliteRuntimeConversationStore } from "./runtime-conversation-store.ts";
import { createSqliteRuntimeSaveStore } from "./runtime-save-store.ts";
import type { MobileDatabase } from "./sqlite.ts";
import { createSqliteSyncStore } from "./sync-store.ts";

/**
 * One open connection → one set of ports. **Assembly happens here, in one place.**
 *
 * Split out of the scope (`scope.tsx`) for testing. If each test called `createChatStore(db)`
 * directly, the result would not be the store the product actually uses: the product side wraps the
 * write signal and the test side does not, so a test meant to verify that local changes wake
 * automatic sync would verify nothing.
 *
 * The fact that there is **one connection** is in this function's signature. All three stores
 * receive the same `db`, so `applyPull` can put chat, authoring, and the cursor in one transaction.
 * Opening a connection per store would lose that atomicity, and the loss would not appear in the
 * types.
 */
export interface MobileLocalStores {
	chat: ChatStore;
	authoring: AuthoringStore;
	/**
	 * This device's and this member's generation preferences. **Not synced.**
	 *
	 * They sit in this bundle but are the opposite of the two above. Those attach a revision and a
	 * tombstone to every record and go out in the outbound batch; this value has no such axis in any
	 * column (`generation-store.ts`).
	 */
	generation: GenerationPreferenceStore;
	/**
	 * The cover a draft holds on this device before publication. **Not synced**
	 * (`draft-cover-store.ts`).
	 *
	 * This port is separate from `AuthoringStore` for exactly that reason. The authoring store is a
	 * shared contract that the web and this app both fill, and all its values are synced records. This
	 * value is a temporary holding area that the device keeps only until publication.
	 */
	draftCover: DraftCoverStore;
	/**
	 * This device's and this member's **provider connection summary** (BYO API keys), the window the
	 * screen sees.
	 *
	 * Opposite in character to the two above, and different from generation preferences. Chats and
	 * drafts sync; generation preferences do not sync but live in SQLite; and this value is **not in
	 * SQLite either**. The secrets live only in the OS secure store, and what arrives here is a thin
	 * port in front of it (`local-provider/store.ts`).
	 *
	 * The screen receives only this. The port that opens the secrets is below, under **a different
	 * name**.
	 */
	providers: ProviderConnectionStore;
	/**
	 * **Runtime only.** The port that opens credentials when generation starts.
	 *
	 * Keeping it apart from the one above is this slice's security boundary. Merged, a settings
	 * component would hold a function that reads secrets, and that function could be called from
	 * anywhere in the render tree. The only place that uses this port is the generation transport, and
	 * a static scan locks that list.
	 */
	providerCredentials: ProviderCredentialAccess;
	/**
	 * The creator runtime's **player saves**. Opposite in character to the preferences and connections
	 * above: this one **syncs.**
	 *
	 * The port exists even though this app has no playback screen yet, for the same reason as the
	 * authoring runtime tables: completeness of the copy comes first. Without it, progress made on the
	 * web would never reach this device, and worse, this device's next push would upload it as an
	 * erased state.
	 */
	runtimeSave: RuntimeSaveStore;
	/**
	 * The **library row** of a runtime playthrough. Same connection as `runtimeSave`, **different
	 * port.**
	 *
	 * The port differs because of ownership. The save port lives inside the playback lifecycle's
	 * serialized procedure, and writing a library row must not become a participant in that procedure
	 * (header of `conversation.ts` in `@rowcat/runtime-persistence`).
	 */
	runtimeConversation: RuntimeConversationStore;
	sync: SyncStore;
	/**
	 * A local copy of the version the merge discarded. **A port that must share a connection with
	 * `sync`.**
	 *
	 * Like the values above, it is not synced, but it has one more reason. Those only need the same
	 * lifetime, while this copy must **commit in the same transaction as the merge result**. If the
	 * two were split, the state "the canonical value was overwritten and the losing copy does not
	 * exist" would become representable, and that loss is exactly what this feature exists to prevent.
	 */
	draftRecovery: DraftRecoveryStore;
	deviceKey: DeviceKeyStore;
	/**
	 * The automatic-sync device preference. **Wrapped in no signal.**
	 *
	 * Wrapping it in `mutations` would make one toggle wake a sync run with nothing to upload (a
	 * non-synced value triggering sync). Wrapping it in `preferences` would re-render the generation
	 * settings screen for no reason. The subscription to this value belongs to the automatic-sync
	 * adapter's snapshot (`local-sync/auto-sync.ts`).
	 */
	autoSyncPreference: AutoSyncPreferenceStore;
	mutations: LocalMutationSignal;
	/**
	 * A **separate** signal for "the generation preference changed."
	 *
	 * Keeping it apart from `mutations` is the most important line in this slice. That signal is the
	 * axis that wakes automatic sync (`local-sync/auto-sync.ts` listens to it). Putting preferences on
	 * it would make changing the response length wake a sync run with **nothing to upload**: a
	 * non-synced value triggering sync, so that request always goes out empty.
	 *
	 * Still, the signal cannot be left out entirely. The settings screen has to **subscribe** to this
	 * value (the web gets that for free from Dexie's `liveQuery`), and without a signal the value just
	 * picked would not appear on screen.
	 */
	preferences: LocalMutationSignal;
	/**
	 * A **third** signal, for "a provider connection changed."
	 *
	 * It cannot go on `mutations` for the same reason as generation preferences: that signal wakes
	 * automatic sync, and connections do not sync, so such requests always go out empty. It cannot go
	 * on `preferences` for a different reason: that value is what this device **wants**, while this
	 * one is what it **can do**. Folding them together would make connecting a key re-render the
	 * entire generation preferences screen.
	 *
	 * Above all, **no content rides on this signal** (`notify()` takes no arguments). Only the fact
	 * that a connection changed passes through, not which provider.
	 */
	providerConnections: LocalMutationSignal;
	/**
	 * A **fourth** signal, for "a recovery copy changed."
	 *
	 * It cannot go on `mutations` for the same reason as preferences and connections: that signal
	 * wakes automatic sync, and copies do not sync, so the request would always go out empty.
	 * Dismissing the notice would create a round trip with nothing to upload. It cannot go on
	 * `preferences` either: that value is what this device wants, while this one is **what it has
	 * lost**. Folding them together would make discarding one copy re-render the entire generation
	 * settings screen.
	 *
	 * **Restoring does not end on this signal.** That path actually edits the draft, so it also emits
	 * `mutations` through the wrapped authoring store. The restored value is one that must be
	 * uploaded.
	 */
	recoveries: LocalMutationSignal;
	/**
	 * A **fifth** signal, for "the pre-publication cover changed."
	 *
	 * It cannot go on `mutations` for the same reason as the three above: that signal wakes automatic
	 * sync, and this value has no sync axis in any column, so such requests always go out empty. It is
	 * also kept apart from the other three because this value belongs to **one draft**: picking a
	 * cover would have no reason to re-render generation settings or the connection list.
	 *
	 * The place that needs this signal is concrete. The editor's **cover field and preview** read the
	 * same value. Without the signal, after a cover is picked the field would draw the new image while
	 * the preview right below still draws the old one, and both would sit side by side on one screen.
	 */
	draftCovers: LocalMutationSignal;
}

export function createMobileLocalDataStores(
	db: MobileDatabase,
	viewerId: string,
	secureStorage: SecureKeyStorage,
	/**
	 * The four operations that touch the cover file location. **Injected**, with the same shape and
	 * the same reason as the SQLite driver and the Keychain: if this file imported `expo-file-system`
	 * directly, that native module would enter the test graph, and that configuration has no polyfills
	 * (`vitest.config.ts`).
	 */
	draftCoverFiles: DraftCoverFiles,
): MobileLocalStores {
	const mutations = createLocalMutationSignal();
	/**
	 * Preference-only signal. The fact that this instance differs is the entire "does not wake sync"
	 * guarantee for this value, and `stores.test.ts` checks it by value.
	 */
	const preferences = createLocalMutationSignal();
	/** Connection-only signal. Like the two above, a different instance is the whole "does not wake sync" guarantee. */
	const providerConnections = createLocalMutationSignal();
	/** Recovery-copy-only signal. A different instance is the single fact that makes it not wake sync. */
	const recoveries = createLocalMutationSignal();
	const draftCovers = createLocalMutationSignal();
	/**
	 * Build the key store **first.** The player save adapter needs to answer "is this device waiting
	 * on sync to receive something?", and that value lives in SecureStore, not SQLite. The assembly
	 * point is the only place that connects the two.
	 */
	const deviceKey = createMobileDeviceKeyStore(secureStorage, viewerId);
	return {
		/**
		 * The write signal is attached **at the assembly point.** If each store implementation signaled
		 * directly, the product store would know about sync, and every new write method would then need
		 * that one line remembered. A method whose change was not remembered would stay on this device
		 * alone, silently.
		 */
		chat: withMutationSignal(createChatStore(db), CHAT_READS, mutations),
		authoring: withMutationSignal(
			createAuthoringStore(db),
			AUTHORING_READS,
			mutations,
		),
		/**
		 * Preferences are wrapped in **their own signal.** Without wrapping, the settings screen would
		 * not learn of a change; wrapped in `mutations`, sync would run needlessly. This is the spot
		 * between those two.
		 */
		generation: withMutationSignal(
			createGenerationPreferenceStore(db),
			GENERATION_READS,
			preferences,
		),
		/**
		 * The connection summary is also wrapped in **its own signal.** Without it, the model picker
		 * would not see a key connected on the settings screen; wrapped in a different signal, it would
		 * add either a pointless sync run or an unnecessary re-render.
		 */
		providers: withMutationSignal(
			createProviderConnectionStore(secureStorage, viewerId),
			PROVIDER_READS,
			providerConnections,
		),
		/**
		 * The credential accessor is **not wrapped.** Opening a secret is a read, not a state change;
		 * signaling it would make one generation re-run the whole screen subscription.
		 */
		providerCredentials: createProviderCredentialAccess(
			secureStorage,
			viewerId,
		),
		/**
		 * Player saves are **wrapped in `mutations`.** When progress changes there really is something to
		 * upload. This is where they differ from the preferences and connections above: without wrapping,
		 * that progress would stay on this device until some later lifecycle signal.
		 */
		runtimeSave: withMutationSignal(
			createSqliteRuntimeSaveStore(db, async () => {
				return (await deviceKey.recall()) !== null;
			}),
			RUNTIME_SAVE_READS,
			mutations,
		),
		/**
		 * Library rows are also **wrapped in `mutations`.** They are sync records, so opening and
		 * removing one creates something to upload, and the drawer and `/chats` subscriptions listen to
		 * the same signal.
		 */
		runtimeConversation: withMutationSignal(
			createSqliteRuntimeConversationStore(db),
			RUNTIME_CONVERSATION_READS,
			mutations,
		),
		/**
		 * The sync store is **not wrapped.** What `applyPull` writes is records received from the server,
		 * not a user action. Counting them as local changes would make pull → signal → pull loop forever.
		 * This one line is the whole guard against that feedback, and it has a regression test
		 * (`stores.test.ts`).
		 *
		 * The cover file location is also passed to the sync store, because that transaction cleans up
		 * the cover of a draft deleted remotely. The name derivation (`viewerDraftCoverDirName`) must be
		 * **the same call** the cover store uses: if they diverge, one side looks at another member's
		 * location.
		 */
		sync: createSqliteSyncStore(db, syncCodecRegistry, {
			dirName: viewerDraftCoverDirName(viewerId),
			files: draftCoverFiles,
		}),
		/**
		 * The recovery copy is wrapped in **its own signal.** Without wrapping, the editor's notice would
		 * remain even after the copy was discarded. Wrapped in `mutations`, that deletion would wake a
		 * sync run with nothing to upload.
		 */
		draftRecovery: withMutationSignal(
			createMobileDraftRecoveryStore(db),
			RECOVERY_READS,
			recoveries,
		),
		/**
		 * The pre-publication cover is also wrapped in **its own signal.** Without it, editing the cover
		 * would leave the editor's preview unaware (two places on one screen would draw different
		 * images); wrapped in `mutations`, it would wake a sync run with nothing to upload, since this
		 * value has no sync axis in any column.
		 */
		draftCover: withMutationSignal(
			createMobileDraftCoverStore(
				db,
				viewerDraftCoverDirName(viewerId),
				draftCoverFiles,
			),
			DRAFT_COVER_READS,
			draftCovers,
		),
		autoSyncPreference: createAutoSyncPreferenceStore(db),
		/**
		 * The device key is not wrapped either. Remembering and forgetting trust is not an event that
		 * creates something to upload. Wrapping it would make one unlock wake a sync run with nothing to
		 * send.
		 */
		deviceKey,
		mutations,
		preferences,
		providerConnections,
		recoveries,
		draftCovers,
	};
}

/**
 * Read-only methods. **Everything else is treated as a write.**
 *
 * The list is oriented this way for the reason given in the `mutation-signal.ts` header. The cost
 * of a missed query is not small, though: the moment a screen subscribes to it, read → signal →
 * read loops forever. So `stores.test.ts` checks the real keys of each store for any query-named
 * method against this list.
 */
const CHAT_READS: ReadonlySet<keyof ChatStore & string> = new Set([
	"getRoom",
	"listRooms",
	"listRecentMessages",
	"listAllMessages",
	"listMemories",
	/**
	 * **This line was missing.** The chat room subscribes to characters, so that query emitted a
	 * signal that woke itself, and even with the room open and idle the JS thread kept re-reading
	 * rooms and messages nonstop (about 94% idle CPU in the simulator). It is the same loop that
	 * `listSceneImages` in `AUTHORING_READS` below suffered.
	 */
	"listCharacters",
	"getSummary",
	"listPersonas",
	"getPersona",
]);

/**
 * The preference store's query methods. The other four (`setGlobal`, `setRoom`, `clearRoom`,
 * `setRuntime`) emit signals. Of those, `clearRoom` is the one that matters: deleting a room also
 * removes that room's overrides, and if the settings screen is open it must learn of that.
 */
const GENERATION_READS: ReadonlySet<keyof GenerationPreferenceStore & string> =
	new Set(["getGlobal", "getRoom", "getRuntime"]);

/**
 * The connection store's query methods. The other two (`connect`, `disconnect`) emit signals.
 *
 * The direction matches the other lists: an unknown method counts as a write. The cost of that
 * misjudgment is especially small here because this signal does not wake sync (miscounting would
 * only cost the screen one extra read).
 */
const PROVIDER_READS: ReadonlySet<keyof ProviderConnectionStore & string> =
	new Set(["list", "get", "has"]);

/**
 * Only one read — the other two (`stage` and `clear`) move a file and a row together, so they are
 * writes.
 */
const DRAFT_COVER_READS: ReadonlySet<keyof DraftCoverStore & string> = new Set([
	"get",
]);

/**
 * The recovery store's query methods. The only write left, `discard`, emits the signal.
 *
 * That this port has only one write is itself the contract: the place that **creates** a copy is
 * the single transaction that commits the merge, and that write does not go through this port.
 */
const RECOVERY_READS: ReadonlySet<keyof DraftRecoveryStore & string> = new Set([
	"list",
	"listForDraft",
]);

const AUTHORING_READS: ReadonlySet<keyof AuthoringStore & string> = new Set([
	"listDrafts",
	"getDraft",
	"listLore",
	"listStartScenes",
	/**
	 * **This line was missing.** The list direction had been set to the safe side (an unknown method
	 * counts as a write), so it compiled and passed tests. No code read scene images yet, so no
	 * symptom appeared. The moment the editor subscribed to it, that query emitted a **signal that
	 * woke itself**: read → signal → read, forever, with automatic sync waking along with each loop.
	 */
	"listSceneImages",
	/**
	 * Queries for runtime projects and files. Added when the editor's prompt section began subscribing
	 * to the project. Leaving them out would make those queries emit a **signal that wakes
	 * themselves** (the same endless loop that scene images actually suffered above).
	 */
	"getRuntimeProject",
	"listRuntimeFiles",
	/** Managed-image queries belong to the same class: leave one out and the loop starts the moment its list is subscribed. */
	"listRuntimeAssets",
	"loadPublicationSource",
]);

/**
 * Reads of the save port. The other two (`putPlaythrough`, `putPersistent`) are writes.
 *
 * It matters that `initialSyncDone` is here. That method only **reads** the state row; leaving it
 * out would make a sync run with nothing to upload happen every time a session starts.
 */
const RUNTIME_SAVE_READS: ReadonlySet<keyof RuntimeSaveStore & string> =
	new Set(["getPlaythrough", "getPersistent", "initialSyncDone"]);

/** Reads of the library port. The other two (`touch`, `remove`) are writes. */
const RUNTIME_CONVERSATION_READS: ReadonlySet<
	keyof RuntimeConversationStore & string
> = new Set(["get", "list"]);

/**
 * The read list for each wrapped store. `stores.test.ts` compares it against the store's **actual
 * keys**.
 *
 * The keys match the names `createMobileLocalDataStores` returns. This table is used only by a
 * test, but it lives here because the list needs one source: if the test kept its own copy, the
 * check would pass by editing that copy.
 */
export const STORE_READS = {
	chat: CHAT_READS,
	authoring: AUTHORING_READS,
	generation: GENERATION_READS,
	providers: PROVIDER_READS,
	runtimeSave: RUNTIME_SAVE_READS,
	runtimeConversation: RUNTIME_CONVERSATION_READS,
	draftRecovery: RECOVERY_READS,
	draftCover: DRAFT_COVER_READS,
} as const;
