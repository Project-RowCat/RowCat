import { z } from "zod";
import { AppPlatform } from "./ops.ts";

/**
 * Native push contract: the delivery plane only, not a notification contract. It answers two
 * questions: whether this install can receive pushes (registration), and which notification a
 * received push refers to (payload). What happened stays in notifications.ts, whose inbox is the
 * single source of truth. Delivery is best-effort and retryable.
 *
 * Deliberately absent:
 * - Recipient ids. Ownership comes from the authenticated /me request, so a target cannot be
 *   expressed.
 * - Notification content. Lock screens are readable by non-owners, so the payload is only a
 *   reference.
 * - App navigation targets. A second destination table would give one Notification two
 *   interpretations.
 * - Device lists. They would need a remote-revoke control (`Remote sign-out`), which the sessions endpoint
 *   (/me/account/sessions) already provides.
 * - Push tokens in any response. Holding a token lets its holder push to that install.
 */

/**
 * The provider is a stored value, so it is an enum even with one member. Rows already stored must
 * be traceable to their delivery provider when a second one arrives, and that cannot be inferred
 * later. Placeholder members (`fcm`, `apns`) are not added, since they would freeze the vocabulary
 * before any code produces them.
 */
export const PushProvider = z.enum(["expo"]);
export type PushProvider = z.infer<typeof PushProvider>;

/**
 * Reuses the `AppPlatform` vocabulary from ops.ts instead of redeclaring it. Two declarations could
 * drift apart without the type checker noticing, since both are "ios" | "android".
 */

/**
 * Opaque random id for the app install. It is not derived from device name, serial number,
 * advertising id, or member id. It identifies the install rather than the device, so reinstalling
 * the app yields a new value. The format is locked narrowly because this value is half of the
 * unique key. Accepting near-duplicate strings would split one install into two rows, which shows
 * up as duplicate pushes.
 */
export const PushInstallationId = z.string().regex(/^[0-9a-f]{32}$/);

/**
 * Shape check only. Client-side validation is not sufficient, because Expo decides validity at
 * delivery time (DeviceNotRegistered). The pattern rejects typos and empty values, and also rejects
 * other values placed in the token slot (a session cookie, an email) so they cannot reach storage.
 */
export const EXPO_PUSH_TOKEN_PATTERN =
	/^Expo(nent)?PushToken\[[A-Za-z0-9._%+-]{1,256}\]$/;

export const ExpoPushToken = z.string().regex(EXPO_PUSH_TOKEN_PATTERN);

/**
 * Only values the install legitimately owns. The schema is strict: a request containing memberId
 * fails with 400 instead of being silently ignored, since silent ignoring would make the client
 * believe it chose the target.
 */
export const PushRegistrationDto = z
	.object({
		installationId: PushInstallationId,
		platform: AppPlatform,
		provider: PushProvider,
		token: ExpoPushToken,
	})
	.strict();
export type PushRegistrationDto = z.infer<typeof PushRegistrationDto>;

/**
 * The registration response carries one fact: this device is receiving pushes. It omits the
 * registration id, token, expiry, and other-device count, which this slice does not answer.
 */
export const PushRegistrationResponse = z
	.object({ registered: z.boolean() })
	.strict();
export type PushRegistrationResponse = z.infer<typeof PushRegistrationResponse>;

/**
 * Payload version, so a client never guesses at an unknown shape. Pushes can sit in the OS queue
 * for days while the app updates. Without a version, a newer app would misread an old payload and
 * fail silently, which appears only as taps that do nothing.
 */
export const PUSH_PAYLOAD_VERSION = 1;

/**
 * The channel id must be identical on the server (which sends it) and in the app (which creates the
 * channel). If they differ, Android uses the default channel, and a user lowering that channel's
 * importance would have no effect on ours. Server and app cannot import each other, so the value
 * lives in this shared contract.
 */
export const PUSH_ANDROID_CHANNEL_ID = "default";

/**
 * A single reference, not the serialized notification row. The row holds kind, actor, work, and
 * reason, which the OS would store where we cannot erase them until the user clears the
 * notification. The app asks the inbox, through its session, what arrived.
 */
export const PushMessagePayload = z
	.object({
		version: z.literal(PUSH_PAYLOAD_VERSION),
		notificationId: z.string().min(1),
	})
	.strict();
export type PushMessagePayload = z.infer<typeof PushMessagePayload>;

export const PUSH_ERROR_CODE = {
	/**
	 * The deployment has no delivery transport configured. Registration is not rejected for this, so
	 * the code is not on the registration path. A route is added only when a screen needs to branch on
	 * it. It exists now only to match the vocabulary of the `env:doctor` diagnostic.
	 */
	transportDisabled: "push_transport_disabled",
} as const;
export type PushErrorCode =
	(typeof PUSH_ERROR_CODE)[keyof typeof PUSH_ERROR_CODE];
