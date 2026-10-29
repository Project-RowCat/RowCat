import {
	AccountDetailsDto,
	AccountPasskeysDto,
	AccountSessionsDto,
	type AvatarDto,
	AvatarResponse,
	BioUpdateDto,
	CreatorAnalyticsPage,
	CreatorAnalyticsQuery,
	CreatorCommentInboxPage,
	CreatorCommentInboxQuery,
	CreatorWorksPage,
	CreatorWorksQuery,
	type LoginMethodDisconnectDto,
	LoginMethodDisconnectDto as LoginMethodDisconnectSchema,
	NicknameUpdateDto,
	OwnPinnedStoriesResponse,
	type PasskeyDeleteDto,
	PasskeyDeleteDto as PasskeyDeleteSchema,
	type PasskeyRenameDto,
	PasskeyRenameDto as PasskeyRenameSchema,
	PersonalizationStateDto,
	PinnedStoriesUpdateDto,
	PublicProfileDto,
	type RuntimeAudioAssetDto,
	RuntimeAudioUploadResponse,
	type RuntimeImageAssetDto,
	RuntimeImageUploadResponse,
	type SceneImageAssetDto,
	SceneImageUploadResponse,
	type SessionRevokeDto,
	SessionRevokeDto as SessionRevokeSchema,
	type SetPasswordDto,
	SetPasswordDto as SetPasswordSchema,
	ShowAdultUpdateDto,
	toCreatorAnalyticsSearchParams,
	toCreatorCommentInboxSearchParams,
	toCreatorWorksSearchParams,
	ViewerDto,
	ViewerResponseDto,
} from "@rowcat/contracts";
import type {
	AccountDetails,
	AccountPasskey,
	AccountSession,
	CreatorAnalyticsPage as CreatorAnalytics,
	CreatorCommentInboxPage as CreatorCommentInbox,
	CreatorWork,
	CreatorWorkPage,
	PersonalizationState,
	PublicProfile,
	Viewer,
} from "@rowcat/domain";
import type { RequestOptions, RowCatTransport } from "./client.ts";
import { invalidRequest, invalidResponse } from "./errors.ts";

/**
 * Viewer: product identity, personalization state, and the account. The screen's source of truth is
 * this, not the Better Auth session, which only answers whether the user is logged in. Membership
 * identity, nickname, and adult gate come out only after the server resolves the member from the
 * session.
 * - get() and account() are split on purpose. get() is read globally by every route, while
 *   account() holds private data such as email. Merging them would put email into every route's SSR
 *   HTML.
 * - None of the three viewer update functions takes a target. The target is always the requester,
 *   identified only by the cookie.
 */
export interface MeApi {
	/** Current viewer. Null when not logged in (not an error). */
	get(options?: RequestOptions): Promise<Viewer | null>;
	/** Favorite, follow, and block id batches. Empty arrays when not logged in. */
	state(options?: RequestOptions): Promise<PersonalizationState>;
	/** Private account metadata. Guests get a 401, not an empty value. */
	account(options?: RequestOptions): Promise<AccountDetails>;
	/**
	 * Sets a password. Only valid for accounts that have no credential login method yet. This is the
	 * only place a password appears in this SDK, and the exception is recorded here. Changing a
	 * password is not in the SDK: Better Auth already exposes `/v2/auth/change-password` over HTTP and
	 * the web calls it directly, as account deletion calls `authClient.deleteUser()` directly. Setting
	 * lives here only because the library's `setPassword` is serverOnly, so no endpoint exists for the
	 * browser to call. The value is sent untrimmed, with no `.trim()` or `.normalize()`. A password is
	 * opaque, and changing one character would make the new password fail to log in. Returns the
	 * account after the change, so the screen does not guess `hasPassword`.
	 */
	setPassword(
		input: SetPasswordDto,
		options?: RequestOptions,
	): Promise<AccountDetails>;
	/**
	 * Disconnects one login method (a provider) and returns the confirmed account. The server finds
	 * the Better Auth account row id itself, so that internal id never reaches the client. The server
	 * rejects removing the last method (`last_login_method`). The screen checks the same rule first as
	 * guidance, but direct callers get the same answer from the server.
	 */
	disconnectLoginMethod(
		input: LoginMethodDisconnectDto,
		options?: RequestOptions,
	): Promise<AccountDetails>;
	/**
	 * The live sessions. The returned value has no session token. The library's session list does
	 * include tokens, which is why this resource lives here rather than in the Better Auth client: a
	 * token in browser JavaScript state would defeat the HttpOnly session cookie.
	 */
	sessions(options?: RequestOptions): Promise<AccountSession[]>;
	/**
	 * The registered passkey list, as a sanitized projection. It does not call the plugin's list
	 * endpoint (`/v2/auth/passkey/list-user-passkeys`), whose response is the raw credential row with
	 * public keys, credential ids, and counters. Those values would sit in the query cache and
	 * devtools as soon as they pass through this SDK. This is the same decision as the session list
	 * leaving out tokens. The server's allowlist and the validation below guard the boundary on both
	 * sides.
	 */
	passkeys(options?: RequestOptions): Promise<AccountPasskey[]>;
	renamePasskey(
		input: PasskeyRenameDto,
		options?: RequestOptions,
	): Promise<AccountPasskey[]>;
	/**
	 * Deletes a passkey, which cannot be undone. Pointing at someone else's passkey returns 404, the
	 * same code as not found. That judgment belongs to the server and the library; ownership is not
	 * checked here.
	 */
	deletePasskey(
		input: PasskeyDeleteDto,
		options?: RequestOptions,
	): Promise<AccountPasskey[]>;
	/**
	 * Revokes one session. Idempotent: an already-missing session still succeeds, and the response is
	 * always the list after the change, so the screen does not remove the row by hand.
	 */
	revokeSession(
		input: SessionRevokeDto,
		options?: RequestOptions,
	): Promise<AccountSession[]>;
	/**
	 * Revokes every session except the current one. There is no argument for choosing which to keep.
	 */
	revokeOtherSessions(options?: RequestOptions): Promise<AccountSession[]>;
	/**
	 * A single work the server holds for me, shown as the `Published works` tab in the
	 * creator workspace. This is separate from `creators.stories()`. That is a public lookup taking a
	 * target, so it excludes private, archived, and operator-hidden works. This is a private lookup
	 * with no target slot, so it includes everything that is mine. Folding both into one function
	 * would make the exposure boundary depend on whose list is requested, and the difference would be
	 * invisible at the call site.
	 */
	stories(
		input?: CreatorWorksInput,
		options?: RequestOptions,
	): Promise<CreatorWorkPage>;
	/**
	 * One of my works' performance, shown as the `Analytics` tab. This is separate from
	 * `stories()`: that is the management list answering 'what do I hold', while this is an aggregate
	 * answering 'how was it read'. Folding them together would make every path that draws the work
	 * list also carry the aggregate. There is no target slot here either; the owner always comes from
	 * the cookie.
	 */
	creatorAnalytics(
		input?: CreatorAnalyticsInput,
		options?: RequestOptions,
	): Promise<CreatorAnalytics>;
	/**
	 * Comments on one of my works, shown as the `Comment` (comments) tab, most recent first. Per-work
	 * comments are not fetched with `client.comments.list`, because that resource passes the public
	 * discussion exposure gate, where comments on my archived works return
	 * 404. There is no target slot here either. The next page passes the server's `nextCursor`
	 *      through unchanged.
	 */
	creatorComments(
		input?: CreatorCommentInboxInput,
		options?: RequestOptions,
	): Promise<CreatorCommentInbox>;
	updateNickname(
		input: NicknameUpdateDto,
		options?: RequestOptions,
	): Promise<Viewer>;
	/**
	 * Returns the confirmed public profile rather than the viewer, because bio is not on `Viewer`.
	 * `/me` is read globally, so a field used only by the account screen is not added there. Instead,
	 * the write returns the same field it changes, so the screen can store the response directly in
	 * the public profile cache. An empty string clears the bio (the contract allows it), and the
	 * response's `bio` comes back as null.
	 */
	updateBio(
		input: BioUpdateDto,
		options?: RequestOptions,
	): Promise<PublicProfile>;
	/**
	 * The member's pinned featured works, including ones not visible on the profile right now, in pin
	 * order. The public version (`creators.pinnedStories`) differs in its return type. This is an
	 * owner projection (`CreatorWork`) with a status axis, so the screen can explain why a work that
	 * is pinned but kept private is not showing.
	 */
	pinnedStories(options?: RequestOptions): Promise<CreatorWork[]>;
	/**
	 * Replaces the featured list with the desired final list and returns the confirmed list. There are
	 * no separate add, remove, or move calls. Order is display order, and an empty array unpins
	 * everything. Limits and duplicates are filtered by the contract before sending, because a server
	 * 400 would produce a message meant for developers.
	 */
	setPinnedStories(
		input: PinnedStoriesUpdateDto,
		options?: RequestOptions,
	): Promise<CreatorWork[]>;
	/**
	 * Uploads or replaces the avatar and returns the confirmed avatar. The bytes are sent as a `Blob`,
	 * not base64 inside JSON: base64 adds about 33% size and turns the image into a one-field
	 * document, pushing the server's body size limit behind the JSON parser, while the limit must
	 * apply before parsing. There is no target argument and no remote-URL form; avatars come only from
	 * bytes RowCat validated and stored. The screen does not build `url` itself, because the address
	 * rule belongs to the server and a browser copy would go stale on a deploy. `Content-Type` is sent
	 * for diagnostics only; the server decides from the bytes.
	 */
	uploadAvatar(image: Blob, options?: RequestOptions): Promise<AvatarDto>;
	/**
	 * Deletes the avatar. Idempotent: calling again on an account with no avatar succeeds with the
	 * same response, so a retry after a lost response does not show failure for a state that is
	 * already true. Returns nothing because the server response is always `{ avatar: null }`;
	 * returning `Promise<null>` would invite callers to read meaning into a constant.
	 */
	deleteAvatar(options?: RequestOptions): Promise<void>;
	/**
	 * Uploads one scene image as raw bytes. It differs from the avatar only in verb and count (`POST`,
	 * since a member holds several). The returned `url` is only for previewing the upload. The draft
	 * stores just `mediaId`, and `client.media.url` builds the address later, because stored
	 * references stay on the device for a long time (see the `media.ts` header).
	 */
	uploadSceneImage(
		image: Blob,
		options?: RequestOptions,
	): Promise<SceneImageAssetDto>;
	/**
	 * Uploads one creator runtime image as raw bytes; it is a separate resource from scene images. The
	 * server's media `kind` is the publishing authorization, so merging the two would let a scene
	 * photo be published as a runtime asset. The logical name is not set here. This call creates one
	 * media item, and the device's authoring record binds it to a name such as
	 * `characters/sena/smile`. If the server knew that pairing before publish, drafts would become
	 * server resources, while authoring is local-first and E2EE. The returned `url` is for preview
	 * only, as with scene images.
	 */
	uploadRuntimeImage(
		image: Blob,
		options?: RequestOptions,
	): Promise<RuntimeImageAssetDto>;
	/**
	 * Uploads one creator runtime sound, at an address separate from images. A `kind` field on a
	 * shared address would be a request-side claim that selects the parser and the size limit;
	 * separate addresses remove the claim. The response carries a length rather than dimensions, since
	 * sound takes no layout space, and the length is what creators check in the list.
	 */
	uploadRuntimeAudio(
		audio: Blob,
		options?: RequestOptions,
	): Promise<RuntimeAudioAssetDto>;
	updateShowAdult(
		input: ShowAdultUpdateDto,
		options?: RequestOptions,
	): Promise<Viewer>;
}

/** Input for list queries. Omitted axes take the contract's defaults. */
export type CreatorWorksInput = Partial<CreatorWorksQuery>;

/** Input for analytics queries. Same rule, and again no slot for a target member. */
export type CreatorAnalyticsInput = Partial<CreatorAnalyticsQuery>;
export type CreatorCommentInboxInput = Partial<CreatorCommentInboxQuery>;

/**
 * Reads a viewer update response. All three updates return the confirmed `ViewerDto`. It is not
 * trusted just because the status is 200: it corrects the screen's optimistic update, so a
 * malformed shape would silently pin the header nickname and adult setting to wrong values.
 */
const parseViewer = (json: unknown, path: string): Viewer => {
	const parsed = ViewerDto.safeParse(json);
	if (!parsed.success) throw invalidResponse(path);
	return parsed.data;
};

export function createMeApi({
	requestJson,
	requestVoid,
}: RowCatTransport): MeApi {
	return {
		async get(options) {
			const json = await requestJson({
				method: "GET",
				path: "/me",
				signal: options?.signal,
			});
			/**
			 * `null` is a normal, contract-defined response, so the schema is nullable. Turning null into an
			 * error would send guests down the error path, while skipping validation would let an empty
			 * object leaked by the server pass as a logged-in viewer.
			 */
			const parsed = ViewerResponseDto.safeParse(json);
			if (!parsed.success) throw invalidResponse("/me");
			// The contract and the domain `Viewer` currently match field-for-field. No copy-only mapper is
			// kept: the moment they diverge, this return statement fails to compile.
			return parsed.data;
		},

		async state(options) {
			const json = await requestJson({
				method: "GET",
				path: "/me/state",
				signal: options?.signal,
			});
			const parsed = PersonalizationStateDto.safeParse(json);
			if (!parsed.success) throw invalidResponse("/me/state");
			return parsed.data;
		},

		/**
		 * The account. Neither the path nor the body has a slot for 'whose': `/me/account` always belongs
		 * to the requester, and that identity comes only from the cookie.
		 */
		async account(options) {
			const json = await requestJson({
				method: "GET",
				path: "/me/account",
				signal: options?.signal,
			});
			/**
			 * Validation matters most here: the response carries email and login methods. If a field outside
			 * the contract, such as an auth account id or a token, leaks in through a server bug, the schema
			 * drops it. Skipping validation would let it reach the screen and cache.
			 */
			const parsed = AccountDetailsDto.safeParse(json);
			if (!parsed.success) throw invalidResponse("/me/account");
			return parsed.data;
		},

		/**
		 * Sets a password. Validated against the contract before sending, to avoid a round trip that
		 * would come back as 400. Sends the raw value, unlike `updateNickname`, because the nickname
		 * schema trims; the password schema has no transform and must keep none. The error message does
		 * not include the input. A zod issue message copied verbatim could later carry the value if
		 * `.refine()` is added to the schema.
		 */
		async setPassword(input, options) {
			if (!SetPasswordSchema.safeParse(input).success)
				throw invalidRequest(
					"/me/account/password",
					"The password length does not meet the policy.",
				);
			const json = await requestJson({
				method: "POST",
				path: "/me/account/password",
				body: input,
				signal: options?.signal,
			});
			const parsed = AccountDetailsDto.safeParse(json);
			if (!parsed.success) throw invalidResponse("/me/account/password");
			return parsed.data;
		},

		async disconnectLoginMethod(input, options) {
			const parsed = LoginMethodDisconnectSchema.safeParse(input);
			if (!parsed.success)
				throw invalidRequest(
					"/me/account/login-methods/disconnect",
					"Unknown sign-in method",
				);
			const json = await requestJson({
				method: "POST",
				path: "/me/account/login-methods/disconnect",
				body: parsed.data,
				signal: options?.signal,
			});
			const account = AccountDetailsDto.safeParse(json);
			if (!account.success)
				throw invalidResponse("/me/account/login-methods/disconnect");
			return account.data;
		},

		async sessions(options) {
			const json = await requestJson({
				method: "GET",
				path: "/me/account/sessions",
				signal: options?.signal,
			});
			/**
			 * Validation matters most here. If the server accidentally leaks a library session row whole, a
			 * session token arrives here. The schema drops fields outside the contract, so skipping
			 * validation would let that value sit in the cache and devtools. The server's allowlist and this
			 * validation guard the same boundary on both sides.
			 */
			const parsed = AccountSessionsDto.safeParse(json);
			if (!parsed.success) throw invalidResponse("/me/account/sessions");
			return parsed.data.sessions;
		},

		async revokeSession(input, options) {
			const parsed = SessionRevokeSchema.safeParse(input);
			if (!parsed.success)
				throw invalidRequest(
					"/me/account/sessions/revoke",
					"Invalid session reference",
				);
			const json = await requestJson({
				method: "POST",
				path: "/me/account/sessions/revoke",
				body: parsed.data,
				signal: options?.signal,
			});
			const sessions = AccountSessionsDto.safeParse(json);
			if (!sessions.success)
				throw invalidResponse("/me/account/sessions/revoke");
			return sessions.data.sessions;
		},

		async revokeOtherSessions(options) {
			/**
			 * The body is not sent. Omitting `body` is the most important line in this function. Even an
			 * empty object would eventually gain a field saying what to keep, and that field would become a
			 * parameter that keeps others' sessions alive.
			 */
			const json = await requestJson({
				method: "POST",
				path: "/me/account/sessions/revoke-others",
				signal: options?.signal,
			});
			const sessions = AccountSessionsDto.safeParse(json);
			if (!sessions.success)
				throw invalidResponse("/me/account/sessions/revoke-others");
			return sessions.data.sessions;
		},

		/**
		 * The passkey list. Validation matters most here: if the server leaks the plugin's row whole,
		 * public keys and credential ids arrive here. The schema drops fields outside the contract, so
		 * skipping validation would let them sit in the cache and devtools.
		 */
		async passkeys(options) {
			const json = await requestJson({
				method: "GET",
				path: "/me/account/passkeys",
				signal: options?.signal,
			});
			const parsed = AccountPasskeysDto.safeParse(json);
			if (!parsed.success) throw invalidResponse("/me/account/passkeys");
			return parsed.data.passkeys;
		},

		/**
		 * Validated before sending, then sends the parsed result. The schema calls `.trim()`, so sending
		 * the raw value would make the stored name differ from the one the screen drew optimistically.
		 * This is the opposite of the password setter, which sends the raw value on purpose.
		 */
		async renamePasskey(input, options) {
			const parsed = PasskeyRenameSchema.safeParse(input);
			if (!parsed.success)
				throw invalidRequest(
					"/me/account/passkeys/rename",
					"The passkey name is not well-formed.",
				);
			const json = await requestJson({
				method: "POST",
				path: "/me/account/passkeys/rename",
				body: parsed.data,
				signal: options?.signal,
			});
			const result = AccountPasskeysDto.safeParse(json);
			if (!result.success) throw invalidResponse("/me/account/passkeys/rename");
			return result.data.passkeys;
		},

		async deletePasskey(input, options) {
			const parsed = PasskeyDeleteSchema.safeParse(input);
			if (!parsed.success)
				throw invalidRequest(
					"/me/account/passkeys/delete",
					"Invalid passkey reference",
				);
			const json = await requestJson({
				method: "POST",
				path: "/me/account/passkeys/delete",
				body: parsed.data,
				signal: options?.signal,
			});
			const result = AccountPasskeysDto.safeParse(json);
			if (!result.success) throw invalidResponse("/me/account/passkeys/delete");
			return result.data.passkeys;
		},

		async stories(input = {}, options) {
			// The input is also checked against the contract. Serialization omits defaults and assumes a
			// normalized value; passing an unchecked value through would send the same query to two URLs.
			const query = CreatorWorksQuery.parse(input);
			const json = await requestJson({
				method: "GET",
				path: "/me/stories",
				search: toCreatorWorksSearchParams(query),
				signal: options?.signal,
			});
			/**
			 * Validation matters most here. If the server leaks a work row whole, the playback payload
			 * (scenario, characters, lore) arrives too. The schema drops fields outside the contract, so
			 * skipping validation would let that body sit in the cache and devtools. The server's allowlist
			 * and this validation guard the boundary on both sides.
			 */
			const parsed = CreatorWorksPage.safeParse(json);
			if (!parsed.success) throw invalidResponse("/me/stories");
			return parsed.data;
		},

		async creatorAnalytics(input = {}, options) {
			const query = CreatorAnalyticsQuery.parse(input);
			const json = await requestJson({
				method: "GET",
				path: "/me/creator-analytics",
				search: toCreatorAnalyticsSearchParams(query),
				signal: options?.signal,
			});
			/**
			 * Validation matters most here. This response should carry only counts. If the server leaks work
			 * rows or join results, playback payloads or viewer identity (who viewed, who saved) can arrive
			 * mixed in. The schema drops fields outside the contract, so skipping validation would let them
			 * reach the cache and devtools. The server's allowlist and this validation guard the boundary on
			 * both sides.
			 */
			const parsed = CreatorAnalyticsPage.safeParse(json);
			if (!parsed.success) throw invalidResponse("/me/creator-analytics");
			return parsed.data;
		},

		async creatorComments(input = {}, options) {
			const query = CreatorCommentInboxQuery.parse(input);
			const json = await requestJson({
				method: "GET",
				path: "/me/creator-comments",
				search: toCreatorCommentInboxSearchParams(query),
				signal: options?.signal,
			});
			/**
			 * The contract accepts comments on a line only as live threads. If the server leaks a tombstone,
			 * the whole response is rejected here. Rendering that line would put a 'deleted comment' row
			 * with nothing to read into the inbox, and the analytics comment count and the list line count
			 * would disagree.
			 */
			const parsed = CreatorCommentInboxPage.safeParse(json);
			if (!parsed.success) throw invalidResponse("/me/creator-comments");
			return parsed.data;
		},

		/**
		 * Validated with the server's schema before sending. This does not replace server validation (any
		 * HTTP client can call the server, which checks by its own rules). It avoids a round trip that
		 * would come back 400, and sharing the contract keeps the verdicts from diverging. Sends the
		 * parsed result: if the raw value were sent, the trimming rule would exist only on the server,
		 * and the length the client checked would differ from the stored length.
		 */
		async updateNickname(input, options) {
			const parsed = NicknameUpdateDto.safeParse(input);
			if (!parsed.success)
				throw invalidRequest(
					"/me/nickname",
					parsed.error.issues[0]?.message ?? "Invalid nickname",
				);
			const json = await requestJson({
				method: "PATCH",
				path: "/me/nickname",
				body: parsed.data,
				signal: options?.signal,
			});
			return parseViewer(json, "/me/nickname");
		},

		async uploadAvatar(image, options) {
			const json = await requestJson({
				method: "PUT",
				path: "/me/avatar",
				rawBody: image,
				/**
				 * The file's self-declared format. It can be empty (for example, a file with no extension), so
				 * a fallback is set. If the header were dropped entirely, fetch would choose one on its own.
				 */
				contentType: image.type || "application/octet-stream",
				signal: options?.signal,
			});
			const parsed = AvatarResponse.safeParse(json);
			if (!parsed.success) throw invalidResponse("PUT /me/avatar");
			/**
			 * The success response's `avatar` is never null; null is the answer to deletion. The contract is
			 * nullable because both verbs share one envelope. Narrowing that here means callers do not carry
			 * a branch that cannot happen.
			 */
			if (!parsed.data.avatar) throw invalidResponse("PUT /me/avatar");
			return parsed.data.avatar;
		},

		async uploadSceneImage(image, options) {
			const json = await requestJson({
				method: "POST",
				path: "/me/scene-images",
				rawBody: image,
				contentType: image.type || "application/octet-stream",
				signal: options?.signal,
			});
			const parsed = SceneImageUploadResponse.safeParse(json);
			if (!parsed.success) throw invalidResponse("POST /me/scene-images");
			return parsed.data.asset;
		},

		async uploadRuntimeImage(image, options) {
			const json = await requestJson({
				method: "POST",
				path: "/me/runtime-assets",
				rawBody: image,
				contentType: image.type || "application/octet-stream",
				signal: options?.signal,
			});
			const parsed = RuntimeImageUploadResponse.safeParse(json);
			if (!parsed.success) throw invalidResponse("POST /me/runtime-assets");
			return parsed.data.asset;
		},

		async uploadRuntimeAudio(audio, options) {
			const json = await requestJson({
				method: "POST",
				path: "/me/runtime-audio",
				rawBody: audio,
				/**
				 * The file's self-declared format. For audio, the server decides from the container, not from
				 * this claim.
				 */
				contentType: audio.type || "application/octet-stream",
				signal: options?.signal,
			});
			const parsed = RuntimeAudioUploadResponse.safeParse(json);
			if (!parsed.success) throw invalidResponse("POST /me/runtime-audio");
			return parsed.data.asset;
		},

		async deleteAvatar(options) {
			/**
			 * The response body is not read. The server returns `{ avatar: null }`, a constant with nothing
			 * to validate. Validating it would make a successful deletion look like a failure if the shape
			 * changed, after the deletion had already happened.
			 */
			await requestVoid({
				method: "DELETE",
				path: "/me/avatar",
				signal: options?.signal,
			});
		},

		async updateBio(input, options) {
			const parsed = BioUpdateDto.safeParse(input);
			if (!parsed.success)
				throw invalidRequest(
					"/me/bio",
					parsed.error.issues[0]?.message ?? "Invalid bio",
				);
			const json = await requestJson({
				method: "PATCH",
				path: "/me/bio",
				body: parsed.data,
				signal: options?.signal,
			});
			const profile = PublicProfileDto.safeParse(json);
			if (!profile.success) throw invalidResponse("/me/bio");
			return profile.data;
		},

		async pinnedStories(options) {
			const json = await requestJson({
				method: "GET",
				path: "/me/pinned-stories",
				signal: options?.signal,
			});
			const parsed = OwnPinnedStoriesResponse.safeParse(json);
			if (!parsed.success) throw invalidResponse("/me/pinned-stories");
			return parsed.data.items;
		},

		async setPinnedStories(input, options) {
			const parsed = PinnedStoriesUpdateDto.safeParse(input);
			if (!parsed.success)
				throw invalidRequest(
					"/me/pinned-stories",
					parsed.error.issues[0]?.message ?? "Invalid featured list",
				);
			const json = await requestJson({
				method: "PUT",
				path: "/me/pinned-stories",
				body: parsed.data,
				signal: options?.signal,
			});
			const result = OwnPinnedStoriesResponse.safeParse(json);
			if (!result.success) throw invalidResponse("/me/pinned-stories");
			return result.data.items;
		},

		async updateShowAdult(input, options) {
			const parsed = ShowAdultUpdateDto.safeParse(input);
			if (!parsed.success)
				throw invalidRequest(
					"/me/show-adult",
					parsed.error.issues[0]?.message ?? "Invalid setting value",
				);
			const json = await requestJson({
				method: "PATCH",
				path: "/me/show-adult",
				body: parsed.data,
				signal: options?.signal,
			});
			return parseViewer(json, "/me/show-adult");
		},
	};
}
