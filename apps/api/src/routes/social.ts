import {
	type BlockStateDto,
	type FavoriteStateDto,
	type FollowStateDto,
	SetBlockRequest,
	SetFavoriteRequest,
	SetFollowRequest,
} from "@rowcat/contracts";
import { Hono } from "hono";
import type { z } from "zod";
import type { AppEnv } from "../app.ts";
import { invalidInput, notFound } from "../lib/errors.ts";
import { requireActiveViewer } from "../lib/gates.ts";
import { getViewer } from "../middleware/viewer.ts";
import { requireCapability } from "../services/moderation-capability.ts";
import { setBlock, setFavorite, setFollow } from "../services/social.ts";
import { getStory } from "../services/story/index.ts";
import { lookupSelector } from "./stories/access.ts";

/**
 * Request bodies carry the desired final state, not a toggle, so a retry cannot flip state and
 * pressing the same button from several screens converges one way.
 *
 * All three bodies live in @rowcat/contracts because the SDK builds the same bodies; kept only in
 * the server, the two shapes could diverge with types still green and surface only as runtime 400s.
 *
 * No body has a subject: the follower or blocker is always the requester, taken from the session.
 * With no slot in the contract, passing a client value by mistake is blocked by the type.
 */

async function body<T extends z.ZodType>(
	c: { req: { json: () => Promise<unknown> } },
	schema: T,
) {
	const parsed = schema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) throw invalidInput(parsed.error);
	return parsed.data as z.infer<T>;
}

/**
 * The `social.write` restriction applies to two of the three routes; that asymmetry is this file's
 * policy (§38).
 *
 * Follow and favorite are outward interactions: they raise a creator's follower count, appear in
 * their feed and feed popularity, so they can be harassment tools. Block is the opposite: it
 * reduces interaction and protects the blocker, and taking it from a sanctioned member would use a
 * safety feature as part of the sanction. Each route states its gate explicitly instead of one
 * broad gate, which could not be told apart from an accidental omission.
 */
export const favorites = new Hono<AppEnv>().put("/:storyId", async (c) => {
	const viewer = requireActiveViewer(await getViewer(c));
	await requireCapability(viewer.id, "social.write");
	const storyId = c.req.param("storyId");
	const { favorited } = await body(c, SetFavoriteRequest);

	/**
	 * Only adding passes the exposure boundary; removing does not.
	 *
	 * Adding creates a relationship with the story, so it needs the detail's predicate
	 * (`lookupSelector` → `getStory`): private, archived, operator-hidden, blocked and adult-gated
	 * stories give the same 404 as a missing one. Without it, knowing a story id would let anyone
	 * favorite someone's private story, and success vs 404 would reveal whether that id exists (worst
	 * for adult works; detail, playback, cover and comments already make the same decision).
	 *
	 * Removing is the opposite: a story can become private or archived after being favorited, and
	 * keeping the gate would leave no way to remove an existing favorite. Operations that reduce a
	 * relationship get no exposure boundary (same axis as block staying open under `social.write`).
	 */
	if (favorited) {
		const { selector } = await lookupSelector(c);
		if (!(await getStory(storyId, selector)))
			throw notFound("Story not found.");
	}

	const result = await setFavorite(storyId, viewer.id, favorited);
	if (!result) throw notFound("Story not found.");
	const dto: FavoriteStateDto = result;
	return c.json(dto);
});

/**
 * Follow — `PUT /v2/follows`.
 *
 * Refusals (self, missing member, blocked target) are all decided by the service; imitating any in
 * the route would put one rule in two places.
 *
 * `requireActiveViewer` gives suspended or blocked accounts 401/403: relationship writes are
 * outward, and a suspension that still allows interaction means nothing.
 */
export const follows = new Hono<AppEnv>().put("/", async (c) => {
	const viewer = requireActiveViewer(await getViewer(c));
	await requireCapability(viewer.id, "social.write");
	const { creator, following } = await body(c, SetFollowRequest);
	const dto: FollowStateDto = await setFollow(viewer.id, creator, following);
	return c.json(dto);
});

/**
 * Block — `PUT /v2/blocks`.
 *
 * Severing an existing follow happens inside the service's transaction. Calling `setFollow` again
 * from here would let a failure land between the two requests and commit "blocked but still
 * following".
 *
 * It deliberately does not check the `social.write` restriction; the absence is the policy, not a
 * missing gate. The reasoning is in the favorites header above (§38).
 */
export const blocks = new Hono<AppEnv>().put("/", async (c) => {
	const viewer = requireActiveViewer(await getViewer(c));
	const { creator, blocked } = await body(c, SetBlockRequest);
	const dto: BlockStateDto = await setBlock(viewer.id, creator, blocked);
	return c.json(dto);
});
