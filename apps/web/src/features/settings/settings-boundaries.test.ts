import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { settings } from "#/lib/i18n/messages/en/settings.ts";

/**
 * Statically checks the boundaries of the settings screen. The mistakes this screen tends to make
 * keep the same shape as it grows. A navigation list gets filled, and when there is nothing to add,
 * account-screen values get pulled in: a nickname line, an email line, a sync button. All of these
 * pass the type checker and render fine. The quiet failure is that the same value ends up edited in
 * two places, and it becomes unclear which one is the truth.
 *
 * These tests check policy, not render output, since this repo's web tests do not render React.
 * Source-level checks answer these questions.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

/**
 * Source with comments removed. Comments in this repo explain why, and they name the things that
 * were deliberately not built (no SettingsProvider, no `Save settings` button). Banning those names would
 * flag the file that explains the rule, and that pressure would push toward deleting the rationale.
 * The scan must not erase its own justification.
 */
function withoutComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Collects the settings feature's sources. Test files are excluded so the scan does not check
 * itself.
 */
function settingsSources(): Map<string, string> {
	const files = new Map<string, string>();
	for (const entry of readdirSync(HERE, { withFileTypes: true })) {
		if (!entry.isFile()) continue;
		if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
		if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx"))
			continue;
		files.set(entry.name, readFileSync(join(HERE, entry.name), "utf8"));
	}
	return files;
}

describe("the settings and account boundary", () => {
	it("there really are files to scan", () => {
		// If the scan finds nothing, every assertion below passes forever.
		expect(settingsSources().size).toBeGreaterThan(5);
	});

	/**
	 * Does not import from the account screen. The navigation list's account management is a single
	 * link. The account screen's values (nickname, email, sign-in methods, content display, sync,
	 * account deletion) still belong to /account. Drawing any of them here would create two places
	 * editing the same value.
	 */
	it("does not import account feature components", () => {
		for (const [name, source] of settingsSources()) {
			expect(source, `${name} imports an account feature`).not.toMatch(
				/from\s+"#\/features\/account\//,
			);
		}
	});

	/**
	 * No account value queries either. Borrowing a name and redrawing it is still duplication, and the
	 * copy goes stale once the value is edited on the account screen.
	 */
	it("does not query account or security resources", () => {
		const FORBIDDEN = [
			"accountQueryOptions",
			"accountSessionsQueryOptions",
			"accountPasskeysQueryOptions",
		];
		for (const [name, source] of settingsSources())
			for (const symbol of FORBIDDEN)
				expect(source, `${name} calls ${symbol}`).not.toContain(symbol);
	});
});

describe("the dialog does not vanish while a hard-to-undo action runs", () => {
	/**
	 * Provider connect and disconnect must follow the same policy as the other management dialogs in
	 * the repo (lib/dialog/dismiss.ts). Those two once closed directly from onOpenChange. Esc, outside
	 * presses and focus loss erased the window during verification and save, so the user believed they
	 * had cancelled while a new key was saved silently seconds later.
	 *
	 * The point is to check that the policy is called together with pending. Importing
	 * shouldCloseDialog but passing a constant false would still filter the reason while leaving
	 * closing during pending open.
	 */
	const DIALOGS = [
		"provider-connection-dialog.tsx",
		"provider-connections.tsx",
		"local-data-reset-dialog.tsx",
	];

	it("the provider and local reset dialogs go through the shared policy", () => {
		const sources = settingsSources();
		for (const name of DIALOGS) {
			const source = sources.get(name);
			expect(source, `${name} is missing`).toBeDefined();
			expect(
				source,
				`${name} does not use the shared dismiss policy`,
			).toContain('from "#/lib/dialog/dismiss.ts"');
			expect(
				withoutComments(source ?? ""),
				`${name} does not pass pending to the policy`,
			).toMatch(/shouldCloseDialog\(\s*details\.reason\s*,\s*pending\s*\)/);
		}
	});

	/**
	 * No onOpenChange in this folder ignores the close reason. The assertion above checks that the
	 * policy is used, but not a folder where one dialog uses the policy and another does not. That
	 * split is exactly how the defect looked: one file held a dialog that applied the policy alongside
	 * one that did not.
	 */
	it("no dialog closes without looking at the reason", () => {
		for (const [name, raw] of settingsSources()) {
			expect(
				withoutComments(raw),
				`${name} has an onOpenChange that ignores the reason`,
			).not.toMatch(/onOpenChange=\{\(next\)\s*=>\s*!next\s*&&/);
		}
	});
});

describe("failures stand in their own place", () => {
	/**
	 * The provider connect dialog does not put every failure on the API key field. While aria-invalid
	 * was set to error !== null, a user without a network connection had a valid key marked invalid.
	 * The kind already comes from connectProvider (rejected versus not_permitted or failed), so the
	 * screen only has to read that judgment.
	 */
	it("the connect dialog's aria-invalid follows only the field's failure", () => {
		const source = withoutComments(
			settingsSources().get("provider-connection-dialog.tsx") ?? "",
		);
		expect(source).toContain("connectFailureScope");
		expect(source).toMatch(/aria-invalid=\{fieldInvalid\}/);
		expect(source).not.toMatch(/aria-invalid=\{\w+\s*!==\s*null\}/);
	});

	/**
	 * Theme failures appear next to the control the user just pressed. The table mapping place to
	 * sentence lives in a pure module (themeFailureFor), and the screen reads from it. If it reverts
	 * to string literals, the place becomes single again: a user who pressed a preset card would not
	 * see a sentence one screen-height below.
	 */
	it("the theme section reads failure placement from the pure module", () => {
		const source = withoutComments(
			settingsSources().get("theme-customization-section.tsx") ?? "",
		);
		expect(source).toContain("themeFailureFor");
		expect(source).toMatch(/failure\?\.scope === "preset"/);
		expect(source).toMatch(/failure\?\.scope === "custom"/);
		expect(source).not.toMatch(/"Couldn't /);
	});
});

describe("the settings screen is not a value store", () => {
	/**
	 * There is no SettingsProvider and no object holding every setting. Each setting reads from and
	 * writes to its own owner. A shared upstream context would make adding one setting widen that
	 * type, and at that point this screen would become the owner of preferences.
	 */
	it("makes no settings-only context", () => {
		for (const [name, raw] of settingsSources()) {
			const source = withoutComments(raw);
			expect(source, `${name} has a settings context`).not.toMatch(
				/createContext<\s*Settings/,
			);
			expect(source, `${name} has a SettingsProvider`).not.toContain(
				"SettingsProvider",
			);
		}
	});

	/**
	 * No bottom save settings button. A transaction spanning different stores (localStorage and
	 * IndexedDB) does not exist, so such a button would report partial success as success. Reversible
	 * preferences write to their owner as soon as they are picked.
	 */
	it("there is no commit-everything button", () => {
		for (const [name, raw] of settingsSources())
			for (const label of ["Save settings", "Save changes", "Save all"])
				expect(
					`${withoutComments(raw)} ${JSON.stringify(settings)}`,
					`${name} has "${label}"`,
				).not.toContain(label);
	});

	/**
	 * The source of truth for the theme stays in the theme provider. Touching the storage medium here
	 * would create a second state, and the header's transition period and this screen would draw
	 * different values.
	 */
	it("does not store the theme directly", () => {
		for (const [name, raw] of settingsSources())
			expect(
				withoutComments(raw),
				`${name} touches the storage medium directly`,
			).not.toContain("localStorage");
	});
});

describe("provider row actions", () => {
	const source = () =>
		withoutComments(settingsSources().get("provider-connections.tsx") ?? "");

	/**
	 * Disconnect is not hidden behind hover. Fingers have no hover, and an action that is hidden is
	 * effectively absent. This matters more because reversing it requires the user to fetch the key
	 * again from the provider's console. To quiet the UI, lower the weight (button variant), not the
	 * visibility.
	 */
	it("not revealed only on hover", () => {
		expect(source()).not.toContain("group-hover");
	});

	it("disconnect and replace key are on the row", () => {
		expect(source()).toContain('t("providerConnections.disconnect")');
		expect(source()).toContain('t("providerConnections.replaceKey")');
		expect(source()).not.toContain("DropdownMenu");
	});
});

describe("the nav list belongs to the settings canvas", () => {
	/**
	 * Do not add settings categories to the app sidebar. The left column holds global destinations and
	 * recent conversations. Adding one feature's list would make that column hold something different
	 * on each screen, a leftover space. Once that door opens, search, theme and sync would follow one
	 * after another.
	 */
	it("the app shell does not import the settings nav list", () => {
		const shell = join(HERE, "..", "..", "components", "app-shell");
		for (const entry of readdirSync(shell, { withFileTypes: true })) {
			if (!entry.isFile() || !entry.name.endsWith(".tsx")) continue;
			const source = readFileSync(join(shell, entry.name), "utf8");
			expect(source, `${entry.name} imports the settings nav list`).not.toMatch(
				/features\/settings\/settings-nav/,
			);
		}
	});
});

describe("provider connect dialog", () => {
	const source = () =>
		withoutComments(
			settingsSources().get("provider-connection-dialog.tsx") ?? "",
		);

	/**
	 * Disabling only the cancel button is not enough. Esc, outside presses and focus loss would still
	 * close the window while verification and save keep running. The user would believe they had
	 * cancelled, and the new key would be saved silently seconds later. The policy in
	 * lib/dialog/dismiss.ts decides this. The check confirms that the close reason is passed along
	 * with the pending state.
	 */
	it("passes the close reason to the policy along with pending", () => {
		expect(source()).toContain("shouldCloseDialog(details.reason, pending)");
	});

	/**
	 * The policy refuses closing while pending, but the close X in the top right looked active. Cancel
	 * was disabled and input was locked, yet the X alone looked pressable. Pressing it sent a close
	 * reason that the policy swallowed, so nothing happened. The data was safe, but the screen showed
	 * a control and then refused it.
	 *
	 * Do not hide the X with showCloseButton={false}. If a target vanishes when verification starts,
	 * the layout shifts, and the user cannot tell what they lost. Keep its place and disable it. The
	 * same rule across the repo is checked by lib/dialog/pending-affordance.test.ts; this test names
	 * the defect this dialog actually had.
	 */
	it("the close button can't be pressed while pending either", () => {
		expect(source()).toContain("closeButtonDisabled={pending}");
	});

	/**
	 * Both are required. The disabled X is only a display: it does not stop Esc, outside presses or
	 * focus loss, so the policy must remain. Keeping only the policy and dropping the disabled X is
	 * caught by the assertion above.
	 */
	it("locking the controls does not stand in for the policy", () => {
		expect(source()).toContain("shouldCloseDialog");
	});

	/**
	 * There is no path that closes directly from onOpenChange. That one line would bypass the whole
	 * policy above. This dialog calls onClose() in only two places: a successful submit and the cancel
	 * button. Both are explicit user choices or completions the component itself recognizes.
	 */
	it("there is no close path that skips the policy", () => {
		expect(source()).not.toMatch(/onOpenChange=\{\(next\)\s*=>/);
	});

	/**
	 * Success closes the dialog. If the pending lock were attached to the parent's onClose, it would
	 * also block a successful submission, and a completed save would stay on screen.
	 */
	it("a successful submit closes as usual", () => {
		expect(source()).toMatch(/setSecret\(""\);\s*onClose\(\);/);
	});

	it("converges on one meaningful form submit", () => {
		const text = source();
		expect(text).toContain("onSubmit=");
		expect(text).toContain('type="submit"');
		expect(text).not.toContain("onKeyDown");
	});

	/**
	 * The synchronous guard does not go away when this becomes a form. `<form>` removes the existence
	 * of two submit paths. It does not remove the chance that the same path runs twice in one tick.
	 * pending only becomes true at the next render, so two quick presses still produce two
	 * verifications and two writes.
	 */
	it("a synchronous copy blocks a duplicate submit in the same tick", () => {
		const text = source();
		expect(text).toContain("useRef(false)");
		expect(text).toContain("if (pendingRef.current) return;");
		expect(text).toContain("guard: pendingRef");
	});

	/**
	 * Only a rejected credential marks the key field invalid. The judgment lives in a pure function
	 * (provider-feedback.ts), and the screen only reads it. Computing aria-invalid from the mere
	 * existence of a failure would mark a valid key invalid for a user without a network connection.
	 */
	it("the invalid marker comes from the failure's place, not its existence", () => {
		const text = source();
		expect(text).toContain('failure?.scope === "field"');
		expect(text).not.toMatch(/aria-invalid=\{failure\s*!==\s*null\}/);
		expect(text).not.toMatch(/aria-invalid=\{Boolean\(failure\)\}/);
		expect(text).not.toMatch(/aria-invalid=\{!!failure\}/);
	});

	it("editing the value clears a stale field failure", () => {
		expect(source()).toContain("setFailure(failureAfterEdit)");
	});

	it("does not read a saved key back into the form", () => {
		const text = source();
		expect(text).not.toMatch(/readSecret|getApiKey|exportCredential/);
		expect(text).toContain('useState("")');
	});
});

describe("this device's data copy", () => {
	/** The copy lives in the dictionary, one group per file, so that is what is read. */
	const section = () => JSON.stringify(settings.localDataSection);
	const dialog = () => JSON.stringify(settings.localDataResetDialog);

	/**
	 * Keep the stated scope accurate. The old sentence said `Conversations and drafts`, but this action clears the whole
	 * per-member database. That includes generation settings, saved provider API keys and the
	 * remembered sync key. The implementation is authoritative, so the fix belongs in the copy. Do not
	 * narrow the scope to make the old sentence true.
	 */
	it("both texts name API keys and generation settings", () => {
		for (const [name, source] of [
			["local-data-section.tsx", section()],
			["local-data-reset-dialog.tsx", dialog()],
		] as const) {
			expect(source, `${name} states the scope too narrowly`).toContain(
				"API key",
			);
		}
		expect(section()).toContain("generation settings");
	});

	it("says the account and server data remain", () => {
		const text = dialog();
		expect(text).toContain("Your account stays");
		expect(text).toMatch(/encrypted copy kept on the server remains/);
	});

	/**
	 * Sync does not restore automatically. The copy comes back only if the user re-enters the sync key
	 * on this device. Dropping that condition would turn the notice into a promise it cannot keep.
	 */
	it("states when the sync copy comes back", () => {
		expect(dialog()).toContain("Enter the key on this device again");
	});

	/**
	 * Do not claim a path that does not exist. Importing old RowCat local data was removed with the
	 * service shutdown; the public release has no legacy origin to inherit from. After a wipe, the
	 * only way back is sync, and naming any other path would be a promise that cannot be kept.
	 */
	it("does not claim old RowCat data is imported again", () => {
		const text = dialog();
		expect(text).not.toMatch(/old RowCat|legacy/i);
		expect(text).not.toMatch(/import(s|ed)? again/i);
	});

	/**
	 * Do not say the server is wiped. This action sends no requests to the server. Sentences such as
	 * `all data will be deleted` belong to account deletion. If they appeared here, the user could not tell what
	 * they pressed.
	 */
	it("does not borrow account deletion's sentences", () => {
		for (const text of [section(), dialog()]) {
			expect(text).not.toMatch(/account (is|will be) deleted/i);
			expect(text).not.toMatch(/all (your )?data/i);
			expect(text).not.toMatch(/permanently/i);
		}
	});
});

describe("ownership copy on the general screen", () => {
	const page = () => settingsSources().get("settings-general-page.tsx") ?? "";

	/**
	 * A section that the account owns is present on this screen. The rule below depends on this
	 * premise.
	 */
	it("holds a section the account owns", () => {
		expect(withoutComments(page())).toContain("ThemeCustomizationGroup");
	});

	/**
	 * Does not claim that every value is device-only. Theme colors are stored on the server and follow
	 * the same account to other devices. If the page intro covered that with a claim that everything
	 * is local, users would believe the color they chose never leaves this browser. Do not move values
	 * to another store to make the sentence true. Each section that edits a value states where it is
	 * stored.
	 */
	it("the intro does not claim everything is device-only", () => {
		const header = /<SettingsPageHeader[\s\S]*?\/>/.exec(
			withoutComments(page()),
		);
		expect(header, "the general screen has no page header").not.toBeNull();
		const text = JSON.stringify(settings.settingsGeneralPage);
		expect(text).not.toMatch(/only on this device/i);
		expect(text).not.toMatch(/only in this browser/i);
	});
});
