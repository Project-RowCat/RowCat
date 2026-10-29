import { projectProtectedSeed } from "@rowcat/chat/protected-seed";
import {
	type RelatedStoriesResponse,
	STORY_PLAYBACK_VERSION,
	type StoriesPage,
	StoriesQuery,
	type StoryChatSeedDto,
	type StoryDto,
	type StoryLifecycleResponse,
	type StoryPlaybackDto,
	StoryPlayStartRequest,
	type StoryPlayStartResponse,
	StoryPublishRequest,
	type StoryPublishResponse,
	StoryUpdateRequest,
	type StoryUpdateResponse,
} from "@rowcat/contracts";
import { type Context, Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { invalidInput, notFound, unauthorized } from "../../lib/errors.ts";
import {
	canViewAdult,
	rejectAdultFilter,
	requireActiveViewer,
	requireViewer,
} from "../../lib/gates.ts";
import { readJson, viewerKey } from "../../lib/http.ts";
import { checkRateLimit } from "../../lib/rate-limit/index.ts";
import { getViewer } from "../../middleware/viewer.ts";
import { requireCapability } from "../../services/moderation-capability.ts";
import { requireFeatureEnabled } from "../../services/ops.ts";
import { listBlocked, recordView } from "../../services/social.ts";
import { listGalleryStories } from "../../services/story/gallery-cache.ts";
import { getStory, listRelatedStories } from "../../services/story/index.ts";
import {
	archiveStory,
	publishStoryPublicly,
	restoreStory,
	unlistStory,
	unpublishStory,
} from "../../services/story/lifecycle.ts";
import {
	publishStory,
	updatePublishedStory,
} from "../../services/story/publication.ts";
import { getPublishedStoryRuntime } from "../../services/story/runtime.ts";
import { recordStoryPlayStart } from "../../services/story/telemetry.ts";
import { lookupSelector } from "./access.ts";
import { comments } from "./comments.ts";
import { storyCover } from "./cover.ts";
import { parseChatSeed, requirePlayableStory } from "./playback-gate.ts";

/**
 * Query string to contract. The contract wants booleans and numbers but URLs are all strings.
 * `z.coerce` is avoided: it silently passes bad input (`"abc"` becomes NaN, `"0"` becomes true).
 */
function parseQuery(url: string) {
	const sp = new URL(url).searchParams;
	const int = (key: string): number | undefined => {
		const raw = sp.get(key);
		if (raw === null) return undefined;
		const n = Number(raw);
		// Passing fractions/NaN/Infinity as undefined would apply the default and hide typos.
		return Number.isSafeInteger(n) ? n : Number.NaN;
	};
	return StoriesQuery.safeParse({
		orientation: sp.get("orientation") || null,
		rating: sp.get("rating") ?? undefined,
		sort: sp.get("sort") ?? undefined,
		period: sp.get("period") ?? undefined,
		q: sp.get("q") ?? undefined,
		tag: sp.get("tag") || null,
		favorited: sp.get("favorited") === "1",
		following: sp.get("following") === "1",
		page: int("page"),
		pageSize: int("pageSize"),
	});
}

/** Maps the rating filter to the query predicate; `any` means no condition. */
const ratingToAdult = (rating: "any" | "sfw" | "adult"): boolean | null =>
	rating === "adult" ? true : rating === "sfw" ? false : null;

/**
 * The story id under `/:id`. The mount point guarantees it exists; only the type does not know. A
 * missing value folds to a missing story rather than throwing, as in `requireCommentableStory`, so
 * playback failures keep one shape.
 */
function storyIdParam(c: Context<AppEnv>): string {
	const param = c.req.param("id");
	return typeof param === "string" ? param : "";
}

export const stories = new Hono<AppEnv>()
	.get("/", async (c) => {
		const parsed = parseQuery(c.req.url);
		if (!parsed.success) throw invalidInput(parsed.error);
		const q = parsed.data;

		const viewer = await getViewer(c);
		// The subject comes only from the session; a client-chosen member id would expose others'
		// favorites.
		if ((q.favorited || q.following) && !viewer)
			throw unauthorized("Only signed-in members can see the personal feed.");

		const adultAllowed = canViewAdult(viewer);
		// Reject with a reason instead of an empty list so the client can pick the right guidance screen.
		if (q.rating === "adult" && !adultAllowed) rejectAdultFilter(viewer);

		/**
		 * Only the first few guest pages go through the server cache; that decision is made in
		 * `services/story/gallery-cache.ts`, not here. `Cache-Control` stays `private, no-cache` because
		 * the same handler also serves member responses.
		 */
		const { items, total } = await listGalleryStories({
			orientation: q.orientation,
			adult: ratingToAdult(q.rating),
			search: q.q,
			tag: q.tag,
			viewerId: viewer?.id ?? null,
			/**
			 * Discovery includes the viewer's own private works. The public profile grid passes false
			 * (`routes/creators.ts`) so it looks the same to everyone.
			 */
			ownPrivateVisible: true,
			/**
			 * Unlisted works never reach discovery: list, search, popular, favorites and following all pass
			 * this one query, so this axis closes all five. Only the single-item path opens it
			 * (`routes/stories/access.ts`).
			 */
			unlistedVisible: false,
			adultAllowed,
			/**
			 * Own adult works stay closed in lists: the gallery pushes ratings the user has not enabled, so
			 * the display opt-in must hold. Differs from `lookupSelector` here only.
			 */
			ownAdultAllowed: false,
			blocked: viewer ? await listBlocked(viewer.id) : [],
			favoritedBy: q.favorited ? (viewer?.id ?? null) : null,
			followingOf: q.following ? (viewer?.id ?? null) : null,
			// The creator filter belongs to the public profile route (`routes/creators.ts`).
			creatorId: null,
			sort: q.sort,
			period: q.period,
			page: q.page,
			pageSize: q.pageSize,
		});

		// The service returns the domain Story; the HTTP shape is decided here. The two are identical
		// today, so structural assignment stands in for a mapper.
		const body: StoriesPage = {
			items,
			total,
			page: q.page,
			pageSize: q.pageSize,
			// One page even with zero results (the contract has min(1)); 0 would read as "no first page".
			pageCount: Math.max(1, Math.ceil(total / q.pageSize)),
		};
		// Gating differs per viewer, so a shared cache must not hold it.
		c.header("Cache-Control", "private, no-cache");
		return c.json(body);
	})

	.get("/:id", async (c) => {
		const { selector } = await lookupSelector(c);
		const story = await getStory(c.req.param("id"), selector);
		// Gated stories answer like a missing one; 403 vs 404 would reveal existence.
		if (!story) throw notFound("Story not found.");
		const body: StoryDto = story;
		c.header("Cache-Control", "private, no-cache");
		return c.json(body);
	})

	/**
	 * Related works: stories sharing tags with this one.
	 *
	 * The source is read first with the detail selector so an invisible story is a 404 and this route
	 * cannot expose a private story's tags. Candidates pass the discovery predicate: unlisted and the
	 * owner's own-adult exception stay closed here.
	 */
	.get("/:id/related", async (c) => {
		const { selector } = await lookupSelector(c);
		const source = await getStory(c.req.param("id"), selector);
		if (!source) throw notFound("Story not found.");
		const items = await listRelatedStories({
			source: {
				id: source.id,
				tags: source.tags,
				creatorId: source.creator?.id ?? null,
			},
			selector: {
				...selector,
				unlistedVisible: false,
				ownAdultAllowed: false,
				favoritedBy: null,
				followingOf: null,
				creatorId: null,
			},
		});
		const body: RelatedStoriesResponse = { items };
		c.header("Cache-Control", "private, no-cache");
		return c.json(body);
	})

	/**
	 * Playback snapshot: the body a device downloads when starting a conversation. GET because it only
	 * reads an immutable snapshot and leaves nothing on the server.
	 *
	 * Eligibility is decided by one door, `requirePlayableStory` (`playback-gate.ts`) and the
	 * predicate in `services/story/playback.ts`. Owner always qualifies; public/unlisted qualifies
	 * through the viewer gates (adult, blocks). Do not read the payload with the detail selector here,
	 * or this route's rules diverge from the server-assembled generation of protected works
	 * (`routes/chat.ts`).
	 *
	 * Guests stop here: the detail page is public but this carries the manuscript. The 401 comes
	 * before any lookup, so missing and private stories are indistinguishable to guests.
	 */
	.get("/:id/play", async (c) => {
		const { storyId, payload } = await requirePlayableStory(c, storyIdParam(c));
		/** Protected works ship a blank creator prompt; the server assembles their generation (`projectProtectedSeed`). */
		const body: StoryChatSeedDto = projectProtectedSeed(
			parseChatSeed(storyId, payload),
		);
		// Gating differs per viewer, so a shared cache must not hold it.
		c.header("Cache-Control", "private, no-cache");
		return c.json(body);
	})

	/**
	 * Unified playback: what to open this story with.
	 *
	 * This is a new path instead of changing `/play` because turning that response into a
	 * discriminated union would break every deployed client. `/play` keeps returning the chat snapshot
	 * even for runtime stories; runtime stories do carry a normal chat snapshot.
	 *
	 * Authorization is the same `requirePlayableStory` door; restating the rules here would let one
	 * copy loosen. The mode is decided by the presence of a `story_runtime` row, the same fact the
	 * detail's `playMode` reads. There is no client-supplied mode parameter, since asking would reopen
	 * the path to fetch a runtime story's body as a chat snapshot.
	 */
	.get("/:id/playback", async (c) => {
		const { storyId, payload } = await requirePlayableStory(c, storyIdParam(c));
		const runtime = await getPublishedStoryRuntime(storyId);
		c.header("Cache-Control", "private, no-cache");
		if (runtime === null) {
			const body: StoryPlaybackDto = {
				version: STORY_PLAYBACK_VERSION,
				kind: "chat",
				seed: projectProtectedSeed(parseChatSeed(storyId, payload)),
			};
			return c.json(body);
		}
		const body: StoryPlaybackDto = {
			version: STORY_PLAYBACK_VERSION,
			kind: "runtime",
			artifact: runtime.artifact,
			capabilities: runtime.capabilities,
			/**
			 * The logical-name table leaves only inside this response. A standalone asset manifest address
			 * would list a private story's images without playback entitlement.
			 */
			managedAssets: runtime.managedAssets,
		};
		return c.json(body);
	})

	/** Records one view. Separate from the detail GET so prefetch, bots and revalidation do not count as views. */
	.post("/:id/view", async (c) => {
		const id = c.req.param("id");
		const { viewer, selector } = await lookupSelector(c);
		const story = await getStory(id, selector);
		if (!story) throw notFound("Story not found.");
		await recordView(
			id,
			viewerKey(c, viewer?.id ?? null),
			// An ownerless story has no owner view to exclude; optional chaining means always count.
			story.creator?.id ?? null,
			viewer?.id ?? null,
		);
		return c.body(null, 204);
	})

	/**
	 * Records a play start, reported by the device only after the local session exists.
	 *
	 * `/play` and `/playback` do not count: their 200 means "body served", not "conversation started"
	 * (local storage can fail, the account can switch), and counting them would inflate the number by
	 * an unknown amount.
	 *
	 * ```text
	 * guest            401, before any lookup (missing and others' stories are the same 401)
	 * not entitled     404, same as a missing story, so this is not an existence probe
	 * owner / replay   200 recorded:false, not an error (a retry must not draw a failure)
	 * ```
	 *
	 * Entitlement is re-decided with the same predicate as playback (`services/story/telemetry.ts`);
	 * the server's decision, not the client's claim, backs the row.
	 */
	.post("/:id/play-starts", async (c) => {
		const { viewer, selector } = await lookupSelector(c);
		/** Before any lookup, same order as `requirePlayableStory`. */
		const player = requireViewer(viewer);
		const parsed = StoryPlayStartRequest.safeParse(await readJson(c));
		if (!parsed.success) throw invalidInput(parsed.error);

		await checkRateLimit("storyPlayStart", player.id);

		const outcome = await recordStoryPlayStart({
			storyId: c.req.param("id"),
			viewerId: player.id,
			adultAllowed: selector.adultAllowed,
			ownAdultAllowed: selector.ownAdultAllowed,
			blocked: selector.blocked,
			sessionKey: parsed.data.sessionKey,
			kind: parsed.data.kind,
		});
		if (outcome === null) throw notFound("Story not found.");

		const body: StoryPlayStartResponse = { recorded: outcome.recorded };
		c.header("Cache-Control", "no-store");
		return c.json(body);
	})

	/**
	 * First publication: a local draft becomes a story. It POSTs to the collection instead of a
	 * `/publish` namespace so the resource has one path.
	 *
	 * Idempotent: calling again with the same draft updates the story it created and returns `created:
	 * false`, so a retry after a lost response does not create two stories
	 * (services/story/publication.ts).
	 */
	.post("/", async (c) => {
		/**
		 * Requires an active member, not just a session: suspended or blocked accounts can read but not
		 * publish. The `story.publish` capability restriction sits beside it as a narrower sanction.
		 * Local draft editing is never blocked; the draft belongs to the device and blocking it would
		 * hold the author's manuscript hostage.
		 */
		const viewer = requireActiveViewer(await getViewer(c));
		await requireCapability(viewer.id, "story.publish");
		/**
		 * The publish circuit breaker (`ops`), next to the capability check. Different axis: the
		 * capability restriction targets this member, the switch halts everyone. Capability goes first so
		 * a sanctioned creator gets the more accurate "restricted" message.
		 */
		await requireFeatureEnabled("publish");
		const parsed = StoryPublishRequest.safeParse(await readJson(c));
		if (!parsed.success) throw invalidInput(parsed.error);

		const { created, story } = await publishStory(viewer, parsed.data);
		const body: StoryPublishResponse = { created, story };
		/** 201 vs 200 for created vs updated: proxies, logs and metrics read the status, clients branch on the body's `created`. */
		return c.json(body, created ? 201 : 200);
	})

	/**
	 * Updates a published story: the owner re-uploads from their draft. PUT because it replaces the
	 * whole snapshot; a partial swap could mix new characters with old lore. Counters, owner, creation
	 * time and operator hiding are not expressible in the request.
	 */
	.put("/:id", async (c) => {
		const viewer = requireActiveViewer(await getViewer(c));
		// Same gate as first publication; an update also writes to the catalogue.
		await requireCapability(viewer.id, "story.publish");
		/** Same breaker; otherwise a suspension could be bypassed by "updating". */
		await requireFeatureEnabled("publish");
		const parsed = StoryUpdateRequest.safeParse(await readJson(c));
		if (!parsed.success) throw invalidInput(parsed.error);

		const story = await updatePublishedStory(
			viewer,
			c.req.param("id"),
			parsed.data,
		);
		const body: StoryUpdateResponse = { story };
		return c.json(body);
	})

	/* Lifecycle: moves the visibility of an already-published story. */

	/**
	 * Each of the five operations has its own path. A generic `PATCH /:id { visibility }` would make
	 * forbidden transitions such as `archived → public` expressible as requests. Gates are spelled out
	 * per route because they genuinely differ (`routes/social.ts` made the same call).
	 *
	 * ```text
	 *              account state       capability      breaker     entitlement
	 * publish      requireActive       story.publish   publish     identity check if adult
	 * unlist       requireActive       story.publish   publish     same
	 * unpublish    requireViewer       -               -           -
	 * archive      requireViewer       -               -           -
	 * restore      requireActive       -               -           -
	 * ```
	 *
	 * Operations that reduce exposure stay open; only those that can return a story to exposure need a
	 * whole account. Blocking a sanctioned creator from taking down their own work would hold their
	 * content in the catalogue. `unlist` is the ambiguous row (it can raise or lower exposure
	 * depending on the start); the gate aligns with the raising side, and the two withdrawing paths
	 * (`unpublish`, `archive`) stay open so it is not a dead end.
	 */

	/** Private to public. Same three gates as first publication; otherwise two presses would reach the same place. */
	.post("/:id/publish", async (c) => {
		const viewer = requireActiveViewer(await getViewer(c));
		await requireCapability(viewer.id, "story.publish");
		await requireFeatureEnabled("publish");
		const body: StoryLifecycleResponse = {
			story: await publishStoryPublicly(viewer, c.req.param("id")),
		};
		return c.json(body);
	})

	/**
	 * Private/public to unlisted. Same gates as `publish`: an unlisted story opens for anyone who has
	 * the address, and that address spreads beyond our control.
	 */
	.post("/:id/unlist", async (c) => {
		const viewer = requireActiveViewer(await getViewer(c));
		await requireCapability(viewer.id, "story.publish");
		await requireFeatureEnabled("publish");
		const body: StoryLifecycleResponse = {
			story: await unlistStory(viewer, c.req.param("id")),
		};
		return c.json(body);
	})

	/**
	 * Public/unlisted to private. A withdrawing operation, so `requireViewer`: the capability
	 * restriction and publish breaker guard writes that go out to the catalogue, not ones that pull
	 * back.
	 */
	.post("/:id/unpublish", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		const body: StoryLifecycleResponse = {
			story: await unpublishStory(viewer, c.req.param("id")),
		};
		return c.json(body);
	})

	/** Public/unlisted/private to archived. `requireViewer` for the same reason; idempotent. */
	.post("/:id/archive", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		const body: StoryLifecycleResponse = {
			story: await archiveStory(viewer, c.req.param("id")),
		};
		return c.json(body);
	})

	/**
	 * Archived to private. Needs `requireActiveViewer` although it adds no exposure: it undoes rather
	 * than withdraws, and the account state model never opened such owner writes to suspended
	 * accounts. Taking down stays available through the two operations above.
	 */
	.post("/:id/restore", async (c) => {
		const viewer = requireActiveViewer(await getViewer(c));
		const body: StoryLifecycleResponse = {
			story: await restoreStory(viewer, c.req.param("id")),
		};
		return c.json(body);
	})

	/**
	 * Comments: a sub-resource mounted under the story path. A top-level `/comments` would let a
	 * body-supplied story id be trusted before the visibility check. The prefix is mounted here for
	 * the same reason as in `routes/index.ts`.
	 */
	.route("/:id/comments", comments)

	/**
	 * Cover: read, replace and delete live in one router (`routes/stories/cover.ts`) so exposure and
	 * cache rules are written once, as with comments.
	 */
	.route("/:id/cover", storyCover);
