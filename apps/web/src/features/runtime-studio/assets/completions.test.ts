import { describe, expect, it } from "vitest";
import {
	prepareRuntimeAssetCatalog,
	type RuntimeAssetEditorEntry,
} from "./catalog.ts";
import { planRuntimeAssetCompletions } from "./completions.ts";

/**
 * Name suggestions inside `asset("`.
 *
 * Half of this file checks that the selected item does not break the surrounding syntax. If the
 * replaced range extends even one character too far, quotes or the closing parenthesis disappear,
 * and the user never asked for that edit.
 */

const MEDIA = (mediaId: string) =>
	`https://api.rowcat.test/v2/media/${mediaId}`;

const entry = (path: string): RuntimeAssetEditorEntry => ({
	path,
	mediaId: `media-${path}`,
	kind: "image",
	mime: "image/webp",
	width: 640,
	height: 640,
	durationMs: null,
});

const CATALOG = prepareRuntimeAssetCatalog(
	[
		entry("ui/heart"),
		entry("characters/sena/smile"),
		entry("backgrounds/library"),
		entry("characters/sena/angry"),
	],
	MEDIA,
);

const planAt = (marked: string) => {
	const offset = marked.indexOf("|");
	expect(offset).toBeGreaterThanOrEqual(0);
	return {
		source: marked.replace("|", ""),
		plan: planRuntimeAssetCompletions(CATALOG, marked.replace("|", ""), offset),
	};
};

describe("items", () => {
	it("gives every project image in name order", () => {
		expect(planAt('asset("|")').plan?.items.map((item) => item.path)).toEqual([
			"backgrounds/library",
			"characters/sena/angry",
			"characters/sena/smile",
			"ui/heart",
		]);
	});

	/**
	 * Does not pre-filter by prefix. Monaco filters by the text from the range start to the cursor, so
	 * filtering here too would duplicate the rule, and the two copies would diverge the day Monaco's
	 * filter changes.
	 */
	it("does not pre-filter by prefix; filtering is Monaco's job", () => {
		expect(planAt('asset("characters/|")').plan?.items).toHaveLength(4);
	});

	it("hands the order to Monaco as is: zero-padded sort keys", () => {
		const items = planAt('asset("|")').plan?.items ?? [];
		expect(items.map((item) => item.sortText)).toEqual([
			"0000",
			"0001",
			"0002",
			"0003",
		]);
		expect(
			[...items].sort((a, b) => a.sortText.localeCompare(b.sortText)),
		).toEqual(items);
	});

	it("the label is the name and the detail is separate", () => {
		const item = planAt('asset("|")').plan?.items[0];
		expect(item?.path).toBe("backgrounds/library");
		expect(item?.detail).toBe("640 × 640 · WebP");
		/** The media identity is not a value that goes into source. */
		expect(item?.path).not.toContain("media-");
	});

	it("no bound pictures means no items", () => {
		expect(
			planRuntimeAssetCompletions(
				prepareRuntimeAssetCatalog([], MEDIA),
				'asset("")',
				7,
			)?.items,
		).toEqual([]);
	});
});

describe("replacement", () => {
	const apply = (marked: string, path: string): string => {
		const { source, plan } = planAt(marked);
		expect(plan).not.toBeNull();
		return source.slice(0, plan?.start) + path + source.slice(plan?.end);
	};

	it("keeps quotes and parentheses", () => {
		expect(apply('asset("|")', "ui/heart")).toBe('asset("ui/heart")');
	});

	it("does not change single quotes to double", () => {
		expect(apply("asset('characters/|')", "ui/heart")).toBe(
			"asset('ui/heart')",
		);
	});

	it("backticks of a template without substitutions stay too", () => {
		expect(apply("asset(`characters/|`)", "ui/heart")).toBe(
			"asset(`ui/heart`)",
		);
	});

	it("replaces the text already written as a whole", () => {
		expect(apply('asset("characters/XX|X/smile")', "ui/heart")).toBe(
			'asset("ui/heart")',
		);
	});

	it("the rest of the markup stays inside a JSX prop too", () => {
		expect(apply('<Image source={asset("characters/|")} />', "ui/heart")).toBe(
			'<Image source={asset("ui/heart")} />',
		);
	});

	it("keeps the comma and closing parenthesis of a multi-line call", () => {
		expect(apply('asset(\n\t"characters/|",\n)', "ui/heart")).toBe(
			'asset(\n\t"ui/heart",\n)',
		);
	});
});

describe("places with no suggestions", () => {
	it.each([
		["plain string", 'const message = "characters/|";'],
		["line comment", '// asset("characters/|")'],
		["block comment", '/* asset("characters/|") */'],
		["console", 'console.log("characters/|")'],
		["another function", 'translate("characters/|")'],
	])("%s", (_name, marked) => {
		expect(planAt(marked).plan).toBeNull();
	});

	/**
	 * Opening the list inside a template with a substitution makes the selected item erase `${face}`.
	 * That edit was not requested by the creator, and the only way back is undo.
	 */
	it("does not destructively replace a dynamic template", () => {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: the `${face}` is input from the creator's source, not one of our templates.
		expect(planAt("asset(`characters/sena/|${face}`)").plan).toBeNull();
	});

	/**
	 * Remote addresses differ in both the authoring model and the authorization model. Monaco's
	 * ordinary filtering leaves nothing in the list even without this, but this test checks directly
	 * that the list holds no remote addresses.
	 */
	it("does not put remote URLs in the suggestions", () => {
		const items = planAt('asset("https://|")').plan?.items ?? [];
		for (const item of items) expect(item.path).not.toContain("://");
	});
});

const sound = (
	path: string,
	durationMs = 102_000,
): RuntimeAssetEditorEntry => ({
	path,
	mediaId: `media-${path}`,
	kind: "audio",
	mime: "audio/mpeg",
	width: null,
	height: null,
	durationMs,
});

const MIXED = prepareRuntimeAssetCatalog(
	[
		entry("characters/sena/smile"),
		sound("audio/bgm/main"),
		entry("backgrounds/library"),
		sound("audio/sfx/door", 1_500),
	],
	MEDIA,
);

const mixedAt = (marked: string) => {
	const offset = marked.indexOf("|");
	return planRuntimeAssetCompletions(MIXED, marked.replace("|", ""), offset);
};
const pathsAt = (marked: string) =>
	mixedAt(marked)?.items.map((item) => item.path) ?? null;

describe("kind: decided by the receiving place", () => {
	it("only pictures stand at `<Image source>`", () => {
		expect(pathsAt('<Image source={asset("|")} />')).toEqual([
			"backgrounds/library",
			"characters/sena/smile",
		]);
		expect(mixedAt('<Image source={asset("|")} />')?.expected).toBe("image");
	});

	it("only sounds stand at `<Audio source>`", () => {
		expect(pathsAt('<Audio source={asset("|")} playing={on} />')).toEqual([
			"audio/bgm/main",
			"audio/sfx/door",
		]);
		expect(mixedAt('<Audio source={asset("|")} />')?.expected).toBe("audio");
	});

	/** When the consumer is unknown, both kinds appear, and each row states its kind. */
	it("when the receiver is unknown both stand, with the kind on the row", () => {
		const plan = mixedAt('const bgm = asset("|");');
		expect(plan?.expected).toBeNull();
		expect(plan?.items.map((item) => [item.path, item.kind])).toEqual([
			["audio/bgm/main", "audio"],
			["audio/sfx/door", "audio"],
			["backgrounds/library", "image"],
			["characters/sena/smile", "image"],
		]);
	});

	it("a sound's detail is format and length, not dimensions", () => {
		const door = mixedAt('asset("|")')?.items.find(
			(item) => item.path === "audio/sfx/door",
		);
		expect(door?.detail).toBe("MP3 · 0:02");
	});

	it("finds the tag past a multi-line tag and other props' expressions", () => {
		expect(
			pathsAt(
				'<Image\n\talt="door > open {x}"\n\tonPress={() => go(">")}\n\tsource={asset("|")}\n/>',
			),
		).toEqual(["backgrounds/library", "characters/sena/smile"]);
	});

	it("in a child position the outer tag is not mistaken for the receiver", () => {
		/** Does not climb past the `>` of `<View>`: this string belongs to `Image`. */
		expect(
			mixedAt('<View>\n\t<Image source={asset("|")} />\n</View>')?.expected,
		).toBe("image");
		/** A call inside an expression is not a prop, and the consumer is unknown. */
		expect(
			mixedAt('<Audio source={pick ? asset("|") : fallback} />')?.expected,
		).toBeNull();
	});

	/**
	 * Aliased tags and other props are not followed. When unsure, show both: hiding the correct name
	 * costs more than a slightly longer list.
	 */
	it.each([
		["aliased tag", '<Img source={asset("|")} />'],
		["another prop", '<Image fallback={asset("|")} />'],
		["unknown tag", '<Avatar source={asset("|")} />'],
	])("no filtering at %s", (_name, marked) => {
		expect(mixedAt(marked)?.expected).toBeNull();
		expect(mixedAt(marked)?.items).toHaveLength(4);
	});

	it("an empty list when there are no names of that kind", () => {
		const imagesOnly = prepareRuntimeAssetCatalog([entry("ui/heart")], MEDIA);
		const marked = '<Audio source={asset("|")} />';
		expect(
			planRuntimeAssetCompletions(
				imagesOnly,
				marked.replace("|", ""),
				marked.indexOf("|"),
			)?.items,
		).toEqual([]);
	});
});
