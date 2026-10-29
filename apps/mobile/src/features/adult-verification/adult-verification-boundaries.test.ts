import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Locks the wiring of adult verification, which types cannot catch. The rules themselves are tested
 * elsewhere (request mapping in `adult-verification-handoff.test.ts`, order/lock/ownership in
 * `adult-verification-turn.test.ts`, the platform boundary in
 * `features/account/adult-content-policy.test.ts`, the wire shape in `@rowcat/sdk`'s
 * `adult-verification.test.ts`); this file checks that they are actually passed through.
 *
 * It replaced `features/account/account-boundaries.test.ts`'s vocabulary ban on `PortOne`,
 * `adultVerification` and `react-native-webview`, which held while the provider handoff needed a
 * browser SDK with nowhere to run. That premise is gone (PortOne's React Native SDK finishes the
 * flow natively), so the check now locks where things live rather than that they are absent; a
 * vocabulary ban disappears when the feature arrives, a wiring check stays.
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
 * Scan after stripping comments: comments here explain boundaries by naming the forbidden words, so
 * scanning raw text would flag the explanation and push people to delete comments.
 */
const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const all = sources(SRC)
	.map((path) => ({
		path: path.slice(SRC.length),
		text: stripComments(readFileSync(path, "utf8")),
	}))
	.filter(
		(file) => !file.path.endsWith("adult-verification-boundaries.test.ts"),
	);

const product = all.filter(
	(file) => !file.path.startsWith("test/") && !/\.test\.tsx?$/.test(file.path),
);

const feature = product.filter((file) =>
	file.path.startsWith("features/adult-verification/"),
);

const fileAt = (path: string) => {
	const found = product.find((file) => file.path === path);
	if (!found) throw new Error(`${path} is missing`);
	return found.text;
};

describe("the files to check actually exist", () => {
	it("the feature files are all in place", () => {
		for (const path of [
			"features/adult-verification/adult-verification-copy.ts",
			"features/adult-verification/adult-verification-error.ts",
			"features/adult-verification/adult-verification-handoff.ts",
			"features/adult-verification/adult-verification-state.ts",
			"features/adult-verification/adult-verification-surface.tsx",
			"features/adult-verification/adult-verification-trigger.tsx",
			"features/adult-verification/adult-verification-turn.ts",
			"features/adult-verification/use-adult-verification.ts",
			"features/account/adult-content-policy.ts",
			"features/account/adult-visibility-control.tsx",
		])
			expect(
				product.some((file) => file.path === path),
				path,
			).toBe(true);
	});

	// If the filter above selects nothing, the checks below pass silently.
	it("the feature folder isn't empty", () => {
		expect(feature.length).toBeGreaterThan(5);
	});
});

describe("one place knows the verification authority", () => {
	// The vendor is a native-execution detail: spread across screens, swapping providers has
	// uncountable edit sites and pure rules get tied to one SDK's shape.
	it("only one surface file imports @portone/react-native-sdk", () => {
		const importers = product
			.filter((file) => /@portone\/react-native-sdk/.test(file.text))
			.map((file) => file.path)
			.sort();
		expect(importers).toEqual([
			"features/adult-verification/adult-verification-surface.tsx",
		]);
	});

	// Types come only from the one place that extracts the contract shape; a value import would ship
	// the browser-only runtime in the native bundle.
	it("the browser SDK comes in only as types, from one pure module", () => {
		const importers = product
			.filter((file) => /@portone\/browser-sdk/.test(file.text))
			.map((file) => file.path)
			.sort();
		expect(importers).toEqual([
			"features/adult-verification/adult-verification-handoff.ts",
		]);
		expect(
			fileAt("features/adult-verification/adult-verification-handoff.ts"),
		).toMatch(/import type \{[^}]*\} from "@portone\/browser-sdk\/v2"/);
	});

	// We do not draw the webview: hand-injecting the browser SDK means re-implementing SDK loading,
	// deep links, external-app switching and completion callbacks, all easy to get wrong.
	// `react-native-webview` is that SDK's peer, not our drawing tool.
	it("feature code doesn't take react-native-webview directly", () => {
		// One exception: the trusted runtime's transport layer (`lib/runtime-native/`). That WebView is
		// an execution environment, not a screen (1x1, transparent, draws nothing): Hermes has no
		// WebAssembly, so the system WebView is the only realm QuickJS WASM can run in, and creator UI is
		// drawn by React Native from patch bundles. This differs from what the check blocks (drawing the
		// verification provider's window ourselves). `features/` has no exception: a second bridge made
		// diagnostics measure a path other than production's.
		for (const file of product) {
			if (file.path.startsWith("lib/runtime-native/")) continue;
			expect(file.text, file.path).not.toMatch(/react-native-webview|<WebView/);
		}
	});

	// The app never calls the provider REST API: that lookup needs an API secret that exists only on
	// the server; holding it in the app voids the procedure's trust.
	it("neither the authority's secret nor its REST address", () => {
		for (const file of all)
			for (const forbidden of [
				/PORTONE_API_SECRET|PORTONE_API_KEY|portoneApiSecret/,
				/api\.portone\.io/,
				/EXPO_PUBLIC_PORTONE/,
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toMatch(forbidden);
	});

	// The payment surface is not brought in. The same package exports `Payment` and `IssueBillingKey`,
	// and that vocabulary here would read as a payment bypass in store review.
	it("doesn't take in payment surfaces", () => {
		for (const file of product)
			for (const forbidden of [
				/\bIssueBillingKey\b/,
				/\bPaymentUI\b/,
				/requestPayment|requestIssueBillingKey/,
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toMatch(forbidden);
	});
});

describe("the client doesn't make the verification identifier", () => {
	// This value is the procedure's channel binding. If the client chose it, someone else's
	// verification could be attached to one's own attempt. The server creates it, stores it on its row
	// and asks again with the stored value.
	it("doesn't derive it from randomness, time or the viewer id", () => {
		for (const file of feature)
			for (const forbidden of [
				/randomUUID|randomBytes|getRandomValues|Math\.random/,
				/Date\.now\(\)|new Date\(\)/,
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toMatch(forbidden);
	});

	// The only place that assigns it is the pure mapping; another assigner opens a slot for something
	// other than the server's value.
	it("one pure mapping assigns the identifier", () => {
		const writers = product
			.filter((file) => /identityVerificationId:/.test(file.text))
			.map((file) => file.path)
			.sort();
		expect(writers).toEqual([
			"features/adult-verification/adult-verification-handoff.ts",
		]);
	});

	// Nothing rides on the completion request. The contract has no body so types block it, but that
	// cannot say whether an empty object was sent; so the actual call site is checked.
	it("the completion request carries no arguments", () => {
		const hook = fileAt(
			"features/adult-verification/use-adult-verification.ts",
		);
		expect(hook).toMatch(/complete:\s*\(\)\s*=>\s*completeRef\.current\(\)/);
		expect(hook).not.toMatch(/completeRef\.current\([^)]/);
	});
});

describe("verification creates neither eligibility nor display", () => {
	// The server-confirmed viewer is the only authority. Hand-writing these values here would make the
	// screen draw entitlement the moment the provider says "success".
	it("there is no code that creates verified or adult", () => {
		for (const file of feature)
			for (const forbidden of [
				/verified:\s*true/,
				/adult:\s*true/,
				/ageStatus/,
				/setQueryData/,
				/VIEWER_QUERY_KEY/,
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toMatch(forbidden);
	});

	// Verification does not turn on adult content. Bundling them shows adult content to someone who
	// only meant to verify, which on iOS crosses the policy boundary.
	it("this folder doesn't touch the display setting", () => {
		for (const file of feature)
			for (const forbidden of [/showAdult/, /showAdultMutationOptions/])
				expect(file.text, `${file.path} — ${forbidden}`).not.toMatch(forbidden);
	});

	// The write that turns display on exists in one place app-wide, behind the confirm dialog. A
	// second place would eventually skip the confirmation, a policy violation on iOS.
	it("the write that turns display on is in one place, behind the confirm dialog", () => {
		const writers = product
			.filter((file) => /showAdult:\s*true/.test(file.text))
			.map((file) => file.path)
			.sort();
		expect(writers).toEqual(["features/account/adult-visibility-control.tsx"]);
		const control = fileAt("features/account/adult-visibility-control.tsx");
		// The write sits inside the dialog's `onConfirm`, located by index; a wrapping regex's greedy
		// match would cover the whole file and verify nothing.
		const confirm = control.indexOf("onConfirm=");
		const cancel = control.indexOf("onCancel=");
		const write = control.indexOf("showAdult: true");
		expect(confirm).toBeGreaterThan(-1);
		expect(write).toBeGreaterThan(confirm);
		expect(write).toBeLessThan(cancel);
		// The switch only opens the dialog and never writes to the server there. The dialog opens only
		// while off, so "turning on is impossible on iOS" reads from this line rather than being inferred
		// from an early return.
		expect(control).toMatch(
			/if \(checked\) \{\s*if \(control\.kind === "off"\) setConfirming\(true\);/,
		);
		const toggle = control.indexOf("onValueChange=");
		expect(toggle).toBeLessThan(confirm);
		expect(control.slice(toggle, confirm)).not.toContain("showAdult: true");
	});

	// Screens do not re-write the decision: `Platform.OS` is read in one place that passes it as an
	// argument, and the rule belongs to the pure function.
	it("the platform fork goes through one pure function", () => {
		const readers = product
			.filter((file) => /Platform\.OS/.test(file.text))
			.map((file) => file.path);
		expect(readers).toContain("features/account/adult-visibility-control.tsx");
		for (const file of feature)
			expect(file.text, file.path).not.toMatch(/Platform\.OS/);
		expect(fileAt("features/account/adult-visibility-control.tsx")).toMatch(
			/adultContentControl\(\s*Platform\.OS/,
		);
	});
});

describe("the authority's response doesn't remain on the device", () => {
	// No diagnostic logging either: provider responses can carry identity fragments, and the product
	// path has no `console` call (`lib/boundaries.test.ts`).
	it("it's stored in neither storage nor logs", () => {
		for (const file of feature)
			for (const forbidden of [
				/\bconsole\.\w+\(/,
				/SecureStore/,
				/AsyncStorage/,
				/expo-sqlite|ChatStore|AuthoringStore|SyncStore/,
				/JSON\.stringify\(response/,
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toMatch(forbidden);
	});

	// No identity input fields: name, resident number and contact are collected inside the provider's
	// screen, and those values not passing through this app is the point.
	it("there are no identity input fields", () => {
		for (const file of feature)
			for (const forbidden of [
				/residentRegistration|resident registration number/i,
				/<Input|<Textarea|<BareInput/,
				/\bcarrier\b|choose (your|a) carrier/i,
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toMatch(forbidden);
	});
});

describe("doesn't rewrite the cache policy", () => {
	// Seating the confirmed viewer in the cache and resetting gallery/detail belongs to
	// `@rowcat/query`'s completion policy; repeating it here duplicates the rule, and the drift shows
	// only on accounts whose entitlement opened.
	it("uses both shared policies as is", () => {
		const hook = fileAt(
			"features/adult-verification/use-adult-verification.ts",
		);
		expect(hook).toContain("beginAdultVerificationMutationOptions");
		expect(hook).toContain("completeAdultVerificationMutationOptions");
		for (const file of feature)
			for (const forbidden of [
				/invalidateQueries/,
				/resetQueries/,
				/removeQueries/,
				/queryKey:/,
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toMatch(forbidden);
	});

	// The viewer is not refetched after starting: creating an attempt changes no entitlement cell, and
	// invalidating here would refetch the whole app while the provider window is open.
	it("doesn't add a success hook to the start policy", () => {
		const hook = fileAt(
			"features/adult-verification/use-adult-verification.ts",
		);
		expect(hook).toMatch(
			/useMutation\(beginAdultVerificationMutationOptions\(client\)\)/,
		);
	});
});

describe("the account screen only composes", () => {
	// The content section composes the verification control; no other account file takes its name.
	it("one account file composes identity verification", () => {
		const composers = product
			.filter(
				(file) =>
					file.path.startsWith("features/account/") &&
					/AdultVerificationTrigger/.test(file.text),
			)
			.map((file) => file.path);
		expect(composers).toEqual(["features/account/content-section.tsx"]);
		expect(fileAt("features/account/content-section.tsx")).toContain(
			"<AdultVerificationTrigger",
		);
	});

	// Not drawn for children: that account has no such procedure (the server refuses with
	// `requireNonChild`), and drawing it makes the child press a nonexistent flow and get refused. Two
	// shared functions decide.
	it("the suggestion decision goes through a pure function", () => {
		const section = fileAt("features/account/content-section.tsx");
		expect(section).toContain("adultVisibilityState(viewer)");
		expect(section).toContain("adultVerificationOffer(state)");
		expect(section).toMatch(/offer === "none" \? null :/);
	});
});
