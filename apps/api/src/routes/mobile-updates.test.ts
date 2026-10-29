import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { closeDb, db } from "../db/client.ts";
import {
	mobile_update_release,
	mobile_update_release_event,
} from "../db/schema.ts";
import { env } from "../env.ts";
import * as mobileUpdateService from "../services/mobile-updates/index.ts";
import {
	MobileUpdateError,
	planRollback,
	registerRelease,
	transitionRelease,
} from "../services/mobile-updates/index.ts";
import { validateReleaseBundle } from "../services/mobile-updates/registration.ts";
import { isInRollout } from "../services/mobile-updates/rollout.ts";
import { connectTestDatabase } from "../test/database.ts";
import { api } from "../test/http.ts";
import {
	type BundleOptions,
	certificatesFor,
	testBundle,
} from "../test/mobile-updates.ts";

/**
 * OTA manifest endpoint, over real Postgres and the real Hono app. The pure decisions (rollout
 * bucket, selection, protocol shape, registration validation) have their own tests; this file
 * checks that they mesh with the query: releases for the wrong platform, runtime, channel or key
 * never reach the response, and state transitions show on the next request.
 *
 * Each stream uses this file's own runtime generation (`rowcat-native-<random>`), so it never
 * shares a stream with releases from other tests or the dev DB and cleanup cannot touch foreign
 * rows.
 */

const ready = await connectTestDatabase();
const created: string[] = [];
const runtime = `rowcat-native-${900000 + Math.floor(Math.random() * 99999)}`;
const otherRuntime = `rowcat-native-${800000 + Math.floor(Math.random() * 99999)}`;

const certificates = certificatesFor(
	"rowcat-production-1",
	"rowcat-preview-1",
	"rowcat-testflight-1",
	"rowcat-production-2",
);

let clock = Date.now() - 60 * 60 * 1000;
const nextTime = () => {
	clock += 1000;
	return new Date(clock);
};

async function publish(
	options: BundleOptions,
	rolloutPercentage: number | null = 100,
): Promise<string> {
	const bundle = testBundle({
		runtimeVersion: runtime,
		apiOrigin: env.API_ORIGIN,
		createdAt: nextTime(),
		...options,
	});
	const validation = validateReleaseBundle(bundle, {
		deploymentApiOrigin: env.API_ORIGIN,
		certificates,
		now: new Date(),
	});
	if (!validation.ok) throw new Error(validation.problems.join("\n"));
	const result = await registerRelease(validation.release, {
		rolloutPercentage,
		actor: "test",
		reason: "",
		allowDuplicateContent: false,
	});
	created.push(result.id);
	return result.id;
}

const installation = () => randomUUID();

const manifestRequest = (
	overrides: Record<string, string | undefined> = {},
) => {
	const headers: Record<string, string> = {};
	const base: Record<string, string | undefined> = {
		"expo-protocol-version": "1",
		"expo-platform": "ios",
		"expo-runtime-version": runtime,
		"rowcat-update-channel": "production",
		"expo-expect-signature":
			'sig, keyid="rowcat-production-1", alg="rsa-v1_5-sha256"',
		"eas-client-id": installation(),
		accept: "multipart/mixed,application/expo+json,application/json",
		...overrides,
	};
	for (const [name, value] of Object.entries(base))
		if (value !== undefined) headers[name] = value;
	return api("/mobile/updates/manifest", { headers, origin: null });
};

const servedId = async (response: Response): Promise<string | null> => {
	if (response.status === 204) return null;
	expect(response.status).toBe(200);
	const text = await response.text();
	const match = /"id":"([0-9a-f-]{36})"/.exec(text);
	if (match) return match[1] as string;
	if (text.includes("rollBackToEmbedded")) return "rollback-to-embedded";
	throw new Error(`unreadable response: ${text.slice(0, 200)}`);
};

afterAll(async () => {
	if (ready && created.length > 0) {
		await db
			.delete(mobile_update_release_event)
			.where(inArray(mobile_update_release_event.release_id, created));
		await db
			.delete(mobile_update_release)
			.where(inArray(mobile_update_release.id, created));
	}
	await closeDb();
});

describe.skipIf(!ready)("selection", () => {
	let iosProduction = "";

	beforeAll(async () => {
		iosProduction = await publish({ platform: "ios", channel: "production" });
		await publish({ platform: "android", channel: "production" });
		await publish({ platform: "ios", channel: "preview" });
		await publish({ platform: "ios", channel: "testflight" });
		await publish({ platform: "ios", runtimeVersion: otherRuntime });
	});

	test("gives the release for the right platform, channel and runtime, with its signature", async () => {
		const response = await manifestRequest();
		expect(response.headers.get("content-type")).toMatch(/^multipart\/mixed/);
		expect(response.headers.get("cache-control")).toBe("private, max-age=0");
		const text = await response.clone().text();
		expect(text).toContain('expo-signature: sig="');
		expect(text).toContain('keyid="rowcat-production-1"');
		expect(await servedId(response)).toBe(iosProduction);
	});

	test("doesn't give another platform's release", async () => {
		const id = await servedId(await manifestRequest());
		const android = await servedId(
			await manifestRequest({ "expo-platform": "android" }),
		);
		expect(android).not.toBe(id);
		expect(android).not.toBeNull();
	});

	test("a binary with a different runtime receives nothing", async () => {
		const response = await manifestRequest({
			"expo-runtime-version": "rowcat-native-1",
		});
		/** The dev DB may hold a real rowcat-native-1 release, so assert "not ours". */
		const id = await servedId(response);
		expect(created).not.toContain(id);
	});

	test("preview and testflight releases don't reach production binaries, and the reverse", async () => {
		const production = await servedId(await manifestRequest());
		const preview = await servedId(
			await manifestRequest({
				"rowcat-update-channel": "preview",
				"expo-expect-signature": 'sig, keyid="rowcat-preview-1"',
			}),
		);
		const testflight = await servedId(
			await manifestRequest({
				"rowcat-update-channel": "testflight",
				"expo-expect-signature": 'sig, keyid="rowcat-testflight-1"',
			}),
		);
		expect(new Set([production, preview, testflight]).size).toBe(3);
	});

	test("a release without the requested key's signature is not a candidate", async () => {
		const response = await manifestRequest({
			"expo-expect-signature": 'sig, keyid="rowcat-production-2"',
		});
		expect(response.status).toBe(204);
		expect(response.headers.get("expo-protocol-version")).toBe("1");
	});

	test("gives nothing to a client that doesn't expect a signature", async () => {
		const response = await manifestRequest({
			"expo-expect-signature": undefined,
		});
		expect(response.status).toBe(204);
	});

	test("called without a session — it neither reads nor writes cookies", async () => {
		const response = await manifestRequest();
		expect(response.headers.getSetCookie()).toEqual([]);
	});
});

describe.skipIf(!ready)("rollout and state", () => {
	test("staged rollout: outside the bucket gets the previous release, and raising the rollout keeps installs that already received it", async () => {
		const platform = "android" as const;
		const channel = "testflight" as const;
		const headers = (client: string) => ({
			"expo-platform": platform,
			"rowcat-update-channel": channel,
			"expo-expect-signature": 'sig, keyid="rowcat-testflight-1"',
			"eas-client-id": client,
		});
		const a = await publish({ platform, channel });
		const b = await publish({ platform, channel }, 10);

		const clients = Array.from({ length: 80 }, installation);
		const inside = clients.filter((client) => isInRollout(b, client, 10));
		const outside = clients.filter((client) => !isInRollout(b, client, 10));
		expect(inside.length).toBeGreaterThan(0);

		for (const client of inside.slice(0, 3))
			for (let launch = 0; launch < 3; launch++)
				expect(await servedId(await manifestRequest(headers(client)))).toBe(b);
		for (const client of outside.slice(0, 3))
			expect(await servedId(await manifestRequest(headers(client)))).toBe(a);

		await transitionRelease(b, {
			action: "rollout",
			rolloutPercentage: 25,
			actor: "test",
			reason: "",
		});
		for (const client of inside.slice(0, 3))
			expect(await servedId(await manifestRequest(headers(client)))).toBe(b);

		await expect(
			transitionRelease(b, {
				action: "rollout",
				rolloutPercentage: 10,
				actor: "test",
				reason: "",
			}),
		).rejects.toMatchObject({ code: "mobile_update_rollout_decrease" });

		/** Pause: an installation asking anew does not get B. */
		await transitionRelease(b, {
			action: "pause",
			actor: "test",
			reason: "bad",
		});
		for (const client of inside.slice(0, 3))
			expect(await servedId(await manifestRequest(headers(client)))).toBe(a);

		/** Resuming gives the same bucket the same answer. */
		await transitionRelease(b, { action: "resume", actor: "test", reason: "" });
		expect(
			await servedId(await manifestRequest(headers(inside[0] as string))),
		).toBe(b);

		/** The rollback plan points at A, and the rolled-back B is not selected again. */
		const plan = await planRollback(b);
		expect(plan?.previousGood?.id).toBe(a);
		expect(plan?.newerActive).toEqual([]);
		await transitionRelease(b, {
			action: "rollback",
			actor: "test",
			reason: "bad",
		});
		expect(
			await servedId(await manifestRequest(headers(inside[0] as string))),
		).toBe(a);
		await expect(
			transitionRelease(b, { action: "resume", actor: "test", reason: "" }),
		).rejects.toBeInstanceOf(MobileUpdateError);
	});

	test("a draft reaches nobody", async () => {
		const platform = "ios" as const;
		const channel = "preview" as const;
		const before = await servedId(
			await manifestRequest({
				"rowcat-update-channel": channel,
				"expo-expect-signature": 'sig, keyid="rowcat-preview-1"',
			}),
		);
		const draft = await publish({ platform, channel }, null);
		const after = await servedId(
			await manifestRequest({
				"rowcat-update-channel": channel,
				"expo-expect-signature": 'sig, keyid="rowcat-preview-1"',
			}),
		);
		expect(after).toBe(before);
		expect(after).not.toBe(draft);
	});

	test("a rollback instruction goes out as a directive", async () => {
		const platform = "android" as const;
		const channel = "preview" as const;
		await publish({ platform, channel });
		await publish({ platform, channel, kind: "rollback_to_embedded" });
		const response = await manifestRequest({
			"expo-platform": platform,
			"rowcat-update-channel": channel,
			"expo-expect-signature": 'sig, keyid="rowcat-preview-1"',
		});
		const text = await response.text();
		expect(text).toContain('name="directive"');
		expect(text).toContain("rollBackToEmbedded");
	});
});

describe.skipIf(!ready)("registration", () => {
	test("registering the same bundle again changes nothing", async () => {
		const bundle = testBundle({
			runtimeVersion: runtime,
			apiOrigin: env.API_ORIGIN,
			createdAt: nextTime(),
			platform: "ios",
			channel: "testflight",
		});
		const validation = validateReleaseBundle(bundle, {
			deploymentApiOrigin: env.API_ORIGIN,
			certificates,
			now: new Date(),
		});
		if (!validation.ok) throw new Error(validation.problems.join());
		const options = {
			rolloutPercentage: 100,
			actor: "test",
			reason: "",
			allowDuplicateContent: false,
		};
		const first = await registerRelease(validation.release, options);
		created.push(first.id);
		const second = await registerRelease(validation.release, options);
		expect(first.created).toBe(true);
		expect(second.created).toBe(false);
	});

	test("doesn't register the same code as a second release", async () => {
		await publish({
			platform: "android",
			channel: "production",
			content: "dup",
		});
		await expect(
			publish({ platform: "android", channel: "production", content: "dup" }),
		).rejects.toMatchObject({ code: "mobile_update_duplicate_content" });
	});

	test("doesn't register a bundle older than the stream's head", async () => {
		await publish({ platform: "ios", channel: "production" });
		await expect(
			publish({
				platform: "ios",
				channel: "production",
				createdAt: new Date(clock - 10_000),
			}),
		).rejects.toMatchObject({ code: "mobile_update_release_stale" });
	});
});

describe("closing direction", () => {
	test("a request that can't be read is a 400 and gives no update", async () => {
		const response = await manifestRequest({ "expo-platform": "web" });
		expect(response.status).toBe(400);
	});

	/**
	 * A failed selection is a 503; there is no "newest release at least" fallback. A client that gets
	 * no response starts on its current bundle.
	 */
	test("a failed selection query is a 503 with no manifest", async () => {
		const spy = vi
			.spyOn(mobileUpdateService, "findServableRelease")
			.mockRejectedValueOnce(new Error("connection terminated"));
		const response = await manifestRequest();
		expect(response.status).toBe(503);
		expect(await response.text()).not.toContain("launchAsset");
		spy.mockRestore();
	});
});
