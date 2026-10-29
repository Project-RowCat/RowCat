import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The boundaries of the persona screen are checked statically. This slice breaks in the same three
 * ways when it moves:
 * - The server renders the settings shell, the nav list, category titles, descriptions and
 *   placeholders.
 * - The browser alone renders role names and descriptions, list state, IndexedDB subscriptions
 *   and create, edit and delete.
 * - There is one canonical screen. If an old address keeps rendering an old screen, the same
 *   feature has two addresses.
 *
 * The lower boundary keeps private text out of server HTML. Role names and descriptions are kept
 * only in this device's IndexedDB. That guarantee exists only because ClientOnly and lazy are
 * present, and omitting them causes silent leakage, not an error.
 *
 * The upper boundary is where this file widened. At one point the whole category sat inside
 * ClientOnly, so the server sent an empty height and even non-private titles waited for hydration.
 * Retreating to screen-level boundaries breaks neither compile nor render, so the absence is
 * asserted as a value.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROUTES = join(HERE, "..", "..", "routes", "(app)");

const readFeature = (name: string): string =>
	readFileSync(join(HERE, name), "utf8");
const readRoute = (...segments: string[]): string =>
	readFileSync(join(ROUTES, ...segments), "utf8");

/**
 * withoutComments strips comments before matching. Comments in this repo say why, and they name
 * things deliberately not done (for example, that the private body does not redraw
 * SettingsPageHeader). Banning those names would flag the file that explains the rule. That
 * pressure would push people to delete the comments, so the scan must not erase its own evidence.
 */
function withoutComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Keeps only what ClientOnly wraps: from the first opening tag to the last closing tag. The
 * question is what sits inside the boundary, and 'somewhere in the source' does not answer it,
 * since titles that should sit outside are in the same file.
 */
function insideClientOnly(source: string): string {
	const open = source.indexOf("<ClientOnly");
	const close = source.lastIndexOf("</ClientOnly>");
	expect(open, "no ClientOnly boundary").toBeGreaterThanOrEqual(0);
	expect(close, "ClientOnly is not closed").toBeGreaterThan(open);
	return source.slice(open, close);
}

const LOCAL_STORAGE_SYMBOLS = [
	"useLocalPersonas",
	"usePersonaLibrary",
	"useChatScope",
	"local-chat",
	"Dexie",
];

describe("role text does not ride in server HTML", () => {
	const content = () => readFeature("persona-library-content.tsx");

	/**
	 * ClientOnly stops server rendering; lazy also stops loading the module. Keeping only ClientOnly
	 * would leave the list screen and Dexie in the server bundle's static graph. The boundary is now
	 * inside the body, not at the route. What it wraps is the content that comes from IndexedDB.
	 */
	it("the private body is drawn and loaded only in the browser", () => {
		const page = readFeature("persona-settings-page.tsx");
		expect(page).toContain("ClientOnly");
		expect(page).toContain("lazy(");
		expect(insideClientOnly(page)).toContain("PersonaLibraryContent");
	});

	/**
	 * A server-rendered module must not know local storage. If it imports one, Dexie is pulled into
	 * that graph, and drawing a title line would load browser-only code.
	 */
	it("server-rendered modules do not import local storage", () => {
		for (const name of [
			"persona-settings-page.tsx",
			"persona-library-skeleton.tsx",
		]) {
			const source = withoutComments(readFeature(name));
			for (const symbol of LOCAL_STORAGE_SYMBOLS)
				expect(source, `${name} imports ${symbol}`).not.toContain(symbol);
		}
	});

	/**
	 * The other side: the private body really subscribes to local storage, so the boundary is not an
	 * empty shell.
	 */
	it("the private body subscribes to local storage", () => {
		expect(content()).toContain("useLocalPersonas");
		expect(content()).toContain("usePersonaLibrary");
	});

	/**
	 * Placeholders carry no roles. The server-rendered list placeholder should be bare shape only.
	 * Filling it with invented names would make the placeholder assert facts.
	 */
	it("the server-rendered placeholder has neither roles nor the empty state", () => {
		const skeleton = readFeature("persona-library-skeleton.tsx");
		expect(skeleton).toContain('aria-hidden="true"');
		const code = withoutComments(skeleton);
		expect(code).not.toContain("PERSONA_EMPTY");
		expect(code).not.toContain("emptyTitle");
	});
});

describe("the title and description are rendered by the server", () => {
	const page = () => readFeature("persona-settings-page.tsx");

	/**
	 * The category title sits outside the boundary. Moving it inside would make the server's body an
	 * empty slot again, and it would diverge from sibling categories (`General`, `AI`) and the first
	 * screen. This retreat breaks neither compile nor render.
	 */
	it("the title is outside ClientOnly", () => {
		const source = page();
		expect(source).toContain("SettingsPageHeader");
		expect(insideClientOnly(source)).not.toContain("SettingsPageHeader");
		expect(source.indexOf("<SettingsPageHeader")).toBeLessThan(
			source.indexOf("<ClientOnly"),
		);
	});

	/**
	 * The title `Personas` and its description are sent by the server too. Leaving a placeholder and
	 * deferring the text is the same retreat.
	 */
	it("the title and description are real text", () => {
		expect(page()).toContain('title={t("page.title")}');
		expect(page()).toContain('description={t("page.description")}');
	});

	/**
	 * The title is not drawn in two places. If the private body drew its own title again, the same
	 * text would turn into a different node at hydration.
	 */
	it("the private body does not redraw the title", () => {
		expect(
			withoutComments(readFeature("persona-library-content.tsx")),
		).not.toContain("SettingsPageHeader");
	});
});

describe("the transition is one category", () => {
	/**
	 * The entry wraps the category body once, in the same shape as sibling categories. If the list or
	 * the empty state had their own PageEnter, the screen would appear twice when the value arrives.
	 */
	it("PageEnter is only in the server-rendered page", () => {
		expect(readFeature("persona-settings-page.tsx")).toContain("<PageEnter>");
		for (const name of [
			"persona-library-content.tsx",
			"persona-library-skeleton.tsx",
		])
			expect(
				withoutComments(readFeature(name)),
				`${name} has its own transition`,
			).not.toContain("PageEnter");
	});
});

describe("the settings category route is thin", () => {
	const source = () => withoutComments(readRoute("settings", "personas.tsx"));

	/**
	 * Auth checks, no-index and the shell belong to the parent layout. The server-render boundary
	 * belongs to the body. The route keeps only one thing: which category this address is. It must
	 * match its siblings (index.tsx, ai.tsx), so that when a category is added there is no step to
	 * forget.
	 */
	it("the route does not defer the whole screen to the browser", () => {
		expect(source()).toContain("PersonaSettingsPage");
		expect(source()).not.toContain("<ClientOnly");
		expect(source()).not.toContain("lazy(");
	});

	/**
	 * The shell and the nav list come from the parent layout, so this screen must not build a second
	 * shell.
	 */
	it("does not build its own shell", () => {
		expect(source()).not.toContain("SettingsShell");
		const layout = withoutComments(readRoute("settings", "route.tsx"));
		expect(layout).toContain("SettingsShell");
		expect(layout).toContain("Outlet");
	});
});

describe("the store state does not fold into loading", () => {
	/**
	 * unavailable (the identity could not be confirmed, so no storage can be opened) is not loading.
	 * Folding it into loading would leave a screen whose session has dropped showing a placeholder
	 * forever. The conversation list handles the same branch in the same order
	 * (chat-library-page.tsx). Removing this branch passes types and rendering, so the test catches
	 * it.
	 */
	it("the unavailable branch comes before the loading branch", () => {
		const code = withoutComments(readFeature("persona-library-content.tsx"));
		const unavailable = code.indexOf('status === "unavailable"');
		const loading = code.indexOf("if (loading)");
		expect(unavailable).toBeGreaterThan(-1);
		expect(loading).toBeGreaterThan(unavailable);
	});

	/**
	 * This is a fact about the account, not the network, so the copy must not use connection wording.
	 */
	it("unavailable is not phrased as a connection problem", () => {
		const code = withoutComments(readFeature("persona-library-content.tsx"));
		expect(code).not.toContain("not connected");
		expect(code).not.toContain("offline");
	});
});

describe("there is one canonical copy", () => {
	/**
	 * The old address is a redirect with no screen. Drawing the old UI here would give the same
	 * feature two addresses, and nobody could say which one is canonical.
	 */
	it("/personas only redirects", () => {
		const source = withoutComments(readRoute("personas", "index.tsx"));
		expect(source).toContain('to: "/settings/personas"');
		expect(source).not.toContain("PersonaSettingsPage");
		expect(source).not.toContain("PersonaLibraryContent");
		expect(source).not.toContain("component:");
	});
});
