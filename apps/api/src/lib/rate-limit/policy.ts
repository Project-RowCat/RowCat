import {
	ADULT_VERIFICATION_ERROR_CODE,
	APPEAL_ERROR_CODE,
	CHAT_ERROR_CODE,
	GUARDIAN_ERROR_CODE,
	REPORT_ERROR_CODE,
	SETUP_ERROR_CODE,
	STORY_COMMENT_ERROR_CODE,
	STORY_PLAY_START_ERROR_CODE,
	SYNC_ERROR_CODE,
} from "@rowcat/contracts";
import { REMOTE_IMAGE_BUDGET } from "../remote-image/budget.ts";

/**
 * Rate-limit policies. This file is the only source of limits.
 *
 * Pure: no Redis, Hono or database. A policy says how often; the store counts and the limiter
 * rejects, so changing one limit never means reading Redis code.
 *
 * Limits used to be scattered (`BURST` in `services/comments.ts`, `REPORT_BURST` in
 * `services/moderation.ts`, `VERIFY_BURST` in `routes/guardian.ts`), each reimplementing window
 * math, 429 assembly and `Retry-After`, two counting database rows and one counting process memory.
 * Answering "what is this deployment's limit" meant opening three files, and with two replicas none
 * of them held.
 *
 * A policy answers four things:
 *
 * ```text
 * how often         max, windowMs
 * about what        subject
 * store down        onStoreFailure (the policy's decision, not the route's)
 * how to reject     code, message (already-deployed clients read these)
 * ```
 */

/**
 * What is counted. This vocabulary is the trust boundary: every value is a server-trusted identity
 * (member id from the session, guardian request id from a server-side existence check), hashed
 * before reaching a store key (`limiter.ts`).
 *
 * IP is deliberately absent. This deployment has no authoritative IP extraction; the one
 * `X-Forwarded-For` reader (`viewerKey` in `lib/http.ts`) is acceptable only because forging it
 * just inflates a view count. A limiter on a forgeable header is bypassed with one header and
 * blocks only honest users. Trusting an IP would require pinning which proxy this deployment sits
 * behind and verifying it, a separate decision nobody has asked for. Keeping IP out of the
 * vocabulary makes "just use the header for now" a type error, so unauthenticated endpoints (login,
 * signup) are not covered here (`index.ts` header).
 */
export type RateLimitSubjectKind =
	/** RowCat member id resolved from the session; no path lets the request body supply it. */
	| "member"
	/** Verified guardian consent request row id; an arbitrary path token cannot become it. */
	| "guardian-consent-request"
	/**
	 * The deployment itself, one counter for everyone. Only for a door that has no member yet and
	 * opens only to requests from this computer (`claim-local`): there is no identity to count by, and
	 * every caller it admits is the same machine anyway.
	 */
	| "deployment";

/**
 * What to do when the counter store cannot be read. Living in the policy is the point: per-route
 * try/catch would give different answers to one question.
 *
 * ```text
 * allow   pass on store failure  - losing the limiter is cheaper than blocking users
 * deny    reject on store failure - running without the limiter costs more than a brief block
 * ```
 *
 * `deny` is a 503, not a 429 (`limiter.ts`): the client did nothing, and a 429 would make the user
 * think they were too fast.
 */
export type RateLimitFailureMode = "allow" | "deny";

export interface RateLimitPolicy {
	/** Store key namespace and policy name. Must be unique (`policy.test.ts` checks); it is the only thing keeping counters apart. */
	readonly name: string;
	/** Maximum within the window, in `unit`; reaching it succeeds, the next is rejected. */
	readonly max: number;
	/**
	 * Absent means requests (nearly all policies). A `bytes` policy must go through
	 * `reserveRateLimit`, never `checkRateLimit` (`policy.test.ts` scans the pairing), or each request
	 * counts as 1 byte and blocks nothing.
	 */
	readonly unit?: "requests" | "bytes";
	readonly windowMs: number;
	readonly subject: RateLimitSubjectKind;
	readonly onStoreFailure: RateLimitFailureMode;
	/**
	 * Machine-readable code of the 429. Boundaries that already have a domain code keep it: swapping
	 * in a shared one would break deployed screens (web `comment-error.ts` and `report-error.ts`
	 * branch on these), dropping those failures into the default branch with no compile error.
	 */
	readonly code: string;
	/** User-visible sentence; the wait time travels in `Retry-After`. */
	readonly message: string;
}

/**
 * Every policy in this deployment. Adding one means adding a line here and a call site that checks
 * it; a name with no checking caller blocks nothing while looking like it does (same rule as
 * `ModerationCapability` and feature-switch keys; `policy.test.ts` guards the pairing).
 */
export const RATE_LIMIT_POLICIES = {
	/**
	 * Play-start recording, the floor of the telemetry. An honest person does not exceed a few dozen
	 * starts per 10 minutes. Same-session retries are already folded by the idempotency key, so this
	 * catches scripts sending rotating keys to push their own work up the ranking; entitlement
	 * checking stands in front of it. Fail-open: the worst loss is a few ranking places, reversible.
	 */
	storyPlayStart: {
		name: "story-play-start",
		max: 60,
		windowMs: 10 * 60_000,
		subject: "member",
		onStoreFailure: "allow",
		code: STORY_PLAY_START_ERROR_CODE.rateLimited,
		message:
			"Play starts were recorded too often. Please try again in a moment.",
	},
	/**
	 * Comment burst, moved over unchanged: 5 / 30 s / author, the old `BURST` in
	 * `services/comments.ts` (which counted `story_comment` rows and called itself a floor, not a
	 * distributed limiter). Infrastructure and product-rule changes stay out of one commit so nobody
	 * is unable to say which caused a user-visible change. The target is a script pushing dozens per
	 * second, not someone quickly writing two lines. Fail-open: the worst loss is a few spam lines,
	 * which moderation already handles.
	 */
	storyCommentCreate: {
		name: "story-comment-create",
		max: 5,
		windowMs: 30_000,
		subject: "member",
		onStoreFailure: "allow",
		code: STORY_COMMENT_ERROR_CODE.rateLimited,
		message: "You're commenting too fast. Please try again in a moment.",
	},

	/**
	 * Comment reaction burst; like and unlike share one window. Separate from creating comments
	 * because honest rates differ: tapping hearts while scanning a list easily exceeds five per 30
	 * seconds, and sharing a window would let hearts block comment writing. A limit is still needed
	 * because this is the cheapest write and a script can send hundreds per second. On/off are not
	 * counted separately since toggling repeatedly is exactly the pattern. Fail-open: the unique
	 * constraint already keeps counts correct.
	 */
	storyCommentReact: {
		name: "story-comment-react",
		max: 60,
		windowMs: 60_000,
		subject: "member",
		onStoreFailure: "allow",
		code: STORY_COMMENT_ERROR_CODE.reactionRateLimited,
		message: "You're reacting too fast. Please try again in a moment.",
	},

	/**
	 * Report filing, moved over unchanged: 10 / 10 min / reporter (the old `REPORT_BURST` in
	 * `services/moderation.ts`, which counted `moderation_report`). Fail-open because reporting is a
	 * safety feature: blocking it on a store outage would remove a harassed person's way to tell us.
	 * Operators can see mass-reporting in the queue; a report that never arrived nobody can see.
	 */
	reportCreate: {
		name: "report-create",
		max: 10,
		windowMs: 600_000,
		subject: "member",
		onStoreFailure: "allow",
		code: REPORT_ERROR_CODE.rateLimited,
		message: "You've filed too many reports. Please try again in a moment.",
	},

	/**
	 * Guardian identity verification attempts, moved over (10 / 10 min / request) but with a different
	 * store: the old `VERIFY_BURST` in `routes/guardian.ts` counted a process-memory `Map` keyed by
	 * the raw token, which doubled with two replicas and vanished on deploy.
	 *
	 * Fail-closed: each attempt makes a paid verification call and the procedure ends in opening a
	 * child account (`docs/membership/ARCHITECTURE.md`). A real guardian does this once or twice in a
	 * lifetime, so a few minutes blocked is cheap, while an unlimited endpoint would amplify our
	 * authority's quota.
	 *
	 * Only the request row id obtained after DB token validation is counted, so an invalid token
	 * cannot create a counter key and several token forms of one request share one budget.
	 *
	 * The code stays `verificationFailed` because the 429 already went out under it; changing it would
	 * silently fork the guardian screen's branching.
	 */
	guardianVerify: {
		name: "guardian-verify",
		max: 10,
		windowMs: 600_000,
		subject: "guardian-consent-request",
		onStoreFailure: "deny",
		code: GUARDIAN_ERROR_CODE.verificationFailed,
		message:
			"Too many identity verification attempts. Please try again in a moment.",
	},

	/**
	 * A member's own adult-eligibility verification: new policy, 10 / 10 min / member. Another
	 * consumer of the same capability as guardian verification (`services/identity/`), fail-closed for
	 * the same reasons (paid external call, once per lifetime).
	 *
	 * The whole procedure shares one budget: both start (`POST /`) and confirm (`POST /verify`) count
	 * here. Separate limits would allow "start works but confirm is blocked", so the person reaches
	 * the authority's window and is rejected on return. 10 absorbs up to five closed-and-reopened
	 * windows (a procedure is start + confirm = 2); beyond that it is not a person.
	 */
	adultVerification: {
		name: "adult-verification",
		max: 10,
		windowMs: 600_000,
		subject: "member",
		onStoreFailure: "deny",
		code: ADULT_VERIFICATION_ERROR_CODE.rateLimited,
		message:
			"Too many identity verification attempts. Please try again in a moment.",
	},

	/**
	 * Managed generation rate: 30 / 1 min / member. Managed generation runs on the operator's key and
	 * is unmetered, so this, the daily cap below and the stream wall-clock cap
	 * (`MANAGED_GENERATION_WALL_CLOCK_MS`) are the only server-side guards on one member burning it.
	 *
	 * The route runs the limiter before the upstream call, so a rejected request never goes out.
	 *
	 * Fail-closed. It was once fail-open on the grounds that a balance reservation stood behind it;
	 * that reservation is gone, so passing while the store is down would open the key without a
	 * ceiling.
	 *
	 * 30 / min is unreachable by a person (a turn is one stream, and regenerate/edit on top stay under
	 * thirty). An open stream does not count again; it is counted once at request start.
	 */
	managedGeneration: {
		name: "managed-generation",
		max: 30,
		windowMs: 60_000,
		subject: "member",
		onStoreFailure: "deny",
		code: CHAT_ERROR_CODE.rateLimited,
		message:
			"Generation requests are too frequent. Please try again in a moment.",
	},

	/**
	 * Managed generation daily cap: 400 / 24 h / member. The per-minute cap alone would still allow
	 * 40k per day at thirty a minute. This is the ceiling on what one member can charge the operator's
	 * key; deployments afford different amounts, so operators edit it in this table. The window runs
	 * 24 hours from the first request, not from midnight (how the limiter's windows work).
	 */
	managedGenerationDaily: {
		name: "managed-generation-daily",
		max: 400,
		windowMs: 86_400_000,
		subject: "member",
		onStoreFailure: "deny",
		code: CHAT_ERROR_CODE.rateLimited,
		message:
			"You've used all of today's generations. Please try again tomorrow.",
	},

	/**
	 * Device-pairing session creation: new policy, 10 / 10 min / member. Prevents minting unlimited
	 * pairing sessions. Each is a relay row (`sync_pairing`), and a new request never replaces an open
	 * one — open sessions end only by expiry, cancel or approval — so this limit is what keeps one
	 * session of the account from holding every slot of `pairingMaxActive` open.
	 *
	 * Status lookup (`/pairing/status`) deliberately has no policy: it is a designed poll about every
	 * 2 seconds while the screen is open, and a limit would block honest users mid-pairing.
	 *
	 * Fail-open: this is the first step of a five-minute procedure the user is waiting on, and
	 * blocking it on a store outage would remove their way to move data to a new device.
	 */
	syncPairingCreate: {
		name: "sync-pairing-create",
		max: 10,
		windowMs: 600_000,
		subject: "member",
		onStoreFailure: "allow",
		code: SYNC_ERROR_CODE.pairingRateLimited,
		message: "Pairing was started too often. Please try again in a moment.",
	},
	/**
	 * Start of guardian verification, with a budget separate from confirm (`guardianVerify`). Confirm
	 * makes the paid call, so its limit is the cost ceiling, and sharing it would let ordinary
	 * close-and-reopen retries eat that budget. Start needs its own limit because it is an
	 * unauthenticated path needing only a token and would become a paid-call amplifier the day the
	 * adapter reserves a transaction at start. Fail-closed, same as confirm.
	 */
	guardianBegin: {
		name: "guardian-begin",
		max: 20,
		windowMs: 600_000,
		subject: "guardian-consent-request",
		onStoreFailure: "deny",
		code: GUARDIAN_ERROR_CODE.verificationFailed,
		message:
			"Identity verification was started too often. Please try again in a moment.",
	},
	/**
	 * Image uploads: avatars, covers and scene images are one policy. These are the API's most
	 * expensive requests (decode, resize, re-encode, tens of MB of pixels per request). The
	 * per-request budget was well measured but nothing counted the total, so one member uploading
	 * repeatedly could take the process down. Kinds are not split because the cost axis is the same
	 * (the decode slot in `lib/media/image.ts` counts concurrency). Fail-open: being unable to change
	 * an avatar costs more than the limiter failing.
	 */
	mediaUpload: {
		name: "media-upload",
		max: 20,
		windowMs: 600_000,
		subject: "member",
		onStoreFailure: "allow",
		code: "media_rate_limited",
		message: "Images were uploaded too often. Please try again in a moment.",
	},

	/**
	 * Appeal creation: `requireViewer`, so sanctioned accounts call it too. One open appeal per action
	 * keeps the abuse scope narrow, but each attempt costs a lookup and a unique-constraint round
	 * trip.
	 */
	appealCreate: {
		name: "appeal-create",
		max: 5,
		windowMs: 600_000,
		subject: "member",
		onStoreFailure: "allow",
		code: APPEAL_ERROR_CODE.rateLimited,
		message: "Appeals were attempted too often. Please try again in a moment.",
	},
	/**
	 * Creator-runtime remote image proxy: new policy, 240 / 1 min / member. One request here is one
	 * outbound request from our server. A session is required (401 for guests), but that does not cap
	 * volume: one member scripting it would turn us into a bandwidth proxy for someone else's CDN.
	 *
	 * 240 is unreachable by a person: one runtime screen can request dozens of images at once and
	 * clients cache the results, so several screen changes stay under it. Above it is a loop.
	 *
	 * Fail-open: images all turning into placeholders on a store blip costs more than losing volume
	 * defense for those minutes; the proxy's SSRF, format, size and deadline checks hold per request
	 * regardless.
	 */
	runtimeRemoteAsset: {
		name: "runtime-remote-asset",
		max: 240,
		windowMs: 60_000,
		subject: "member",
		onStoreFailure: "allow",
		code: "runtime_asset_rate_limited",
		message: "Images were requested too often. Please try again in a moment.",
	},

	/**
	 * Byte budget of the remote image proxy, covering the volume the count limit above could not:
	 * counts alone allowed 2.4 GiB/min (240 x 10 MiB) per member. Each request reserves the response
	 * cap on entry (admission is one atomic increment) and gives back what was not read
	 * (`reserveRateLimit`). The numbers' derivation is in `lib/remote-image/budget.ts`.
	 *
	 * The code equals the count limit's (`runtime_asset_rate_limited`): the client's action is the
	 * same (wait), and a new name would become a detector for which limit was hit. Fail-open for the
	 * same reason.
	 */
	runtimeRemoteAssetBytes: {
		name: "runtime-remote-asset-bytes",
		max: REMOTE_IMAGE_BUDGET.bytesPerWindow,
		windowMs: REMOTE_IMAGE_BUDGET.windowMs,
		unit: "bytes",
		subject: "member",
		onStoreFailure: "allow",
		code: "runtime_asset_rate_limited",
		message: "Too many images were received. Please try again in a moment.",
	},

	/**
	 * First-run setup claim. The code carries 60 bits, so this is not what keeps it from being guessed;
	 * it keeps a script from spending the claim route's lock in a loop. Subject is the member (IP is not
	 * a subject here), and every attempt counts, right or wrong. Fail-open: the code's entropy stands
	 * whether or not the counter does, and setup is used once per deployment.
	 */
	/**
	 * The local claim has no member to count by (it creates one), so it counts the deployment: ten wrong
	 * codes in ten minutes from this computer, then wait. Same numbers as the account claim.
	 */
	setupClaimLocal: {
		name: "setup-claim-local",
		max: 10,
		windowMs: 10 * 60_000,
		subject: "deployment",
		onStoreFailure: "allow",
		code: SETUP_ERROR_CODE.rateLimited,
		message: "Too many setup attempts. Please try again in a few minutes.",
	},
	setupClaim: {
		name: "setup-claim",
		max: 10,
		windowMs: 10 * 60_000,
		subject: "member",
		onStoreFailure: "allow",
		code: SETUP_ERROR_CODE.rateLimited,
		message: "Too many setup attempts. Please try again in a few minutes.",
	},
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitPolicyKey = keyof typeof RATE_LIMIT_POLICIES;
