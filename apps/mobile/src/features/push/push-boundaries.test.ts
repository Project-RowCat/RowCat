import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Locks the push **wiring**: the things the type system cannot catch.
 *
 * The rules themselves are checked elsewhere: section state in `push-state.test.ts`, taps in
 * `push-response.test.ts`, installation identity in `lib/push/installation.test.ts`. What this file
 * checks is **whether those rules are actually called**, and **whether things that must not be
 * called are not**.
 *
 * The two most expensive mistakes of this slice are caught here:
 *
 * ```text
 * the app asks for permission itself    sign-in, loading or the first render shows the system prompt
 * push becomes the inbox's authority    notifications are fabricated from receipts, or read state is written
 * ```
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));

function sources(dir: string, files: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) sources(full, files);
		else if (/\.tsx?$/.test(entry.name)) files.push(full);
	}
	return files;
}

/**
 * **Checked after stripping comments.** Comments in this repository explain boundaries and
 * therefore quote the forbidden words verbatim ("do not touch the badge"). Scanning the raw text
 * would flag the sentence that explains the rule as a violation, and people would then "fix" it by
 * deleting the comment.
 */
const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const all = sources(SRC)
	.map((path) => ({
		path: path.slice(SRC.length),
		text: stripComments(readFileSync(path, "utf8")),
	}))
	.filter((file) => !file.path.endsWith("push-boundaries.test.ts"));

const product = all.filter(
	(file) => !file.path.startsWith("test/") && !/\.test\.tsx?$/.test(file.path),
);

const fileAt = (path: string) => {
	const found = product.find((file) => file.path === path);
	if (!found) throw new Error(`${path} is missing`);
	return found.text;
};

const feature = product.filter((file) =>
	file.path.startsWith("features/push/"),
);

describe("the files to check actually exist", () => {
	it("the feature and wiring are in place", () => {
		for (const path of [
			"lib/push/installation.ts",
			"lib/push/device-installation.ts",
			"lib/push/preference.ts",
			"lib/push/device-preference.ts",
			"lib/push/native.ts",
			"features/push/push-copy.ts",
			"features/push/push-response.ts",
			"features/push/push-state.ts",
			"features/push/push-registrar.ts",
			"features/push/push-provider.tsx",
			"features/push/push-section.tsx",
		])
			expect(() => fileAt(path)).not.toThrow();
	});
});

describe("doesn't ask for permission on its own", () => {
	/**
	 * There is **one** place that calls the function showing the system prompt. If several could call
	 * it, some day a screen would show the prompt while mounting, and that prompt cannot be undone
	 * (once refused, iOS does not show it again).
	 */
	it("one wiring place calls the permission request", () => {
		const callers = product
			.filter((file) => file.path !== "lib/push/native.ts")
			.filter((file) => /\brequestPushPermission\s*\(/.test(file.text))
			.map((file) => file.path);
		expect(callers).toEqual(["features/push/push-provider.tsx"]);
	});

	/** And within that wiring, only the one explicit action calls it. */
	it("the wiring's automatic path doesn't request permission", () => {
		const provider = fileAt("features/push/push-provider.tsx");
		const enable = provider.slice(provider.indexOf("const enable"));
		expect(enable).toContain("requestPushPermission(");
		const before = provider.slice(0, provider.indexOf("const enable"));
		expect(before).not.toContain("requestPushPermission(");
	});

	/** Sign-in, sign-up and loading paths know nothing about push. */
	it("identity and auth paths don't call push", () => {
		for (const path of [
			"lib/identity.tsx",
			"lib/session-transition.ts",
			"lib/auth-social.ts",
		]) {
			const text = fileAt(path);
			expect(text, path).not.toMatch(/expo-notifications/);
			expect(text, path).not.toMatch(/PushPermission|push\.register/);
		}
	});
});

describe("the native module's place is narrow", () => {
	it("one place imports expo-notifications", () => {
		const importers = product
			.filter((file) => /from\s+["']expo-notifications["']/.test(file.text))
			.map((file) => file.path);
		expect(importers).toEqual(["lib/push/native.ts"]);
	});

	/** Rules do not leak into the native file, which does not open under Node. */
	it("the native wiring holds no product rules", () => {
		const native = fileAt("lib/push/native.ts");
		expect(native).not.toMatch(/useState|useEffect|useCallback/);
		expect(native).not.toMatch(/getRowCatClient|@rowcat\/query/);
		expect(native).not.toMatch(/notificationId|resolvePushSectionState/);
	});

	/**
	 * **Do not touch the app icon badge** (V1). Pushes arrive out of order, duplicate, and can arrive
	 * after another device has already read them, so writing an absolute count as it comes would make
	 * the number go backwards.
	 */
	it("doesn't touch the app icon badge", () => {
		for (const file of product) {
			expect(file.text, file.path).not.toMatch(/setBadgeCountAsync/);
			expect(file.text, file.path).not.toMatch(/shouldSetBadge:\s*true/);
		}
	});

	/** No local notifications are scheduled: every banner this app draws is sent by the server. */
	it("doesn't schedule local notifications", () => {
		for (const file of product)
			expect(file.text, file.path).not.toMatch(
				/scheduleNotificationAsync|presentNotificationAsync/,
			);
	});
});

describe("push isn't the inbox's authority", () => {
	/**
	 * Does not create a notification from a receipt. The value has no time, actor or read state, so
	 * all of it would be fabricated, and a row the server never created would settle in the inbox.
	 */
	it("doesn't insert notifications into the cache", () => {
		for (const file of feature) {
			expect(file.text, file.path).not.toMatch(/setQueryData/);
			expect(file.text, file.path).not.toMatch(/NOTIFICATIONS_LIST_QUERY_KEY/);
		}
	});

	/** Neither delivery, receipt nor tap writes read state. */
	it("doesn't write read state", () => {
		for (const file of feature) {
			expect(file.text, file.path).not.toMatch(/markNotificationRead/);
			expect(file.text, file.path).not.toMatch(/markAllNotificationsRead/);
			expect(file.text, file.path).not.toMatch(/readAt/);
		}
	});

	/**
	 * Does not build a second destination table: the one place that interprets a `Notification` stays
	 * the inbox.
	 */
	it("doesn't rewrite destination branching", () => {
		for (const file of feature) {
			expect(file.text, file.path).not.toMatch(/notificationDestination/);
			expect(file.text, file.path).not.toMatch(/"story_comment"|"follow"/);
		}
		/** The destination is one constant. */
		expect(fileAt("features/push/push-response.ts")).toContain(
			'PUSH_TAP_ROUTE = "/notifications"',
		);
	});

	/** `push` would stack the navigator on every banner tap (the same judgement as the bell and drawer destinations). */
	it("navigation is navigate", () => {
		const provider = fileAt("features/push/push-provider.tsx");
		expect(provider).toContain("router.navigate(");
		expect(provider).not.toContain("router.push(");
	});
});

describe("neither SQLite nor sync", () => {
	/**
	 * Both are **installation** values, so they live outside member scope: the installation identity
	 * and this device's receive decision. In the member database they would vanish on account change,
	 * and a device that had been turned off would return as a candidate for auto-registration.
	 */
	it("the two things on device storage are the install identity and the delivery decision", () => {
		for (const file of feature) {
			expect(file.text, file.path).not.toMatch(/local-data\//);
			expect(file.text, file.path).not.toMatch(/local-sync\//);
			expect(file.text, file.path).not.toMatch(/SecureStore/i);
		}
		for (const path of [
			"lib/push/device-installation.ts",
			"lib/push/device-preference.ts",
		])
			expect(fileAt(path), path).toContain("deviceValueStorage");
	});

	it("the device schema doesn't know push", () => {
		expect(fileAt("lib/local-data/migrations.ts")).not.toMatch(
			/push[_-]?(token|registration|delivery|installation|preference)/i,
		);
	});

	/**
	 * **The installation's decision never goes to the server.** The contract has no slot for it
	 * (registration carries only installation id, platform, provider and token), and once it starts
	 * leaving, that value becomes an account-level notification setting. That is a different product
	 * decision.
	 */
	it("doesn't send the delivery decision to the server", () => {
		const registrar = fileAt("features/push/push-registrar.ts");
		const call = registrar.slice(registrar.indexOf("ports.register({"));
		expect(call.slice(0, call.indexOf("})"))).not.toMatch(/preference/);
		expect(fileAt("features/push/push-provider.tsx")).not.toMatch(
			/push\.register\(\s*\{[^}]*preference/,
		);
	});
});

describe("the fact of having turned it off doesn't quietly revive", () => {
	/**
	 * **The costliest mistake of this slice.** OS permission and this installation's decision are
	 * different values, so judging auto-registration by permission alone would revive an installation
	 * whose user pressed `Turn off on this device` just by restarting the app (the permission stays granted).
	 */
	it("one shared function decides automatic registration", () => {
		const provider = fileAt("features/push/push-provider.tsx");
		expect(provider).toContain("shouldRegisterPush(");
		/** Hand-writing the gate would make the copy drop the turned-off fact. */
		expect(provider).not.toMatch(/permission\s*[=!]==\s*"granted"/);
	});

	/** The decision actually reads this installation's preference. */
	it("the decision takes this install's choice as an argument", () => {
		const state = fileAt("features/push/push-state.ts");
		const gate = state.slice(
			state.indexOf("export function shouldRegisterPush"),
		);
		expect(gate).toContain('preference !== "disabled"');
	});

	/**
	 * Writing the decision in one place lets the order (write only after success) be kept in one
	 * place.
	 */
	it("one pure module writes the decision", () => {
		const writers = product
			.filter((file) => /preference\.write\(/.test(file.text))
			.map((file) => file.path);
		expect(writers).toEqual(["features/push/push-registrar.ts"]);
	});

	/**
	 * Account change and turning off this installation are different events. Clearing them together
	 * would turn one sign-out back into a candidate for auto-registration for a device that had been
	 * turned off.
	 */
	it("all it forgets is the fact of having uploaded", () => {
		const registrar = fileAt("features/push/push-registrar.ts");
		const forget = registrar.slice(registrar.indexOf("\t\tforget()"));
		expect(forget).not.toMatch(/preference/);
	});
});

describe("the settings section's place", () => {
	it("stands in general settings", () => {
		expect(fileAt("features/settings/settings-general-screen.tsx")).toContain(
			"<PushNotificationSection />",
		);
	});

	/**
	 * No switch that shows "on" on a device whose OS permission was refused. The state has six values,
	 * and three of them need different user actions.
	 */
	it("doesn't draw a switch", () => {
		expect(fileAt("features/push/push-section.tsx")).not.toMatch(/<Switch/);
	});

	/** The section holds no state; its owner is the single root wiring. */
	it("the section has no state", () => {
		const section = fileAt("features/push/push-section.tsx");
		expect(section).not.toMatch(/useState|useEffect/);
	});
});
