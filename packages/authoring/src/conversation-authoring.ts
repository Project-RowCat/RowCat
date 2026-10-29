import { type DraftRuntimeProject, isRuntimeEnabled } from "./runtime.ts";

/**
 * Editability of the conversation-material sections (prompt, lore, opening scene, scene image),
 * derived only from runtime project state. Basic info (title, cover, tags, adult flag) is catalog
 * data and is not governed by this.
 * - Project state unknown: pending. No editing.
 * - No project, or project disabled: editable.
 * - Project enabled: locked. The run model is the runtime, so values are kept but not edited.
 *   Only `enabled` decides. File count, prompt text, scene count, published play mode and the
 *   current URL are deliberately ignored. DraftRuntimeProject keeps those facts separate on
 *   purpose. Locked means blocked, not cleared. Saved values remain and runtime publication
 *   includes them, so turning runtime off restores exactly what was there. The function takes no
 *   draft, so it cannot read or write authoring values. All platforms share it, so none can fold
 *   `pending` into `editable`.
 */
export type ConversationAuthoringMode = "pending" | "editable" | "locked";

export interface ConversationAuthoringInput {
	loading: boolean;
	/** The project the lookup returned, or `null` if none. Not read while `loading` is true. */
	project: DraftRuntimeProject | null;
}

export function resolveConversationAuthoringMode(
	input: ConversationAuthoringInput,
): ConversationAuthoringMode {
	if (input.loading) return "pending";
	return isRuntimeEnabled(input.project) ? "locked" : "editable";
}
