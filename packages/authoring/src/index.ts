/**
 * @rowcat/authoring: product rules for creating works, with nothing platform-specific.
 * Contains the autosave queue, draft model, legacy folding, store port, validation, publication,
 * playtest, recovery, runtime project records and start templates. Not here: React and TanStack.
 * Editor screens differ between web and mobile. Not here: Dexie, SQLite or IndexedDB. Only the
 * store port is defined in this package. Not here: fetch, Hono or @rowcat/sdk. The app decides when
 * to send, since nothing is sent during an account switch. Not here: DOM or Node APIs (Expo has
 * neither), or work id creation (the server assigns it on first publish). Not here: @rowcat/chat.
 * Shared vocabulary such as the lore injection position comes from
 * @rowcat/contracts.
 * Depends only on @rowcat/contracts and @rowcat/domain.
 */
export * from "./autosave-queue.ts";
export * from "./conversation-authoring.ts";
export * from "./legacy.ts";
export * from "./model.ts";
export * from "./playtest.ts";
export * from "./publication.ts";
export * from "./recovery.ts";
export * from "./runtime.ts";
export * from "./runtime-templates/index.ts";
export * from "./store.ts";
export * from "./sync-codec.ts";
export * from "./validation.ts";
