/**
 * Product rules for chat, independent of platform: model, memory, persona, summary,
 * memory-maintenance (+ prompt, runner), reply-suggestion (+ prompt, runner), store (port only:
 * Dexie on web, SQLite on mobile), conversation, guards, context, lore, prompt-trace,
 * protected-seed, protected-generation, debug-trace, debug-view, placeholder, ai-evidence,
 * generation (+ preference, availability, summary, options, reasoning), narration-output,
 * intensity, search, tail-rewrite, message-actions, room-settings-ia, room-actions, room-library,
 * sidebar-rooms.
 *
 * Not here: React and TanStack (each app's UI differs); Dexie, SQLite, and IndexedDB (storage
 * varies by platform, so only the port lives here); fetch, Hono, and
 * @rowcat/sdk (a transport would prevent the same assembler from running on the BYO
 * path, where the device calls providers directly); DOM and Node APIs (Expo has neither). The only
 * dependency is @rowcat/contracts, because a room's replay snapshot is the server's value, and
 * writing its shape twice would drift.
 */
export * from "./ai-evidence.ts";
export * from "./character.ts";
export * from "./composer-emphasis.ts";
export * from "./context.ts";
export * from "./continuation.ts";
export * from "./conversation.ts";
export * from "./debug-trace.ts";
export * from "./debug-view.ts";
export * from "./generation.ts";
export * from "./generation-availability.ts";
export * from "./generation-options.ts";
export * from "./generation-preference.ts";
export * from "./generation-summary.ts";
export * from "./guards.ts";
export * from "./intensity.ts";
export * from "./lore.ts";
export * from "./maintenance-prompt.ts";
export * from "./maintenance-runner.ts";
export * from "./memory.ts";
export * from "./memory-maintenance.ts";
export * from "./message-actions.ts";
export * from "./model.ts";
export * from "./narration.ts";
export * from "./narration-output.ts";
export * from "./opening.ts";
export * from "./persona.ts";
export * from "./placeholder.ts";
export * from "./prompt-trace.ts";
export * from "./protected-generation.ts";
export * from "./protected-seed.ts";
export * from "./reasoning.ts";
export * from "./reply-suggestion.ts";
export * from "./reply-suggestion-prompt.ts";
export * from "./reply-suggestion-runner.ts";
export * from "./room-actions.ts";
export * from "./room-library.ts";
export * from "./room-settings-ia.ts";
export * from "./scene-image.ts";
export * from "./scroll-advance.ts";
export * from "./search.ts";
export * from "./sidebar-rooms.ts";
export * from "./store.ts";
export * from "./summary.ts";
export * from "./sync-codec.ts";
export * from "./tail-rewrite.ts";
export * from "./tool.ts";
export * from "./tool-loop.ts";
export * from "./tool-lore.ts";
export * from "./tool-registry.ts";
export * from "./tracking-block.ts";
export * from "./usage-view.ts";
export * from "./user-note.ts";
