import type { StoryDraft } from "@rowcat/authoring";
import { storyQueryOptions } from "@rowcat/query";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getRowCatClient } from "#/lib/api.ts";
import { useStagedDraftCover } from "#/lib/local-authoring/draft-cover-hooks.ts";

/**
 * Single answer to what the draft cover currently shows. Two places need the same answer: the cover
 * field (where the user chooses) and the gallery card preview (where it is seen). If each judged
 * separately, one could show a staged file awaiting publish while the other shows the server's old
 * cover, and the preview would contradict the screen directly above it.
 *
 * Rule: a file staged on this device is drawn, since that is what publish will upload. Otherwise
 * the server's current cover is drawn, which only applies to drafts already published.
 *
 * The URL is not built here. The rule for cover URLs (origin, path, content hash) belongs to the
 * server. A copy in the browser would go stale when deployment changes the rule.
 *
 * Unpublished drafts never query the server, because there is no work to ask about.
 */
export interface DraftCoverUrl {
	url: string | null;
	/**
	 * Whether the cover is chosen on this device and not yet uploaded. This is the basis on which the
	 * screen can say so.
	 */
	staged: boolean;
	/** The first result from device storage has not arrived yet. This is different from 'no cover'. */
	loading: boolean;
}

export function useDraftCoverUrl(draft: StoryDraft): DraftCoverUrl {
	const { cover, loading } = useStagedDraftCover(draft.id);
	const published = draft.publishedStoryId;

	/**
	 * Current cover of a published draft. If this fails, the editor still opens: for hidden or
	 * archived works the request returns 404 here. That only means the cover cannot be drawn, not that
	 * editing should be blocked.
	 */
	const story = useQuery({
		...storyQueryOptions(getRowCatClient(), published ?? ""),
		enabled: published !== null,
	});

	/**
	 * Object URL for the Blob stored on this device. A new URL is created whenever the Blob changes,
	 * and the previous one is always revoked. Revocation lives in the effect cleanup because unmount
	 * must go through the same path. The dependency is the blob because it is the only value that
	 * actually changes the URL.
	 */
	const [stagedUrl, setStagedUrl] = useState<string | null>(null);
	const blob = cover?.blob ?? null;
	useEffect(() => {
		if (!blob) {
			setStagedUrl(null);
			return;
		}
		const url = URL.createObjectURL(blob);
		setStagedUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [blob]);

	return {
		url: stagedUrl ?? story.data?.coverUrl ?? null,
		staged: stagedUrl !== null,
		loading,
	};
}
