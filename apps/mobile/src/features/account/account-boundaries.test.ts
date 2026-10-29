import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Pins the wiring of the account feature, which the type system cannot see.
 *
 * The rules themselves are tested elsewhere (screen state order, form validation, avatar preflight,
 * adult visibility in `@rowcat/domain`, cache policy in `@rowcat/query`). This file checks that
 * those are actually called, that forbidden things are not, and that unrelated neighbours do not
 * grow silently into this folder. Security is a section of this folder; personal moderation is two
 * sections owned by `features/moderation` that this screen only composes.
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));
const REPO = fileURLToPath(new URL("../../../../..", import.meta.url));

function sources(dir: string, files: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) sources(full, files);
		else if (/\.tsx?$/.test(entry.name)) files.push(full);
	}
	return files;
}

/**
 * Scans run on comment-stripped text: comments here name forbidden words while explaining a
 * boundary, so scanning raw text would flag the explanation and push people to delete comments.
 */
const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const all = sources(SRC)
	.map((path) => ({
		path: path.slice(SRC.length),
		text: stripComments(readFileSync(path, "utf8")),
	}))
	.filter((file) => !file.path.endsWith("account-boundaries.test.ts"));

const product = all.filter(
	(file) => !file.path.startsWith("test/") && !/\.test\.tsx?$/.test(file.path),
);

const fileAt = (path: string) => {
	const found = product.find((file) => file.path === path);
	if (!found) throw new Error(`${path} is missing`);
	return found.text;
};

const feature = product.filter((file) =>
	file.path.startsWith("features/account/"),
);

describe("the files to check actually exist", () => {
	it("the routes and feature files are all in place", () => {
		for (const path of [
			"app/account.tsx",
			"features/account/account-copy.ts",
			"features/account/account-error.ts",
			"features/account/account-screen.tsx",
			"features/account/account-section.tsx",
			"features/account/account-shortcut.tsx",
			"features/account/account-state.ts",
			"features/account/avatar-field.tsx",
			"features/account/avatar-file.ts",
			"features/account/avatar-crop-dialog.tsx",
			"features/account/content-section.tsx",
			"features/account/adult-content-policy.ts",
			"features/account/adult-visibility-control.tsx",
			"features/account/profile-form.ts",
			"features/account/profile-section.tsx",
			"features/account/security-section.tsx",
			"features/account/security-copy.ts",
			"features/account/security-error.ts",
			"features/account/security-state.ts",
			"features/account/email-section.tsx",
			"features/account/email-change.ts",
			"features/account/email-change-dialog.tsx",
			"features/account/password-section.tsx",
			"features/account/password-form.ts",
			"features/account/password-dialog.tsx",
			"features/account/login-methods-section.tsx",
			"features/account/connect-login-method.ts",
			"features/account/disconnect-method-dialog.tsx",
			"features/account/passkeys-section.tsx",
			"features/account/passkey-label.ts",
			"features/account/passkey-dialogs.tsx",
			"features/account/sessions-section.tsx",
			"features/account/revoke-others-dialog.tsx",
			"features/account/use-reauth.ts",
			"features/account/data-section.tsx",
			"features/account/delete-account-section.tsx",
			"features/account/delete-account-dialog.tsx",
			"features/account/delete-account-error.ts",
			"features/account/deletion-terminal.tsx",
			"features/account/deletion-turn.ts",
			"features/account/use-account-deletion.ts",
			"features/sync/sync-section.tsx",
			"features/shell/shell-utilities.tsx",
			"lib/account-security-auth.ts",
			"lib/account-deletion-auth.ts",
			"lib/account-deletion.ts",
			"lib/purge-deleted-viewer.ts",
			"lib/image-picker.ts",
			"lib/image-crop.ts",
		])
			expect(() => fileAt(path)).not.toThrow();
		expect(feature.length).toBeGreaterThan(8);

		/**
		 * The read-only `Account details` section is gone. Keeping it beside security would show the same values
		 * (email, login methods) twice with only one copy actionable, leaving no canonical one.
		 */
		expect(
			product.some(
				(file) => file.path === "features/account/account-info-section.tsx",
			),
		).toBe(false);
		for (const file of feature)
			expect(file.text, file.path).not.toContain("AccountInfoSection");
	});

	/** The route file is only a route; the screen belongs to the feature. */
	it("the routes are thin", () => {
		const route = fileAt("app/account.tsx");
		expect(route).toContain("<AccountScreen />");
		expect(route).not.toContain("useQuery");
		expect(route).not.toContain("useMutation");
	});
});

describe("shell boundaries", () => {
	/**
	 * Account is a utility, not a section: `MobileAppSection` is unchanged and `account` lives in
	 * `MobileShellUtility`. Values are covered by `shell-route.test.ts`.
	 *
	 * `settings` later joined as a third utility, so this checks only that account is still not a
	 * section, by `account`'s position rather than the utility list length.
	 */
	it("account didn't enter the section vocabulary", () => {
		const route = fileAt("features/shell/shell-route.ts");
		expect(route).toMatch(/MobileAppSection = "discover" \| "chat"/);
		expect(route).not.toMatch(/MobileAppSection =[^;]*"account"/);
		expect(route).toMatch(/MobileShellUtility =[^;]*"account"/);
	});

	/**
	 * The drawer has no account entry: its left side is a fixed IA of product sections and account is
	 * a header utility. `lib/boundaries.test.ts` locks the word `Account`; this locks the wiring.
	 */
	it("the drawer doesn't draw a path to the account", () => {
		const sidebar = fileAt("features/shell/app-sidebar.tsx");
		expect(sidebar).not.toContain("AccountShortcut");
		expect(sidebar).not.toContain("/account");
	});

	/** Active state comes from the shell decision alone; no path prefix is re-written. */
	it("the account menu's active state goes through the shell decision", () => {
		const shortcut = fileAt("features/account/account-shortcut.tsx");
		expect(shortcut).toContain("mobileShellRouteFor");
		expect(shortcut).toContain('utility === "account"');
		expect(shortcut).not.toContain("startsWith");
	});

	it("no copy of the path-prefix decision exists anywhere", () => {
		for (const file of product)
			expect(file.text, file.path).not.toMatch(/startsWith\(\s*["']\/account/);
	});

	/** Guests and unresolved sessions get no account menu; no disabled trigger is drawn. */
	it("the account menu stands only for members", () => {
		const shortcut = fileAt("features/account/account-shortcut.tsx");
		expect(shortcut).toMatch(
			/if \(session\.phase !== "authenticated" \|\| !session\.viewer\) return null;/,
		);
	});

	/**
	 * The menu has three items in fixed order: account, settings, sign-out.
	 *
	 * It had two while the app had no `/settings` screen. Settings came back for a different reason,
	 * width: at 320pt always-visible utilities compete with the title, and settings does not answer
	 * whether it calls you on every screen (see the table in the header of
	 * `features/shell/shell-utilities.tsx`). The billing item left with billing (`docs/oss/PLAN.md`
	 * stage 3).
	 *
	 * The navigation methods differ on purpose: account is a destination you return to (`navigate`),
	 * settings is a brief visit (`push`). Merging them makes back from settings land on the account
	 * screen, or stacks history on every account press.
	 */
	it("the menu is account, settings, sign out, in that order", () => {
		const shortcut = fileAt("features/account/account-shortcut.tsx");
		expect(shortcut).toContain('router.navigate("/account")');
		expect(shortcut).toContain('router.push("/settings")');
		expect(shortcut).not.toContain("/billing");

		const order = [
			"ACCOUNT_MENU_ITEM",
			"ACCOUNT_MENU_SETTINGS",
			"ACCOUNT_MENU_SIGN_OUT",
		].map((name) => shortcut.lastIndexOf(name));
		expect(order.every((index) => index >= 0)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);

		const copy = fileAt("features/account/account-copy.ts");
		expect(copy).toContain('ACCOUNT_MENU_ITEM = "Account"');
		expect(copy).toContain('ACCOUNT_MENU_SETTINGS = "Settings"');
		expect(copy).not.toContain("ACCOUNT_MENU_BILLING");
		expect(copy).toContain('ACCOUNT_MENU_SIGN_OUT = "Sign out"');
	});

	/**
	 * Sign-out belongs to the existing transition owner. Calling `resetViewerState`-style functions
	 * here creates two cleanup paths that eventually drift; the order of cookie, cache and scope is
	 * owned by `session-transition.ts` (tested by value in `session-transition.test.ts`).
	 */
	it("the account feature doesn't create a second sign-out procedure", () => {
		const shortcut = fileAt("features/account/account-shortcut.tsx");
		expect(shortcut).toMatch(/signOut/);
		for (const file of feature) {
			expect(file.text, file.path).not.toContain("resetViewerState");
			expect(file.text, file.path).not.toContain("refreshViewerState");
			expect(file.text, file.path).not.toContain("authClient");
			expect(file.text, file.path).not.toContain("deleteDatabase");
		}
	});

	/**
	 * The member branch of the discover header became a single account menu; a nickname label or
	 * standalone sign-out beside it would give two control surfaces for one account. Guest, unresolved
	 * and booting branches are unchanged.
	 */
	it("the discover header draws the account menu and leaves no second sign-out", () => {
		const header = fileAt("features/shell/app-header.tsx");
		expect(header).toContain("<AccountShortcut />");
		expect(header).not.toContain('label="Sign out"');
		expect(header).not.toMatch(/viewer\?\.nickname/);
		/** The guest, unresolved and booting branches and the two shortcuts are unchanged. */
		expect(header).toContain('label="Sign in"');
		expect(header).toContain('label="Check session"');
		expect(header).toContain('label="Checking"');
		expect(header).toContain("<NotificationShortcut />");
		/** The balance cell left this row with billing (`docs/oss/PLAN.md` stage 3). */
		expect(header).not.toContain("ChuruShortcut");
	});

	/**
	 * The account menu keeps its way to settings. Settings folded from an always-visible header icon
	 * into this menu, and the path must survive that. `push` is part of the rule: back should return
	 * to the original screen (account is the opposite, hence `navigate`).
	 */
	it("the account menu has account, settings and sign out", () => {
		const shortcut = fileAt("features/account/account-shortcut.tsx");
		expect(shortcut).toContain('router.navigate("/account")');
		expect(shortcut).toContain('router.push("/settings")');
		expect(shortcut).toContain("ACCOUNT_MENU_SIGN_OUT");
	});

	/**
	 * The generic `AppBar` is a presentation primitive; once it knows account queries, identity or
	 * routes, that package becomes part of the product. The account menu is a feature component
	 * composed through `actions`.
	 */
	it("the shared AppBar doesn't know about accounts", () => {
		const bar = stripComments(
			readFileSync(join(REPO, "packages/ui-native/src/app-bar.tsx"), "utf8"),
		);
		expect(bar).not.toMatch(/[Aa]ccount/);
		expect(bar).not.toContain("@rowcat/query");
		expect(bar).not.toContain("useQuery");
		expect(bar).not.toContain("expo-router");
	});

	/**
	 * Identity gate and form isolation: content renders only inside the member branch, keyed by viewer
	 * id.
	 */
	it("account content stands inside the member branch, keyed by viewer id", () => {
		const screen = fileAt("features/account/account-screen.tsx");
		expect(screen).toContain("resolveAccountScreenState");
		expect(screen).toMatch(
			/session\.viewer \? \(\s*<AccountContent[\s\S]{0,80}key=\{session\.viewer\.id\}/,
		);
		expect(screen).toContain("<ShellUtilities />");
		expect(screen).toContain("navigation={<AppSidebarTrigger />}");
		/**
		 * The three private queries (account details, sessions, passkeys) are owned by sections inside
		 * that branch, by mounting rather than an `enabled` switch.
		 */
		expect(screen).toContain("<SecuritySection />");
		for (const path of [
			"features/account/security-section.tsx",
			"features/account/sessions-section.tsx",
			"features/account/passkeys-section.tsx",
		])
			expect(fileAt(path), path).not.toContain("enabled:");
	});
});

describe("the shared package owns server state", () => {
	it("actually calls the shared query and mutation options", () => {
		const profile = fileAt("features/account/profile-section.tsx");
		expect(profile).toContain("nicknameMutationOptions");
		expect(profile).toContain("bioMutationOptions");
		expect(profile).toContain("publicProfileQueryOptions");

		const avatar = fileAt("features/account/avatar-field.tsx");
		expect(avatar).toContain("uploadAvatarMutationOptions");
		expect(avatar).toContain("deleteAvatarMutationOptions");
		expect(avatar).toContain("publicProfileQueryOptions");

		/**
		 * The visibility switch moved to its own file because the way to turn it on differs per platform
		 * (`adult-content-policy.ts`); the section only composes it with the identity-verification
		 * action.
		 */
		const visibility = fileAt("features/account/adult-visibility-control.tsx");
		expect(visibility).toContain("showAdultMutationOptions");
		expect(visibility).toContain("adultVisibilityState");
		const content = fileAt("features/account/content-section.tsx");
		expect(content).toContain("adultVisibilityState");

		const security = fileAt("features/account/security-section.tsx");
		expect(security).toContain("accountQueryOptions");

		const password = fileAt("features/account/password-section.tsx");
		expect(password).toContain("setPasswordMutationOptions");

		const methods = fileAt("features/account/login-methods-section.tsx");
		expect(methods).toContain("disconnectLoginMethodMutationOptions");
		expect(methods).toContain("invalidateAccountDetails");
		expect(methods).toContain("canDisconnectLoginMethod");

		const passkeys = fileAt("features/account/passkeys-section.tsx");
		expect(passkeys).toContain("accountPasskeysQueryOptions");
		expect(passkeys).toContain("renamePasskeyMutationOptions");
		expect(passkeys).toContain("deletePasskeyMutationOptions");

		const sessions = fileAt("features/account/sessions-section.tsx");
		expect(sessions).toContain("accountSessionsQueryOptions");
		expect(sessions).toContain("revokeSessionMutationOptions");
		expect(sessions).toContain("revokeOtherSessionsMutationOptions");
	});

	/**
	 * Policy callbacks are chained. Overwriting them with a spread silently drops optimistic rollback,
	 * gallery invalidation and public-profile patching, a regression with no visible symptom, so the
	 * wiring is pinned by value.
	 */
	it("screen callbacks don't replace policy callbacks", () => {
		const profile = fileAt("features/account/profile-section.tsx");
		expect(profile).toMatch(/policy\.onError\?\.\(\.\.\.args\)/);
		expect(profile).toMatch(/await policy\.onSuccess\?\.\(\.\.\.args\)/);

		const avatar = fileAt("features/account/avatar-field.tsx");
		expect(avatar).toMatch(/uploadPolicy\.onError\?\.\(\.\.\.args\)/);
		expect(avatar).toMatch(/uploadPolicy\.onSuccess\?\.\(\.\.\.args\)/);
		expect(avatar).toMatch(/removePolicy\.onSuccess\?\.\(\.\.\.args\)/);

		const visibility = fileAt("features/account/adult-visibility-control.tsx");
		expect(visibility).toMatch(/policy\.onError\?\.\(\.\.\.args\)/);
		expect(visibility).toMatch(/await policy\.onSuccess\?\.\(\.\.\.args\)/);
	});

	/**
	 * Feature code does not patch the cache; optimistic updates, resets and patches belong to the
	 * shared policy. In particular the adult-visibility reset is a reset, not an invalidation: undoing
	 * it with `invalidateQueries` leaves the adult works you just hid on screen until the refetch
	 * ends.
	 */
	it("feature code doesn't modify the cache directly", () => {
		for (const file of feature) {
			expect(file.text, file.path).not.toContain("setQueryData");
			expect(file.text, file.path).not.toContain("setQueriesData");
			expect(file.text, file.path).not.toContain("onMutate");
			expect(file.text, file.path).not.toContain("invalidateQueries");
			expect(file.text, file.path).not.toContain("removeQueries");
		}
		/**
		 * The one exception is `Try again` on a paused query, held only by the files that own a query. On a
		 * paused query `refetch()` creates no request (it returns the existing promise), so only when no
		 * value is held is the query restarted from scratch.
		 */
		const resetCallers = feature
			.filter((file) => file.text.includes("resetQueries"))
			.map((file) => file.path)
			.sort();
		expect(resetCallers).toEqual([
			"features/account/delete-account-trigger.tsx",
			"features/account/passkeys-section.tsx",
			"features/account/security-section.tsx",
			"features/account/sessions-section.tsx",
		]);
		/**
		 * Each resets only its own cell, not a prefix, so sibling sections' values are not dragged along.
		 */
		for (const path of resetCallers)
			expect(fileAt(path), path).toMatch(/exact:\s*true/);
	});

	/** No mobile-only account query; the keys belong to the shared package. */
	it("account details aren't fetched by hand", () => {
		for (const file of feature) {
			expect(file.text, file.path).not.toMatch(/client\.me\.account\(/);
			expect(file.text, file.path).not.toMatch(/queryKey:\s*\[/);
		}
	});

	/**
	 * The avatar preview is temporary state: on both failure and success it is discarded
	 * (`setPreview(null)`) and only the server response is promoted. No cache buster on the URL, since
	 * success returns a new media id and thus a new address. Delete is drawn only when a saved photo
	 * exists and is not optimistic.
	 */
	it("the avatar's lifecycle is in the wiring", () => {
		const avatar = fileAt("features/account/avatar-field.tsx");
		expect(avatar).toContain("preview ?? savedUrl");
		expect(avatar.match(/setPreview\(null\)/g)?.length).toBeGreaterThanOrEqual(
			3,
		);
		expect(avatar).not.toMatch(/cacheBust|\?ts=|Date\.now\(\)/);
		expect(avatar).toMatch(/\{savedUrl \? \(\s*<Button\s*label="Delete"/);
	});

	/** The picker boundary is one lib file; feature code does not hold library types. */
	it("only one place in lib imports expo-image-picker", () => {
		const importers = product
			.filter((file) => file.text.includes("expo-image-picker"))
			.map((file) => file.path);
		expect(importers).toEqual(["lib/image-picker.ts"]);
	});

	/**
	 * The manipulator boundary is one lib file too, for the same reason plus one: more places would
	 * mean cropping in two places, each choosing its own format, compression and coordinate system,
	 * visible only as uploaded photo quality.
	 */
	it("only one place in lib imports expo-image-manipulator", () => {
		const importers = product
			.filter((file) => file.text.includes("expo-image-manipulator"))
			.map((file) => file.path);
		expect(importers).toEqual(["lib/image-crop.ts"]);
	});

	/**
	 * The crop rectangle comes from the shared geometry. Web draws the same screen with a different
	 * input device yet must produce the same rectangle; re-implementing it here crops the same drag
	 * differently per device, which shows up only as 'my face got cut off' and does not reproduce.
	 */
	it("the app doesn't rewrite the crop geometry", () => {
		const dialog = fileAt("features/account/avatar-crop-dialog.tsx");
		for (const shared of [
			"avatarCropRect",
			"clampAvatarCropView",
			"initialAvatarCropView",
			"avatarCropPanScale",
			"avatarCropOutputEdge",
			"isAvatarCroppable",
		])
			expect(dialog, shared).toContain(shared);
		/**
		 * The stored size also comes from the contract; a hand-written value would upscale only cropped
		 * uploads the day the server raises it.
		 */
		expect(dialog).toContain("AVATAR_STORED_EDGE");
		for (const file of feature) {
			expect(file.text, file.path).not.toMatch(/\b512\b/);
			expect(file.text, file.path).not.toMatch(/Math\.min\(source\.width/);
		}
	});

	/**
	 * Cropping opens only when the size cap is exceeded, and the screen does not re-write that fork.
	 * If the format-before-size order ever broke, the crop window would open for formats the server
	 * rejects anyway, and the user would be refused only after finishing the crop.
	 */
	it("a pure function answers the fork to cropping", () => {
		const avatar = fileAt("features/account/avatar-field.tsx");
		expect(avatar).toContain("avatarIssueOpensCrop");
		expect(avatar).not.toMatch(/===\s*"too_large"/);
	});

	/** No camera: capture and camera permission were never requested by this slice. */
	it("there is no camera vocabulary at all", () => {
		for (const file of product) {
			expect(file.text, file.path).not.toMatch(/launchCameraAsync/);
			expect(file.text, file.path).not.toMatch(/CameraPermission/i);
		}
	});

	/** The picker dependency belongs to this app and does not leak into shared packages. */
	it("the native picker dependency exists only in the app", () => {
		for (const pkg of [
			"packages/ui-native",
			"packages/query",
			"packages/sdk",
			"packages/domain",
			"packages/chat",
			"packages/contracts",
		]) {
			const manifest = readFileSync(join(REPO, pkg, "package.json"), "utf8");
			expect(manifest, pkg).not.toContain("expo-image-picker");
			expect(manifest, pkg).not.toContain("expo-image-manipulator");
		}
	});
});

describe("the account is server state — it doesn't live on the device", () => {
	it("no local storage or sync vocabulary", () => {
		for (const file of feature) {
			for (const forbidden of [
				/AsyncStorage/,
				/SecureStore/i,
				/expo-sqlite/,
				/local-data\//,
				/local-sync\//,
				/\bChatStore\b/,
				/\bAuthoringStore\b/,
				/\bSyncStore\b/,
				/useMobileLocalScope/,
				/useMobileAppPhase/,
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toMatch(forbidden);
		}
	});

	/**
	 * The SQLite schema does not know the account; email and display settings must not diverge per
	 * device.
	 */
	it("the device schema doesn't know about accounts", () => {
		const schema = fileAt("lib/local-data/migrations.ts");
		expect(schema).not.toMatch(/account|email|show_adult|nickname/i);
	});
});

describe("what isn't this slice", () => {
	/**
	 * Security and personal moderation have arrived; their neighbours have not. This check once
	 * blocked security vocabulary, then moderation vocabulary, which was right then (no action is
	 * drawn before a screen can finish it). Only the lines whose purpose is gone were removed;
	 * two-factor, backup codes, trusted devices and password reset stay blocked, so a word appearing
	 * marks the start of its own slice.
	 *
	 * Password reset arrived but not in this folder: it is for people who cannot sign in, so the login
	 * screen hands it to the web (below), while signed-in people change their password in this
	 * folder's password section.
	 */
	it("no two-factor, recovery code or password reset vocabulary at all", () => {
		for (const file of feature)
			for (const forbidden of [
				/\bTOTP\b|twoFactor|two-factor/i,
				/[Rr]ecovery[ -]?[Cc]ode|backup code/i,
				/trusted device|trustedDevice/i,
				/forgetPassword|forgotPassword|resetPassword|requestPasswordReset/,
				/reset (your )?password|forgot (your )?password/i,
				/security activity|securityActivity|sign-in history/i,
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toMatch(forbidden);
	});

	/**
	 * Reset is a web flow; the app keeps only the door in. The mail link returns to the web
	 * `/reset-password`, so the procedure always ends there. If the app called the request or
	 * new-password submit, one procedure would stand half on each surface and the existence-hiding,
	 * expiry and other-device-sign-out sentences would be maintained twice. The commit that adds such
	 * a path must rewrite this check with its reason.
	 */
	it("reset is the web's flow", () => {
		for (const file of product)
			expect(file.text, file.path).not.toMatch(
				/requestPasswordReset|\.resetPassword\(|forgetPassword/,
			);
		const login = fileAt("app/login.tsx");
		expect(login).toContain("usePasswordResetLink()");
		expect(login).toContain("openBrowserAsync(resetUrl)");
		/**
		 * The link stands only when the deployment opens reset. Without reading the public runtime
		 * config, a deployment where reset is closed (the privacy policy not yet listing that mail) would
		 * show a link leading only to the web's cannot-send message.
		 */
		const link = fileAt("lib/password-reset-link.ts");
		expect(link).toContain("runtimeConfigQueryOptions");
		expect(link).toContain("passwordReset !== true");
	});

	/**
	 * Personal moderation has arrived, but its meaning is still not this folder's. The account screen
	 * only composes the two `features/moderation` sections. If sanction lookup, appeal intake or
	 * report-list vocabulary entered here, meaning would have two owners, visible only when two
	 * screens are compared (the paired wiring is locked by `personal-moderation-boundaries.test.ts`).
	 */
	it("the account folder doesn't own moderation meaning", () => {
		const composition = new Set([
			"AccountModerationSection",
			"MyReportsSection",
		]);
		for (const file of feature) {
			for (const forbidden of [
				/**
				 * Account deletion has arrived, but the auth client is still not this folder's: `deleteUser` is
				 * called only in `lib/account-deletion-auth.ts`, and feature code holds just its wiring
				 * (`lib/account-deletion.ts`).
				 */
				/\bdeleteUser\b/,
				/moderationStatusQueryOptions|myReportsInfiniteQueryOptions/,
				/MY_MODERATION_QUERY_KEY|MY_REPORTS_QUERY_KEY/,
				/moderation\.appeal|createAppealTurn|AppealDialog/,
				/appealErrorMessage|collectRestrictionItems|accountModerationView/,
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toMatch(forbidden);
			/**
			 * The two section names appear only in the one composing screen; another account file acquiring
			 * them signals a second composition site.
			 */
			for (const name of composition)
				if (file.path !== "features/account/account-screen.tsx")
					expect(file.text, `${file.path} — ${name}`).not.toContain(name);
		}
		const screen = fileAt("features/account/account-screen.tsx");
		expect(screen).toContain("<AccountModerationSection />");
		expect(screen).toContain("<MyReportsSection />");
	});

	/**
	 * The account screen draws no settings values. This check once banned the `/settings` vocabulary
	 * folder-wide, when the app had no settings screen. Now the account menu has a path there, and
	 * having a path differs from drawing values. So the exception is one file (the menu); theme,
	 * language and notification settings drawn here would live on two screens, and one of them would
	 * go stale.
	 */
	it("the account screen doesn't draw settings' values", () => {
		expect(product.some((file) => file.path === "app/settings.tsx")).toBe(
			false,
		);
		for (const file of feature) {
			if (file.path === "features/account/account-shortcut.tsx") continue;
			expect(file.text, file.path).not.toMatch(
				/\/settings|\bTheme\b|\bLanguage\b|Notification settings/,
			);
		}
		/** The excepted file exists; otherwise the `continue` above does nothing. */
		expect(
			feature.some(
				(file) => file.path === "features/account/account-shortcut.tsx",
			),
		).toBe(true);
	});

	/**
	 * Identity verification has arrived in this app; its meaning is still not this folder's. This
	 * check once blocked `PortOne`, `adultVerification` and `react-native-webview` because the
	 * provider's handoff needed a browser SDK this app could not run. That premise is gone: PortOne's
	 * React Native SDK finishes the procedure natively.
	 *
	 * So the check is inverted rather than deleted: the account screen only composes
	 * `features/adult-verification` actions, and provider, endpoint or state-machine vocabulary here
	 * would give meaning two owners (the paired wiring is locked by
	 * `adult-verification-boundaries.test.ts`).
	 */
	it("the account folder doesn't own identity verification meaning", () => {
		const composition = new Set(["AdultVerificationTrigger"]);
		for (const file of feature) {
			for (const forbidden of [
				/[Pp]ort[Oo]ne/,
				/identityVerification/i,
				/beginAdultVerification|completeAdultVerification/,
				/react-native-webview|<WebView/,
				/AdultVerificationSurface|useAdultVerification|createAdultVerificationTurn/,
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toMatch(forbidden);
			/** One composing site; another account file acquiring the name signals a second one. */
			for (const name of composition)
				if (file.path !== "features/account/content-section.tsx")
					expect(file.text, `${file.path} — ${name}`).not.toContain(name);
		}
		expect(fileAt("features/account/content-section.tsx")).toContain(
			"<AdultVerificationTrigger",
		);
	});

	/**
	 * An external browser opens from two links to canonical pages only:
	 * - delete section: the web's public deletion notice (`/account-deletion`)
	 * - display setting: the web account screen, where adult content display is turned on for iOS
	 *
	 * The second used to be the way to go do identity verification; verification now ends in the app
	 * and the web link is only for the display opt-in (boundary in `adult-content-policy.ts`).
	 * Hand-joining addresses is blocked too; `lib/public-web.ts` is the only assembler.
	 */
	it("two places open the external browser", () => {
		const browsers = feature
			.filter((file) => /expo-web-browser/.test(file.text))
			.map((file) => file.path)
			.sort();
		expect(browsers).toEqual([
			"features/account/adult-visibility-control.tsx",
			"features/account/delete-account-section.tsx",
		]);
		for (const path of browsers)
			expect(fileAt(path), path).not.toMatch(/replace\(\/\\\/\+\$\//);
	});

	/**
	 * The public profile stays read-only; editing is the account screen only, so account writes do not
	 * leak into the profile folder.
	 */
	it("the public profile screen didn't gain editing", () => {
		for (const file of product) {
			if (!file.path.startsWith("features/profile/")) continue;
			for (const forbidden of [
				/nicknameMutationOptions/,
				/bioMutationOptions/,
				/uploadAvatarMutationOptions/,
				/deleteAvatarMutationOptions/,
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toMatch(forbidden);
		}
	});

	/** The switch is a display setting, not verification; wording keeps that boundary. */
	it("the switch doesn't call itself adult verification", () => {
		expect(fileAt("features/account/account-copy.ts")).toContain(
			'SHOW_ADULT_LABEL = "Show adult content"',
		);
		for (const path of [
			"features/account/content-section.tsx",
			"features/account/adult-visibility-control.tsx",
		])
			expect(fileAt(path), path).not.toContain("adult verification");
	});
});

describe("security — the operations arrived", () => {
	const security = feature.filter((file) =>
		/features\/account\/(security|email|password|login-methods|connect-login-method|disconnect-method|passkey|sessions|revoke-others|use-reauth)/.test(
			file.path,
		),
	);

	it("actually picked the security files to check", () => {
		expect(security.length).toBeGreaterThanOrEqual(17);
	});

	/**
	 * `/account` is the only destination for account management. Security is a section of it, not a
	 * second address, and it does not enter the shell vocabulary: neither drawer sections nor header
	 * utilities grew.
	 */
	it("didn't create a security route", () => {
		for (const path of [
			"app/account/security.tsx",
			"app/security.tsx",
			"app/security-center.tsx",
			"app/settings/security.tsx",
			"app/settings/account.tsx",
		])
			expect(
				product.some((file) => file.path === path),
				path,
			).toBe(false);

		const route = fileAt("features/shell/shell-route.ts");
		expect(route).toMatch(/MobileAppSection = "discover" \| "chat"/);
		expect(route).toMatch(/MobileShellUtility =[^;]*"account"/);

		for (const file of product) {
			expect(file.text, file.path).not.toMatch(/["'`]\/account\/security/);
			expect(file.text, file.path).not.toMatch(/["'`]\/security/);
			/**
			 * No account address under settings either. This became a possible mistake when the settings
			 * screen arrived: the way to account management is one link (`/account`), and
			 * `/settings/account` would give the same screen a second address.
			 */
			expect(file.text, file.path).not.toMatch(/["'`]\/settings\/account/);
		}
	});

	/**
	 * Pins the order of the sub-sections by value; a mismatch between the vocabulary table
	 * (`SECURITY_SUBSECTION_TITLE`) and the screen's assembly breaks no compile and shows only when
	 * the two apps are compared.
	 */
	it("there are five subsections in a fixed order", () => {
		const copy = fileAt("features/account/security-copy.ts");
		const vocabulary = [
			"email",
			"password",
			"loginMethods",
			"passkeys",
			"sessions",
		];
		const declared = vocabulary.map((key) => copy.indexOf(`\t${key}: "`));
		for (const [index, at] of declared.entries())
			expect(at, vocabulary[index]).toBeGreaterThan(-1);
		expect(declared).toEqual([...declared].sort((a, b) => a - b));

		const section = fileAt("features/account/security-section.tsx");
		const rendered = [
			"<EmailSection",
			"<PasswordSection",
			"<LoginMethodsSection",
			"<PasskeysSection",
			"<SessionsSection",
		].map((tag) => section.indexOf(tag));
		for (const [index, at] of rendered.entries())
			expect(at, `${index}`).toBeGreaterThan(-1);
		expect(rendered).toEqual([...rendered].sort((a, b) => a - b));
	});

	/**
	 * One owner of account details. Three of the five sections receive the value as a prop; if each
	 * queried, failure, staleness and retry would have three owners and one failure would draw three
	 * times in one section. Only passkeys and sessions have their own queries (freshness and failure
	 * character differ).
	 */
	it("two places fetch account details, with one key", () => {
		/**
		 * The rule evolved: not 'only the security section calls it' but 'one canonical query policy is
		 * shared by the intended consumers'. The deletion trigger needs `hasPassword` to choose the
		 * confirmation's shape and uses the same `accountQueryOptions`, so cache key and server authority
		 * stay one; a deletion-specific query key is the real defect to prevent (the `queryKey:` scan
		 * catches it).
		 *
		 * The trigger moved out of the section because two places open deletion (the account screen's
		 * delete section and the entry gate), so button, query and confirmation are bundled once and the
		 * section keeps only context (what remains, canonical notice). A second implementation of an
		 * irreversible operation would eventually diverge in confirmation copy, password decision and
		 * failure handling.
		 */
		const owners = feature
			.filter((file) => file.text.includes("accountQueryOptions"))
			.map((file) => file.path)
			.sort();
		expect(owners).toEqual([
			"features/account/delete-account-trigger.tsx",
			"features/account/security-section.tsx",
		]);

		for (const path of [
			"features/account/email-section.tsx",
			"features/account/password-section.tsx",
			"features/account/login-methods-section.tsx",
		])
			expect(fileAt(path), path).toMatch(/account: AccountDetails/);
	});

	/**
	 * Feature code does not hold the auth client. `lib/account-security-auth.ts` owns callback
	 * addresses, error shape and password lifetime; if screens grabbed it directly, one would
	 * eventually skip validation.
	 */
	it("security operations go through one app-owned auth boundary", () => {
		const importers = product
			.filter((file) => /from "\.[./]*\/auth\.ts"/.test(file.text))
			.map((file) => file.path)
			.sort();
		expect(importers).toEqual([
			/** The only place deletion calls `deleteUser`; same wiring rule as the security boundary. */
			"lib/account-deletion-auth.ts",
			"lib/account-security-auth.ts",
			"lib/api.ts",
			/**
			 * A second transport. Like `lib/api.ts` adding cookies to the SDK's `fetch`, this file does so
			 * for the native image loader, which bypasses our `fetch`, so covers visible only with a session
			 * would 404 only in the app (the header of `lib/auth-image.ts` records that symptom).
			 *
			 * Its standing is the same as `lib/api.ts`: it only reads the cookie into a header and calls no
			 * auth operation (`changePassword`, `linkSocial`, ...). Feature code still goes through the
			 * other file.
			 */
			"lib/auth-image.ts",
			"lib/identity.tsx",
		]);

		/**
		 * Pins that standing by value; if this file ever called an auth operation, a line in the list
		 * above would silently change meaning.
		 */
		expect(fileAt("lib/auth-image.ts")).not.toMatch(/authClient\s*\./);

		const boundary = fileAt("lib/account-security-auth.ts");
		/** Compared by name since the formatter splits the call across lines. */
		for (const call of [
			"changePassword",
			"changeEmail",
			"sendVerificationEmail",
			"linkSocial",
		])
			expect(boundary, call).toMatch(
				new RegExp(`authClient\\s*\\.\\s*${call}\\(`),
			);
	});

	/**
	 * Linking is not signing in. `signIn.social` looks up the owner of that provider identity and
	 * creates a new account if none exists; calling it from the account screen would create a second
	 * RowCat member with no local data or works, and the user would read their account as empty.
	 */
	it("security operations don't call sign-in paths", () => {
		const boundary = fileAt("lib/account-security-auth.ts");
		expect(boundary).not.toContain("signIn");
		for (const file of security) {
			expect(file.text, file.path).not.toMatch(/signInWith[A-Z]/);
			expect(file.text, file.path).not.toMatch(/signIn\.social/);
			expect(file.text, file.path).not.toContain("authClient");
		}
	});

	/**
	 * Callback destinations are constants. A parameter for them would be an open redirect, and the
	 * email side is costlier than the login screen's `?redirect=` because that link is delivered by
	 * mail.
	 */
	it("the call site doesn't decide the callback destination", () => {
		const boundary = fileAt("lib/account-security-auth.ts");
		expect(boundary).toMatch(/const ACCOUNT_PATH = "\/account"/);
		expect(boundary).toMatch(/callbackURL: EMAIL_CHANGED_PATH/);
		expect(boundary).toMatch(/callbackURL: CONNECT_RETURN_PATH/);
		expect(boundary).toMatch(/errorCallbackURL: CONNECT_RETURN_PATH/);
		/** No signature takes the destination as an argument. */
		expect(boundary).not.toMatch(/callbackURL:\s*\w*[Rr]eturn\w*Path\b\s*[,)]/);
		expect(boundary).not.toMatch(/returnPath|redirect/);
	});

	/**
	 * A returned marker is a claim, not a fact. Account details are not patched from a deep-link
	 * value; the check is an exact comparison with one string we wrote, and even then the only effect
	 * is asking the server again.
	 */
	it("the deep-link marker isn't used as account state", () => {
		const change = fileAt("features/account/email-change.ts");
		expect(change).toMatch(
			/EMAIL_CHANGE_RETURN_VALUE = "changed"[\s\S]{0,400}param === EMAIL_CHANGE_RETURN_VALUE/,
		);

		const section = fileAt("features/account/security-section.tsx");
		expect(section).toContain("isEmailChangeReturn");
		expect(section).toContain("invalidateAccountDetails");
		/** The marker is consumed once and cleared; left in, every re-render would fetch. */
		expect(section).toMatch(/consumed\.current/);
		expect(section).toMatch(/setParams\(\{ email: undefined \}\)/);

		for (const file of security) {
			expect(file.text, file.path).not.toMatch(/emailVerified\s*[:=]\s*true/);
			expect(file.text, file.path).not.toMatch(/account\.email\s*=/);
		}
	});

	/**
	 * No optimistic updates. The lie drawn briefly here would be 'this device can no longer get in' or
	 * 'this login method is gone', and someone would walk away believing it. The absence of
	 * hand-edited cache code is the structural form of that rule.
	 */
	it("screens don't modify the security cache directly", () => {
		for (const file of security) {
			expect(file.text, file.path).not.toContain("setQueryData");
			expect(file.text, file.path).not.toContain("onMutate");
			expect(file.text, file.path).not.toContain("invalidateQueries");
			expect(file.text, file.path).not.toContain("removeQueries");
			/** No blanket `["viewer"]` key; security does not change product identity. */
			expect(file.text, file.path).not.toMatch(/\["viewer"\]/);
		}
	});

	/**
	 * Product identity does not move. The member id is unchanged when email, password, methods,
	 * passkeys or sessions change, so the local SQLite scope and sync namespace are too; that fact
	 * exists only as security code not mentioning those axes at all.
	 */
	it("security doesn't touch local data ownership", () => {
		for (const file of security)
			for (const forbidden of [
				/session\??\.user\b/,
				/useMobileLocalScope/,
				/useMobileAppPhase/,
				/local-data\//,
				/local-sync\//,
				/AsyncStorage/,
				/SecureStore/i,
				/expo-sqlite/,
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toMatch(forbidden);
	});

	/**
	 * Passwords do not cross the RowCat contract, except set, with a reason. Change goes to Better
	 * Auth, which already opens it over HTTP; only set passes our route (`setPassword` is serverOnly,
	 * so there is no surface to call). So `currentPassword` has no place in what goes to the SDK.
	 */
	it("the current password doesn't go out to the SDK", () => {
		const section = fileAt("features/account/password-section.tsx");
		expect(section).toMatch(
			/mutateAsync\(\{\s*newPassword: values\.newPassword\s*\}\)/,
		);
		expect(section).toContain("changeAccountPassword");
		for (const file of security)
			expect(file.text, file.path).not.toMatch(
				/currentPassword[\s\S]{0,80}(mutate|client\.me)/,
			);
	});

	/**
	 * Passwords are not tidied. A single `trim` splits screen and server decisions, with the symptom
	 * 'cannot sign in with the password I just made'. The length policy has one source in the
	 * contract.
	 */
	it("reads the shared length policy without trimming the password", () => {
		const form = fileAt("features/account/password-form.ts");
		expect(form).toContain("PASSWORD_LENGTH");
		expect(form).not.toMatch(/PASSWORD_MIN_LENGTH|PASSWORD_MAX_LENGTH/);
		for (const path of [
			"features/account/password-form.ts",
			"features/account/password-dialog.tsx",
			"features/account/password-section.tsx",
			"lib/account-security-auth.ts",
		]) {
			const text = fileAt(path);
			expect(text, path).not.toMatch(/(current|new|confirm)Password\.trim/i);
			expect(text, path).not.toMatch(
				/(current|new|confirm)Password\.(toLowerCase|normalize)/i,
			);
		}
	});

	/**
	 * Changing the password does not cut off other devices. The library offers the option but it is
	 * not passed; that operation has its own confirmation in the sessions section, and doing it
	 * silently would read as something the user did not do.
	 */
	it("changing the password doesn't revoke sessions", () => {
		expect(fileAt("lib/account-security-auth.ts")).not.toContain(
			"revokeOtherSessions",
		);
		expect(fileAt("features/account/password-section.tsx")).not.toContain(
			"revokeOtherSessions",
		);
	});

	/**
	 * The two ends of the connect round trip differ. An explicit failure (`AuthErrorLike`) goes
	 * through the security error mapper and states the real reason; only an error-free end without a
	 * connection gets the non-committal neutral sentence. Cancellation is not asserted as failure and
	 * failure is not blurred into cancellation. Either way the authority is the re-fetched account
	 * details.
	 */
	it("an explicit linking failure doesn't fold into a neutral sentence", () => {
		const methods = fileAt("features/account/login-methods-section.tsx");
		expect(methods).toMatch(
			/authSecurityErrorMessage\(failure, LOGIN_METHOD_CONNECT_FAILED\)/,
		);
		expect(methods).toContain("connectOutcomeNotice");
		/**
		 * Account details are re-fetched on explicit failure too; the server is the list's authority.
		 */
		expect(methods).toMatch(
			/await invalidateAccountDetails\(queryClient\);[\s\S]{0,600}if \(failure\)/,
		);
		/**
		 * The neutral notice does not stand on the failure branch; `settled` belongs to the error-free
		 * branch.
		 */
		expect(methods).toMatch(
			/if \(failure\) \{[\s\S]{0,600}return;\s*\}[\s\S]{0,600}setSettled\(provider\)/,
		);
	});

	/**
	 * The last login method cannot be disconnected, and the screen does not re-write that decision:
	 * `methods.length > 1` counts methods, not usable methods.
	 */
	it("the unlink decision goes through the domain function", () => {
		const methods = fileAt("features/account/login-methods-section.tsx");
		expect(methods).toContain("canDisconnectLoginMethod");
		expect(methods).toMatch(/remaining=\{check\.allowed \? check\.remaining/);
		for (const file of security)
			expect(file.text, file.path).not.toMatch(/methods\.length\s*[><=]/);
	});

	/**
	 * No passkey registration in this app, and no dead button. The absence is an intended parity gap:
	 * this auth stack has no native credential adapter, and hand-writing the WebAuthn ceremony is a
	 * protocol implementation this slice never asked for. List, rename and delete remain.
	 */
	it("doesn't imitate passkey registration", () => {
		for (const file of product)
			for (const forbidden of [
				/navigator\.credentials/,
				/PublicKeyCredential/,
				/@better-auth\/passkey/,
				/registerPasskey|addPasskey|createPasskey/,
				/attestation|authenticatorSelection|challenge/i,
				/Add (a )?passkey/i,
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toMatch(forbidden);

		const passkeys = fileAt("features/account/passkeys-section.tsx");
		expect(passkeys).toContain("PASSKEY_REGISTER_UNAVAILABLE_NOTE");
		expect(passkeys).toContain("PASSKEY_RENAME_LABEL");
		expect(passkeys).toContain("PASSKEY_DELETE_LABEL");
	});

	/**
	 * Device names are not invented. Sessions and passkeys draw only what we know; deleting on a wrong
	 * label cannot be undone.
	 */
	it("doesn't invent device identities", () => {
		for (const file of security)
			for (const forbidden of [
				/userAgent|user-agent/i,
				/\bAAGUID\b/i,
				/\bipAddress\b|\bIP address\b/i,
				/iPhone|MacBook|Windows|Android|Safari|Chrome|Keychain/,
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toMatch(forbidden);

		/** Opaque references are not drawn; they are only the address an operation points at. */
		const dialogs = fileAt("features/account/passkey-dialogs.tsx");
		expect(dialogs).not.toMatch(/passkey\.id/);
		/**
		 * References appear only as request arguments and list keys; as a text child the screen would
		 * read an internal identifier aloud.
		 */
		const passkeys = fileAt("features/account/passkeys-section.tsx");
		for (const at of passkeys.matchAll(/(item|renaming|removing)\.id/g))
			expect(
				passkeys.slice(Math.max(0, (at.index ?? 0) - 24), at.index),
				passkeys.slice(Math.max(0, (at.index ?? 0) - 24), (at.index ?? 0) + 16),
			).toMatch(/(id:|key=\{)\s*$/);
		const sessions = fileAt("features/account/sessions-section.tsx");
		for (const at of sessions.matchAll(/session\.id/g))
			expect(
				sessions.slice(Math.max(0, (at.index ?? 0) - 24), at.index),
				sessions.slice(Math.max(0, (at.index ?? 0) - 24), (at.index ?? 0) + 16),
			).toMatch(/(sessionId:|key=\{)\s*$/);
	});

	/**
	 * The current device has no revoke button. That is sign-out, whose path carries cache and scope
	 * cleanup; a second sign-out here would eventually skip it. The server makes the same decision
	 * (`current_session_revoke`).
	 */
	it("doesn't cut the current session from this list", () => {
		const sessions = fileAt("features/account/sessions-section.tsx");
		expect(sessions).toMatch(
			/session\.current \? \([\s\S]{0,600}SESSION_CURRENT_NOTE/,
		);
		expect(sessions).not.toMatch(/signOut\(/);
		/** Expansion is display state; it lives neither in the address nor in storage. */
		expect(sessions).toContain("useState(false)");
		expect(sessions).not.toContain("setParams");
	});

	/**
	 * No `Try again` for a state that needs sign-in again. Asking again with the same session returns the
	 * same answer, and a button that does nothing is indistinguishable from a broken one. Recovery
	 * goes through the existing transition owner.
	 */
	it("the recent sign-in requirement is guidance, not a failure", () => {
		for (const path of [
			"features/account/sessions-section.tsx",
			"features/account/passkeys-section.tsx",
		]) {
			const text = fileAt(path);
			expect(text, path).toMatch(
				/view\.state === "recent_login"[\s\S]{0,400}REAUTH_ACTION_LABEL/,
			);
		}

		const reauth = fileAt("features/account/use-reauth.ts");
		expect(reauth).toContain("useMobileIdentity");
		expect(reauth).toMatch(/signOut\(\)/);
		expect(reauth).toMatch(/redirect: "\/account"/);
		/** No second cleanup path. */
		expect(reauth).not.toContain("resetViewerState");
		expect(reauth).not.toContain("authClient");
	});

	/**
	 * Copy is a value, so pure tests can see it, and it states no fact we cannot know: no account
	 * enumeration, no processing deadline, no invented success.
	 */
	it("security copy doesn't state facts it can't know", () => {
		const copy = fileAt("features/account/security-copy.ts");
		for (const forbidden of [
			/email (is )?already in use|used by another account/i,
			/business day|processing deadline|expected completion/i,
			/email (was|has been) changed/i,
			/has been verified|has been confirmed/i,
			/coming soon|in preparation|available soon/i,
		])
			expect(copy, `${forbidden}`).not.toMatch(forbidden);

		/** Acceptance and completion are stated separately. */
		expect(copy).toContain(
			"The address doesn't change until you open every link",
		);
		/** Set and change are different sentences; not derived from the current mode. */
		expect(copy).toMatch(/set: "Your password was set\."/);
		expect(copy).toMatch(/changed: "Your password was changed\."/);
		const section = fileAt("features/account/password-section.tsx");
		expect(section).toMatch(/setResult\(mode === "set" \? "set" : "changed"\)/);
	});
});

describe("data — not a maintenance console", () => {
	/**
	 * The local deletion primitive belongs to account deletion. A `Delete all`-style action in the data
	 * section would put an irreversible operation among ordinary settings; the wiring
	 * (`deleteDatabase` ban) is locked above, so this locks the vocabulary.
	 */
	it("the data section has no generic destructive operations", () => {
		const data = fileAt("features/account/data-section.tsx");
		for (const forbidden of [
			/delete all|reset|clear all/i,
			/deleteLocalDataForViewer|purge/i,
		])
			expect(data, `${forbidden}`).not.toMatch(forbidden);
	});

	/** The storage model is not misstated; two sentences actually stand. */
	it("data copy describes the actual storage model", () => {
		const copy = fileAt("features/account/account-copy.ts");
		expect(copy).toContain("are saved on this device");
		expect(copy).toContain("Signing out doesn't erase this device's data;");
		expect(copy).not.toMatch(/stored in the cloud/i);
		expect(copy).not.toMatch(/sign(ing)? out.*delete/i);
	});
});

describe("deletion — the boundary of an irreversible operation", () => {
	/**
	 * The entrance is Better Auth's delete-user alone. A deletion request in the RowCat contract or
	 * SDK would route the credential account's current password through our contract; this locks that
	 * path from appearing even as vocabulary.
	 */
	it("the RowCat SDK has no deletion path", () => {
		for (const file of product) {
			expect(file.text, file.path).not.toMatch(/client\.me\.delete/);
			expect(file.text, file.path).not.toMatch(/["'`]\/v2\/me\/delete/);
			expect(file.text, file.path).not.toMatch(/["'`]\/account\/delete/);
			expect(file.text, file.path).not.toMatch(/["'`]\/delete-account/);
		}
	});

	/** No deletion route; the procedure ends inside `/account`. */
	it("deletion doesn't have its own route", () => {
		for (const path of [
			"app/account/delete.tsx",
			"app/delete-account.tsx",
			"app/account-deletion.tsx",
		])
			expect(
				product.some((file) => file.path === path),
				path,
			).toBe(false);
	});

	/**
	 * The password's lifetime is the confirmation dialog's: not tidied, cleared the moment confirm is
	 * pressed, and never in cache, storage or logs (storage vocabulary is already blocked by 'account
	 * is server state' above).
	 */
	it("deletes the deletion password right after confirmation, without trimming it", () => {
		const dialog = fileAt(
			"features/account/delete-account-dialog.tssx".replace("tssx", "tsx"),
		);
		expect(dialog).toContain("secureTextEntry");
		expect(dialog).not.toMatch(/password\.(trim|toLowerCase|normalize)/);
		/** Cleared right after `onConfirm`, so plaintext does not stay in state even on failure. */
		expect(dialog).toMatch(
			/onConfirm\(hasPassword \? password : undefined\);[\s\S]{0,300}setPassword\(""\)/,
		);
	});

	/**
	 * No magic phrase to type. Typing `DELETE` or the nickname verifies no identity; safety comes from
	 * the password (or recent login), verified by the auth layer.
	 */
	it("there is no confirmation phrase to type", () => {
		const dialog = fileAt("features/account/delete-account-dialog.tsx");
		expect(dialog).not.toMatch(
			/DELETE MY ACCOUNT|"DELETE"|===\s*"Delete account"/,
		);
		const section = fileAt("features/account/delete-account-section.tsx");
		expect(section).not.toMatch(/nickname|Enter (a |your )?nickname/);
	});

	/**
	 * Copy states no fact we cannot know: the server cannot erase other devices' storage, and a
	 * response-less failure is 'could not confirm', not 'failed'.
	 */
	it("the deletion copy is honest", () => {
		const copy = fileAt("features/account/account-copy.ts");
		expect(copy).not.toMatch(
			/deleted (instantly|immediately) on every device/i,
		);
		expect(copy).not.toMatch(/all (your )?data (is|lives) in the cloud/i);
		const error = fileAt("features/account/delete-account-error.ts");
		expect(error).toContain("Couldn't confirm");
		/** The terminal panel's two facts; no false 'deletion failed' sentence. */
		expect(copy).toContain("Your account was deleted");
	});

	/**
	 * Cleanup retry needs no authentication. The account is already gone so none can be required; if
	 * the retry path touched session, account lookup or password again it would fail forever.
	 */
	it("retrying the cleanup doesn't require authentication", () => {
		const turn = fileAt("features/account/deletion-turn.ts");
		const retry = turn.slice(turn.indexOf("async retryCleanup"));
		expect(retry).not.toMatch(/password|deleteAccount|account/i);
	});

	/**
	 * The terminal panel has neither cancel nor a second server delete, only cleanup retry and
	 * sign-in.
	 */
	it("the exit panel doesn't retry the deletion", () => {
		const terminal = fileAt("features/account/deletion-terminal.tsx");
		expect(terminal).toContain("retryCleanup");
		expect(terminal).toContain('replace("/login")');
		expect(terminal).not.toMatch(/requestDelete|Cancel/);
	});
});
