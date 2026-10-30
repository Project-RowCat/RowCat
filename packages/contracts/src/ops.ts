import { z } from "zod";

/**
 * Remote operations config: a few server-owned switches.
 *
 * This file covers two things. Both answer what this deployment accepts right now:
 * - Feature switches (ops_feature_flag) close risky backend operations immediately.
 * - Minimum app version (ops_app_version_floor) sends old mobile apps back to the store.
 *
 * Not a general config platform. Free-form key and JSON config makes unverifiable states
 * expressible. One typo creates a row that no route reads, and the screen shows it as set. The
 * operator believes the feature is off while the server keeps running. So the vocabulary is fixed
 * here, and unknown keys are rejected on write (fail-closed).
 *
 * Adding a key must land in the same commit as the route that checks it. A key with no checking
 * route only looks like it blocks something. Same rule as ModerationCapability.
 *
 * Not here:
 * - Secrets, connection strings and credentials. env.ts holds them and validates at boot. Making
 *   them runtime-changeable would send them through audit logs, responses and screens.
 * - A/B experiments, rollout percentages or audience targeting. A ratio requires knowing who is
 *   in which group, so the server gate would look up each member on every request. That is a
 *   different slice.
 * - Operator identity. The audit log (admin_audit_log) owns who changed what. Putting it in the
 *   config response would open a leak path into public runtime config.
 */

/**
 * Features a switch can apply to. A closed vocabulary.
 *
 * Four keys, each backed by a server path that actually checks it:
 * - chat: POST /v2/chat/generate. Managed generation, sent on our key.
 * - publish: POST and PUT /v2/stories. Writes to the catalog.
 * - sync: POST /v2/me/sync/records. Push for encrypted sync.
 * - signup: POST /v2/auth/sign-up/*. Creating new member accounts.
 *
 * Limit: chat cannot block BYO generation, because that request never passes through this server.
 * Moderation omits a chat.generate capability for the same reason. The switch closes managed
 * generation only, and the comment says so plainly.
 */
export const FeatureFlagKey = z.enum(["chat", "publish", "sync", "signup"]);
export type FeatureFlagKey = z.infer<typeof FeatureFlagKey>;

/**
 * Three states. This is why default does not collapse into a boolean:
 * - default: follows this deployment's default. The operator has not touched it.
 * - on: explicitly enabled.
 * - off: explicitly disabled. The server rejects the operation.
 *
 * Merging default and on would make the operator having turned it on and nobody having touched it
 * the same value. Changing the product default would then also move deployments that were
 * explicitly set on. This matches settings and preferences, where `Use default` does not
 * copy the parent value.
 */
export const FeatureFlagState = z.enum(["default", "on", "off"]);
export type FeatureFlagState = z.infer<typeof FeatureFlagState>;

/**
 * Operator-facing labels and product defaults, in one registry.
 *
 * The screen must not keep its own list. With two lists, adding a key updates only one. The symptom
 * is that the operator cannot see the switch on the screen when they need to turn it off.
 *
 * All defaults are `on` today. These switches are circuit breakers, not feature-launch switches. A
 * default of off would first need a reason why the feature ships disabled.
 */
export interface FeatureFlagDefinition {
	key: FeatureFlagKey;
	defaultState: Extract<FeatureFlagState, "on" | "off">;
	label: string;
	/** What the server rejects while this switch is off. Written concretely, not in abstract terms. */
	description: string;
}

export const FEATURE_FLAGS: readonly FeatureFlagDefinition[] = [
	{
		key: "chat",
		defaultState: "on",
		label: "Managed conversation generation",
		description:
			"When off, POST /v2/chat/generate is refused. Generation with a personal API key (BYO) does not pass through our server and is not blocked.",
	},
	{
		key: "publish",
		defaultState: "on",
		label: "Story publishing",
		description:
			"When off, publishing stories and updating publications are refused. Draft editing on devices does not pass through the server and stays available.",
	},
	{
		key: "sync",
		defaultState: "on",
		label: "Encrypted sync push",
		description:
			"When off, POST /v2/me/sync/records is refused. Pull stays open: blocking a device from fetching its own data would hold the data hostage, not break a circuit.",
	},
	{
		key: "signup",
		defaultState: "on",
		label: "New sign-ups",
		description:
			"When off, new account sign-ups and member creation for accounts without a member row are refused. Existing members still sign in.",
	},
] as const;

const FLAG_BY_KEY = new Map(FEATURE_FLAGS.map((f) => [f.key, f]));

/** Definition lookup. The vocabulary is closed, so this never returns undefined. */
export const featureFlagDefinition = (
	key: FeatureFlagKey,
): FeatureFlagDefinition => {
	const found = FLAG_BY_KEY.get(key);
	if (!found) throw new Error(`Unknown feature switch: ${key}`);
	return found;
};

/**
 * Maps state to whether the switch is actually on. This one function is the only decision point.
 *
 * The server gate and the operator screen both call it. If they diverged, the screen could show off
 * while the server let requests through. That mismatch would surface only after an incident.
 */
export const isFeatureEnabled = (
	key: FeatureFlagKey,
	state: FeatureFlagState,
): boolean =>
	state === "default"
		? featureFlagDefinition(key).defaultState === "on"
		: state === "on";

/** Length cap for messages shown to users. One sentence for an outage notice, not a notice body. */
export const OPS_MESSAGE_MAX_LENGTH = 300;

export const FeatureFlagDto = z.object({
	key: FeatureFlagKey,
	state: FeatureFlagState,
	/** Derived, but the server sends it. The screen then does not need its own default table. */
	enabled: z.boolean(),
	/**
	 * Sentence shown to users while the switch is off. Empty means use the product default message.
	 */
	message: z.string(),
	updatedAt: z.iso.datetime().nullable(),
	/**
	 * Operator who last changed it. null once that operator withdraws (the record stays in the audit
	 * log).
	 */
	updatedBy: z.string().nullable(),
});
export type FeatureFlagDto = z.infer<typeof FeatureFlagDto>;

export const FeatureFlagsDto = z.object({
	items: z.array(FeatureFlagDto),
});
export type FeatureFlagsDto = z.infer<typeof FeatureFlagsDto>;

/**
 * Changes one switch. The key comes from the path.
 *
 * If the key were in the body, a request could express a mismatch between path and body. Comments
 * follow the same rule and do not take the story id in the body.
 */
export const FeatureFlagSetRequest = z.object({
	state: FeatureFlagState,
	message: z.string().trim().max(OPS_MESSAGE_MAX_LENGTH).default(""),
	/** Why the switch was changed. Recorded in the audit log, so it cannot be empty. */
	reason: z.string().trim().min(1).max(OPS_MESSAGE_MAX_LENGTH),
});
export type FeatureFlagSetRequest = z.infer<typeof FeatureFlagSetRequest>;

export const AppPlatform = z.enum(["ios", "android"]);
export type AppPlatform = z.infer<typeof AppPlatform>;

/**
 * Semantic version as MAJOR.MINOR.PATCH. Pre-release and build metadata are rejected.
 *
 * The reason is comparison. SemVer section 11 orders pre-release identifiers by comparing
 * dot-separated numbers and strings. If each client (web, iOS, Android, server) implements that,
 * one of them will get it wrong, and the error can lock users out of the app. Stores accept only
 * three version components, so only three are accepted.
 */
export const AppVersion = z
	.string()
	.regex(/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/, {
		message: "Must be MAJOR.MINOR.PATCH (e.g. 1.2.0).",
	});

/**
 * Compares two versions. Returns negative, zero or positive. Whatever enforces the floor must use
 * this one function.
 *
 * Nothing calls it yet, because mobile does not read the floor. It is here so that when enforcement
 * arrives, the server and clients do not each implement a comparison and get it wrong. A wrong
 * comparison here locks users out of the app.
 *
 * The inputs are assumed to pass the AppVersion regex, so parse failure is not represented. The
 * contract blocks the places where that assumption could break.
 */
export function compareAppVersions(a: string, b: string): number {
	const pa = a.split(".");
	const pb = b.split(".");
	for (let i = 0; i < 3; i++) {
		const diff = Number(pa[i] ?? 0) - Number(pb[i] ?? 0);
		if (diff !== 0) return diff < 0 ? -1 : 1;
	}
	return 0;
}

/**
 * Floor for one platform. minVersion null means there is no floor.
 *
 * null is used rather than an empty string for no floor. The value goes into the comparison, and
 * there `''` behaves like 0.0.0, so every version passes silently. If that leniency is accidental,
 * it may one day behave the opposite way by accident.
 */
export const AppVersionFloorDto = z.object({
	platform: AppPlatform,
	minVersion: AppVersion.nullable(),
	/** Copy the app shows when it requires an update. Empty means the app's default copy. */
	message: z.string(),
	updatedAt: z.iso.datetime().nullable(),
	updatedBy: z.string().nullable(),
});
export type AppVersionFloorDto = z.infer<typeof AppVersionFloorDto>;

export const AppVersionFloorsDto = z.object({
	items: z.array(AppVersionFloorDto),
});
export type AppVersionFloorsDto = z.infer<typeof AppVersionFloorsDto>;

/** Changes the floor. The platform comes from the path, the same rule as switches. */
export const AppVersionFloorSetRequest = z.object({
	/** null removes the floor. */
	minVersion: AppVersion.nullable(),
	message: z.string().trim().max(OPS_MESSAGE_MAX_LENGTH).default(""),
	reason: z.string().trim().min(1).max(OPS_MESSAGE_MAX_LENGTH),
});
export type AppVersionFloorSetRequest = z.infer<
	typeof AppVersionFloorSetRequest
>;

/**
 * Values the client reads at boot from GET /v2/runtime-config. Public.
 *
 * Only what the app needs to draw its screens: which features are off (so it does not draw dead
 * buttons), and the minimum supported version.
 *
 * Operator fields are not in this response. updatedBy, updatedAt and internal reasons have no place
 * in it. The guarantee comes from using a different type, not from a function that picks fields,
 * since omissions are easy to forget. This is the same decision as NotificationActionDto.
 *
 * This response is not authorization. A client that ignores a disabled feature and sends the
 * request anyway is rejected by the server. These values are a courtesy, not enforcement.
 */
export const RuntimeConfigDto = z.object({
	/**
	 * Only currently disabled features. Enabled ones are not listed, so the response does not grow as
	 * the vocabulary grows.
	 */
	disabledFeatures: z.array(
		z.object({ key: FeatureFlagKey, message: z.string() }),
	),
	minAppVersion: z.object({
		ios: AppVersion.nullable(),
		android: AppVersion.nullable(),
	}),
	/** Update notice copy. Not split by platform in V1. */
	updateMessage: z.string(),
	/**
	 * Whether password reset is open in this deployment. Drives whether the login screen shows the
	 * `Forgot your password?` link.
	 *
	 * This is a different axis from disabledFeatures. That one is a circuit breaker the operator
	 * toggles in the console. This value is derived from deployment config (the send channel and
	 * PASSWORD_RESET_ENABLED). Mixing them would make it look as if the console can enable reset, when
	 * the switch cannot open it.
	 *
	 * Default false. When a new client reads a response from an older server without this field, the
	 * link folds to hidden. Drawing the link while reset is closed would only lead to cannot send. As
	 * with the rest of this response, it is not authorization; the server rejects again.
	 */
	passwordReset: z.boolean().default(false),
	/**
	 * Whether this deployment was set up for use without signing in (it has a local owner,
	 * `deployment-setup.ts`). A guest browser on this computer then asks `/v2/auth/local-sign-in` for
	 * a session instead of showing the login form.
	 *
	 * A deployment fact, identical for everyone, so it stays cacheable like the rest of this
	 * response. Whether *this* request is from the computer is not here — that is decided per request
	 * by the sign-in door itself, and a browser elsewhere that tries is answered 404.
	 */
	localSignIn: z.boolean().default(false),
});
export type RuntimeConfigDto = z.infer<typeof RuntimeConfigDto>;

export const OPS_ERROR_CODE = {
	/**
	 * This operation is off right now. This is the value web and mobile branch on.
	 *
	 * Not 503 or 500, because this is a policy, not a failure. Clients must not retry to get through,
	 * and must not draw copy like try again later.
	 */
	featureDisabled: "feature_disabled",
	/** Switch key not in the vocabulary. The fail-closed representation. */
	unknownFeature: "unknown_feature",
	invalidVersion: "invalid_app_version",
} as const;
export type OpsErrorCode = (typeof OPS_ERROR_CODE)[keyof typeof OPS_ERROR_CODE];

export const DEFAULT_FEATURE_DISABLED_MESSAGE =
	"This feature is temporarily unavailable.";
