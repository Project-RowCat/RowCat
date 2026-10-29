import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Pins the push delivery plane's boundaries, which types cannot catch: which file may know what.
 * The rules themselves are checked elsewhere (classification in `expo.test.ts`, copy in
 * `copy.test.ts`, state machine in `delivery.test.ts`, registration in `routes/me/push.test.ts`).
 *
 * The three costliest mistakes caught here:
 *
 * ```text
 * calling the provider inside the notification transaction   event correctness hangs on an external service
 * delivery editing notification rows                         push becomes the inbox's authority
 * broadcast making a round trip per member                   one set operation becomes N
 * ```
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));

function sources(dir: string, files: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "test") continue;
			sources(full, files);
		} else if (
			/\.tsx?$/.test(entry.name) &&
			!entry.name.endsWith(".test.ts") &&
			!entry.name.endsWith(".test.tsx")
		)
			files.push(full);
	}
	return files;
}

const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const all = sources(SRC).map((path) => ({
	path: path.slice(SRC.length),
	text: stripComments(readFileSync(path, "utf8")),
}));

const fileAt = (path: string) => {
	const found = all.find((file) => file.path === path);
	if (!found) throw new Error(`${path} is missing`);
	return found.text;
};

const pushFiles = all.filter((file) => file.path.startsWith("services/push/"));

describe("the files to check actually exist", () => {
	test("the delivery plane is in place", () => {
		for (const path of [
			"services/push/copy.ts",
			"services/push/enqueue.ts",
			"services/push/expo.ts",
			"services/push/delivery.ts",
			"services/push/registrations.ts",
			"jobs/push/deliver-push.ts",
			"routes/me/push.ts",
			"lib/push-config.ts",
		])
			expect(() => fileAt(path)).not.toThrow();
	});
});

describe("one place knows the provider", () => {
	/**
	 * Destination, error codes and batch cap leaking out of the adapter go stale when the provider
	 * changes. Above all, once the notification path knows that name it will want to call it inside
	 * the transaction.
	 */
	test("only the adapter file knows exp.host", () => {
		const knowers = all
			.filter((file) => /exp\.host/.test(file.text))
			.map((file) => file.path);
		expect(knowers).toEqual(["services/push/expo.ts"]);
	});

	test("only the adapter file knows provider error codes too", () => {
		const knowers = all
			.filter((file) =>
				/DeviceNotRegistered|MessageRateExceeded/.test(file.text),
			)
			.map((file) => file.path);
		expect(knowers).toEqual(["services/push/expo.ts"]);
	});

	/** Deployment config must not set the destination; changing it would amount to forging responses. */
	test("doesn't open the destination through an environment variable", () => {
		expect(fileAt("services/push/expo.ts")).not.toMatch(/process\.env|env\./);
		expect(fileAt("config/env-schema.ts")).not.toMatch(
			/EXPO_PUSH_URL|PUSH_URL/,
		);
	});
});

describe("the notification transaction doesn't go outward", () => {
	/** A single `fetch` on `createNotification`'s path ties event correctness to an external service's availability; enqueue must be one INSERT. */
	test("enqueue knows neither the network nor the provider", () => {
		const enqueue = fileAt("services/push/enqueue.ts");
		expect(enqueue).not.toMatch(/\bfetch\s*\(/);
		expect(enqueue).not.toMatch(/exp\.host|ExpoPush|expoAccessToken/);
		expect(enqueue).not.toMatch(/sendPushMessages|readPushReceipts/);
	});

	test("the notification service doesn't call the provider", () => {
		const notifications = fileAt("services/notifications.ts");
		expect(notifications).not.toMatch(/\bfetch\s*\(/);
		expect(notifications).not.toMatch(/sendPushMessages|pushCopyFor/);
		/** Deliveries are created through one path. */
		expect(notifications).toContain("enqueuePushDeliveries(");
	});

	/** Transport config must not decide whether to create a delivery; this layer answers only "is there something to deliver", so turning transport on later is not a code change. */
	test("enqueue doesn't look at the transport config", () => {
		expect(fileAt("services/push/enqueue.ts")).not.toMatch(
			/pushEnabled|pushTransportConfig|PUSH_TRANSPORT/,
		);
	});
});

describe("one entitlement predicate", () => {
	/**
	 * Creator and sender read the same fragment. Behavior is checked by value in `delivery.test.ts`;
	 * this blocks copies of the fragment: rewritten by hand, one side drops a condition with no error
	 * (and sends banners to ineligible registrations).
	 */
	test("both consumers read the shared predicate", () => {
		for (const path of [
			"services/push/enqueue.ts",
			"services/push/delivery.ts",
		])
			expect(fileAt(path), path).toContain("activePushRegistrationPredicate");
	});

	test("no place rewrites the predicate by hand", () => {
		const owners = all
			.filter((file) => /disabled_at[\s\S]{0,240}expiresAt/.test(file.text))
			.map((file) => file.path);
		expect(owners).toEqual(["services/push/registrations.ts"]);
	});
});

describe("a broadcast stays a set", () => {
	/** Looping per member makes this take time proportional to member count with the transaction open; it must pass the notification INSERT's `returning` straight through. */
	for (const path of ["services/admin/app-update-notice.ts"])
		test(`${path} doesn't round-trip per member`, () => {
			const source = fileAt(path);
			expect(source).toContain('returning "id"');
			expect(source).toContain("enqueuePushDeliveries(");
			/** No notification or delivery is created inside a loop. */
			expect(source).not.toMatch(/for\s*\([^)]*\)\s*\{[^}]*createNotification/);
			expect(source).not.toMatch(/\.map\([^)]*=>\s*createNotification/);
			expect(source).not.toMatch(/\.map\([^)]*=>\s*enqueuePushDeliveries/);
		});
});

describe("delivery is not the inbox's authority", () => {
	/** This slice's promise: whatever delivery does, the notification row stays as it is (existence, timestamp, read state). */
	test("the delivery path doesn't modify notification rows", () => {
		for (const file of [
			...pushFiles,
			{
				path: "jobs/push/deliver-push.ts",
				text: fileAt("jobs/push/deliver-push.ts"),
			},
		]) {
			expect(file.text, file.path).not.toMatch(/update\(notification\)/);
			expect(file.text, file.path).not.toMatch(/read_at|readAt/);
			expect(file.text, file.path).not.toMatch(/markNotificationRead/);
		}
	});

	/** No user data lies in delivery rows, so the history does not become a second inbox. */
	test("delivery rows don't copy notification content", () => {
		const table = fileAt("db/tables/push.ts");
		const delivery = table.slice(table.indexOf("push_delivery"));
		for (const forbidden of ["title", "body", "kind", "actor", "story_id"])
			expect(delivery, forbidden).not.toContain(`"${forbidden}"`);
	});
});

describe("tokens don't go out", () => {
	/** No token appears anywhere in the response contract; the registration response answers one fact. */
	test("the registration response doesn't return the token", () => {
		const route = fileAt("routes/me/push.ts");
		expect(route).not.toMatch(/\btoken\b/);
	});

	/** No operations console projection carries registrations. */
	test("operations responses don't carry registrations", () => {
		const admin = all.filter((file) => file.path.startsWith("services/admin/"));
		for (const file of admin)
			expect(file.text, file.path).not.toMatch(
				/push_registration|push_delivery/,
			);
	});

	/** Readers of that column stay inside the delivery path. */
	test("few places read the registration table", () => {
		const knowers = all
			.filter((file) => /push_registration/.test(file.text))
			.map((file) => file.path)
			.sort();
		expect(knowers).toEqual([
			"db/tables/push.ts",
			"services/push/delivery.ts",
			"services/push/enqueue.ts",
			"services/push/registrations.ts",
		]);
	});
});

describe("this isn't web push", () => {
	test("no service worker, VAPID or Web Push vocabulary", () => {
		for (const file of all)
			for (const forbidden of [
				/vapid/i,
				/web-push/i,
				/serviceWorker/i,
				/PushSubscription/,
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toMatch(forbidden);
	});
});

describe("update notes are not this plane", () => {
	/** `app_update` announces that the minimum supported version rose; release news is a different thing the repository owns, and adding vocabulary would make raising the floor mean writing release notes. */
	test("notification kinds didn't grow", () => {
		const contracts = readFileSync(
			join(SRC, "..", "..", "..", "packages/contracts/src/notifications.ts"),
			"utf8",
		);
		expect(contracts).not.toMatch(/"update_note"|"push"/);
	});

	test("the delivery plane doesn't know update notes", () => {
		for (const file of pushFiles)
			expect(file.text, file.path).not.toMatch(/UpdateNote|update-note/);
	});
});

describe("the sync protocol didn't change by a character", () => {
	test("the codec registry has no push", () => {
		const syncFiles = all.filter((file) =>
			file.path.startsWith("services/sync"),
		);
		for (const file of syncFiles)
			expect(file.text, file.path).not.toMatch(
				/push_registration|push_delivery/,
			);
	});
});
