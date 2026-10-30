import { z } from "zod";
import { AgeStatus, MembershipGate } from "./membership.ts";
import { MemberRole } from "./moderation.ts";

/**
 * Personal-information protocol: the shapes returned by `/v2/me` and `/v2/me/state`. Moved here
 * from the gallery contract. The gallery was only the first screen to use it. Now that auth and
 * personalization are real features, this file has an owner.
 *
 * The `id` here is the RowCat member ID (member.id), the identity that authorization decisions use.
 * The auth-account ID (Better Auth's user) must never cross this line.
 */

/**
 * Member status. Suspended and banned members can still read, but writes (favorites, follows) are
 * blocked.
 */
export const MemberStatus = z.enum(["approved", "suspended", "banned"]);
export type MemberStatus = z.infer<typeof MemberStatus>;

/**
 * Viewer info. The three adult-gate axes are exposed directly so the client can choose its guidance
 * text.
 *
 * Role is here; moderation state is not. The split is deliberate. Role is one identity axis: small,
 * rarely changed, and needed on nearly every screen to decide whether to show operator-tool links.
 *
 * Restriction lists and appeal status are read by one account screen and vary in length per person.
 * `/me` is the hottest read (root SSR, header, auth guard on every route). Including moderation
 * data here would make every route's HTML carry one person's sanction history. So it is served by
 * `GET /v2/me/moderation`, for the same reason email moved to `/me/account`.
 */
export const ViewerDto = z.object({
	id: z.string(),
	nickname: z.string(),
	status: MemberStatus,
	/** Operator role. Never sent in any public response. */
	role: MemberRole,
	verified: z.boolean(),
	adult: z.boolean(),
	showAdult: z.boolean(),
	/**
	 * Age bracket, and only ever sent to the account itself. No birth date, no date the child turns
	 * 14, and no guardian identity. The screen only needs to know whether child restrictions apply.
	 * The server supplies the value valid right now. A child whose birthday has passed becomes
	 * `standard` automatically.
	 *
	 * It never appears in public responses (PublicProfileDto, StoryDto.creator,
	 * StoryCommentDto.author, NotificationDto). Being under 14 is private information about that
	 * person.
	 */
	ageStatus: AgeStatus,
	/**
	 * Entry gate to enforce now, computed once by the server. The screen must not reassemble this from
	 * `ageStatus`. When the priorities collide, the symptom is 'passes without
	 * an age check', and that failure is silent.
	 *
	 * Guests never receive it (`/me` returns null). The entry gate is the member's state, not the
	 * browser's.
	 */
	membershipGate: MembershipGate,
	/**
	 * Whether identity verification must be redone before viewing adult content, because the last
	 * adult verification is more than a year old (Art. 17(2) of the Enforcement Decree of the Juvenile
	 * Protection Act). Only the server-computed result is sent.
	 *
	 * The timestamp of the last verification is not here. The screen needs only whether to prompt a
	 * re-check. Sending the timestamp would put the deadline calculation on the client, based on the
	 * device clock.
	 *
	 * `.default(false)` is for rollout. A response from an older server that does not know this axis
	 * must read as 'no re-check required', which is what that server actually decides (it does not
	 * close viewing).
	 */
	adultRecheckRequired: z.boolean().default(false),
	/**
	 * This member is the deployment's local owner (`deployment-setup.ts`): the account a computer's
	 * browser is signed in as without a password. Screens read it to drop what cannot mean anything
	 * for that account — signing out, which the next page load undoes.
	 *
	 * `.default(false)` for the same rollout reason as above: an older server has no local owner.
	 */
	localOwner: z.boolean().default(false),
});
export type ViewerDto = z.infer<typeof ViewerDto>;

/**
 * `GET /me` response. Unauthenticated returns **null, not an error**. Turning guests into a 401
 * would log the normal public-gallery path as an error on every visit, and clients could not tell
 * 'not signed in' from 'session lookup failed'. Those two lead to different screens.
 */
export const ViewerResponseDto = ViewerDto.nullable();
export type ViewerResponseDto = z.infer<typeof ViewerResponseDto>;

/**
 * Personalization state, fetched in one batch. Asking 'did I save this?' per card would mean 24
 * round trips for one gallery page. Relationships are viewer-specific, so they cannot live on the
 * story object (StoryDto): values in a public cache would differ per person. Hence one batched
 * fetch per viewer.
 *
 * Guests receive an empty array, not an error. Splitting requests by login status would route
 * guests through different code, and that split would drift for a while after sign-in.
 */
export const PersonalizationStateDto = z.object({
	favorites: z.array(z.string()),
	following: z.array(z.string()),
	blocked: z.array(z.string()),
});
export type PersonalizationStateDto = z.infer<typeof PersonalizationStateDto>;

/**
 * Login methods. `provider` lists only the methods actually configured in this deployment. The
 * vocabulary is a promise, so values are not widened ahead of time. The screen maps this list to
 * labels (e.g. `credential` → `Email`). A value that is in the vocabulary but not configured would
 * leave a label branch that never runs, implying support that does not exist. Widening later is
 * cheap.
 *
 * `apple` and `kakao` were added under this rule, not as an exception. The server's provider setup
 * (`auth/index.ts`), the screen's buttons, and this vocabulary were introduced together in one
 * slice. Widening the vocabulary first would put the value on no account, while the screen showed a
 * `Not linked` row whose `Linked` button returns 400 when pressed.
 *
 * `kakao` is the only method here whose email is not guaranteed. Email sharing is optional consent
 * on Kakao's side. If it is declined, no account is created (Better Auth returns
 * `email_not_found`). That does not change the contract: what is listed is a method attached to an
 * already-created account, and an account created without an email does not exist.
 */
export const LoginMethodProvider = z.enum([
	"credential",
	"google",
	"apple",
	"kakao",
]);
export type LoginMethodProvider = z.infer<typeof LoginMethodProvider>;

export const LoginMethodDto = z.object({
	provider: LoginMethodProvider,
	linkedAt: z.iso.datetime(),
});
export type LoginMethodDto = z.infer<typeof LoginMethodDto>;

/**
 * Private account metadata, deliberately kept apart from `ViewerDto`. `/me` is the hottest read.
 * Email and login methods are used on one account screen only. Putting them in `ViewerDto` would
 * embed the email in the SSR HTML of every route. One consumer, one fetch.
 *
 * What must NOT come back matters more: Better Auth's user.id and account.id, the provider's
 * account ID, the password (hash included), access, refresh and ID tokens, and session ID and
 * token. These are auth implementation internals. Once they enter a contract, they spread to
 * screens, logs and caches at once.
 *
 * `hasPassword` is a boolean for the same reason: the screen needs only whether a credential
 * exists.
 */
export const AccountDetailsDto = z.object({
	email: z.email(),
	emailVerified: z.boolean(),
	/**
	 * Whether a credential (email/password) login method exists. The password itself is never sent in
	 * any form.
	 */
	hasPassword: z.boolean(),
	/**
	 * Whether two-factor authentication (authenticator app) is enabled, as a single boolean. The TOTP
	 * secret, backup codes and remaining-code count are never sent in any form, for the same reason as
	 * `hasPassword`.
	 *
	 * The default is `false` because of deploy order. Responses from a server that does not know this
	 * field must still pass the new client's checks, and that server has no 2FA at all.
	 */
	twoFactorEnabled: z.boolean().default(false),
	methods: z.array(LoginMethodDto),
	/**
	 * This is when the **auth account** was created. It is neither the creator profile's join date nor
	 * the time the member row was created. The member row is created lazily on first request, so the
	 * two can genuinely differ. For that reason UI copy says `Account created` (account creation date), not
	 * `Joined`.
	 */
	createdAt: z.iso.datetime(),
});
export type AccountDetailsDto = z.infer<typeof AccountDetailsDto>;

/**
 * Nickname change request. Moved here from an inline definition in the route file. For the SDK to
 * filter with the same rule before sending, both sides must share one schema. With two copies, if
 * only one side changes, the client passes a value that the server then rejects with a 400.
 *
 * No uniqueness, reserved-word, or change-cooldown rules. Nicknames are public display names, not
 * identity. Identity is `member.id`. Putting uniqueness on display names would begin to treat them
 * as account identifiers.
 */
export const NICKNAME_LIMITS = { min: 1, max: 20 } as const;

export const NicknameUpdateDto = z.object({
	nickname: z.string().trim().min(NICKNAME_LIMITS.min).max(NICKNAME_LIMITS.max),
});
export type NicknameUpdateDto = z.infer<typeof NicknameUpdateDto>;

/**
 * Changes the opt-in for **displaying** adult content. The server decides whether the user may turn
 * it on.
 */
export const ShowAdultUpdateDto = z.object({ showAdult: z.boolean() });
export type ShowAdultUpdateDto = z.infer<typeof ShowAdultUpdateDto>;
