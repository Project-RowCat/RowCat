import {
	CreatorStoriesQuery,
	type PinnedStoriesResponse,
	type PublicProfileDto,
	type StoriesPage,
} from "@rowcat/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { invalidInput, notFound } from "../lib/errors.ts";
import { canViewAdult } from "../lib/gates.ts";
import { getViewer } from "../middleware/viewer.ts";
import { getPublicProfile } from "../services/account/profile.ts";
import { listBlocked } from "../services/social.ts";
import {
	type GallerySelector,
	listPinnedStories,
	listStories,
} from "../services/story/index.ts";

/**
 * Public profile, `/v2/creators/:creatorId`.
 *
 * - The address follows product vocabulary (`creators`) while the model is the member's public
 *   projection (`PublicProfile`): someone who only wrote comments needs this address too, and a
 *   `CreatorProfile` type would force a separate `UserProfile` later.
 * - Identity is the member id alone. Nicknames have no uniqueness constraint
 *   (`NicknameUpdateDto`), and renaming would break links other people saved. A short handle, if
 *   ever needed, is one more `handle -> member.id` mapping that does not touch this route.
 * - The profile and the work list are separate resources: the profile is small and rarely
 *   changes, the list is paginated, and their cache lifetimes differ (`@rowcat/query`).
 * - Guests can read it. The public gallery is open to guests, so a login wall here would cut the
 *   only path from a work to its creator.
 */
/**
 * Visibility axes for the public profile; the grid and the pinned works share it.
 *
 * Written per route, one side would eventually drift and a pinned work missing from the grid would
 * be put at the top (or the reverse). The three axes that differ from the gallery:
 *
 * ```text
 * ownPrivateVisible  false  the public screen looks the same to everyone, owner included
 * unlistedVisible    false  link-only works were deliberately kept out of lists
 * ownAdultAllowed    false  own adult works still pass the display opt-in, as in lists
 * ```
 *
 * Unlisted works stay out even for the owner, or the owner could not check how the profile looks
 * from outside; for others they would make the profile a discovery path for link-only works.
 */
async function profileSelector(
	viewer: Awaited<ReturnType<typeof getViewer>>,
): Promise<Omit<GallerySelector, "creatorId">> {
	return {
		orientation: null,
		adult: null,
		search: "",
		tag: null,
		viewerId: viewer?.id ?? null,
		ownPrivateVisible: false,
		unlistedVisible: false,
		ownAdultAllowed: false,
		adultAllowed: canViewAdult(viewer),
		blocked: viewer ? await listBlocked(viewer.id) : [],
		favoritedBy: null,
		followingOf: null,
	};
}

export const creators = new Hono<AppEnv>()
	/**
	 * One profile.
	 *
	 * A missing member and a deleted member give the same 404, or the response would confirm that an
	 * id once existed. The viewer is not resolved: the response never varies by viewer, and not
	 * reading the session removes any room for personalization.
	 */
	.get("/:creatorId", async (c) => {
		const profile = await getPublicProfile(c.req.param("creatorId"));
		if (!profile) throw notFound("Profile not found.");

		const body: PublicProfileDto = profile;
		/**
		 * Identical for everyone, so it may sit in a shared cache (the first non-`private` response
		 * here). Short, so name and bio edits show up quickly; `must-revalidate` stops stale copies.
		 */
		c.header("Cache-Control", "public, max-age=60, must-revalidate");
		return c.json(body);
	})

	/**
	 * Works the creator pinned, in pinned order, filtered to what this viewer can see.
	 *
	 * Same selector as the grid below: pinning decides order, not visibility, so a pinned work that
	 * went private, was hidden, is over the viewer's rating or belongs to a blocked creator does not
	 * appear. It is a separate resource because it varies by viewer (`private, no-cache`) while the
	 * profile is `public, max-age=60`. Capped at three, so no pagination.
	 */
	.get("/:creatorId/pinned-stories", async (c) => {
		const viewer = await getViewer(c);
		const body: PinnedStoriesResponse = {
			items: await listPinnedStories(
				c.req.param("creatorId"),
				await profileSelector(viewer),
			),
		};
		c.header("Cache-Control", "private, no-cache");
		return c.json(body);
	})

	/**
	 * Works this creator published, through the gallery predicate (`listStories` -> `galleryWhere`).
	 *
	 * Re-writing visibility SQL here would let one side loosen alone, leaking private titles and
	 * covers. This is a separate route instead of a gallery `?creator=` because that path includes the
	 * viewer's own private works, so the profile owner would see a different list from everyone else
	 * (see `profileSelector` for the three axes).
	 *
	 * The adult gate and blocks still apply, and the total is counted with the same predicate, so
	 * counts cannot reveal hidden works. Member existence is not checked first: an unknown id yields
	 * an empty list, and existence is the profile route's question.
	 */
	.get("/:creatorId/stories", async (c) => {
		const sp = new URL(c.req.url).searchParams;
		const int = (key: string): number | undefined => {
			const raw = sp.get(key);
			if (raw === null) return undefined;
			const n = Number(raw);
			// Letting fractions/NaN/Infinity through as undefined would apply the default and hide the typo.
			return Number.isSafeInteger(n) ? n : Number.NaN;
		};
		const parsed = CreatorStoriesQuery.safeParse({
			page: int("page"),
			pageSize: int("pageSize"),
		});
		if (!parsed.success) throw invalidInput(parsed.error);
		const q = parsed.data;

		const viewer = await getViewer(c);
		const { items, total } = await listStories({
			...(await profileSelector(viewer)),
			creatorId: c.req.param("creatorId"),
			/**
			 * Fixed to newest first. This screen is not discovery; popularity and period filters belong to
			 * the gallery.
			 */
			sort: "recent",
			period: "all",
			page: q.page,
			pageSize: q.pageSize,
		});

		const body: StoriesPage = {
			items,
			total,
			page: q.page,
			pageSize: q.pageSize,
			// Zero results still has one page: the contract says min(1), and 0 would make the client's `page
			// <= pageCount` check read as having no first page.
			pageCount: Math.max(1, Math.ceil(total / q.pageSize)),
		};
		/**
		 * Unlike the profile, must not enter a shared cache: the list depends on the viewer's adult
		 * display setting and block list.
		 */
		c.header("Cache-Control", "private, no-cache");
		return c.json(body);
	});
