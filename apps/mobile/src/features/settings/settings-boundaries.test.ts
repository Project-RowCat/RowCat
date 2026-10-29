import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Boundaries of the settings slice: **what the type system cannot catch.**
 *
 * Every rule below compiles even when broken and fails only on a device. This slice has one
 * irreversible operation (clearing local data), so its boundary doubles up: one wrongly chosen
 * primitive can lock a person out of their own account.
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
 * **Checks run after comments are stripped.** This repository's comments spell out banned words
 * while explaining the boundaries ("does not use `abandonViewer`"). Scanning the raw text would
 * flag the sentences that explain a rule as violations, and everyone would then fix that by
 * deleting the comments.
 */
const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const all = sources(SRC)
	.map((path) => ({
		path: path.slice(SRC.length),
		text: stripComments(readFileSync(path, "utf8")),
	}))
	/** The scanner itself holds the banned words as patterns; scanning itself would always fail. */
	.filter((file) => !file.path.endsWith("settings-boundaries.test.ts"));

const product = all.filter(
	(file) => !file.path.startsWith("test/") && !/\.test\.tsx?$/.test(file.path),
);

const settings = product.filter((file) =>
	file.path.startsWith("features/settings/"),
);
const persona = product.filter((file) =>
	file.path.startsWith("features/persona/"),
);

const fileAt = (path: string) => {
	const found = product.find((file) => file.path === path);
	if (!found) throw new Error(`${path} is missing`);
	return found.text;
};

describe("the files to check actually exist", () => {
	it("the settings and persona folders aren't empty", () => {
		expect(settings.length).toBeGreaterThan(8);
		expect(persona.length).toBeGreaterThan(3);
	});

	it("the three routes are in place", () => {
		for (const path of [
			"app/settings/index.tsx",
			"app/settings/ai.tsx",
			"app/settings/personas.tsx",
		])
			expect(() => fileAt(path)).not.toThrow();
	});
});

describe("settings isn't a fourth section", () => {
	/**
	 * **Do not grow the vocabulary.** If settings entered `MobileAppSection`, the drawer would get a
	 * fourth item, and at that moment the left side would stop being a list of product sections and
	 * become "leftover space". After that, theme, notifications, account and sign-out would follow one
	 * by one (the `app-sidebar.tsx` header records where that ends).
	 */
	it("MobileAppSection stays three", () => {
		const route = fileAt("features/shell/shell-route.ts");
		expect(route).toContain(
			'export type MobileAppSection = "discover" | "chat" | "create";',
		);
	});

	/** It **does** go into the utility vocabulary: the same three as the web header. */
	it("MobileShellUtility has settings", () => {
		expect(fileAt("features/shell/shell-route.ts")).toContain(
			'export type MobileShellUtility = "notifications" | "settings" | "account";',
		);
	});

	/** The drawer's copy table has no settings entry; if it did, that surface would draw it. */
	it("the drawer copy has no settings", () => {
		const copy = fileAt("features/shell/sidebar-copy.ts");
		expect(copy).not.toContain("Settings");
		expect(copy).not.toContain("/settings");
	});

	/** The drawer itself has no route to settings. */
	it("the drawer doesn't go to settings", () => {
		const sidebar = fileAt("features/shell/app-sidebar.tsx");
		expect(sidebar).not.toContain("/settings");
		expect(sidebar).not.toContain("SettingsShortcut");
	});
});

describe("the order of global utilities", () => {
	/**
	 * **Notifications → account.** Account is always the right-hand anchor. If each screen wrote its
	 * own, one screen would eventually flip the order; that mismatch only shows when moving between
	 * screens.
	 *
	 * ⚠️ For a while this check counted **four** (balance · notifications · settings · account, the
	 * same order as the web header). It shrank to two for reasons of width: at 320pt those four take
	 * up the right half of the screen, and two of them cannot answer *does this screen summon me while
	 * I am looking at it?* (settings is a place you visit briefly and leave; the balance is a read,
	 * not an action). Both were folded into the account menu.
	 */
	it("the bundle stands notifications then account", () => {
		const text = fileAt("features/shell/shell-utilities.tsx");
		const order = [
			text.indexOf("<NotificationShortcut"),
			text.indexOf("<AccountShortcut"),
		];
		expect(order.every((index) => index >= 0)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
	});

	/** The home header on Discover uses the same relative order. */
	it("the discover header is notifications → account too", () => {
		const text = fileAt("features/shell/app-header.tsx");
		const order = [
			text.indexOf("<NotificationShortcut"),
			text.indexOf("<AccountShortcut"),
		];
		expect(order.every((index) => index >= 0)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
	});

	/**
	 * **The header has no gear: the trigger itself is gone.**
	 *
	 * The route to settings is one item in the account menu, and the file for the old trigger was
	 * deleted (`settings-shortcut.tsx`). Bringing it back would make two routes to the same
	 * destination on one screen, and those two would soon behave differently (one is `push`, one is
	 * `navigate`).
	 */
	it("there's no settings trigger component", () => {
		expect(() => fileAt("features/settings/settings-shortcut.tsx")).toThrow();
		for (const file of product)
			expect(file.text, file.path).not.toMatch(/\bSettingsShortcut\b/);
	});

	/**
	 * **The route to settings is the one account-menu item.** Its being a `push` is also a rule: it is
	 * a place you visit briefly and leave, so going back must return to the screen you were on. (The
	 * old gear used the same function for the same reason.)
	 */
	it("the account menu tucks settings in", () => {
		const menu = fileAt("features/account/account-shortcut.tsx");
		expect(menu).toContain("ACCOUNT_MENU_SETTINGS");
		expect(menu).toContain('router.push("/settings")');
	});

	/**
	 * **Do not widen the exception for the conversation screen (an open room).** Its header is the
	 * tightest row at 320pt, with four touch targets, which is why the utility group is deliberately
	 * absent there.
	 */
	it("the conversation screen header has no utilities", () => {
		const chat = fileAt("features/chat/chat-screen.tsx");
		expect(chat).not.toContain("ShellUtilities");
	});

	/**
	 * **The appearance trigger is still exclusive with the member branch.** Members get the settings
	 * screen for that value, while for guests this trigger is the only way to change brightness inside
	 * the app. If the conditions overlapped, one extra icon would appear on member screens; if they
	 * split, guests would lose brightness.
	 */
	it("the brightness trigger doesn't stand for members", () => {
		const appearance = fileAt("features/settings/appearance-shortcut.tsx");
		expect(appearance).toMatch(
			/phase === "authenticated"[\s\S]{0,40}return null/,
		);
	});
});

describe("doesn't rebuild the account", () => {
	/**
	 * Nickname, email, password, login methods, passkeys, sessions, moderation and account deletion
	 * are all owned by `/account`. If settings drew even one of those values, two places would edit
	 * the same value, and those two would soon behave differently.
	 */
	it("doesn't take in account lookups or operations", () => {
		for (const file of [...settings, ...persona])
			for (const forbidden of [
				"accountQueryOptions",
				"nicknameMutationOptions",
				"bioMutationOptions",
				"showAdultMutationOptions",
				"uploadAvatarMutationOptions",
				"requestAccountDeletion",
				"deleteUser",
				"authClient",
				"passkey",
				"revokeSession",
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toContain(
					forbidden,
				);
	});

	/** There is **one** way to the account: not a category, but an exit link. */
	it("the account link is outside the navigation list", () => {
		const nav = fileAt("features/settings/settings-nav.ts");
		expect(nav).toContain("MOBILE_SETTINGS_ACCOUNT_LINK");
		/** If `/account` were placed inside the category array, it would become a fourth row in settings. */
		const list = /MOBILE_SETTINGS_NAV[\s\S]*?\] as const;/.exec(nav)?.[0] ?? "";
		expect(list).not.toContain("/account");
	});
});

describe("settings knows only the connection summary", () => {
	/**
	 * **P0.** If the screen can read the stored API key, that value rides along in state, closures or
	 * diagnostic snapshots somewhere in the render tree. So settings knows only the summary (`Linked`
	 * (connected) and the time), and the port that opens the secret is a **hook with a different
	 * name** (`useProviderCredentialScope`).
	 */
	it("doesn't take in the port that opens credentials", () => {
		for (const file of [...settings, ...persona])
			for (const forbidden of [
				"useProviderCredentialScope",
				"ProviderCredentialAccess",
				"withCredential",
				"readSecret",
				"getApiKey",
				"exportCredential",
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toContain(
					forbidden,
				);
	});

	/**
	 * **The screen does not know the storage medium.** Calling `expo-secure-store` here would create a
	 * second copy of the item-naming rule, and if one of them went stale only that screen would read
	 * someone else's item or read nothing. The only path is the store the scope provides.
	 */
	it("doesn't call native secret storage directly", () => {
		for (const file of [...settings, ...persona])
			for (const forbidden of [
				"expo-secure-store",
				"SecureStore",
				"providerCredentialEntry",
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toContain(
					forbidden,
				);
	});

	/**
	 * **The screen does not know provider addresses.** Verification and generation both pass through
	 * the adapter. The only address settings knows is the key issuing page it sends the user to.
	 */
	it("doesn't write provider endpoints", () => {
		for (const file of settings) {
			expect(file.text, file.path).not.toContain("api.anthropic.com");
			expect(file.text, file.path).not.toContain("generativelanguage");
		}
	});

	/**
	 * **Do not pretend to show the stored key.** Neither a masked value nor the last four digits are
	 * drawn. That display is information usable for offline matching, and above all it would require a
	 * path by which the screen reads the stored secret (no such path exists in this slice).
	 */
	it("no operation reveals the key", () => {
		for (const file of settings)
			for (const forbidden of ["Copy", "Show", "masking", "•••"])
				expect(file.text, `${file.path} — ${forbidden}`).not.toContain(
					forbidden,
				);
	});

	/**
	 * **A connection does not touch preferences.** Connecting does not switch the global target to
	 * that provider, and disconnecting does not clear a saved target. Reconnecting must make those
	 * conversations work again without any action.
	 */
	it("connecting and unlinking don't write generation preferences", () => {
		for (const path of [
			"features/settings/provider-connections-section.tsx",
			"features/settings/connect-provider.ts",
			"features/settings/provider-connection-dialog.tsx",
		]) {
			const text = fileAt(path);
			for (const forbidden of [
				"setGlobal",
				"setRoom",
				"clearRoom",
				"useGenerationScope",
			])
				expect(text, `${path} — ${forbidden}`).not.toContain(forbidden);
		}
	});

	/**
	 * **A connection does not wake sync.** This value belongs to the device, so there is nothing to
	 * upload; still, emitting a signal would send one pointless sync for every key saved.
	 */
	it("doesn't call sync", () => {
		for (const file of settings) {
			expect(file.text, file.path).not.toContain("syncNow");
			expect(file.text, file.path).not.toContain("requestSync");
		}
	});

	/**
	 * **Disconnect is not locked by eligibility.** If it were locked symmetrically with saving, a
	 * member confirmed under 14 could never delete an API key still on their device. The pure decision
	 * carries that fact as a value.
	 */
	it("unlinking isn't locked by eligibility", () => {
		const state = fileAt("features/settings/provider-connections-state.ts");
		expect(state).toContain("canDisconnect: true");
		expect(state).not.toMatch(/canDisconnect:\s*input\.byoAllowed/);
	});

	/**
	 * **Rows are not hidden when ineligible.** A person who came to fix something cannot find what to
	 * fix, and, above all, the ability to delete a key already connected would disappear.
	 */
	it("the row list doesn't hang on eligibility or the catalogue", () => {
		const state = fileAt("features/settings/provider-connections-state.ts");
		expect(state).toContain("MOBILE_BYO_PROVIDERS.map");
		expect(state).not.toContain("generationModelsQueryOptions");
	});

	/**
	 * **No dead placeholders.** Things this slice does not open (OpenAI, OpenRouter, arbitrary
	 * endpoints, proxies) are not drawn as `Coming soon`.
	 */
	it("no `Coming soon` placeholders or next-slice vocabulary", () => {
		for (const file of settings)
			for (const placeholder of [
				"Coming soon",
				"Available soon",
				"coming soon",
				"OpenAI",
				"OpenRouter",
				"baseUrl",
				"customEndpoint",
			])
				expect(file.text, `${file.path} — ${placeholder}`).not.toContain(
					placeholder,
				);
	});

	/** The BYO target vocabulary is not narrowed to the managed one either. */
	it("doesn't narrow the target vocabulary", () => {
		for (const file of settings)
			expect(file.text, file.path).not.toMatch(
				/provider\s*[=!]==\s*["\u0027]rowcat["\u0027]/,
			);
	});
});

describe("generation defaults are the device's values", () => {
	const defaults = () =>
		fileAt("features/settings/generation-defaults-section.tsx");

	/** The store is **the same one** the conversation settings use. No second settings store is created. */
	it("uses the global preference store as is", () => {
		expect(defaults()).toContain("useGenerationScope");
		expect(defaults()).toContain("setGlobal");
		expect(defaults()).toContain("useGlobalGenerationState");
	});

	/**
	 * **Room overrides are not touched.** A value chosen here applies only to rooms without an
	 * override, and there must be no line of code that walks existing rooms and edits them.
	 */
	it("doesn't write room preferences", () => {
		expect(defaults()).not.toContain("setRoom");
		expect(defaults()).not.toContain("clearRoom");
		expect(defaults()).not.toContain("listRooms");
	});

	/**
	 * Do not re-write the priority resolution. If `room ?? global ?? default` appeared in three
	 * places, one of them would go stale someday, and then "the summary and the settings name
	 * different models".
	 */
	it("the screen doesn't rewrite precedence", () => {
		expect(defaults()).not.toContain("resolveEffectiveGeneration");
		expect(defaults()).not.toMatch(/\?\?\s*PRODUCT_/);
	});

	/** This value is not synced, and it is not held in the query cache. */
	it("doesn't put generation preferences in the query cache", () => {
		expect(defaults()).not.toMatch(/queryKey:\s*\[/);
		expect(defaults()).not.toContain("requestSync");
		expect(defaults()).not.toContain("syncNow");
	});
});

describe("persona library", () => {
	/**
	 * **Do not call the server.** Personas are local-first records: there is no list endpoint, none is
	 * created, and no copy is kept in the query cache.
	 */
	it("no server lookup and no query key", () => {
		for (const file of persona) {
			expect(file.text, file.path).not.toContain("getRowCatClient");
			expect(file.text, file.path).not.toContain("@rowcat/sdk");
			expect(file.text, file.path).not.toMatch(/queryKey:\s*\[/);
		}
	});

	/**
	 * **Deleting does not walk the rooms.** A room holds a copy of the value, so there is no reference
	 * to trace back; if deletion started scanning rooms, the user would get a change they never asked
	 * for (the speaker in a conversation disappearing).
	 */
	it("deletion doesn't touch rooms", () => {
		const mutations = fileAt("features/persona/persona-mutations.ts");
		for (const forbidden of [
			"listRooms",
			"setRoomPersona",
			"deleteRoom",
			"updateRoom",
		])
			expect(mutations, forbidden).not.toContain(forbidden);
	});

	/** Sync is woken by the write signal; the screen does not push it directly. */
	it("doesn't call sync directly", () => {
		for (const file of persona) {
			expect(file.text, file.path).not.toContain("syncNow");
			expect(file.text, file.path).not.toContain("requestSync");
		}
	});

	/**
	 * There is **one** write site. If each row touched storage directly, the ownership check would be
	 * repeated per row, and the day one is missed, a save started on Alice's screen would finish in
	 * Bob's database.
	 */
	it("persona writes go through one pure composition", () => {
		const writers = product
			.filter((file) => !file.path.startsWith("lib/local-data/"))
			.filter((file) =>
				/\bcreatePersona\b|\bupdatePersona\b|\bdeletePersona\b/.test(file.text),
			)
			.map((file) => file.path);
		expect(writers).toEqual(["features/persona/persona-mutations.ts"]);
	});

	/** Validation is done by `@rowcat/chat` — no second length computation is written. */
	it("doesn't rewrite length or validation", () => {
		const dialog = fileAt("features/persona/persona-form-dialog.tsx");
		expect(dialog).toContain("planPersonaSave");
		expect(dialog).toContain("personaTextLength");
		/** Setting `maxLength` means the over-limit state is never expressed, so the warning never draws. */
		expect(dialog).not.toContain("maxLength");
		expect(dialog).not.toMatch(/\.length\s*>\s*\d/);
	});
});

describe("device appearance is independent of identity", () => {
	const appearance = product.filter((file) =>
		file.path.startsWith("lib/appearance/"),
	);

	it("there are files to check", () => {
		expect(appearance.length).toBeGreaterThan(2);
	});

	/**
	 * **P0.** If this value flowed down to member scope, there would be no place to hold a guest's
	 * choice, and brightness would revert together on `Alice → sign out → Bob`, a change the user
	 * never made. So this folder knows neither identity, nor the query cache, nor member-scoped
	 * storage.
	 */
	it("doesn't know identity, queries or the member store", () => {
		for (const file of appearance)
			for (const forbidden of [
				"useMobileIdentity",
				"@rowcat/query",
				"@tanstack/react-query",
				"local-data",
				"viewerId",
				"SecureStore",
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toContain(
					forbidden,
				);
	});

	/** This layer does not know account theme — that is another axis, owned by the server. */
	it("doesn't know the account theme", () => {
		for (const file of appearance) {
			expect(file.text, file.path).not.toContain("themeCustomization");
			expect(file.text, file.path).not.toContain("customColorsActive");
		}
	});

	/**
	 * The storage medium sits behind a port: one file is the only one that knows the native module.
	 *
	 * **That one file has moved out of this folder.** When the device key-value store gained a second
	 * consumer (the chosen brightness, and the fact that the update note was seen), the file name and
	 * the synchronous read rule moved to `lib/device-storage.ts`, and what stays here is **which key**
	 * — one. The widening of the check is how that fact is expressed: this folder no longer knows any
	 * native module at all, and there is exactly one place in the whole repository that knows one.
	 */
	it("one place knows native storage", () => {
		for (const file of appearance)
			expect(file.text, file.path).not.toMatch(/expo-sqlite/);
		const knowers = product
			.filter((file) => /expo-sqlite\/kv-store/.test(file.text))
			.map((file) => file.path);
		expect(knowers).toEqual(["lib/device-storage.ts"]);
	});

	/**
	 * It must be a **different file** from the member database. Using the same name would make this
	 * device's local reset erase the appearance too.
	 */
	it("doesn't use the member database name", () => {
		const storage = fileAt("lib/appearance/sqlite-storage.ts");
		expect(storage).not.toContain("viewerDatabaseName");
		expect(storage).not.toContain("rowcat_vnext_");
	});
});

describe("the server owns the account theme", () => {
	const theme = () => [
		fileAt("features/settings/theme-customization-section.tsx"),
		fileAt("features/settings/theme-customization-state.ts"),
		fileAt("features/settings/theme-color-dialog.tsx"),
	];

	/** It is the account's value, so no copy is kept in device storage — keeping one would make two sources of truth. */
	it("doesn't keep a copy in device storage", () => {
		for (const text of theme())
			for (const storage of [
				"expo-sqlite",
				"expo-secure-store",
				"AsyncStorage",
				"local-data",
			])
				expect(text, storage).not.toContain(storage);
	});

	/**
	 * Payments do not come back in. Custom colors were once reserved for subscribers. Payments were
	 * removed in the public release (`docs/oss/PLAN.md` §3), so if this vocabulary were written
	 * again, colors anyone could pick would be silently blocked.
	 */
	it("doesn't use billing or entitlement vocabulary", () => {
		for (const text of theme())
			for (const symbol of [
				"customColorsActive",
				"invalidateCattowerEntitlement",
				"THEME_CATTOWER_BADGE",
				"THEME_LOCKED_NOTE",
			])
				expect(text, symbol).not.toContain(symbol);
	});

	/** Query keys and write policies belong to the shared package (the mobile app does not create its own keys). */
	it("uses the shared query and mutation options as is", () => {
		const section = fileAt("features/settings/theme-customization-section.tsx");
		for (const shared of [
			"themeCustomizationQueryOptions",
			"saveThemePresetMutationOptions",
			"saveThemeColorsMutationOptions",
			"clearThemeColorsMutationOptions",
			"resetThemeMutationOptions",
		])
			expect(section, shared).toContain(shared);
		expect(section).not.toMatch(/queryKey:\s*\[/);
	});

	/**
	 * **Do not build a second application layer.** The colours for the whole app are changed by the
	 * root `ViewerThemeOverride`. If settings imitated it, colours would be released when leaving the
	 * screen, or two layers would paint different values.
	 */
	it("settings doesn't apply colors", () => {
		for (const text of theme()) {
			expect(text).not.toContain("ThemeColorOverrideProvider");
			expect(text).not.toContain("resolveEffectiveThemeOverrides");
		}
	});

	/** Do not make a copy of the preset palette — the source of colour values is `@rowcat/design`, one place. */
	it("there are no color literals", () => {
		for (const text of theme()) expect(text).not.toMatch(/#[0-9a-fA-F]{6}/);
	});

	/**
	 * The floor of the preview must be the colour table **before** overrides are layered on. If the
	 * merged table were used, a blank slot's preview would draw the colour currently saved, and the
	 * user would read the cleared slot as not having been cleared.
	 */
	it("the preview reads the default palette", () => {
		expect(
			fileAt("features/settings/theme-customization-section.tsx"),
		).toContain("useBaseTheme");
	});
});

describe("local reset isn't account deletion", () => {
	const reset = () => [
		fileAt("features/settings/local-data-section.tsx"),
		fileAt("lib/local-reset.ts"),
		fileAt("lib/local-reset-ports.ts"),
	];

	/**
	 * **P0.** `abandonViewer` is a terminal operation for an account that has gone, and it permanently
	 * blocks the same member from being reactivated. If reset used it, the user would be locked out of
	 * their own account as the price of clearing data, and that state would only clear after the app
	 * is closed and reopened.
	 */
	it("doesn't reuse the deletion cleanup path", () => {
		for (const text of reset())
			for (const forbidden of [
				"abandonViewer",
				"purgeDeletedViewer",
				"resetViewerState",
				"requestAccountDeletion",
				"signOut",
				"deleteUser",
			])
				expect(text, forbidden).not.toContain(forbidden);
	});

	/** No outgoing request to the server — it ends without the network. */
	it("doesn't call the server", () => {
		for (const text of reset()) {
			expect(text).not.toContain("getRowCatClient");
			expect(text).not.toContain("@rowcat/sdk");
			expect(text).not.toContain("@tanstack/react-query");
		}
	});

	/**
	 * The thing deleted is **one name**. Scanning by prefix would also delete other members of the
	 * same device.
	 */
	it("doesn't sweep by prefix", () => {
		const ports = fileAt("lib/local-reset-ports.ts");
		expect(ports).toContain("deleteLocalDataForViewer");
		expect(ports).not.toContain("rowcat_vnext_");
		expect(ports).not.toMatch(/readdir|listDatabases|getAllKeys/);
	});

	/** Irreversible confirmation, so it is an `AlertDialog` — and `Alert.alert` is not used. */
	it("the confirmation is an AlertDialog", () => {
		const section = fileAt("features/settings/local-data-section.tsx");
		expect(section).toContain("<AlertDialog");
		expect(section).not.toContain("Alert.alert");
	});

	/**
	 * The lock that folds a second confirmation in the same tick must be a **ref**. `pending` is true
	 * only after the render arrives, so if two fingers touch in the same frame, the irreversible
	 * operation starts twice.
	 */
	it("there's a synchronous lock", () => {
		const section = fileAt("features/settings/local-data-section.tsx");
		expect(section).toMatch(/useRef\(false\)/);
		expect(section).toMatch(/runningRef\.current/);
	});
});

describe("settings doesn't become a store of values", () => {
	/**
	 * Each setting reads from and writes to its own owner. If an object holding every setting, or a
	 * bottom `Save settings` button, existed, no transaction spanning different stores would
	 * exist, so such a button would report a partly-succeeded state as a success.
	 */
	it("no settings global state or bulk save", () => {
		for (const file of settings)
			for (const forbidden of [
				"SettingsProvider",
				"SettingsContext",
				"useSettingsStore",
				"Save changes",
				"Save settings",
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toContain(
					forbidden,
				);
	});

	/**
	 * A category is an **address**. Holding it in local state would make deep links, back navigation
	 * and state restore disappear all at once, and once shadow state and the route disagree, there is
	 * no way to decide which to trust.
	 */
	it("categories aren't kept as shadow state", () => {
		for (const file of settings) {
			expect(file.text, file.path).not.toMatch(/selectedCategory/);
			expect(file.text, file.path).not.toMatch(
				/useState<MobileSettingsCategory/,
			);
		}
	});
});
