/**
 * Which backend an EAS build profile points at. This one rule is the whole of this file.
 *
 * The app has no default API origin (neither does `@rowcat/sdk`). There was a time when the
 * production origin was the default and the rule was built around that constant: "a production
 * build left blank goes to production". That constant was the address of one operator who ran this
 * repository, and a binary defaulting to it becomes **another operator's production client** the
 * moment a fork builds it. So the floor of the rule is now: **an EAS build must name its own
 * backend, and that name must not be a placeholder.**
 *
 * ```text
 * every profile   EXPO_PUBLIC_API_ORIGIN required · stops if it is a placeholder (example.com-style)
 *                 EXPO_PUBLIC_WEB_ORIGIN may be empty (links are then not drawn) but stops if placeholder
 * testflight      **stops if it equals the API origin the production profile declares in eas.json**
 * ```
 *
 * ## Why placeholders are rejected
 *
 * The public repo's `eas.json` holds placeholders such as `https://api.example.com` (RFC 2606). If
 * such a value passed the build, a fork that forgot to fill it in would ship a binary that reaches
 * nothing. That shows up only after review, as the first user's "the app does not open", and fixing
 * it means rebuilding the binary (OTA also asks that origin). A line in the build log is cheaper.
 *
 * ## Why TestFlight must not point at the production API
 *
 * A TestFlight build is a pre-release trial that goes through the store review path. It is paired
 * with server changes not yet shipped to production, and testers press sign-up, delete and publish
 * freely in it. If it pointed at production, those side effects would land in real member data, and
 * screens expecting a contract not yet in production would attach to the production server. This
 * rule was once justified by in-app purchase (Sandbox receipts); purchases have been removed, and
 * this is the remaining reason.
 *
 * The comparison baseline is a **committed value**: the API origin the production profile declares
 * in `eas.json`. If it is missing, the TestFlight build cannot be judged and stops. A value kept
 * only as a secret on the EAS server is invisible to this check, and treating what it cannot see as
 * a pass would make the rule block nothing.
 *
 * ## Why this is not in `app.config.ts`
 *
 * Expo's config evaluation must not depend on workspace package resolution, so that file imports no
 * workspace packages (the header of `app-identity.test.ts` records the same decision). The rule
 * therefore lives here, and that file carries a self-contained second copy. **That the two
 * implementations give the same answer is checked by a test running the same matrix against both**
 * (`build-profile.test.ts`). It compares behaviour, not strings, so a commit changing only one side
 * cannot pass.
 */

/**
 * The four profiles built. **The axis that separates `testflight` from `preview` is distribution.**
 *
 * ```text
 * development   development client        internal   developer devices
 * preview       internal app QA           internal   release build, but does not pass the store
 * testflight    pre-release trial         store      App Store Connect → TestFlight
 * production    store release             store      App Store
 * ```
 *
 * Only the last two go through App Store Connect, so they are where the **store review path
 * actually runs**. `preview` is not reused for that purpose: folding the two concepts into one
 * profile makes "I changed the origin for internal QA, and that turned out to be a TestFlight
 * build" representable.
 */
export const EAS_BUILD_PROFILES = [
	"development",
	"preview",
	"testflight",
	"production",
] as const;

export type EasBuildProfile = (typeof EAS_BUILD_PROFILES)[number];

export const isEasBuildProfile = (value: string): value is EasBuildProfile =>
	(EAS_BUILD_PROFILES as readonly string[]).includes(value);

/**
 * What a profile requires of its API origin.
 *
 * ```text
 * explicit         must be stated (the build decides which deployment it is)
 * non-production   must be stated, and **must not be the origin of the production profile**
 * ```
 *
 * Only `testflight` is `non-production`, deliberately. Forbidding the production origin for
 * internal distribution profiles too would remove the legitimate "QA build that checks screens
 * against production data". That build does not pass the store, so it is not where this axis guards
 * against the accident.
 */
export type ApiOriginRule = "explicit" | "non-production";

export const EAS_PROFILE_API_ORIGIN_RULE: Record<
	EasBuildProfile,
	ApiOriginRule
> = {
	development: "explicit",
	preview: "explicit",
	testflight: "non-production",
	production: "explicit",
};

/**
 * The rule for an unknown profile: state the origin. Adding a profile has repeatedly been missed in
 * this file, and the safe default in that case is "state it".
 */
export const UNKNOWN_PROFILE_RULE: ApiOriginRule = "explicit";

export const apiOriginRuleFor = (profile: string): ApiOriginRule =>
	isEasBuildProfile(profile)
		? EAS_PROFILE_API_ORIGIN_RULE[profile]
		: UNKNOWN_PROFILE_RULE;

/** Compares two origins, folding trailing slashes and case. Unparseable values are never equal. */
export const sameOrigin = (left: string, right: string): boolean => {
	try {
		return new URL(left).origin === new URL(right).origin;
	} catch {
		return false;
	}
};

/**
 * Names RFC 2606 reserves for examples. The placeholders in the public repo's `eas.json` belong
 * here.
 *
 * `.test` and `localhost` are not included: developers use them for real (a development client
 * pointing at `api.rowcat.test` on private DNS is legitimate), and rejecting them would block valid
 * builds. Only names **nobody can actually serve** are listed.
 */
const PLACEHOLDER_DOMAINS = ["example.com", "example.net", "example.org"];
const PLACEHOLDER_TLDS = ["example", "invalid"];

/** Whether this origin is an unfilled placeholder. An unparseable value is not a placeholder; it is a different failure. */
export const isPlaceholderOrigin = (origin: string): boolean => {
	let host: string;
	try {
		host = new URL(origin).hostname.toLowerCase();
	} catch {
		return false;
	}
	return (
		PLACEHOLDER_DOMAINS.some(
			(domain) => host === domain || host.endsWith(`.${domain}`),
		) || PLACEHOLDER_TLDS.some((tld) => host.endsWith(`.${tld}`))
	);
};

export interface EasBuildEnvironment {
	EAS_BUILD?: string | undefined;
	EAS_BUILD_PROFILE?: string | undefined;
	EXPO_PUBLIC_API_ORIGIN?: string | undefined;
	EXPO_PUBLIC_WEB_ORIGIN?: string | undefined;
}

/**
 * Repository facts the decision needs. These are **committed values**, not environment variables.
 *
 * `productionApiOrigin` is `build.production.env.EXPO_PUBLIC_API_ORIGIN` from `eas.json`. Callers
 * read the file and pass it in (`app.config.ts`, `scripts/ota/environment.ts`). If this function
 * read the file it would not be a pure rule, and tests could not substitute the baseline.
 */
export interface EasBuildContext {
	productionApiOrigin?: string | undefined;
}

/**
 * Whether this build must stop: returns the reason if so, otherwise `null`.
 *
 * **Only applies to EAS builds.** `expo start`, `prebuild` and tests do not reach this condition;
 * local development fills values from `.env` or the shell. Rejecting placeholders there too would
 * force a config file just to change one screen (instead, `src/lib/env.ts` reports a missing origin
 * when the app starts).
 *
 * The order of checks is the order of the messages: missing → placeholder → placeholder web origin
 * → overlap of TestFlight with the production origin. `app.config.ts` emits the same messages in
 * the same order.
 */
export function checkEasBuildEnvironment(
	env: EasBuildEnvironment,
	context: EasBuildContext = {},
): string | null {
	if (env.EAS_BUILD !== "true") return null;

	const profile = env.EAS_BUILD_PROFILE?.trim();
	if (!profile) return null;

	const origin = env.EXPO_PUBLIC_API_ORIGIN?.trim() ?? "";
	const webOrigin = env.EXPO_PUBLIC_WEB_ORIGIN?.trim() ?? "";
	const rule = apiOriginRuleFor(profile);

	if (!origin)
		return (
			`EAS profile "${profile}" has no EXPO_PUBLIC_API_ORIGIN — ` +
			"this app has no default API origin. Put the origin of the deployment this build talks to " +
			"in that profile's env in eas.json."
		);

	if (isPlaceholderOrigin(origin))
		return (
			`EXPO_PUBLIC_API_ORIGIN (${origin}) in EAS profile "${profile}" is a placeholder — ` +
			"the public repository's eas.json holds only example.com-family placeholders. " +
			"Replace it with this deployment's real API origin."
		);

	if (webOrigin && isPlaceholderOrigin(webOrigin))
		return (
			`EXPO_PUBLIC_WEB_ORIGIN (${webOrigin}) in EAS profile "${profile}" is a placeholder — ` +
			"the account deletion guide, guardian consent and password reset links lead nowhere. " +
			"Replace it with this deployment's real web origin or leave it empty (empty means the links aren't drawn)."
		);

	if (rule === "non-production") {
		const production = context.productionApiOrigin?.trim() ?? "";
		if (!production)
			return (
				`can't decide that EAS profile "${profile}" doesn't point at the production API — ` +
				"the production profile in eas.json has no EXPO_PUBLIC_API_ORIGIN. " +
				"Write that value in eas.json (kept as an EAS server secret, this check can't see it)."
			);
		if (sameOrigin(origin, production))
			return (
				`EAS profile "${profile}" points at the production backend (EXPO_PUBLIC_API_ORIGIN) — ` +
				"TestFlight is a pre-release build, so sign-ups, deletions and publishes pressed in it land on real member " +
				"data. Use the origin of a non-production deployment (staging)."
			);
	}

	return null;
}
