import type {
	CreatorWorksPage,
	PersonalizationStateDto,
	PublicProfileDto,
	ViewerDto,
	ViewerResponseDto,
} from "@rowcat/contracts";
import {
	BioUpdateDto,
	CreatorWorksQuery,
	NicknameUpdateDto,
	ShowAdultUpdateDto,
} from "@rowcat/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { toViewerDto, updateViewer } from "../../auth/viewer.ts";
import { invalidInput, notFound } from "../../lib/errors.ts";
import {
	isAdultVerified,
	requireActiveViewer,
	requireNonChild,
	requireViewer,
} from "../../lib/gates.ts";
import { getViewer } from "../../middleware/viewer.ts";
import { updateOwnBio } from "../../services/account/profile.ts";
import {
	listBlocked,
	listFavoriteIds,
	listFollowing,
} from "../../services/social.ts";
import { listOwnedStories } from "../../services/story/index.ts";
import { meAccount } from "./account.ts";
import { meAdultVerification } from "./adult-verification.ts";
import { meAvatar } from "./avatar.ts";
import { meCreatorAnalytics } from "./creator-analytics.ts";
import { meCreatorComments } from "./creator-comments.ts";
import { meMembership } from "./membership.ts";
import { meModeration } from "./moderation.ts";
import { notifications } from "./notifications.ts";
import { mePinnedStories } from "./pinned-stories.ts";
import { mePush } from "./push.ts";
import { meRuntimeAssets } from "./runtime-assets.ts";
import { meRuntimeAudio } from "./runtime-audio.ts";
import { meSceneImages } from "./scene-images.ts";
import { sync } from "./sync.ts";
import { meTheme } from "./theme.ts";

/**
 * Confirmed viewer after an update; the client corrects its optimistic update with this value.
 *
 * The write itself belongs to `auth/viewer.ts` (owner of the viewer projection). What remains here
 * is the wire mapping and falling back to the already-read viewer when the row is gone, which only
 * happens on a same-moment account deletion; answering with the value just read beats a 500.
 */
async function updatedViewerDto(
	id: string,
	patch: Parameters<typeof updateViewer>[1],
	fallback: ViewerDto,
): Promise<ViewerDto> {
	const updated = await updateViewer(id, patch);
	return updated ? toViewerDto(updated) : fallback;
}

export const me = new Hono<AppEnv>()
	/**
	 * Encrypted sync: `/v2/me/sync/*`.
	 *
	 * Mount `/me` children here. A second `/v2/me` prefix in `routes/index.ts` would give two places
	 * ownership of one prefix and let the RPC types drift from the real URLs. Being under `/me` also
	 * means "the requester's own": no path slot names which account to sync.
	 */
	.route("/sync", sync)

	/**
	 * My moderation state: `/v2/me/moderation/*`.
	 *
	 * Mounted here for the same reason as sync. The router's gate is `requireViewer` because a
	 * sanctioned person is who needs this screen (see that router's header).
	 */
	.route("/moderation", meModeration)

	/**
	 * Membership eligibility: `/v2/me/membership/*` (age declaration, guardian consent request).
	 *
	 * Mounted here for the same reason; no slot names whose age to record.
	 *
	 * Guardian endpoints are not here (`/v2/guardian/*`): their caller is a guardian holding a
	 * one-time link, not a member, and under this prefix a child's session could confirm its own
	 * consent.
	 *
	 * The verdict (`membershipGate`) lives on `/me` itself, unlike the unread notification count,
	 * because it is an app-wide gate: split into its own resource, every authenticated screen would
	 * wait for a second lookup while a screen that should show the gate briefly renders normally. It
	 * is one value, so it adds no SSR weight and nothing private.
	 */
	.route("/membership", meMembership)

	/**
	 * Adult eligibility verification: `/v2/me/adult-verification/*`.
	 *
	 * Kept apart from `/membership`: that one opens the whole product (without age check or guardian
	 * consent nothing works), this one opens adult content only. Merged, the vocabulary would imply
	 * "you must complete this to use the service", which is false (same axis as not adding
	 * `adult_verification_required` to the entry gate).
	 *
	 * Mounted here for the same reason; no slot names whose identity to verify.
	 */
	.route("/adult-verification", meAdultVerification)

	/**
	 * Creator analytics: `/v2/me/creator-analytics`.
	 *
	 * Mounted here for the same reason; no slot names whose performance to read.
	 *
	 * Metrics are deliberately not added to `/me/stories`: that read backs every path that draws the
	 * work list and publish invalidation hangs off it, while metrics differ in cost and lifetime.
	 * Combined, opening the work screen would run the aggregation each time and re-asking metrics
	 * would re-ask the whole list.
	 */
	.route("/creator-analytics", meCreatorAnalytics)

	/**
	 * Creator comment inbox: `/v2/me/creator-comments`.
	 *
	 * Mounted here for the same reason as analytics; no slot names whose works. The per-story comments
	 * path (`/v2/stories/:id/comments`) is not widened because it goes through the public-discussion
	 * exposure gate, and layering the owner's question ("mine") on it would make that gate answer two
	 * questions.
	 */
	.route("/creator-comments", meCreatorComments)

	/**
	 * In-app notifications: `/v2/me/notifications/*`.
	 *
	 * Mounted here for the same reason: private state read by its recipient alone, and no slot names
	 * whose inbox to read.
	 *
	 * The unread count is not put on `/me` either: that is the hottest read (root SSR, header, auth
	 * guard) and this value changes every 60 seconds.
	 */
	/**
	 * Native push registration: the delivery plane of notifications, not the inbox.
	 *
	 * It sits right below notifications to express that relation: the upper one is the source of truth
	 * for events and this one only configures a second attempt to push them to a device, so removing
	 * it changes nothing above (`docs/notifications/ARCHITECTURE.md`).
	 */
	.route("/push", mePush)
	.route("/notifications", notifications)

	/**
	 * My profile photo: `/v2/me/avatar`.
	 *
	 * Mounted here for the same reason; no slot names whose avatar to change (the body is the image
	 * bytes, so there are no fields at all).
	 *
	 * No read here by design: the avatar URL already rides on the public profile response
	 * (`PublicProfileDto.avatarUrl`) and bytes come from `/v2/media/:id`.
	 */
	.route("/avatar", meAvatar)

	/**
	 * My pinned works: `/v2/me/pinned-stories`.
	 *
	 * Mounted next to the avatar for the same reason: it is a value shown on the public profile and no
	 * slot names whose to edit. Others read it via `/v2/creators/:id/pinned-stories`, which returns
	 * only what is currently visible.
	 */
	.route("/pinned-stories", mePinnedStories)

	/**
	 * Scene image assets: `/v2/me/scene-images`.
	 *
	 * Mounted next to the avatar for the same reason: no slot names the owner. The difference is count
	 * (a member has many), hence `POST`.
	 *
	 * No list endpoint: no screen draws every image I uploaded. The device's draft holds the
	 * references and that list is the screen (an asset library is not this slice).
	 */
	.route("/scene-images", meSceneImages)

	/**
	 * Runtime image assets: `/v2/me/runtime-assets`.
	 *
	 * Mounted beside scene images but as a separate resource: `media.kind` is the publication
	 * authorization, and sharing one address would open a path to publish a scene image as a runtime
	 * asset (it would render, but it is a picture the creator never chose to put there).
	 *
	 * It does not ask which draft this belongs to. The pairing of logical name and this identity lives
	 * in the device's authoring records and the server first sees it in the publish request; knowing
	 * it earlier would make drafts a server resource, while authoring is local-first and E2EE.
	 */
	.route("/runtime-assets", meRuntimeAssets)
	.route("/runtime-audio", meRuntimeAudio)

	/**
	 * Account theme colors: `/v2/me/theme-customization`.
	 *
	 * Mounted here for the same reason; no slot names whose colors to read or change.
	 *
	 * Not put on `/me` itself, same judgment as the unread count: that is the hottest read and this is
	 * six color cells read by only two screens (the settings editor and the runtime application
	 * layer); adding it would make every route's SSR HTML carry them.
	 *
	 * The device appearance preference (`system|light|dark`) does not come here: browser and app each
	 * own it, and storing it on the account would stop guests from seeing a dark screen.
	 */
	.route("/theme-customization", meTheme)

	/**
	 * Account and its security: `/v2/me/account/*`.
	 *
	 * The read (`GET /me/account`) used to be an inline handler here and moved to its own router once
	 * four writes appeared below it (set password, unlink method, two session revocations). Inline,
	 * this file would own account security's gates and vocabulary, turning `/me`'s router from an
	 * entrance to many domains into one domain's implementation.
	 *
	 * Mounted here for the same reason; no slot names whose password or sessions.
	 *
	 * Change password, sign out, delete account and provider linking are not here: Better Auth takes
	 * them directly at `/v2/auth/*` (rationale in the `me-account.ts` header).
	 */
	.route("/account", meAccount)

	/**
	 * Own info. A guest gets null rather than 401 because the guest screen is a normal path.
	 */
	.get("/", async (c) => {
		const viewer = await getViewer(c);
		const body: ViewerResponseDto = viewer ? toViewerDto(viewer) : null;
		return c.json(body);
	})

	/**
	 * Personalization state in one call: card hearts and follow buttons need all three, and separate
	 * routes would cost three round trips per gallery open.
	 */
	.get("/state", async (c) => {
		const viewer = await getViewer(c);
		// Guests get an empty state, not 401: the guest gallery is a normal path, and branching only this
		// lookup on login state would leave that branch out of step for a while after sign-in.
		if (!viewer) {
			const empty: PersonalizationStateDto = {
				favorites: [],
				following: [],
				blocked: [],
			};
			return c.json(empty);
		}
		const [favorites, following, blocked] = await Promise.all([
			listFavoriteIds(viewer.id),
			listFollowing(viewer.id),
			listBlocked(viewer.id),
		]);
		const body: PersonalizationStateDto = { favorites, following, blocked };
		return c.json(body);
	})

	/**
	 * My works on the server: the `Published` tab of the creation workspace (`/create`).
	 *
	 * The public profile grid (`/v2/creators/:id/stories`) is not reused: it answers "what this person
	 * shared" and deliberately excludes private work (even for the owner, who must be able to check
	 * how their profile looks from outside), while this answers "what I own" and must include private
	 * and archived work (without archived rows there is no way to restore). Building on the profile
	 * resource shows half the list, and loosening its predicate would leak others' private work.
	 *
	 * The gallery (`GET /v2/stories`) does not get a creator filter back: it is a discovery resource
	 * with search, rating, adult display, blocks and following, and ownership is not one of those axes
	 * (`contracts/gallery.ts` `StoriesQuery` explains why the parameter was dropped).
	 *
	 * The gate is `requireViewer`: sanctions block outward writes, and a suspended creator must still
	 * read the state of their own assets (as `/me/account` and `/me/moderation` already decided);
	 * blocking the read would leave them unable to learn why their work is not visible.
	 *
	 * No slot names the owner anywhere, and `CreatorWorksQuery` has no such field.
	 */
	.get("/stories", async (c) => {
		const viewer = requireViewer(await getViewer(c));

		const sp = new URL(c.req.url).searchParams;
		const int = (key: string): number | undefined => {
			const raw = sp.get(key);
			if (raw === null) return undefined;
			const n = Number(raw);
			// Passing fractions/NaN/Infinity through as undefined would apply the default and hide the typo.
			return Number.isSafeInteger(n) ? n : Number.NaN;
		};
		const parsed = CreatorWorksQuery.safeParse({
			page: int("page"),
			pageSize: int("pageSize"),
		});
		if (!parsed.success) throw invalidInput(parsed.error);
		const q = parsed.data;

		const { items, total } = await listOwnedStories({
			ownerId: viewer.id,
			page: q.page,
			pageSize: q.pageSize,
		});

		const body: CreatorWorksPage = {
			items,
			total,
			page: q.page,
			pageSize: q.pageSize,
			// An empty result is still one page: the contract is min(1), and 0 would make the client's `page
			// < pageCount` check read as having no first page.
			pageCount: Math.max(1, Math.ceil(total / q.pageSize)),
		};
		/**
		 * Private to the owner, hence `no-store`, stronger than the profile grid's `private, no-cache`:
		 * that grid lists public works, while this carries titles of not-yet-public works (same as the
		 * notification list).
		 */
		c.header("Cache-Control", "private, no-store");
		return c.json(body);
	})

	.patch("/nickname", async (c) => {
		const viewer = requireActiveViewer(await getViewer(c));
		const parsed = NicknameUpdateDto.safeParse(
			await c.req.json().catch(() => null),
		);
		if (!parsed.success) throw invalidInput(parsed.error);
		return c.json(
			await updatedViewerDto(
				viewer.id,
				{ nickname: parsed.data.nickname },
				toViewerDto(viewer),
			),
		);
	})

	/**
	 * Bio change, a value shown on the public profile.
	 *
	 * Same gate as nickname (`requireActiveViewer`): both are outward-facing, and a suspended account
	 * that can publish new sentences defeats the suspension. This differs from the adult display
	 * setting's `requireViewer`, which only reduces what the member sees (`routes/me/index.test.ts`
	 * locks the asymmetry).
	 *
	 * Returns the public profile, not the viewer. The bio is not in `ViewerDto` and will not be: `/me`
	 * is the hottest read (root SSR, header, auth guard) and one account screen's value would ride in
	 * every route's HTML. Returning the exact cell this write fixes lets the screen seat the response
	 * in the public profile cache.
	 *
	 * A vanished member row (same-moment deletion) is practically unreachable since the viewer is
	 * already confirmed; the `!` assertion is avoided so reaching it gives an accurate message instead
	 * of a 500.
	 */
	.patch("/bio", async (c) => {
		const viewer = requireActiveViewer(await getViewer(c));
		const parsed = BioUpdateDto.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) throw invalidInput(parsed.error);

		const profile = await updateOwnBio(viewer.id, parsed.data.bio);
		if (!profile) throw notFound("Member not found.");
		const body: PublicProfileDto = profile;
		return c.json(body);
	})

	/**
	 * Adult content display opt-in.
	 *
	 * Turning on needs identity verification and age 19+. Turning off is always allowed so an account
	 * that lost eligibility can still switch it off.
	 */
	.patch("/show-adult", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		const parsed = ShowAdultUpdateDto.safeParse(
			await c.req.json().catch(() => null),
		);
		if (!parsed.success) throw invalidInput(parsed.error);
		const { showAdult } = parsed.data;
		/**
		 * Children are filtered only when turning on, per this route's rule that off is always allowed
		 * (an account that became under 14 through a late age declaration must still be able to switch it
		 * off).
		 *
		 * `isAdultVerified` already filters children, but this stands first for the reason given: the 400
		 * below means "complete adult verification and you are fine", which is false for an under-14.
		 */
		if (showAdult) requireNonChild(viewer, "adult");
		if (showAdult && !isAdultVerified(viewer))
			throw invalidInput({
				issues: [
					{
						path: ["showAdult"],
						message:
							"Only members who completed adult verification can turn this on.",
					},
				],
			});
		return c.json(
			await updatedViewerDto(
				viewer.id,
				{ show_adult: showAdult },
				toViewerDto(viewer),
			),
		);
	});
