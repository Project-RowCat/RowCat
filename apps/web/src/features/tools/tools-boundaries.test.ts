import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The tool settings screen's boundaries, checked statically, in the persona library's shape
 * (features/persona/persona-boundaries.test.ts) and for a stronger reason: a tool can hold an
 * endpoint address and header values that are keys. Those live only in this device's IndexedDB,
 * and the guarantee that they never reach server HTML exists only because ClientOnly and lazy are
 * present. Removing either breaks neither the build nor the render; it leaks silently.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROUTES = join(HERE, "..", "..", "routes", "(app)");

const readFeature = (name: string): string =>
	readFileSync(join(HERE, name), "utf8");
const readRoute = (...segments: string[]): string =>
	readFileSync(join(ROUTES, ...segments), "utf8");

/** Comments explain what is deliberately not done; scanning them would flag the explanation. */
function withoutComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function insideClientOnly(source: string): string {
	const open = source.indexOf("<ClientOnly");
	const close = source.lastIndexOf("</ClientOnly>");
	expect(open, "no ClientOnly boundary").toBeGreaterThanOrEqual(0);
	expect(close, "ClientOnly is not closed").toBeGreaterThan(open);
	return source.slice(open, close);
}

const LOCAL_STORAGE_SYMBOLS = [
	"useLocalUserTools",
	"useToolLibrary",
	"useChatScope",
	"local-chat",
	"Dexie",
];

describe("tool values do not ride in server HTML", () => {
	it("the private body is drawn and loaded only in the browser", () => {
		const page = readFeature("tool-settings-page.tsx");
		expect(page).toContain("lazy(");
		expect(insideClientOnly(page)).toContain("ToolLibraryContent");
	});

	it("server-rendered modules do not import local storage", () => {
		for (const name of [
			"tool-settings-page.tsx",
			"tool-library-skeleton.tsx",
		]) {
			const source = withoutComments(readFeature(name));
			for (const symbol of LOCAL_STORAGE_SYMBOLS)
				expect(source, `${name} imports ${symbol}`).not.toContain(symbol);
		}
	});

	it("the private body subscribes to local storage", () => {
		const content = readFeature("tool-library-content.tsx");
		expect(content).toContain("useLocalUserTools");
		expect(content).toContain("useToolLibrary");
	});

	it("the placeholder is bare shape", () => {
		const skeleton = readFeature("tool-library-skeleton.tsx");
		expect(skeleton).toContain('aria-hidden="true"');
		expect(withoutComments(skeleton)).not.toContain("emptyTitle");
	});
});

describe("the title and description are rendered by the server", () => {
	it("the header sits before and outside the boundary", () => {
		const source = readFeature("tool-settings-page.tsx");
		expect(source).toContain('title={t("page.title")}');
		expect(source).toContain('description={t("page.description")}');
		expect(insideClientOnly(source)).not.toContain("SettingsPageHeader");
		expect(source.indexOf("<SettingsPageHeader")).toBeLessThan(
			source.indexOf("<ClientOnly"),
		);
		expect(
			withoutComments(readFeature("tool-library-content.tsx")),
		).not.toContain("SettingsPageHeader");
	});

	it("PageEnter is only in the server-rendered page", () => {
		expect(readFeature("tool-settings-page.tsx")).toContain("<PageEnter>");
		for (const name of [
			"tool-library-content.tsx",
			"tool-library-skeleton.tsx",
		])
			expect(withoutComments(readFeature(name))).not.toContain("PageEnter");
	});
});

describe("the settings category route is thin", () => {
	const source = () => withoutComments(readRoute("settings", "tools.tsx"));

	it("the route neither defers the screen nor builds a shell", () => {
		expect(source()).toContain("ToolSettingsPage");
		expect(source()).not.toContain("<ClientOnly");
		expect(source()).not.toContain("lazy(");
		expect(source()).not.toContain("SettingsShell");
	});

	/** A tool name or address in the title would persist in history and tab lists. */
	it("the title is fixed", () => {
		expect(source()).toContain('"titles.toolSettings"');
	});
});

describe("the store state does not fold into loading", () => {
	it("the unavailable branch comes before the loading branch", () => {
		const code = withoutComments(readFeature("tool-library-content.tsx"));
		const unavailable = code.indexOf('status === "unavailable"');
		const loading = code.indexOf("if (loading)");
		expect(unavailable).toBeGreaterThan(-1);
		expect(loading).toBeGreaterThan(unavailable);
	});
});

describe("the http tool says what it sends", () => {
	/**
	 * The editor must state, next to the address, that conversation-derived arguments go to it and
	 * that the browser needs CORS. Dropping the notice passes every type check and render.
	 */
	it("the editor draws both sentences for http tools", () => {
		const editor = readFeature("tool-editor-dialog.tsx");
		expect(editor).toContain('t("editor.httpWarning")');
		expect(editor).toContain('t("editor.httpCors")');
	});

	/** Import shows where an http entry would send calls before the importer chooses. */
	it("the import list shows an http entry's origin", () => {
		expect(readFeature("tool-file-dialogs.tsx")).toContain("entry.http.origin");
	});
});
