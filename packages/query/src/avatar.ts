import type { AvatarDto } from "@rowcat/contracts";
import type { StoryComment } from "@rowcat/domain";
import type { RowCatClient } from "@rowcat/sdk";
import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import {
	STORY_COMMENTS_QUERY_KEY_PREFIX,
	type StoryCommentsInfiniteData,
} from "./comments.ts";
import { patchPublicProfileAvatar } from "./profile.ts";

/**
 * Profile photo write cache policy. The server returns the single avatar after the change, so this
 * file only places that URL into the cells that already hold the old one.
 * - The screen never builds cache-busting URLs such as ?cacheBust=Date.now(). Changing the avatar
 *   issues a new media id, so the URL itself changes and the browser fetches it anew.
 * - No invalidation: an avatar moves no list membership, order, or metric. The server updates one
 *   pointer on the member row, so galleries, works, and analytics stay the same, and refetching
 *   them is waste.
 * - Two cells hold the avatar: the public profile (["creators","profile",<my id>]) and comment
 *   lists (["stories","comments",*]), where it sits beside my comments. Notifications are absent on
 *   purpose: a notification actor is always someone else (no self-notifications). Galleries and
 *   work cards are absent too: StoryDto.creator carries a name and id, not an avatar.
 * - No optimistic update: the server can reject the request for many reasons, and the URL to show
 *   depends on the server-normalized media id, which cannot be guessed. The screen previews the
 *   chosen file with its own temporary object URL; only this response promotes it to the profile
 *   image.
 */

/**
 * Replaces the avatar only on comments this member wrote, across the comment pages loaded so far.
 * The whole comment is not swapped: only one axis changed, and rewriting body, time, or nickname
 * would revert edits another device made in between. A page with nothing to change returns the same
 * reference. A new array would needlessly re-render every comment on it and create cache cells that
 * no observer watches.
 */
function patchCommentAvatars(
	data: StoryCommentsInfiniteData | undefined,
	memberId: string,
	avatarUrl: string | null,
): StoryCommentsInfiniteData | undefined {
	/**
	 * Tombstones are passed through: a deleted row has no author, so there is no avatar to swap. The
	 * discriminant is checked first, since reading the author of a tombstone would read a property
	 * that does not exist.
	 */
	const matches = (comment: StoryComment) =>
		comment.state === "visible" &&
		comment.author.id === memberId &&
		comment.author.avatarUrl !== avatarUrl;
	if (!data?.pages.some((page) => page.items.some(matches))) return data;
	return {
		...data,
		pages: data.pages.map((page) =>
			page.items.some(matches)
				? {
						...page,
						items: page.items.map((comment) =>
							matches(comment) && comment.state === "visible"
								? { ...comment, author: { ...comment.author, avatarUrl } }
								: comment,
						),
					}
				: page,
		),
	};
}

/**
 * Applies the confirmed avatar URL to every place it is cached. Upload and delete both go through
 * this one function; if each wrote its own policy, one would always miss a place, and the symptom
 * ("profile updated, but my comments still show the old photo") is hard to notice. avatarUrl null
 * means the avatar was removed. That is why both operations pass through the same function:
 * deleting does not recount the places to fix.
 */
export function applyViewerAvatar(
	queryClient: QueryClient,
	memberId: string,
	avatarUrl: string | null,
): void {
	patchPublicProfileAvatar(queryClient, memberId, avatarUrl);
	queryClient.setQueriesData<StoryCommentsInfiniteData>(
		{ queryKey: STORY_COMMENTS_QUERY_KEY_PREFIX },
		(data) => patchCommentAvatars(data, memberId, avatarUrl),
	);
}

/**
 * scope is the member id so that two replacements by the same person finish in order. Run in
 * parallel, the later request could finish first and leave the cache settled on the old photo. The
 * server's final state is set by the last commit (it locks the member row), so a screen left out of
 * step is the worse outcome.
 */
export function uploadAvatarMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
	/**
	 * The owner of the cell to fix is passed in as an argument, not read from the viewer cache, as
	 * with the bio write. If that cache is empty at the moment (one render right after logout), the
	 * write would silently succeed while patching nothing.
	 */
	memberId: string,
) {
	return mutationOptions<AvatarDto, Error, Blob>({
		scope: { id: `avatar:${memberId}` },
		mutationFn: (image) => client.me.uploadAvatar(image),
		onSuccess: (avatar) => {
			applyViewerAvatar(queryClient, memberId, avatar.url);
		},
	});
}

/**
 * No optimistic delete. Rolling back would have to restore not one URL but values sitting in
 * several places, and if another device uploaded a new photo in the meantime, the restored value
 * would already be wrong. A removed photo lingering briefly is less harmful than a photo that was
 * not removed appearing gone.
 */
export function deleteAvatarMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
	memberId: string,
) {
	return mutationOptions<void, Error, void>({
		scope: { id: `avatar:${memberId}` },
		mutationFn: () => client.me.deleteAvatar(),
		onSuccess: () => {
			applyViewerAvatar(queryClient, memberId, null);
		},
	});
}
