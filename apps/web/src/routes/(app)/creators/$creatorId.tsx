import {
	APP_NAME,
	type PublicProfile,
	profileDisplayName,
} from "@rowcat/domain";
import {
	creatorStoriesInfiniteQueryOptions,
	pinnedStoriesQueryOptions,
	publicProfileQueryOptions,
} from "@rowcat/query";
import { createFileRoute } from "@tanstack/react-router";
import { ProfileError } from "#/features/profile/profile-error.tsx";
import { ProfilePage } from "#/features/profile/profile-page.tsx";
import { ProfileShell } from "#/features/profile/profile-shell.tsx";
import { ProfileSkeleton } from "#/features/profile/profile-skeleton.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { metaDescription } from "#/lib/format/meta-description.ts";
import { translator } from "#/lib/i18n/current.ts";
import {
	preloadPersonalization,
	preloadViewer,
} from "#/lib/query/viewer-preload.ts";

/**
 * Turns the bio into a one-line preview. Folding and trimming are handled by metaDescription.
 *
 * If there is no bio, a product sentence is used instead of inventing something about the person.
 * An empty description would be worse, and an invented bio is worse still.
 */
function previewText(profile: PublicProfile): string {
	const text = metaDescription(profile.bio);
	if (!text)
		return translator("shell")("titles.creator", {
			name: profileDisplayName(profile),
			app: APP_NAME,
		});
	return text;
}

/**
 * Public profile: /creators/:creatorId.
 *
 * The address identity is the member id. The first decision in this file is not to use the
 * nickname. Display names have no uniqueness constraint and no change limit (NicknameUpdateDto).
 * Using them in the address would turn a rename into a broken link for anyone who saved one. The id
 * is immutable, so the address stays the same however the name or bio changes.
 *
 * The route stays thin: prefetching and connecting the boundary component are its only jobs. The
 * screen belongs to features/profile. The loader and the component use the same options factory, so
 * the component reads the cache entry the server filled. The request happens once.
 *
 * There is no login guard. The public gallery is open to guests. If a work's creator sat behind a
 * login wall while the work itself is public, the only path from the work to the person would be
 * cut off for guests.
 */
export const Route = createFileRoute("/(app)/creators/$creatorId")({
	/**
	 * The profile, the works, and the viewer are fetched together, since none needs to wait for
	 * another. Only personalization waits for the viewer, and it is sent only to logged-in users, so
	 * guests never receive it.
	 *
	 * The profile fetch is allowed to throw. Its failure is the server's verdict, since a missing and
	 * a deleted account both return an indistinguishable 404. Swallowing it here would make that
	 * verdict meaningless on screen. The works list failure is not swallowed either, although it could
	 * be. If only the profile rendered and the grid silently emptied, users would read it as a creator
	 * with no works. The two cases must be told apart on this screen.
	 */
	loader: async ({ context, params }) => {
		const client = getRowCatClient();
		const { queryClient } = context;
		const [profile, , viewer] = await Promise.all([
			queryClient.ensureQueryData(
				publicProfileQueryOptions(client, params.creatorId),
			),
			queryClient.ensureInfiniteQueryData(
				creatorStoriesInfiniteQueryOptions(client, params.creatorId),
			),
			preloadViewer(queryClient, client),
			/**
			 * The pinned works are a non-throwing prefetch. That slot is a highlight in front of the grid,
			 * so its failure has no reason to turn the whole profile into an error. The screen simply leaves
			 * that slot undrawn.
			 */
			queryClient.prefetchQuery(
				pinnedStoriesQueryOptions(client, params.creatorId),
			),
		]);
		if (viewer) await preloadPersonalization(queryClient, client);
		/**
		 * This is the value the head function below uses. The profile is not fetched a second time; the
		 * one already received is passed along. Fetching the same endpoint twice for meta tags would
		 * double the server latency, and the two responses could differ.
		 */
		return profile;
	},

	/**
	 * The profile is server-rendered, so crawlers and link previews see the real name and bio, the
	 * same treatment as the public gallery and the work detail page.
	 *
	 * When the loader throws, loaderData is absent, and nothing is emitted. Putting the name of a
	 * profile the viewer cannot see into meta tags would defeat the existence hiding the server
	 * enforces.
	 *
	 * Everything emitted here comes from the public DTO. Email, member status, and the adult gate are
	 * not in this response at all, so there is no place where they could leak by mistake. That is also
	 * why the contract is split this way.
	 */
	head: ({ loaderData }) => {
		if (!loaderData) return {};
		const name = profileDisplayName(loaderData);
		const description = previewText(loaderData);
		return {
			meta: [
				{ title: `${name} | ${APP_NAME}` },
				{ name: "description", content: description },
				// profile, not article. This document describes a person, not a piece of writing.
				{ property: "og:type", content: "profile" },
				{ property: "og:title", content: name },
				{ property: "og:description", content: description },
			],
		};
	},
	component: ProfilePage,
	pendingComponent: () => (
		<ProfileShell>
			<ProfileSkeleton />
		</ProfileShell>
	),
	errorComponent: ({ error, reset }) => (
		<ProfileShell>
			<ProfileError error={error} reset={reset} />
		</ProfileShell>
	),
});
