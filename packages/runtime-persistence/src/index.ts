/**
 * @rowcat/runtime-persistence: the product domain of player saves.
 * Layers: runtime (creator's language), runtime-host (VM and host-neutral snapshots), this package
 * (where snapshots become records that go out through sync), and the apps (Dexie and SQLite
 * adapters, screens).
 *
 * It depends on none of React, React Native, DOM, Dexie, SQLite, fetch, the RowCat SDK, the query
 * layer or generation. From runtime-host it imports only the two snapshot subpaths
 * (story-state and persistent-state). The root would pull the QuickJS engine and the generated
 * sandbox string into the web and mobile storage layers. The renderer package follows the same rule
 * for its patches subpath, and boundaries.test.ts enforces it.
 *
 * It calls no server. No plaintext REST path for save records exists in this repository.
 * Encryption, transport and cursors belong to the existing @rowcat/sync; this domain hands it a
 * codec (option B).
 */

export {
	isVisibleRuntimeConversation,
	nextRuntimeConversation,
	RUNTIME_CONVERSATION_ID_PREFIX,
	RUNTIME_CONVERSATION_SYNC_SCHEMA_VERSION,
	RUNTIME_CONVERSATION_SYNC_TYPE,
	type RuntimeConversationRecord,
	type RuntimeConversationRemoval,
	type RuntimeConversationStore,
	type RuntimeConversationTouch,
	runtimeConversationIdFor,
	runtimeConversationPresenceAllowed,
	runtimeConversationSyncCodec,
	runtimePlayStartDue,
	runtimePlayStartSessionKey,
} from "./conversation.ts";
export {
	type RuntimeSaveClock,
	RuntimeSaveCoordinator,
	type RuntimeSaveCoordinatorOptions,
	type RuntimeSaveMetrics,
	type RuntimeSaveScopeState,
	type RuntimeSaveState,
	type RuntimeSaveStatus,
	runtimeSaveDurabilityAtRisk,
} from "./coordinator.ts";
export {
	createRuntimePlayerLifecycle,
	type RuntimePlayerLifecycle,
	type RuntimePlayerLifecycleEvent,
	type RuntimePlayerLifecycleOptions,
	type RuntimePlayerScope,
	type RuntimePlayerSessionOwner,
	type RuntimePlayerSessionStart,
} from "./lifecycle.ts";
export {
	DEFAULT_RUNTIME_SAVE_SLOT,
	isRuntimeSaveSlot,
	RUNTIME_PERSISTENT_ID_PREFIX,
	RUNTIME_PLAYTHROUGH_ID_PREFIX,
	RUNTIME_SAVE_SLOTS,
	type RuntimePersistentRecord,
	type RuntimePlaythroughRecord,
	type RuntimeSaveSlot,
	type RuntimeSaveSyncMeta,
	runtimePersistentIdFor,
	runtimePlaythroughIdFor,
} from "./model.ts";
export {
	createRuntimePlayerPersistence,
	RUNTIME_PERSISTENCE_ERROR_CODE,
	type RuntimePersistenceError,
	type RuntimePersistenceErrorCode,
	type RuntimePlayerPersistence,
	type RuntimePlayerPersistenceOptions,
	type RuntimeSaveResolution,
} from "./player.ts";
export type {
	RuntimePersistentWrite,
	RuntimePlaythroughWrite,
	RuntimeSaveStore,
	RuntimeSaveWrite,
} from "./store.ts";
export {
	RUNTIME_PERSISTENCE_SYNC_SCHEMA_VERSION,
	RUNTIME_PERSISTENCE_SYNC_TYPE,
	runtimePersistenceSyncCodecs,
	runtimePersistentSyncCodec,
	runtimePlaythroughSyncCodec,
} from "./sync-codec.ts";
