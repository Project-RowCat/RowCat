import { describe, expect, it } from "vitest";
import {
	buildMultipart,
	noUpdateResponse,
	parseSfvDictionary,
	parseUpdateRequest,
	releaseResponse,
} from "./protocol.ts";

/**
 * Protocol layer: reads request headers and puts signed bytes into responses unchanged.
 *
 * Header names and shapes are exactly what the installed expo-updates (57.x) `FileDownloader`
 * sends: `Expo-Protocol-Version: 1`, `Expo-Platform`, `Expo-Runtime-Version`, `EAS-Client-ID`,
 * `Accept: multipart/mixed,application/expo+json,application/json`, `expo-expect-signature: sig,
 * keyid="…", alg="rsa-v1_5-sha256"`.
 */

const CLIENT_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

const headersOf = (overrides: Record<string, string | undefined> = {}) => {
	const headers: Record<string, string | undefined> = {
		"expo-protocol-version": "1",
		"expo-platform": "ios",
		"expo-runtime-version": "rowcat-native-1",
		"rowcat-update-channel": "production",
		"expo-expect-signature":
			'sig, keyid="rowcat-production-1", alg="rsa-v1_5-sha256"',
		"eas-client-id": CLIENT_ID,
		accept: "multipart/mixed,application/expo+json,application/json",
		...overrides,
	};
	return (name: string) => headers[name.toLowerCase()];
};

describe("request", () => {
	it("reads the request expo-updates sends", () => {
		const parsed = parseUpdateRequest(headersOf());
		expect(parsed).toEqual({
			ok: true,
			request: {
				platform: "ios",
				runtimeVersion: "rowcat-native-1",
				channel: "production",
				keyId: "rowcat-production-1",
				installationId: CLIENT_ID,
				acceptsMultipart: true,
				acceptsJson: true,
			},
		});
	});

	it("anything other than protocol version 1 is a 406", () => {
		expect(
			parseUpdateRequest(headersOf({ "expo-protocol-version": "0" })),
		).toMatchObject({ ok: false, status: 406 });
		expect(
			parseUpdateRequest(headersOf({ "expo-protocol-version": undefined })),
		).toMatchObject({ ok: false, status: 406 });
	});

	it("an unknown platform is a 400", () => {
		expect(
			parseUpdateRequest(headersOf({ "expo-platform": "web" })),
		).toMatchObject({ ok: false, status: 400 });
	});

	it("an unreadable runtime is a 400", () => {
		expect(
			parseUpdateRequest(headersOf({ "expo-runtime-version": "2.0.0" })),
		).toMatchObject({ ok: false, status: 400 });
	});

	/** Folding a channel-less request to production would give production code to a binary that named no channel. */
	it("not stating the channel is a 400, not a fold into production", () => {
		expect(
			parseUpdateRequest(headersOf({ "rowcat-update-channel": undefined })),
		).toMatchObject({ ok: false, status: 400 });
		expect(
			parseUpdateRequest(headersOf({ "rowcat-update-channel": "staging" })),
		).toMatchObject({ ok: false, status: 400 });
	});

	it("a key id whose channel differs from the request channel is a 400", () => {
		expect(
			parseUpdateRequest(
				headersOf({
					"expo-expect-signature":
						'sig, keyid="rowcat-testflight-1", alg="rsa-v1_5-sha256"',
				}),
			),
		).toMatchObject({
			ok: false,
			status: 400,
			code: "mobile_update_channel_key_mismatch",
		});
	});

	it("a request that doesn't expect a signature has no key id (the service gives nothing)", () => {
		const parsed = parseUpdateRequest(
			headersOf({ "expo-expect-signature": undefined }),
		);
		expect(parsed.ok && parsed.request.keyId).toBe(null);
	});

	it("an unreadable signature expectation is refused, not ignored", () => {
		expect(
			parseUpdateRequest(
				headersOf({ "expo-expect-signature": 'sig, keyid="' }),
			),
		).toMatchObject({ ok: false, status: 400 });
		expect(
			parseUpdateRequest(
				headersOf({
					"expo-expect-signature":
						'sig, keyid="rowcat-production-1", alg="rsa-v1_5-sha1"',
				}),
			),
		).toMatchObject({ ok: false, status: 400 });
	});

	it("a missing or invalid install identifier is null", () => {
		const parsed = parseUpdateRequest(headersOf({ "eas-client-id": "nope" }));
		expect(parsed.ok && parsed.request.installationId).toBe(null);
	});

	it("no acceptable format is a 406", () => {
		expect(
			parseUpdateRequest(headersOf({ accept: "text/html" })),
		).toMatchObject({ ok: false, status: 406 });
		expect(
			parseUpdateRequest(headersOf({ accept: "multipart/mixed;q=0" })),
		).toMatchObject({ ok: false, status: 406 });
	});
});

describe("SFV dictionary", () => {
	it("reads the shape expo-updates builds", () => {
		expect(
			parseSfvDictionary('sig, keyid="root", alg="rsa-v1_5-sha256"'),
		).toEqual({ sig: true, keyid: "root", alg: "rsa-v1_5-sha256" });
	});

	it("unescapes, and doesn't split on commas inside quotes", () => {
		expect(parseSfvDictionary('a="x,\\"y\\"", b=token')).toEqual({
			a: 'x,"y"',
			b: "token",
		});
	});
});

/**
 * Imitates the multipart reader: split on the boundary, split part head and body on CRLF CRLF. Same
 * rule as the client's `UpdatesMultipartStreamReader`; the only thing that matters here is whether
 * the body bytes equal the signed string exactly.
 */
function readMultipart(contentType: string, body: string) {
	const boundary = /boundary=([^;]+)/.exec(contentType)?.[1];
	if (!boundary) throw new Error("no boundary");
	const segments = body.split(`--${boundary}`);
	expect(segments.at(-1)).toBe("--\r\n");
	return segments.slice(1, -1).map((segment) => {
		expect(segment.startsWith("\r\n")).toBe(true);
		expect(segment.endsWith("\r\n")).toBe(true);
		const inner = segment.slice(2, -2);
		const split = inner.indexOf("\r\n\r\n");
		const headers = Object.fromEntries(
			inner
				.slice(0, split)
				.split("\r\n")
				.map((line) => {
					const colon = line.indexOf(":");
					return [
						line.slice(0, colon).toLowerCase(),
						line.slice(colon + 1).trim(),
					];
				}),
		);
		return { headers, body: inner.slice(split + 4) };
	});
}

describe("response", () => {
	const manifest = JSON.stringify({
		id: "x",
		note: "line break\r\n and \ud55c\uae00",
	});

	it("no update is a 204 with the protocol headers — there is no body to sign", () => {
		const response = noUpdateResponse("production");
		expect(response.status).toBe(204);
		expect(response.body).toBeNull();
		expect(response.headers["expo-protocol-version"]).toBe("1");
		expect(response.headers["expo-sfv-version"]).toBe("0");
		expect(response.headers["cache-control"]).toBe("private, max-age=0");
		expect(response.headers["expo-manifest-filters"]).toBe(
			'channel="production"',
		);
	});

	it("the manifest part's body is the signed bytes as is, with the signature header attached", () => {
		const response = releaseResponse(
			"production",
			{ acceptsMultipart: true, acceptsJson: true },
			{
				kind: "update",
				body: manifest,
				signature: "c2ln",
				keyId: "rowcat-production-1",
			},
		);
		expect(response.status).toBe(200);
		const parts = readMultipart(
			response.headers["content-type"] as string,
			response.body as string,
		);
		expect(parts).toHaveLength(2);
		const [manifestPart, extensionsPart] = parts;
		expect(manifestPart?.headers["content-disposition"]).toBe(
			'form-data; name="manifest"',
		);
		expect(manifestPart?.body).toBe(manifest);
		expect(manifestPart?.headers["expo-signature"]).toBe(
			'sig="c2ln", keyid="rowcat-production-1", alg="rsa-v1_5-sha256"',
		);
		expect(extensionsPart?.headers["content-disposition"]).toBe(
			'form-data; name="extensions"',
		);
		expect(JSON.parse(extensionsPart?.body ?? "")).toEqual({
			assetRequestHeaders: {},
		});
	});

	it("a rollback instruction goes out as the directive part", () => {
		const directive = JSON.stringify({
			type: "rollBackToEmbedded",
			parameters: { commitTime: "2026-10-03T00:00:00.000Z" },
		});
		const response = releaseResponse(
			"preview",
			{ acceptsMultipart: true, acceptsJson: false },
			{
				kind: "rollback_to_embedded",
				body: directive,
				signature: "c2ln",
				keyId: "rowcat-preview-1",
			},
		);
		const [part] = readMultipart(
			response.headers["content-type"] as string,
			response.body as string,
		);
		expect(part?.headers["content-disposition"]).toBe(
			'form-data; name="directive"',
		);
		expect(part?.body).toBe(directive);
	});

	it("for a client that accepts only JSON, the manifest is the body as is and a directive is a 406", () => {
		const json = releaseResponse(
			"production",
			{ acceptsMultipart: false, acceptsJson: true },
			{
				kind: "update",
				body: manifest,
				signature: "c2ln",
				keyId: "rowcat-production-1",
			},
		);
		expect(json.body).toBe(manifest);
		expect(json.headers["expo-signature"]).toContain('sig="c2ln"');
		expect(
			releaseResponse(
				"production",
				{ acceptsMultipart: false, acceptsJson: true },
				{
					kind: "rollback_to_embedded",
					body: "{}",
					signature: "c2ln",
					keyId: "rowcat-production-1",
				},
			).status,
		).toBe(406);
	});

	it("the boundary doesn't appear in the body", () => {
		for (let index = 0; index < 20; index++) {
			const { boundary, body } = buildMultipart([
				{ name: "manifest", contentType: "application/json", body: manifest },
			]);
			expect(manifest.includes(boundary)).toBe(false);
			expect(body.split(`--${boundary}`)).toHaveLength(3);
		}
	});
});
