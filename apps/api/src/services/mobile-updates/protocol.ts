import { randomBytes } from "node:crypto";
import {
	MOBILE_UPDATE_CHANNEL_HEADER,
	MOBILE_UPDATE_SIGNATURE_ALGORITHM,
	MobileRuntimeVersion,
	MobileUpdateChannel,
	MobileUpdateKeyId,
	MobileUpdatePlatform,
	mobileUpdateKeyIdChannel,
} from "@rowcat/contracts";
import { parseInstallationId } from "./rollout.ts";

/**
 * Expo Updates protocol v1: the pure layer that reads requests and builds responses.
 *
 * The spec is `docs.expo.dev/technical-specs/expo-updates-1`, and what actually reads it is the
 * app's installed `expo-updates` (57.x). Every decision here follows behavior confirmed in that
 * client's code, not remembered shapes (`docs/ota/ARCHITECTURE.md`, "what the client actually
 * does").
 *
 * ```text
 * request   expo-protocol-version: 1, expo-platform, expo-runtime-version,
 *           rowcat-update-channel (binary config), expo-expect-signature (key id), eas-client-id
 * response  no update  204 + protocol headers (no body; nothing to sign)
 *           manifest   multipart/mixed: manifest part (signature header) + extensions part
 *           directive  multipart/mixed: directive part (signature header)
 * ```
 *
 * 204 means "no update" because the spec also allows a `noUpdateAvailable` directive, but for a
 * code-signing client that directive must be signed, and the server cannot sign (no private key).
 * The client treats 204 with `expo-protocol-version > 0` as nothing available (`FileDownloader`'s
 * 204 branch).
 *
 * This layer never builds or edits a body. Manifests and directives enter and leave as the exact
 * bytes the publish tool signed; re-serializing the JSON here would break the signature.
 */

export type HeaderReader = (name: string) => string | undefined;

export interface UpdateRequest {
	platform: MobileUpdatePlatform;
	runtimeVersion: string;
	channel: MobileUpdateChannel;
	/** Key id the client verifies with; `null` for a client that did not enable code signing. */
	keyId: string | null;
	installationId: string | null;
	acceptsMultipart: boolean;
	acceptsJson: boolean;
}

export type ParsedUpdateRequest =
	| { ok: true; request: UpdateRequest }
	| { ok: false; status: 400 | 406; code: string; message: string };

/**
 * Reads an Expo SFV dictionary like `sig, keyid="x", alg="y"`, only the shapes that actually arrive
 * here.
 *
 * Entries split on commas outside quotes; a key with no value is `true`. An unrecognized shape
 * returns `null` so the caller cannot read that request as expecting no signature; it is rejected
 * (`parseUpdateRequest`).
 */
export function parseSfvDictionary(
	raw: string,
): Record<string, string | true> | null {
	const result: Record<string, string | true> = {};
	let index = 0;
	const length = raw.length;
	const skipSpaces = () => {
		while (index < length && (raw[index] === " " || raw[index] === "\t"))
			index++;
	};
	while (index < length) {
		skipSpaces();
		const keyMatch = /^[a-z*][a-z0-9_\-.*]*/.exec(raw.slice(index));
		if (!keyMatch) return null;
		const key = keyMatch[0];
		index += key.length;
		if (raw[index] === "=") {
			index++;
			if (raw[index] === '"') {
				index++;
				let value = "";
				let closed = false;
				while (index < length) {
					const char = raw[index];
					if (char === "\\") {
						const next = raw[index + 1];
						if (next !== '"' && next !== "\\") return null;
						value += next;
						index += 2;
						continue;
					}
					if (char === '"') {
						closed = true;
						index++;
						break;
					}
					value += char;
					index++;
				}
				if (!closed) return null;
				result[key] = value;
			} else {
				const tokenMatch = /^[A-Za-z0-9_\-.:/*+%]+/.exec(raw.slice(index));
				if (!tokenMatch) return null;
				result[key] = tokenMatch[0];
				index += tokenMatch[0].length;
			}
		} else {
			result[key] = true;
		}
		skipSpaces();
		if (index >= length) break;
		if (raw[index] !== ",") return null;
		index++;
	}
	return result;
}

/** SFV string item; only quotes and backslashes are escaped. */
export const sfvString = (value: string): string =>
	`"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

/**
 * Reads `accept`. Quality 0 is a refusal; other quality values are not used for ranking because the
 * content decides the format here (a directive is only expressible as multipart).
 */
function readAccept(raw: string | undefined): {
	multipart: boolean;
	json: boolean;
} {
	if (!raw) return { multipart: false, json: false };
	let multipart = false;
	let json = false;
	for (const entry of raw.split(",")) {
		const [typePart, ...params] = entry.trim().toLowerCase().split(";");
		const type = typePart?.trim() ?? "";
		const q = params
			.map((param) => param.trim())
			.find((param) => param.startsWith("q="));
		if (q && Number(q.slice(2)) === 0) continue;
		if (type === "multipart/mixed" || type === "multipart/*" || type === "*/*")
			multipart = true;
		if (
			type === "application/expo+json" ||
			type === "application/json" ||
			type === "application/*" ||
			type === "*/*"
		)
			json = true;
	}
	return { multipart, json };
}

export function parseUpdateRequest(read: HeaderReader): ParsedUpdateRequest {
	if (read("expo-protocol-version")?.trim() !== "1")
		return {
			ok: false,
			status: 406,
			code: "mobile_update_protocol_unsupported",
			message: "This server speaks only Expo Updates protocol version 1.",
		};

	const platform = MobileUpdatePlatform.safeParse(
		read("expo-platform")?.trim(),
	);
	if (!platform.success)
		return {
			ok: false,
			status: 400,
			code: "mobile_update_platform_invalid",
			message: "expo-platform must be ios or android.",
		};

	const runtimeVersion = MobileRuntimeVersion.safeParse(
		read("expo-runtime-version")?.trim(),
	);
	if (!runtimeVersion.success)
		return {
			ok: false,
			status: 400,
			code: "mobile_update_runtime_invalid",
			message: "couldn't read expo-runtime-version.",
		};

	/**
	 * The channel is carried by the binary's config (`updates.requestHeaders` in `app.config.ts`). A
	 * missing or unknown value is not folded to production, or a request naming no channel would
	 * receive production releases.
	 */
	const channel = MobileUpdateChannel.safeParse(
		read(MOBILE_UPDATE_CHANNEL_HEADER)?.trim(),
	);
	if (!channel.success)
		return {
			ok: false,
			status: 400,
			code: "mobile_update_channel_invalid",
			message: `the ${MOBILE_UPDATE_CHANNEL_HEADER} header is missing or names an unknown channel.`,
		};

	let keyId: string | null = null;
	const expectSignature = read("expo-expect-signature");
	if (expectSignature !== undefined) {
		const dictionary = parseSfvDictionary(expectSignature);
		const requestedKeyId = dictionary?.keyid;
		const requestedAlg = dictionary?.alg;
		if (
			!dictionary ||
			typeof requestedKeyId !== "string" ||
			!MobileUpdateKeyId.safeParse(requestedKeyId).success ||
			(requestedAlg !== undefined &&
				requestedAlg !== MOBILE_UPDATE_SIGNATURE_ALGORITHM)
		)
			return {
				ok: false,
				status: 400,
				code: "mobile_update_signature_request_invalid",
				message: "couldn't read expo-expect-signature.",
			};
		/**
		 * The key id's channel must equal the request channel. A mismatch means the binary's config is
		 * off (one channel's certificate baked into another's profile), and either release would be a
		 * wrong answer.
		 */
		if (mobileUpdateKeyIdChannel(requestedKeyId) !== channel.data)
			return {
				ok: false,
				status: 400,
				code: "mobile_update_channel_key_mismatch",
				message:
					"the signing key id's channel differs from the request channel.",
			};
		keyId = requestedKeyId;
	}

	const accept = readAccept(read("accept"));
	if (!accept.multipart && !accept.json)
		return {
			ok: false,
			status: 406,
			code: "mobile_update_accept_unsupported",
			message: "must accept multipart/mixed or application/expo+json.",
		};

	return {
		ok: true,
		request: {
			platform: platform.data,
			runtimeVersion: runtimeVersion.data,
			channel: channel.data,
			keyId,
			installationId: parseInstallationId(read("eas-client-id")),
			acceptsMultipart: accept.multipart,
			acceptsJson: accept.json,
		},
	};
}

/* Responses */

export interface ProtocolResponse {
	status: 200 | 204 | 406;
	headers: Record<string, string>;
	body: string | null;
}

/**
 * Headers on every response.
 *
 * `cache-control` is 0 per the spec's recommendation: the response differs per install (rollout
 * bucket) and must change immediately when state changes (pause). In a shared cache one install's
 * answer would reach another and a paused release would keep going out for the cache lifetime.
 *
 * `expo-manifest-filters` carries the channel. The client does not pick a stored update whose
 * `metadata.channel` differs from that filter, so an update from another channel that got stored
 * somehow still does not run (one layer; the authority is still the per-channel signing key).
 */
export const commonHeaders = (
	channel: MobileUpdateChannel,
): Record<string, string> => ({
	"expo-protocol-version": "1",
	"expo-sfv-version": "0",
	"expo-manifest-filters": `channel=${sfvString(channel)}`,
	"cache-control": "private, max-age=0",
});

export const noUpdateResponse = (
	channel: MobileUpdateChannel,
): ProtocolResponse => ({
	status: 204,
	headers: commonHeaders(channel),
	body: null,
});

export const signatureHeader = (keyId: string, sig: string): string =>
	`sig=${sfvString(sig)}, keyid=${sfvString(keyId)}, alg=${sfvString(MOBILE_UPDATE_SIGNATURE_ALGORITHM)}`;

interface MultipartPart {
	name: "manifest" | "directive" | "extensions";
	contentType: string;
	signature?: string;
	body: string;
}

/**
 * multipart/mixed body, RFC 2046.
 *
 * The boundary is random per request. If it appeared inside a body the client would split parts
 * wrongly and fail the signature, so a boundary found in any body is re-drawn.
 */
export function buildMultipart(parts: readonly MultipartPart[]): {
	boundary: string;
	body: string;
} {
	let boundary = "";
	do {
		boundary = `rowcat-ota-${randomBytes(12).toString("hex")}`;
	} while (parts.some((part) => part.body.includes(boundary)));

	const chunks: string[] = [];
	for (const part of parts) {
		chunks.push(`--${boundary}\r\n`);
		chunks.push(`content-disposition: form-data; name="${part.name}"\r\n`);
		chunks.push(`content-type: ${part.contentType}\r\n`);
		if (part.signature) chunks.push(`expo-signature: ${part.signature}\r\n`);
		chunks.push("\r\n");
		chunks.push(part.body);
		chunks.push("\r\n");
	}
	chunks.push(`--${boundary}--\r\n`);
	return { boundary, body: chunks.join("") };
}

export interface ServedRelease {
	kind: "update" | "rollback_to_embedded";
	body: string;
	signature: string | null;
	keyId: string | null;
}

/**
 * Turns the chosen release into a response; signed bytes are not changed by a character.
 *
 * Answers with multipart whenever it is accepted (current expo-updates requests it). A JSON-only
 * client cannot be sent a directive, so it gets 406 per the spec.
 */
export function releaseResponse(
	channel: MobileUpdateChannel,
	request: Pick<UpdateRequest, "acceptsMultipart" | "acceptsJson">,
	release: ServedRelease,
): ProtocolResponse {
	const headers = commonHeaders(channel);
	const signature =
		release.signature && release.keyId
			? signatureHeader(release.keyId, release.signature)
			: undefined;

	if (request.acceptsMultipart) {
		const parts: MultipartPart[] =
			release.kind === "update"
				? [
						{
							name: "manifest",
							contentType: "application/json; charset=utf-8",
							signature,
							body: release.body,
						},
						{
							name: "extensions",
							contentType: "application/json",
							body: JSON.stringify({ assetRequestHeaders: {} }),
						},
					]
				: [
						{
							name: "directive",
							contentType: "application/json; charset=utf-8",
							signature,
							body: release.body,
						},
					];
		const multipart = buildMultipart(parts);
		return {
			status: 200,
			headers: {
				...headers,
				"content-type": `multipart/mixed; boundary=${multipart.boundary}`,
			},
			body: multipart.body,
		};
	}

	if (release.kind !== "update") return { status: 406, headers, body: null };

	return {
		status: 200,
		headers: {
			...headers,
			"content-type": "application/expo+json",
			...(signature ? { "expo-signature": signature } : {}),
		},
		body: release.body,
	};
}
