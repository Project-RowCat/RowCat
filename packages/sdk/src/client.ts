import { type AdminApi, createAdminApi } from "./admin.ts";
import {
	type AdultVerificationApi,
	createAdultVerificationApi,
} from "./adult-verification.ts";
import { type ChatApi, createChatApi } from "./chat.ts";
import { type CommentsApi, createCommentsApi } from "./comments.ts";
import { type CreatorsApi, createCreatorsApi } from "./creators.ts";
import { apiErrorFromResponse, RowCatApiError } from "./errors.ts";
import { createFavoritesApi, type FavoritesApi } from "./favorites.ts";
import { createMeApi, type MeApi } from "./me.ts";
import { createMediaApi, type MediaApi } from "./media.ts";
import { createMembershipApi, type MembershipApi } from "./membership.ts";
import { createModerationApi, type ModerationApi } from "./moderation.ts";
import {
	createNotificationsApi,
	type NotificationsApi,
} from "./notifications.ts";
import { createOpsApi, type OpsApi } from "./ops.ts";
import { createPushApi, type PushApi } from "./push.ts";
import { createSocialApi, type SocialApi } from "./social.ts";
import { createStoriesApi, type StoriesApi } from "./stories.ts";
import { createSyncApi, type SyncApi } from "./sync.ts";
import { createThemeApi, type ThemeApi } from "./theme.ts";

/** Options that can accompany a single request. Cancellation is the only one for now. */
export interface RequestOptions {
	/**
	 * Cancellation signal passed in by TanStack Query. A query abandoned by leaving the screen also
	 * stops at the network level.
	 */
	signal?: AbortSignal;
}

/**
 * The two body shapes. They form a union, so both cannot be given at once.
 *
 * If one field held both, and the rule were "an object means JSON, anything else passes through,"
 * the body type alone would not reveal whether it gets serialized. The failure is silent: a `Blob`
 * passed to `JSON.stringify` does not throw. It produces "{}", and the server receives two
 * characters rather than an image. With separate fields, that state cannot be expressed.
 */
type ApiRequestBody =
	| {
			/** Body to serialize as JSON. When it is present, Content-Type is attached automatically. */
			body?: unknown;
			rawBody?: undefined;
			contentType?: undefined;
	  }
	| {
			body?: undefined;
			/**
			 * Raw body: the bytes themselves are the resource, as in a cover image upload.
			 *
			 * `ReadableStream` is deliberately not accepted. A stream body requires `duplex: "half"` in the
			 * fetch init, browser support for that option varies, and undici in Node throws without it. The
			 * same code would die in different ways under SSR and in the browser. A single file fits in a
			 * `Blob`.
			 */
			rawBody: Blob | ArrayBuffer | ArrayBufferView;
			/**
			 * The media type is required. Without it, fetch picks one arbitrarily or sets none, and server
			 * logs lose the only clue about what was uploaded. The server does not trust this value, but not
			 * trusting a value is different from refusing it.
			 */
			contentType: string;
	  };

export type ApiRequest = ApiRequestBase & ApiRequestBody;

interface ApiRequestBase {
	method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	path: string;
	search?: URLSearchParams;
	/**
	 * Accept for this request only. The default is `application/json`, and streaming endpoints use
	 * another value. Headers are copied per request, so this does not leak into other requests.
	 */
	accept?: string;
	/**
	 * Headers for this request only, created for the sync push's `Idempotency-Key`.
	 *
	 * The key stays out of the body because the body is part of the request hash. If the key were in
	 * the body, retries of the same chunk would hash differently and idempotency would be defeated.
	 * That is why it must be a header, and why this field exists.
	 *
	 * It does not forbid overriding default headers (SSR cookie, Accept). Callers should be able to do
	 * that on purpose, and resource modules live only inside this repository.
	 */
	headers?: Record<string, string>;
	signal?: AbortSignal;
}

/**
 * Returns the body as JSON before any parsing, and stops there. Contract validation happens in the
 * resource, which knows which schema to read the body with.
 */
export type RequestJson = (request: ApiRequest) => Promise<unknown>;

/**
 * For a success with no body (`204 No Content`).
 *
 * Calling `response.json()` on a 204 throws. The server should not be made to return an empty
 * object just to avoid that. "Nothing to return" is what 204 means, so the transport layer must
 * adapt.
 */
export type RequestVoid = (request: ApiRequest) => Promise<void>;

/**
 * Reads a body without waiting for it to finish. Used for streaming responses, where the raw byte
 * stream is returned as-is.
 *
 * The third shape exists for generation. `requestJson` yields a value only once the entire body has
 * arrived, but generation has to show the first character as soon as it arrives. The resource
 * decides how to read the framing (NDJSON); this layer only passes the body along.
 *
 * A success without a body becomes an error, because a 200 with no readable stream would leave the
 * caller waiting forever.
 */
export type RequestStream = (
	request: ApiRequest,
) => Promise<ReadableStream<Uint8Array>>;

/**
 * The HTTP capability given to resource modules.
 *
 * The three functions share one implementation for base URL, credentials, headers, cancellation,
 * and error conversion. They differ only in how they read a successful body. No adapter or pipeline
 * layer is built, because these three lines are the only differences such a layer would absorb.
 */
export interface RowCatTransport {
	requestJson: RequestJson;
	requestVoid: RequestVoid;
	requestStream: RequestStream;
}

export interface RowCatClientOptions {
	/**
	 * The base URL, including the path prefix (`/v2`). This package reads neither `import.meta.env`
	 * nor `process.env`. Reading either would tie it to one bundler or runtime, and Expo could not use
	 * the same code. Choosing the value from the environment is the app's job (web:
	 * apps/web/src/lib/api.ts).
	 */
	baseUrl: string;
	/**
	 * Headers sent with every request from this client.
	 *
	 * Browsers have a cookie jar, so `credentials: "include"` alone carries the session. A server-side
	 * `fetch` has no jar, so the incoming request's Cookie must be passed here. The values are fixed
	 * when the client is created, so a client that carries credentials must live only within that
	 * request. At module scope it would send one user's session to another user.
	 *
	 * The app decides which headers to send. Web passes Cookie during SSR; Expo may later use
	 * something like Authorization. This package provides only the transport mechanism.
	 */
	headers?: HeadersInit;
	fetch?: typeof globalThis.fetch;
	/**
	 * The browser-openable base. If omitted, it equals `baseUrl`.
	 *
	 * This second axis exists because of server rendering. SSR requests should go to the internal
	 * network (`API_INTERNAL_ORIGIN`), but the addresses produced there end up in HTML and go to the
	 * browser. If something like `http://api:3001/...` lands in an `<img src>`, no user can open it.
	 * The symptom is a broken image rather than an error, which makes it silent.
	 *
	 * It is not used for requests. Only the address builder (`media.url`) reads it, so no request goes
	 * to the public address and no SSR round trip is added.
	 */
	publicBaseUrl?: string;
}

export interface RowCatClient {
	stories: StoriesApi;
	/**
	 * Public runtime config: the only product resource callable without a session.
	 *
	 * It is separate from `admin` (see that file's header). Both read the same values, but their
	 * callers are opposite. If web and mobile import only this, the ops console's functions stay out
	 * of their bundles.
	 */
	ops: OpsApi;
	/**
	 * Ops console, used only by `apps/admin`.
	 *
	 * It is separate from `moderation` because the consumers differ. The moderation resource has
	 * public report intake and appeals from sanctioned users, while everything here is an
	 * operator-only query. Enforcement still goes through the single `moderation.act()`; no second
	 * moderation client is created.
	 */
	admin: AdminApi;
	/**
	 * Story comments. The path sits under a story, but the resource is separate because its lifetime
	 * and policy differ from the story's (see the file header).
	 */
	comments: CommentsApi;
	/**
	 * Public profile. Same members as `me`, but on the opposite axis. `me` is always the requester's
	 * own data and has no slot for a target. Here the data is public to anyone, so the target arrives
	 * as an argument.
	 */
	creators: CreatorsApi;
	me: MeApi;
	/**
	 * Media URL. This is a rule, not a request. Values that store only a reference (`mediaId`), such
	 * as scene images, use it to build their address. See the header of `media.ts`.
	 */
	media: MediaApi;
	/**
	 * Membership: age declaration and guardian consent.
	 *
	 * Separated from `me` because the identity is two. Half of this resource enters through a session
	 * and the other half through a one-time token, and the caller can be a different person (a
	 * guardian) who has no account. Putting it inside `me` would make "belongs to the requester" false
	 * for half the resource.
	 */
	membership: MembershipApi;
	/**
	 * Adult verification. Sits next to `membership` but is kept separate.
	 *
	 * It could go on `me`, since the path is under `/me/adult-verification` and the identity is a
	 * single session. But `me` is a value the whole app reads every time, while this is an explicit
	 * procedure the user starts, with its own state machine (start, verifier, complete).
	 *
	 * It is not placed in `membership` because half of that resource belongs to guardians. If a
	 * guardian's verification and the user's own verification became neighboring functions in one
	 * namespace, they would look interchangeable. That exchange would be a path to unlocking a child's
	 * adult eligibility.
	 */
	adultVerification: AdultVerificationApi;
	/**
	 * Reports, appeals, and operator tools. Three paths (`/reports`, `/me/moderation`, `/moderation`)
	 * share one resource because the domain is the same. Splitting them would make it hard to see, in
	 * one place, what shape a report takes on the way out and how the operator sees it.
	 */
	moderation: ModerationApi;
	/**
	 * In-app notifications. Sits next to `me`.
	 *
	 * The path is under `/me/notifications`, but the resource is separate. The viewer is fetched once
	 * and kept long, while notifications are appended by cursor and polled often.
	 */
	notifications: NotificationsApi;
	/**
	 * Native push registration. This is the delivery plane, not an inbox.
	 *
	 * It is separate from notifications. Notifications accumulate events by cursor and are polled
	 * often; push registration reports once per login whether this device is ready to receive.
	 */
	push: PushApi;
	/**
	 * Account theme colors. Sits next to `me`.
	 *
	 * The path is under `/me/theme-customization`, but the resource is separate, for the same reason
	 * as notifications. The viewer is read by the whole app every time, while this value is read only
	 * by the settings screen and the runtime application layer.
	 *
	 * The device's appearance preference (`system|light|dark`) is not in this resource. The server
	 * does not own that value, so it never passes through the SDK. Only the account's colors belong
	 * here.
	 */
	theme: ThemeApi;
	favorites: FavoritesApi;
	/**
	 * Follow and block: relationships attached to members. Separate from favorites because the target
	 * differs. Favorites attach to stories, and their paths carry a story id.
	 */
	social: SocialApi;
	chat: ChatApi;
	/**
	 * Only the transport for encrypted sync.
	 *
	 * This file only calls endpoints. When to call what (retries, chunking, conflict convergence, the
	 * state machine) is `@rowcat/sync`'s job. Reversing that would put state into the transport layer,
	 * and a future Expo app could then not use a different engine on the same SDK.
	 */
	sync: SyncApi;
}

/**
 * The RowCat API client.
 *
 * The real transport exists only once, so it is not abstracted. Adapters, pipelines, and resource
 * factories built in advance would add interfaces with a single implementation, and nothing
 * guarantees that a second implementation would fit them. Even when writes were added, the change
 * was only one function's parameter.
 */
export function createRowCatClient(options: RowCatClientOptions): RowCatClient {
	/**
	 * Refuses an empty base. With an empty base, requests become relative and go to the server that
	 * served the page (on web, the web server itself). The symptom is a strange 404, not an error.
	 * Same judgment as in base-url.ts.
	 */
	if (typeof options.baseUrl !== "string" || options.baseUrl.trim() === "")
		throw new Error(
			"createRowCatClient has no baseUrl: @rowcat/sdk has no default origin.",
		);
	// Trims the trailing slash up front. If `${base}/stories` became `//stories`, the server would
	// return 404.
	const base = options.baseUrl.replace(/\/+$/, "");
	const publicBase = (options.publicBaseUrl ?? options.baseUrl).replace(
		/\/+$/,
		"",
	);
	// Calling `globalThis.fetch` after destructuring it and invoking it directly throws "Illegal
	// invocation" in the browser.
	const doFetch =
		options.fetch ?? ((input, init) => globalThis.fetch(input, init));

	/**
	 * The default headers are built once, so the caller's object can be mutated later without changing
	 * what this client sends.
	 *
	 * The code uses `Headers` rather than object spread because header names are case-insensitive.
	 * Spreading `{Accept}` and `{accept}` would yield two entries, and the runtime would decide which
	 * one wins. `Accept` is set last so the contract's value cannot be overwritten by a passed-in
	 * header.
	 */
	const baseHeaders = new Headers(options.headers);
	baseHeaders.set("Accept", "application/json");

	/**
	 * The whole transport: build the address, attach credentials, and turn failures into errors.
	 *
	 * It stops at the raw `Response` on purpose. Each endpoint reads success bodies differently (as
	 * JSON, or not at all for 204). Keeping these settings in two copies would silently drop the SSR
	 * cookie or cancellation when only one copy is edited.
	 */
	const sendRequest = async ({
		method,
		path,
		search,
		body,
		rawBody,
		contentType,
		accept,
		headers: extraHeaders,
		signal,
	}: ApiRequest): Promise<Response> => {
		const qs = search?.toString();
		/**
		 * Headers are copied per request. Setting Content-Type on the stored baseline would leave it on
		 * bodyless GETs too, and it would share the same slot as the SSR-supplied Cookie. Editing the
		 * copy leaves that cookie untouched.
		 */
		const headers = new Headers(baseHeaders);
		if (body !== undefined) headers.set("Content-Type", "application/json");
		else if (contentType) headers.set("Content-Type", contentType);
		/**
		 * Streaming endpoints return a sequence of frames, not a JSON document. Declaring that in Accept
		 * lets a proxy decide whether to buffer or pass the response through. Failure responses still use
		 * the shared JSON envelope, so the server must be able to send both formats.
		 */
		if (accept) headers.set("Accept", `${accept}, application/json`);
		if (extraHeaders)
			for (const [name, value] of Object.entries(extraHeaders))
				headers.set(name, value);

		const response = await doFetch(`${base}${path}${qs ? `?${qs}` : ""}`, {
			method,
			headers,
			/**
			 * Serialization is decided by which field the body arrived in, not by guessing from the value's
			 * shape. Splitting on `typeof body === "object"` would send a `Blob` down the JSON branch,
			 * producing "{}".
			 */
			body:
				body !== undefined
					? JSON.stringify(body)
					: (rawBody as BodyInit | undefined),
			/**
			 * Web and the API are on different origins (for example example.com and api.example.com).
			 * Without the session cookie the server cannot resolve the viewer, and a logged-in user gets the
			 * anonymous gallery.
			 *
			 * On the server, `credentials` alone is not enough. Node's `fetch` has no cookie jar, so the
			 * incoming Cookie is not followed automatically; `headers` fills that in.
			 */
			credentials: "include",
			signal,
		});
		if (!response.ok) throw await apiErrorFromResponse(response);
		return response;
	};

	const transport: RowCatTransport = {
		requestJson: async (request) => (await sendRequest(request)).json(),
		/**
		 * Does not read the success body. A 204 has nothing to read, and verifying a body that is not
		 * there would turn a normal response into a contract violation. Failures already became errors
		 * above.
		 */
		requestVoid: async (request) => {
			await sendRequest(request);
		},
		/**
		 * Returns the body unread. Calling `await response.text()` here would destroy the streaming
		 * property, and the first character would appear only after generation finished.
		 *
		 * A 200 with a null `body` is a contract violation: a stream response with nothing to read. If it
		 * passed through, the caller's `for await` would end immediately and look like "generation
		 * produced nothing." The real cause would show up much later as a different symptom.
		 */
		requestStream: async (request) => {
			const response = await sendRequest(request);
			if (!response.body)
				throw new RowCatApiError({
					status: response.status,
					code: "empty_stream",
					message: "The stream response has no body.",
				});
			return response.body;
		},
	};

	return {
		stories: createStoriesApi(transport),
		ops: createOpsApi(transport),
		admin: createAdminApi(transport),
		comments: createCommentsApi(transport),
		creators: createCreatorsApi(transport),
		me: createMeApi(transport),
		media: createMediaApi(publicBase),
		membership: createMembershipApi(transport),
		adultVerification: createAdultVerificationApi(transport),
		moderation: createModerationApi(transport),
		notifications: createNotificationsApi(transport),
		push: createPushApi(transport),
		theme: createThemeApi(transport),
		favorites: createFavoritesApi(transport),
		social: createSocialApi(transport),
		chat: createChatApi(transport),
		sync: createSyncApi(transport),
	};
}
