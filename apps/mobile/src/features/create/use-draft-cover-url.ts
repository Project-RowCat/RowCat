import type { StoryDraft } from "@rowcat/authoring";
import { storyQueryOptions } from "@rowcat/query";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getRowCatClient } from "../../lib/api.ts";
import { useLocalLiveOn } from "../../lib/local-data/live.ts";
import { useDraftCoverScope } from "../../lib/local-data/scope.tsx";

/**
 * What this draft's cover **currently shows**, answered in one place.
 *
 * Two spots must agree on that answer, so it is split into a hook: the cover slot (where it is
 * picked) and the discovery card preview (where it is seen). If each judged separately, one could
 * show a file awaiting publication while the other shows the server's old cover, and the preview
 * would contradict the screen directly above it. The web's `use-draft-cover-url.ts` is the same
 * spot with the same rule.
 *
 * ```text
 * a file picked on the device  →  draw it (this is the image that uploads on publication)
 * none                          →  the server's current cover (only for already-published drafts)
 * ```
 *
 * The URL is not built here. The server cover URL rule belongs to the server (origin, path, content
 * hash), and the device file URL rule belongs to the file boundary (`draftCoverUri`: the stored
 * value is a name and the URL is built on each read). A copy in this file would go stale when a
 * deploy or reinstall changes the rule.
 *
 * Unpublished drafts do **not query the server at all**; there is no work to ask about.
 */
export interface DraftCoverUrl {
	/** URL to draw. If absent, the caller draws a placeholder. */
	url: string | null;
	/** Whether a cover is picked on the device and not yet uploaded; the basis for telling the user so. */
	staged: boolean;
	/** The device storage's first result has not arrived yet. **Different from "no cover".** */
	loading: boolean;
}

export function useDraftCoverUrl(draft: StoryDraft): DraftCoverUrl {
	const { store, signal, loading: opening } = useDraftCoverScope();
	const published = draft.publishedStoryId;

	/**
	 * **Memoize the read.** A new function each render makes the subscription re-read every render,
	 * and the result changes state, which renders again (`live.ts` documents that rule).
	 */
	const load = useMemo(
		() => (store ? () => store.get(draft.id) : null),
		[store, draft.id],
	);
	const staged = useLocalLiveOn(signal, load, null);

	/**
	 * The **current cover** of a published draft. A failure still opens the screen: a work that is
	 * archived or hidden by operators returns 404 here, which only prevents drawing the cover and is
	 * no reason to block editing.
	 */
	const story = useQuery({
		...storyQueryOptions(getRowCatClient(), published ?? ""),
		enabled: published !== null,
	});

	/**
	 * The URL comes **from the storage layer**; names and paths are not joined here. If that assembly
	 * lived in the screen layer, someone would eventually freeze an absolute path, and that value
	 * would point at a file that is missing after a reinstall.
	 */
	const stagedUri = staged.value?.uri ?? null;
	return useMemo(
		() => ({
			url: stagedUri ?? story.data?.coverUrl ?? null,
			staged: stagedUri !== null,
			/**
			 * **A failure is not loading.** If the read fails, the held value (`null`) stays and the screen
			 * draws the placeholder. Better than leaving the editor on a permanent placeholder because one
			 * cover could not be read.
			 */
			loading: opening || staged.status === "loading",
		}),
		[stagedUri, story.data?.coverUrl, opening, staged.status],
	);
}
