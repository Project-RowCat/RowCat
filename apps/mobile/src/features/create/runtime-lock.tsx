import type { ConversationAuthoringMode } from "@rowcat/authoring";
import { resolveConversationAuthoringMode } from "@rowcat/authoring";
import { space } from "@rowcat/design";
import { Panel, Spinner, Text } from "@rowcat/ui-native";
import { StyleSheet, View } from "react-native";
import { useDraftRuntimeProject } from "../../lib/local-data/use-drafts.ts";
import { RUNTIME_PENDING_LABEL } from "./editor-copy.ts";
import { EditorSection } from "./editor-section.tsx";

/**
 * Locks the four conversation-material sections (prompt, lore, start scenes, scene images) on a
 * draft whose runtime is on. All four are read only when playback stands up a room, and runtime
 * playback creates none (`docs/creator-runtime/player.md`). The decision is
 * `resolveConversationAuthoringMode`, shared with web
 * (`apps/web/src/features/create/runtime-lock.tsx`).
 *
 * Needed even though this app has no runtime authoring screen: the project record arrives by sync.
 * Wiring subscription and decision per section risks one of them not passing `loading`; it would be
 * open for one frame before the project is read, and typing in that frame goes through autosave
 * with no visible symptom.
 *
 * Locking never reads or writes the draft. Turning the runtime off on web syncs back and the
 * sections reopen with their stored values, which is why the lock copy's last line says so.
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

/** Lock copy: why the section is unused, what replaces it, and that the value is kept. */
export interface RuntimeLock {
	title: string;
	body: string;
}

/** Runtime state not known yet; the section stays closed meanwhile. */
export function RuntimeLockPending() {
	return (
		<View
			style={lock.pending}
			accessibilityLabel={RUNTIME_PENDING_LABEL}
			accessibilityRole="progressbar"
		>
			<Spinner />
		</View>
	);
}

export function RuntimeLockNotice({ lock: copy }: { lock: RuntimeLock }) {
	return (
		<Panel style={lock.notice}>
			<Text variant="body" weight="medium">
				{copy.title}
			</Text>
			<Text variant="body" tone="muted-foreground">
				{copy.body}
			</Text>
		</Panel>
	);
}

/**
 * A locked (or not yet known) list section: the shell stays and only the body changes.
 *
 * `summary` is deliberately not passed; with one the section would render closed
 * (`editor-section.tsx`) and only people who open it would read the lock notice, which says why
 * editing is impossible. No `action` either: adding items to a section that will not be carried is
 * noise.
 */
export function RuntimeLockedSection({
	mode,
	title,
	description,
	lock: copy,
}: {
	mode: Exclude<ConversationAuthoringMode, "editable">;
	title: string;
	description: string;
	lock: RuntimeLock;
}) {
	return (
		<EditorSection title={title} description={description}>
			{mode === "pending" ? (
				<RuntimeLockPending />
			) : (
				<RuntimeLockNotice lock={copy} />
			)}
		</EditorSection>
	);
}

const lock = StyleSheet.create({
	notice: { gap: space.xs },
	pending: { alignItems: "center", paddingVertical: space.lg },
});
