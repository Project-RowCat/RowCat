import { Redirect, useLocalSearchParams } from "expo-router";
import { readDraftIdParam } from "../../../features/create/draft-id.ts";
import { PlaytestScreen } from "../../../features/playtest/playtest-screen.tsx";

/**
 * Story test: a screen of the `Create` section, not a conversation destination. It must be addressable
 * because the editor's `Story test` pushes here with `replace` (unmounting the editor), back returns to
 * the same draft's editor, and a hand-typed address must open it.
 *
 * The snapshot is not a parameter: direct entry has none, and it would put unpublished manuscript
 * in the address; the draft is re-read from the local store (`use-playtest-bootstrap.ts`). Parsing
 * uses the editor's same pure function (`readDraftIdParam`); a second rule here would be unchecked
 * because this app's tests do not render.
 */
export default function PlaytestRoute() {
	const { draftId } = useLocalSearchParams<{ draftId?: string | string[] }>();
	const id = readDraftIdParam(draftId);

	/**
	 * An address with no id should not reach this route; if it does it is not a draft. Go back to the
	 * workspace instead of scanning the store with an empty id, since the "no such draft" message is
	 * only honest after actually looking.
	 */
	if (!id) return <Redirect href="/create" />;

	return <PlaytestScreen draftId={id} />;
}
