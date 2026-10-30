import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { admin } from "./admin/index.ts";
import { chat } from "./chat.ts";
import { creators } from "./creators.ts";
import { guardian } from "./guardian.ts";
import { health } from "./health.ts";
import { me } from "./me/index.ts";
import { media } from "./media.ts";
import { mobileUpdateJobReports } from "./mobile-update-jobs.ts";
import { mobileUpdates } from "./mobile-updates.ts";
import { moderation } from "./moderation.ts";
import { reports } from "./reports.ts";
import { runtimeAssets } from "./runtime-assets.ts";
import { runtimeConfig } from "./runtime-config.ts";
import { setup } from "./setup.ts";
import { blocks, favorites, follows } from "./social.ts";
import { stories } from "./stories/index.ts";

/**
 * Routers under `/v2`. Each route exports a bare `new Hono()` and is mounted only here, so path
 * prefixes stay in one place and the RPC types (`hono/client`) match the real URLs.
 */
export const routes = new Hono<AppEnv>()
	.route("/health", health)
	/**
	 * Public runtime config: the only product resource without a session.
	 *
	 * Not under `/me` because it is called before login (first run and the login screen need to know
	 * that signup is closed), and the value is identical for everyone, so it sits in shared caches.
	 * Kept apart from `/admin/operations/*`, which reads the same settings but carries operator
	 * identity and internal reasons.
	 */
	.route("/runtime-config", runtimeConfig)
	/**
	 * First-run setup: the one route that makes someone an admin, gated by a code printed only to this
	 * process's log and closed for good once used (`services/setup/index.ts`). Not under `/me` — that
	 * prefix is the member's own state, and a role write there is exactly what stays forbidden — and
	 * not under `/admin`, whose callers already hold the role this grants.
	 */
	.route("/setup", setup)
	/**
	 * Remote image proxy for the creator runtime; requires a session.
	 *
	 * Separate from `/media` because the bytes have a different owner: that route serves bytes we
	 * stored (immutable, publicly cached), while this fetches a creator's external image per request
	 * with destination checks, deadlines, caps and short caching. Merged, the media route's immutable
	 * cache rules could leak onto this one.
	 */
	.route("/runtime/assets", runtimeAssets)
	.route("/chat", chat)
	.route("/me", me)
	/**
	 * Media bytes: a public, read-only resource.
	 *
	 * Not under `/me` because the caller is not the owner: avatars are drawn in public profiles,
	 * comments and notifications, so guests and other members read them without a session. Writes
	 * belong to the domain that owns the media (`/me/avatar`); an open `POST` here would let the
	 * client decide what the bytes are for, making policy a value that rides along with the request.
	 */
	.route("/media", media)
	.route("/stories", stories)
	/**
	 * Public profile. It concerns the same members as `/me` but on the opposite axis ("the requester's
	 * own" vs "visible to anyone"); one prefix would erase that split and make private fields leaking
	 * into public responses expressible.
	 */
	.route("/creators", creators)
	/**
	 * Report intake: one endpoint taking the target kind as a discriminated union. Per-target paths
	 * would give four near-identical handlers, and AI responses have no resource path to attach to.
	 */
	.route("/reports", reports)
	/**
	 * Operations tools. The prefix stays apart from `/reports` (anyone may file) so "filing" and
	 * "reading" reports do not read as one resource; their authorization is opposite.
	 */
	.route("/moderation", moderation)
	/**
	 * Guardian consent: the only member-eligibility path outside `/me`.
	 *
	 * The caller is not a member but holds a one-time link from the child, so `/me` would make "the
	 * requester's own" false and make a child's session confirming its own consent expressible.
	 */
	.route("/guardian", guardian)
	/**
	 * Mobile OTA manifest: another resource without a session. The caller is the installed app's
	 * `expo-updates`, and the answer depends on the binary (platform, runtime, channel, trust key),
	 * not an account. Registration (where new code enters) is not on HTTP; it is a release-environment
	 * process (`services/mobile-updates/cli.ts`). Rollout, pause, resume and publish requests live
	 * under `/admin/mobile-updates` and `/admin/mobile-update-jobs`.
	 */
	.route("/mobile/updates", mobileUpdates)
	/**
	 * CI reports for mobile OTA publish jobs, authenticated by a GitHub Actions OIDC token rather than
	 * a session. Kept apart from the console's requests (`/admin/mobile-update-jobs`) because the
	 * direction of authorization differs.
	 */
	.route("/mobile/update-jobs", mobileUpdateJobReports)
	/**
	 * Operations console. Kept apart from `/moderation` (enforcement): this prefix is reads and
	 * operational settings, and enforcement still goes through that one route, so the rule against a
	 * second moderation system shows in the paths too.
	 */
	.route("/admin", admin)
	.route("/favorites", favorites)
	.route("/follows", follows)
	.route("/blocks", blocks);
