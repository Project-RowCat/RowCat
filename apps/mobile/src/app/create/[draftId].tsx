import { Redirect, useLocalSearchParams } from "expo-router";
import { DraftEditorScreen } from "../../features/create/draft-editor-screen.tsx";
import { readDraftIdParam } from "../../features/create/draft-id.ts";

/**
 * Draft editor: the address carries identity. No shadow state like `selectedDraftId`; with the
 * route parameter as the source, deep links, back, stack restoration and restarts follow for free.
 * The draft object is not a parameter (direct entry has none, and a copy would not follow
 * autosave); the draft is always re-read from the open local store. Parsing is a pure function
 * (`readDraftIdParam`).
 */
export default function DraftEditorRoute() {
	const { draftId } = useLocalSearchParams<{ draftId?: string | string[] }>();
	const id = readDraftIdParam(draftId);

	/**
	 * An address with no id should not reach this route; if it does it is not a draft. Go back to the
	 * workspace instead of scanning the store with an empty id, since "not found" is only honest after
	 * actually looking.
	 */
	if (!id) return <Redirect href="/create" />;

	/**
	 * Remount per draft id. The editor holds state bound to its draft (cover, autosave queue, upload
	 * lock) and a move between drafts that reused the component would carry it into the new document
	 * (same as web's `remountDeps` on workspace routes).
	 */
	return <DraftEditorScreen key={id} draftId={id} />;
}
