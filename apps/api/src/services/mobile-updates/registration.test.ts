import { describe, expect, it } from "vitest";
import {
	certificatesFor,
	signBody,
	testBundle,
	testKey,
} from "../../test/mobile-updates.ts";
import { validateReleaseBundle } from "./registration.ts";
import { verifyBodySignature } from "./signature.ts";

/**
 * Registration verdict: only what the signed body says gets registered.
 *
 * The client re-verifies signatures, but a mismatched bundle in the DB would make the server pick
 * from the wrong stream. The mismatch is caught at registration, not on a device.
 */

const context = {
	deploymentApiOrigin: "http://localhost:3001",
	certificates: certificatesFor(
		"rowcat-production-1",
		"rowcat-preview-1",
		"rowcat-testflight-1",
	),
	now: new Date(),
};

const problemsOf = (raw: unknown) => {
	const result = validateReleaseBundle(raw, context);
	return result.ok ? [] : result.problems;
};

describe("signatures", () => {
	it("accepts a correctly signed bundle", () => {
		expect(problemsOf(testBundle())).toEqual([]);
	});

	it("refuses when even one character of the body changes after signing", () => {
		const bundle = testBundle();
		const tampered = {
			...bundle,
			body: bundle.body.replace("RowCat", "RowCaT"),
		};
		expect(problemsOf(tampered).join()).toContain(
			"the signature doesn't match the body",
		);
	});

	it("refuses a bundle signed with another channel's key", () => {
		const bundle = testBundle({ channel: "production" });
		const previewKey = testKey("rowcat-preview-1");
		const forged = {
			...bundle,
			signatures: [
				{
					keyId: "rowcat-preview-1",
					alg: "rsa-v1_5-sha256" as const,
					sig: signBody(bundle.body, previewKey),
				},
			],
		};
		expect(problemsOf(forged).join()).toContain("not a production channel key");
	});

	it("refuses when the name matches but another private key signed it", () => {
		const bundle = testBundle({ channel: "production" });
		const wrong = testKey("rowcat-preview-1");
		const forged = {
			...bundle,
			signatures: [
				{
					keyId: "rowcat-production-1",
					alg: "rsa-v1_5-sha256" as const,
					sig: signBody(bundle.body, wrong),
				},
			],
		};
		expect(problemsOf(forged).join()).toContain(
			"the signature doesn't match the body",
		);
	});

	it("refuses a key without a trusted certificate", () => {
		const bundle = testBundle({ keyId: "rowcat-production-2" });
		expect(problemsOf(bundle).join()).toContain(
			"no trusted certificate was given",
		);
	});

	it("a bundle without a signature is refused at the format stage", () => {
		expect(
			problemsOf({ ...testBundle(), signatures: [] }).length,
		).toBeGreaterThan(0);
	});

	it("verification is over the body's UTF-8 bytes", () => {
		const key = testKey("rowcat-preview-1");
		const body = '{"note":"\ud55c\uae00"}';
		expect(
			verifyBodySignature(body, signBody(body, key), key.certificatePem),
		).toBe(true);
		expect(
			verifyBodySignature(`${body} `, signBody(body, key), key.certificatePem),
		).toBe(false);
	});
});

describe("body and structured fields", () => {
	it("refuses when the bundle claims another channel", () => {
		const bundle = testBundle({ channel: "preview" });
		const lie = {
			...bundle,
			release: { ...bundle.release, channel: "production" as const },
			/** The signature is valid but the key is not production's; both layers catch it. */
		};
		expect(problemsOf(lie).length).toBeGreaterThan(0);
	});

	it("refuses when the bundle's runtime differs from the body", () => {
		const bundle = testBundle({ runtimeVersion: "rowcat-native-1" });
		const lie = {
			...bundle,
			release: { ...bundle.release, runtimeVersion: "rowcat-native-2" },
		};
		expect(problemsOf(lie).join()).toContain("runtime");
	});

	it("refuses when the bundle's platform differs from the body", () => {
		const bundle = testBundle({ platform: "ios" });
		const lie = {
			...bundle,
			release: { ...bundle.release, platform: "android" as const },
		};
		expect(problemsOf(lie).join()).toContain("platform");
	});

	it("a bundle for another backend isn't registered on this deployment", () => {
		expect(
			problemsOf(testBundle({ apiOrigin: "https://api.example.com" })).join(),
		).toContain("API origin");
	});

	it("refuses when the asset list differs from the signed manifest", () => {
		const bundle = testBundle();
		const [launch] = bundle.assets;
		const extra = {
			...bundle,
			assets: [
				...bundle.assets,
				{ ...(launch as (typeof bundle.assets)[number]), key: "smuggled" },
			],
		};
		expect(problemsOf(extra).join()).toContain("asset list");
	});

	it("refuses when an asset address isn't a hash address", () => {
		const bundle = testBundle({ assetBase: "https://cdn.example.test" });
		const body = bundle.body.replace(
			/sha256\/[0-9a-f]{64}/,
			`sha256/${"0".repeat(64)}`,
		);
		const key = testKey("rowcat-production-1");
		const manifest = JSON.parse(body);
		const resigned = {
			...bundle,
			body,
			signatures: [
				{
					keyId: "rowcat-production-1",
					alg: "rsa-v1_5-sha256" as const,
					sig: signBody(body, key),
				},
			],
			assets: [
				{ ...manifest.launchAsset, byteSize: 1 },
				...manifest.assets.map((asset: object) => ({ ...asset, byteSize: 1 })),
			],
		};
		expect(problemsOf(resigned).join()).toContain("not a hash address");
	});

	it("assets of a non-local deployment must be https", () => {
		const remote = {
			...context,
			deploymentApiOrigin: "https://sandbox-api.example.com",
		};
		const bundle = testBundle({
			apiOrigin: "https://sandbox-api.example.com",
			assetBase: "http://cdn.example.com",
			channel: "testflight",
		});
		const result = validateReleaseBundle(bundle, remote);
		expect(result.ok ? "" : result.problems.join()).toContain("not https");
	});

	it("a rollback instruction must have no assets and a matching time", () => {
		expect(problemsOf(testBundle({ kind: "rollback_to_embedded" }))).toEqual(
			[],
		);
	});

	it("the same content gives the same content key", () => {
		const a = validateReleaseBundle(testBundle({ content: "same" }), context);
		const b = validateReleaseBundle(testBundle({ content: "same" }), context);
		const c = validateReleaseBundle(testBundle({ content: "other" }), context);
		expect(a.ok && b.ok && a.release.contentKey === b.release.contentKey).toBe(
			true,
		);
		expect(a.ok && c.ok && a.release.contentKey !== c.release.contentKey).toBe(
			true,
		);
	});
});
