import type { ConversationAuthoringMode } from "@rowcat/authoring";
import { resolveConversationAuthoringMode } from "@rowcat/authoring";
import { useDraftRuntimeProject } from "#/lib/local-authoring/hooks.ts";
import { EditorSection } from "./fields.tsx";

/**
 * Wiring that locks the four conversation-material sections when runtime is enabled. All four pass
 * through this one point. The decision is the pure `resolveConversationAuthoringMode`, which mobile
 * also calls.
 *
 * Runtime play never creates a conversation room (`docs/creator-runtime/player.md`), so the four
 * values are never read. Sections must not subscribe on their own: one that fails to pass `loading`
 * stays open for a frame before the project loads, and typing in that frame reaches the runtime
 * work's old value through auto-save. The lock hides this, so nothing shows.
 *
 * The hook takes only the draft id. Passing the draft object would re-render all four sections on
 * every auto-save record.
 *
 * Locked sections never read or write the draft value. Turning runtime off must not change stored
 * values, and runtime publishing carries all four in the snapshot. The lock copy says so, because
 * otherwise creators assume their draft was erased.
 */
export function useConversationAuthoringMode(
	draftId: string,
): ConversationAuthoringMode {
	const runtime = useDraftRuntimeProject(draftId);
	return resolveConversationAuthoringMode({
		loading: runtime.loading,
		project: runtime.project,
	});
}

/**
 * Lock copy. It states why the section is not used, what takes its place, and that the value is
 * kept.
 */
export interface RuntimeLock {
	title: string;
	body: string;
}

/**
 * Block shown in place of editing. It is an `<output>` because the text reports the result of a
 * decision, not an error. It gets no `role="alert"`: the creator switched runtime on, and there is
 * nothing to fix.
 */
export function RuntimeLockNotice({ lock }: { lock: RuntimeLock }) {
	return (
		<output className="flex flex-col gap-1 rounded-md border border-dashed p-4 text-sm">
			<p className="font-medium">{lock.title}</p>
			<p className="text-muted-foreground">{lock.body}</p>
		</output>
	);
}

/**
 * Locked list section. The shell stays, and only the body becomes the notice. The section is not
 * hidden entirely, since that would read as 'this work has no lore'. The add control is not drawn
 * either: adding entries where they will not be used is noise, not a promise. The fixed
 * `layoutDependency` follows from this: this branch has nothing to rearrange.
 */
export function RuntimeLockedSection({
	section,
	lock,
}: {
	section: { title: string; description: string };
	lock: RuntimeLock;
}) {
	return (
		<EditorSection {...section} layoutDependency={false}>
			<RuntimeLockNotice lock={lock} />
		</EditorSection>
	);
}
