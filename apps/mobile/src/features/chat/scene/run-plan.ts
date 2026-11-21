import type { ChatStore, ScenePlan } from "@rowcat/chat";

/**
 * Executes a scene plan from `@rowcat/chat` (`scene-controls.ts`) through the store's own scene
 * writes: every `set` in order, then every `remove`. The plan decides what to write; this only
 * keeps the order the plan was written in (a correction and the removal of the record it replaces
 * must not land the other way round). Sequential, not `Promise.all`: two upserts at the same start
 * position would otherwise race.
 */
export async function executeScenePlan(
	store: Pick<ChatStore, "setScene" | "deleteScene">,
	plan: ScenePlan,
): Promise<void> {
	for (const input of plan.set) await store.setScene(input);
	for (const id of plan.remove) await store.deleteScene(id);
}
