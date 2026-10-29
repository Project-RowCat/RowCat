import type { AuthoringStore } from "@rowcat/authoring";
import type { ChatStore } from "@rowcat/chat";
import type {
	RuntimeConversationStore,
	RuntimeSaveStore,
} from "@rowcat/runtime-persistence";
import { createDraftCoverStore } from "#/lib/local-authoring/draft-cover.ts";
import { createAuthoringStore } from "#/lib/local-authoring/store.ts";
import { createChatStore } from "#/lib/local-chat/store.ts";
import { createGenerationPreferenceStore } from "#/lib/local-generation/store.ts";
import {
	createProviderConnectionStore,
	createProviderCredentialAccess,
} from "#/lib/local-provider/store.ts";
import { createDraftRecoveryStore } from "#/lib/local-recovery/store.ts";
import { createDexieRuntimeConversationStore } from "#/lib/local-runtime-save/conversation-store.ts";
import { createDexieRuntimeSaveStore } from "#/lib/local-runtime-save/store.ts";
import { createDeviceKeyStore } from "#/lib/local-sync/device-key.ts";
import { createAutoSyncPreferenceStore } from "#/lib/local-sync/preference.ts";
import { syncCodecRegistry } from "#/lib/local-sync/registry.ts";
import { createDexieSyncStore } from "#/lib/local-sync/store.ts";
import type { LocalDataStores } from "./activation.ts";
import type { LocalDb } from "./db.ts";
import {
	createLocalMutationSignal,
	withMutationSignal,
} from "./mutation-signal.ts";

/**
 * One open database produces one set of ports, and the assembly lives here rather than in
 * activation.ts. The split exists for tests. If the device harnesses and store tests called
 * createChatStore(db) directly, they would not get the product's store, which is wrapped with
 * mutation signals. A test of 'local changes wake auto-sync' would then verify nothing. This file
 * imports Dexie statically, so it must stay out of the server render graph. activation.ts loads it
 * dynamically.
 */
/**
 * The member id is passed in because it is part of the AAD for provider credentials. It is not
 * derived from the database name. That name is a normalized form of the member code (scopedDbName
 * in db.ts) with no inverse. If the normalization rule ever changed, already-stored ciphertext
 * would stop opening. The AAD must contain the original member id.
 */
export function createLocalDataStores(
	db: LocalDb,
	viewerId: string,
): LocalDataStores {
	const mutations = createLocalMutationSignal();
	return {
		/**
		 * The write signal is attached at the assembly point. If the store implementation signaled
		 * directly, the product store would know about sync. Each new write method would then need its
		 * own signal line, and a method that forgot it would leave its change on this device only.
		 */
		chat: withMutationSignal(createChatStore(db), CHAT_READS, mutations),
		authoring: withMutationSignal(
			createAuthoringStore(db),
			AUTHORING_READS,
			mutations,
		),
		/**
		 * The sync store is not wrapped. applyPull writes records received from the server, not user
		 * actions. Counting them as local changes would create an endless pull, signal, pull loop.
		 * Leaving this store unwrapped is what prevents that feedback.
		 */
		sync: createDexieSyncStore(db, syncCodecRegistry),
		/**
		 * The draft recovery store is not wrapped. Discarding a copy deletes an unsynced local value,
		 * which is not a 'something to upload' signal. Wrapping it would let dismissing the notice wake a
		 * sync with nothing to upload. Restore is the opposite: it edits the draft, so it goes through
		 * the wrapped authoring store and signals as usual.
		 */
		draftRecovery: createDraftRecoveryStore(db),
		deviceKey: createDeviceKeyStore(db),
		generation: createGenerationPreferenceStore(db),
		/**
		 * The draft cover store is not wrapped. This table does not sync, so picking a cover is not a
		 * 'something to upload' signal. Wrapping it would let a single file selection wake a sync round
		 * trip with nothing to upload. The provider connection store has the same reason.
		 */
		draftCover: createDraftCoverStore(db),
		/**
		 * The provider connection store is not wrapped. Credentials do not sync, so changing them is not
		 * an upload signal. Wrapping it would let pasting a key wake a sync round trip with nothing to
		 * upload.
		 */
		provider: createProviderConnectionStore(db, viewerId),
		/**
		 * Runtime-only accessor. It is a different port from the connection store above, for the reason
		 * given in the header of local-provider/store.ts. It keeps the decryption function out of the
		 * hands of screens.
		 */
		providerCredentials: createProviderCredentialAccess(db, viewerId),
		/**
		 * Player saves are wrapped, because progress changes do create something to upload. This differs
		 * from generation, draftCover and provider above. Those are device-only values, so a signal would
		 * fire for nothing. These are sync records. Without a signal, progress would stay on this device
		 * until the next lifecycle signal.
		 */
		runtimeSave: withMutationSignal(
			createDexieRuntimeSaveStore(db),
			RUNTIME_SAVE_READS,
			mutations,
		),
		/**
		 * Library rows are wrapped as well. They are sync records, so opening and removing one creates
		 * something to upload. The screen's subscription is handled by liveQuery. This signal exists only
		 * for auto-sync.
		 */
		runtimeConversation: withMutationSignal(
			createDexieRuntimeConversationStore(db),
			RUNTIME_CONVERSATION_READS,
			mutations,
		),
		autoSyncPreference: createAutoSyncPreferenceStore(db),
		mutations,
	};
}

/**
 * Read-only methods. Everything else is treated as a mutation, and the reason for that direction is
 * in the header of mutation-signal.ts. A missed query still matters. Screens here subscribe through
 * liveQuery and do not make round trips, but each run of an omitted query wakes auto-sync with
 * nothing to upload. stores.test.ts therefore checks that query-named methods appear in this list,
 * using the store's real keys.
 */
const CHAT_READS: ReadonlySet<keyof ChatStore & string> = new Set([
	"getRoom",
	"listRooms",
	"listRecentMessages",
	"listAllMessages",
	"listMemories",
	/** This entry was missing. Each time a chat room subscribed to its characters, sync woke once. */
	"listCharacters",
	"getSummary",
	"listPersonas",
	"getPersona",
]);

const AUTHORING_READS: ReadonlySet<keyof AuthoringStore & string> = new Set([
	"listDrafts",
	"getDraft",
	"listLore",
	"listStartScenes",
	"listSceneImages",
	/**
	 * Runtime project and file queries. While they were missing, every read by the editor woke a sync
	 * with nothing to upload. The debounce absorbed most of it, so there were no visible symptoms.
	 * They were added when the prompt section began subscribing to these queries.
	 */
	"getRuntimeProject",
	"listRuntimeFiles",
	/**
	 * Managed image queries belong to the same class. The studio's asset list subscribes to them. If
	 * they were missing, the query would emit a signal that wakes itself, a read, signal, read loop.
	 */
	"listRuntimeAssets",
	"loadPublicationSource",
]);

/**
 * Read methods of the save port. The other two (putPlaythrough, putPersistent) are writes.
 * initialSyncDone matters here. It only reads the state row, but if it were missing, a sync with
 * nothing to upload would run once every time a session starts.
 */
const RUNTIME_SAVE_READS: ReadonlySet<keyof RuntimeSaveStore & string> =
	new Set(["getPlaythrough", "getPersistent", "initialSyncDone"]);

/** Read methods of the library port. The other two (touch, remove) are writes. */
const RUNTIME_CONVERSATION_READS: ReadonlySet<
	keyof RuntimeConversationStore & string
> = new Set(["get", "list"]);

/**
 * Read lists per wrapped store. They are used only by tests, but they live here because the list
 * needs a single source. If tests kept a copy, editing the copy would make the check pass.
 */
export const STORE_READS = {
	chat: CHAT_READS,
	authoring: AUTHORING_READS,
	runtimeSave: RUNTIME_SAVE_READS,
	runtimeConversation: RUNTIME_CONVERSATION_READS,
} as const;
