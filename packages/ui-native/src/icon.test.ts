import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Icon registry test. It checks that the table is actually the table. Like the other tests in this
 * package, it does not render React, so it checks the shape of the source. It guards real
 * regressions: the vocabulary and the table diverging, the whole icon set being bundled, and a
 * picture being chosen that differs from the web. The type checker catches half of this (satisfies
 * Record<IconName, LucideIcon> flags missing and extra entries). The test adds the table's content,
 * which types cannot express: every Lucide component is a LucideIcon.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const raw = readFileSync(join(HERE, "icon.tsx"), "utf8");
const source = stripComments(raw);

const vocabulary = [
	...(/export type IconName =([\s\S]*?);/.exec(source)?.[1] ?? "").matchAll(
		/"([a-z-]+)"/g,
	),
].map(([, name]) => name);

const registry = new Map(
	[
		...(/const ICON = \{([\s\S]*?)\n\} satisfies/.exec(source)?.[1] ?? "")
			.split("\n")
			.map((line) =>
				/^\t(?:"([a-z-]+)"|([a-z-]+)):\s*([A-Z][A-Za-z0-9]*),$/.exec(line),
			)
			.filter((match) => match !== null),
	].map((match) => [match[1] ?? match[2], match[3]] as const),
);

describe("the vocabulary and the table do not diverge", () => {
	it("really read the vocabulary", () => {
		expect(vocabulary.length).toBeGreaterThan(10);
		/**
		 * A name written twice would collapse silently in the union, so the test checks for duplicates.
		 */
		expect(new Set(vocabulary).size).toBe(vocabulary.length);
	});

	it("every name has exactly one row in the table", () => {
		expect([...registry.keys()].sort()).toEqual([...vocabulary].sort());
	});
});

describe("chooses the same glyph as the web", () => {
	/**
	 * This table is the output of this slice. Changing a value is not a matter of choosing a prettier
	 * icon: it makes the two apps use different pictures for the same action, and users read that as a
	 * different feature. The companion comment in icon.tsx names the web file for each entry. The
	 * Feather version had two entries that were wrong silently, which this table fixed: a
	 * missing-image placeholder (ImageOff, previously a normal picture) and diagnostics (FlaskConical,
	 * previously a wrench).
	 */
	const EXPECTED = {
		/** The current account. Web: UserRound, used by the account menu in app-shell/app-header.tsx. */
		account: "UserRound",
		add: "Plus",
		back: "ChevronLeft",
		/** Removes this creator from my screen. Web: ShieldBan in block-menu.tsx. */
		block: "ShieldBan",
		chat: "MessageCircle",
		"chat-missing": "MessageCircleOff",
		/** The conversation list destination. Web: the `Chats` item in app-sidebar.tsx. */
		chats: "MessagesSquare",
		check: "Check",
		/** A closed control that holds a list. Web: the ChevronDownIcon of the ui-web SelectTrigger. */
		"chevron-down": "ChevronDown",
		/** A chevron on a row that goes deeper. Web: ChevronRight in room-settings-parts.tsx. */
		"chevron-right": "ChevronRight",
		/** Move one slot up in a list. Web: ChevronUp in lore-editor-card.tsx. */
		"chevron-up": "ChevronUp",
		/** Web's dialog.tsx uses XIcon for its close button. That is an alias of this component's X. */
		close: "X",
		/** A comment event. Web: MessageSquare in notification-row.tsx. */
		comment: "MessageSquare",
		copy: "Copy",
		/** The creation destination: the `Create` item in the drawer. Web: PenLine in app-sidebar.tsx. */
		create: "PenLine",
		delete: "Trash2",
		/** Not a trash can. It cuts the sequence off from this point rather than removing one target. */
		"delete-from": "Scissors",
		debugger: "Bug",
		diagnostics: "FlaskConical",
		discover: "Compass",
		/** Editing a message, renaming and editing a memory all use the same picture on the web too. */
		edit: "Pencil",
		/**
		 * A mark that wraps non-speech (an action, description or aside). Web: Asterisk in
		 * chat-composer.tsx.
		 */
		emphasis: "Asterisk",
		favorite: "Heart",
		filter: "SlidersHorizontal",
		follow: "UserRoundPlus",
		/**
		 * The follow action differs from the empty-state picture. The web uses different glyphs in two
		 * spots: UserRoundPlus in gallery-empty.tsx and UserPlus in follow-button.tsx. Folding both to
		 * the nearest icon would make the same screen a slightly different product on each app.
		 */
		"follow-add": "UserPlus",
		"follow-remove": "UserMinus",
		image: "ImageOff",
		info: "Info",
		/**
		 * A directional cue to jump to the end of a list. It means something different from `back`'s
		 * chevron.
		 */
		"jump-latest": "ArrowDown",
		/**
		 * A row that leaves its enclosing section. Different from chevron-right, which goes into a child.
		 */
		leave: "ArrowUpRight",
		library: "LibraryBig",
		/** The only value with no web counterpart: on the web, the memory action is a text button. */
		memory: "Brain",
		/**
		 * The web still uses FileQuestion, which is an alias of this component's name, so it is the same
		 * picture.
		 */
		missing: "FileQuestionMark",
		/** An operational action applied to an account. Web: Gavel in notification-row.tsx. */
		moderation: "Gavel",
		/**
		 * Lifting an operational action. Web: ShieldCheck in notification-row.tsx. It is the same picture
		 * as unblock, which is allowed: two meanings get two names.
		 */
		"moderation-reversed": "ShieldCheck",
		/**
		 * The web uses MoreHorizontal, which is an alias of this component, so it is the same picture.
		 */
		more: "Ellipsis",
		/**
		 * The trigger that opens global navigation. Web: Menu, used by the drawer trigger in
		 * app-sidebar.tsx.
		 */
		navigation: "Menu",
		"no-results": "SearchX",
		/** Received notifications, shown as a bell. Web: Bell in notification-bell.tsx. */
		notifications: "Bell",
		pin: "Pin",
		/**
		 * Runs a published runtime work. Web: Play in story-start-control.tsx. Before this entry existed,
		 * the mobile button showed chat instead. This table exists to prevent exactly that kind of
		 * mismatch.
		 */
		play: "Play",
		/**
		 * Playtest of a work: runs a draft without publishing. Web: FlaskConical in
		 * start-playtest-button.tsx. Same component as diagnostics, which is fine: the table answers
		 * which picture a meaning gets, and two meanings sharing a picture is not a mismatch. Collapsing
		 * the names would change the playtest button whenever the diagnostics entry changes.
		 */
		playtest: "FlaskConical",
		/**
		 * Opens playtest conditions. Same picture as `room-settings`, because it answers the same
		 * question.
		 */
		"playtest-settings": "SlidersHorizontal",
		/** A person who cannot be seen. Web: UserRoundX in profile-error.tsx. */
		"profile-missing": "UserRoundX",
		regenerate: "RefreshCw",
		report: "Flag",
		retry: "RotateCcw",
		/**
		 * This conversation's settings. Web: SlidersHorizontal in chat-header-context.tsx. Same component
		 * as filter, which is fine. The names stay separate so that changing one does not silently change
		 * the other.
		 */
		"room-settings": "SlidersHorizontal",
		/** The runtime row marker in the library. Web: Gamepad2 in runtime-conversation-rows.tsx. */
		"runtime-conversation": "Gamepad2",
		"runtime-settings": "SlidersHorizontal",
		save: "Save",
		search: "Search",
		/**
		 * App-wide settings. Web: Settings in app-header.tsx. Deliberately different from room-settings'
		 * SlidersHorizontal, since both sit on the same row in a conversation (room settings beside the
		 * title, global settings at the far right). Two identical gears side by side would make it
		 * unclear which one belongs to the room.
		 */
		settings: "Settings",
		/**
		 * A share action. The web has no counterpart: browsers have an address bar, which is already the
		 * shared surface. Native apps must open the OS share sheet, so this picture came with an action
		 * that had not existed before (apps/mobile/src/features/story/share-story.ts). Share2 was chosen
		 * over Share (an arrow leaving a box), because Share is nearly the iOS system glyph and our icon
		 * would look like the OS's.
		 */
		share: "Share2",
		send: "Send",
		/**
		 * The marker for an automatically created memory. Same picture as the web's memory-dialog.tsx.
		 */
		sparkle: "Sparkles",
		"story-detail": "BookOpen",
		"sign-in": "LogIn",
		"sign-out": "LogOut",
		stop: "Square",
		/**
		 * The four sections of the update note. The web's update-note-dialog.tsx picks the same four.
		 * Reusing existing names (sparkle, warning) is allowed for the same reason as above: meaning
		 * decides the picture. Folding the names would make changing the automatic-memory marker also
		 * change the release-note titles.
		 */
		"update-addition": "Sparkles",
		"update-improvement": "CircleCheck",
		"update-fix": "Wrench",
		"update-notice": "TriangleAlert",
		/** Unblock. Web: ShieldCheck in block-menu.tsx. */
		unblock: "ShieldCheck",
		unpin: "PinOff",
		warning: "TriangleAlert",
	} as const;

	it("the table's name set matches expectations", () => {
		expect([...registry.keys()].sort()).toEqual(Object.keys(EXPECTED).sort());
	});

	it.each(Object.entries(EXPECTED))("%s is %s", (name, component) => {
		expect(registry.get(name)).toBe(component);
	});
});

describe("does not bundle the whole icon set", () => {
	const kebab = (component: string): string =>
		component.replace(/([a-z])([A-Z0-9])/g, "$1-$2").toLowerCase();

	const deepImports = new Map(
		[
			...source.matchAll(
				/^import (\w+) from "lucide-react-native\/icons\/([a-z0-9-]+)";$/gm,
			),
		].map(([, local, path]) => [local, path] as const),
	);

	/**
	 * Metro does not tree-shake, and this check rests on that fact. Importing by name from the barrel
	 * (import { Heart } from 'lucide-react-native') bundles all 3,554 icons the barrel re-exports. In
	 * this migration the measured cost was 1,783 modules, more than half of the app bundle's modules.
	 * Nothing errors and the screens look fine, so this check is the only way to catch the regression.
	 */
	it("imports each icon from its own path", () => {
		/**
		 * The check counts distinct components, not table rows. Two meanings sharing one picture is a
		 * real, normal state: filter and room-settings are both SlidersHorizontal. Counting rows would
		 * flag that state as a failure, and the quickest fix, merging the names, would make changing the
		 * filter icon also change the conversation-settings icon. What the check actually guards: no
		 * barrel import, and every component comes from its own path.
		 */
		expect(deepImports.size).toBe(new Set(registry.values()).size);
		for (const component of registry.values())
			expect(deepImports.get(component), component).toBe(kebab(component));
	});

	/**
	 * Only the type is imported from the package. `import type` is erased entirely under
	 * verbatimModuleSyntax, so it does not become a runtime module.
	 */
	/**
	 * Checks that the import paths exist. The checks above only look at the shape of the names. A name
	 * can follow kebab-case and still have no file; then the type checker and this test both pass
	 * while Metro fails at bundle time with 'Unable to resolve module'. This has happened: Lucide 1.x
	 * renamed FileQuestion to FileQuestionMark, while the web's lucide-react (0.x) keeps the old name
	 * as an alias. The name copied from the web was missing a path only in the app. Every icon-set
	 * upgrade can repeat this.
	 */
	it("the import paths really exist", () => {
		const icons = join(
			HERE,
			"..",
			"node_modules",
			"lucide-react-native",
			"dist",
			"esm",
			"icons",
		);
		expect(deepImports.size).toBeGreaterThan(0);
		for (const [component, path] of deepImports)
			expect(
				existsSync(join(icons, `${path}.mjs`)),
				`${component}: lucide-react-native/icons/${path} does not exist.`,
			).toBe(true);
	});

	it("imports no values from the barrel", () => {
		const bare = [
			...source.matchAll(/^import (.*) from "lucide-react-native";$/gm),
		];
		expect(bare.map(([, clause]) => clause)).toEqual(["type { LucideIcon }"]);
	});

	/**
	 * A namespace import indexed by name is worse still. It loads the whole barrel, and the code
	 * cannot show which icons are used.
	 */
	it("no namespace or dynamic imports", () => {
		expect(source).not.toMatch(/import \* as/);
		expect(source).not.toMatch(/require\(/);
		expect(source).not.toMatch(/await import\(/);
	});

	/**
	 * The old backend (@expo/vector-icons) appears nowhere in this package. The check runs after
	 * comments are stripped. The repo's comments explain boundaries by naming the old package (the
	 * icon.tsx header says why the switch was made), so scanning raw text would flag explanations as
	 * violations, and people would delete comments to satisfy it.
	 */
	it("this package has no @expo/vector-icons", () => {
		const files = readdirSync(HERE).filter((name) => /\.tsx?$/.test(name));
		for (const file of files) {
			if (file === "icon.test.ts") continue;
			const code = stripComments(readFileSync(join(HERE, file), "utf8"));
			expect(code, file).not.toContain("@expo/vector-icons");
		}
		const manifest = readFileSync(join(HERE, "..", "package.json"), "utf8");
		expect(manifest).not.toContain("@expo/vector-icons");
		expect(manifest).toContain("lucide-react-native");
		/**
		 * The native module is owned by the app, so this package declares it only as a peer dependency.
		 */
		expect(JSON.parse(manifest).peerDependencies).toHaveProperty(
			"react-native-svg",
		);
	});

	/**
	 * No statement accepts an arbitrary Lucide component. If one did, each screen would start choosing
	 * its own icon vocabulary, and the table above would guarantee nothing.
	 */
	it("does not take components as arguments", () => {
		expect(source).not.toMatch(/component\??:/);
		expect(source).not.toMatch(/glyph\??:\s*Lucide/i);
	});
});

describe("weight, size and color do not belong to screens", () => {
	/**
	 * One default stroke width for all icons. If it varied by spot, same-size icons would read at
	 * different weights, and the difference would be read as a difference in importance.
	 */
	it("stroke width is one constant", () => {
		expect(source).toMatch(/const STROKE_WIDTH = 2;/);
		expect(source).toContain("strokeWidth={STROKE_WIDTH}");
		/** Accepting the stroke width as a parameter would let screens choose it. */
		expect(source).not.toMatch(/strokeWidth\??:/);
	});

	/** Size comes from the shared scale (sm, md, lg). Screens do not write pixel values. */
	it("size comes from the shared scale", () => {
		expect(source).toContain("size?: keyof typeof iconSize");
		expect(source).toContain("size={iconSize[size]}");
		expect(source).not.toMatch(/size=\{\d/);
	});

	/** Color comes from semantic tokens, so color='red' cannot be expressed. */
	it("color comes from semantic tokens", () => {
		expect(source).toContain("tone?: ColorName");
		expect(source).toContain("const ink = colors[tone];");
		expect(source).toContain("color={ink}");
	});
});

describe("only the heart fills", () => {
	/**
	 * A filled Search or a filled ChevronLeft means nothing. If fill were open to every icon, someone
	 * would eventually use it for emphasis, and then fill would lose its meaning. Only favorite can be
	 * filled.
	 */
	it("favorite is the only fillable name", () => {
		const set = /const FILLABLE = new Set<IconName>\(\[([^\]]*)\]\)/.exec(
			source,
		)?.[1];
		expect(set).toBeDefined();
		expect([...(set ?? "").matchAll(/"([a-z-]+)"/g)].map(([, n]) => n)).toEqual(
			["favorite"],
		);
	});

	/**
	 * On: the line color and the fill color both carry the state (like the web's fill-current). Off:
	 * the fill must be explicitly empty. Lucide defaults to fill='none', but stating it means every
	 * icon does not turn black if that default ever changes.
	 */
	it("on fills with the tone color, off empties", () => {
		expect(source).toContain(
			'fill={filled && FILLABLE.has(name) ? ink : "none"}',
		);
	});

	/**
	 * Fill is not a representation of state. Selected state belongs to the enclosing control's
	 * accessibilityState.selected. The icon must not repeat it, or two places would state the same
	 * fact and eventually disagree.
	 */
	it("icons have no selected state", () => {
		expect(source).not.toMatch(/selected\??:/);
		expect(source).not.toContain("accessibilityState");
	});
});
