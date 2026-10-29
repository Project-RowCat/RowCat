import {
	type OwnPinnedStoriesResponse,
	PinnedStoriesUpdateDto,
} from "@rowcat/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { invalidInput } from "../../lib/errors.ts";
import { requireActiveViewer, requireViewer } from "../../lib/gates.ts";
import { getViewer } from "../../middleware/viewer.ts";
import { replaceOwnPinnedStories } from "../../services/account/pinned-stories.ts";
import { listOwnPinnedWorks } from "../../services/story/index.ts";

/**
 * The member's own pinned works: `/v2/me/pinned-stories`.
 *
 * This is a separate resource from the public read (`GET /v2/creators/:id/pinned-stories`) because
 * the questions differ: that one answers "what is visible to this viewer now", this one "what did I
 * pin". A pin on a work since made private drops out of the former and stays in the latter.
 *
 * ```text
 * GET   requireViewer         reading one's own settings; sanctioned accounts still see their state
 * PUT   requireActiveViewer   a public-profile display, same gate as nickname and bio
 * ```
 *
 * If a suspended account could change what leads its profile, suspension would not stop public
 * display (same judgement as `/me/bio`). Clearing uses the same gate as clearing the bio: the
 * contract does not separate pin from unpin, so one request cannot carry two authorizations.
 *
 * `no-store` because the response can carry titles of works not yet shown to anyone.
 */
export const mePinnedStories = new Hono<AppEnv>()
	.get("/", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		const body: OwnPinnedStoriesResponse = {
			items: await listOwnPinnedWorks(viewer.id),
		};
		c.header("Cache-Control", "no-store");
		return c.json(body);
	})

	.put("/", async (c) => {
		const viewer = requireActiveViewer(await getViewer(c));
		const parsed = PinnedStoriesUpdateDto.safeParse(
			await c.req.json().catch(() => null),
		);
		if (!parsed.success) throw invalidInput(parsed.error);

		const body: OwnPinnedStoriesResponse = {
			items: await replaceOwnPinnedStories(viewer.id, parsed.data.storyIds),
		};
		c.header("Cache-Control", "no-store");
		return c.json(body);
	});
