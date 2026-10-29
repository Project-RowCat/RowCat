import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Statically checks that placeholders take their geometry from the screen they will become.
 *
 * Mistakes in this layer all share one shape: deleting or misaligning something still passes the
 * type check and still renders. The misalignment appears only when the real value arrives and the
 * screen reflows. That moment usually lasts a few hundred milliseconds, so neither review nor QA
 * sees it. Three such stale placeholders existed in this repo:
 *
 * - sidebar recent list: 62px placeholder vs 100px list. The shell on every screen shifted each
 *   time.
 * - published works: h-28 gray box vs border, cover, and actions. The card was created only on
 *   arrival.
 * - editor child sections: h-32 gray box vs title, description, and buttons. Same problem.
 *
 * The target is the source of the geometry, not pixel values. Pinning bar widths would break this
 * file on every commit that polishes copy, and the check would then get deleted.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const read = (file: string): string => readFileSync(join(HERE, file), "utf8");

/**
 * Source with comments stripped, so that a sentence explaining the rationale cannot make a check
 * pass.
 */
const codeOf = (file: string): string =>
	read(file)
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");

describe("placeholders use the constants of the screen that will arrive", () => {
	it("the draft list shares the real column definitions", () => {
		/*
		 * The list and the placeholder share one file because of this constant. If only the placeholder
		 * declared its own grid, a change in column count would leave that side on the old layout. The
		 * mismatch would show only when the drafts arrive and the whole table is rebuilt.
		 */
		const source = codeOf("../features/create/drafts/list.tsx");
		const skeleton = source.slice(
			source.indexOf("export function DraftListSkeleton"),
		);
		/**
		 * Written as a string, the linter reads it as a template literal, so what is checked is the
		 * existence of that reference.
		 */
		expect(skeleton).toContain(["$", "{DRAFT_COLUMNS}"].join(""));
		expect(skeleton).toContain("<DraftListHeader />");
	});

	it("gallery and profile card slots are **the same grid and the same card**", () => {
		/*
		 * The two screens draw the same card, so their placeholders must match as well. A second copy
		 * would mean that when the column count changes, only one side gets fixed.
		 */
		for (const file of [
			"../features/gallery/gallery-skeleton.tsx",
			"../features/gallery/gallery-load-more.tsx",
			"../features/profile/profile-skeleton.tsx",
		]) {
			expect(codeOf(file), file).toContain("GALLERY_GRID_CLASS");
		}
		for (const file of [
			"../features/gallery/gallery-load-more.tsx",
			"../features/profile/profile-skeleton.tsx",
		]) {
			expect(codeOf(file), file).toContain("GalleryCardSkeleton");
		}
	});

	it("the gallery card's heart row is in the placeholder too", () => {
		/*
		 * That line is always pinned to the bottom of the card (`mt-auto`). If it were omitted, the
		 * placeholder's card would sit 50px lower. The gallery is the first screen the server renders, so
		 * this mismatch is the most frequently visible shift in the app.
		 */
		const card = codeOf("../features/gallery/story-card.tsx");
		const skeleton = codeOf("../features/gallery/gallery-skeleton.tsx");
		expect(card).toContain("mt-auto pt-2 pb-2.5");
		expect(skeleton).toContain("mt-auto");
		expect(skeleton).toContain("pt-2 pb-2.5");
		expect(skeleton).toContain("<CardContent");
	});

	it("conversation list rows come from the same constants as real rows", () => {
		const skeleton = codeOf(
			"../features/chat-library/chat-library-skeleton.tsx",
		);
		expect(skeleton).toContain("ROOM_ROW_CLASS");
		expect(skeleton).toContain("ROOM_LIST_CLASS");
	});

	it("published work slots **belong to the card**", () => {
		/*
		 * The list decides only the container, the gaps, and the count. If the card's geometry (border,
		 * cover ratio, action location) were written on the list side, this file would go stale whenever
		 * the card changes.
		 */
		const list = codeOf("../features/create/publishing/work-list.tsx");
		expect(list).toContain("CreatorWorkCardSkeleton");
		/** It does not draw cards by hand. Doing so would create a second source of geometry. */
		expect(list).not.toMatch(/<Skeleton\b/);

		const card = codeOf("../features/create/publishing/work-card.tsx");
		const skeleton = card.slice(
			card.indexOf("export function CreatorWorkCardSkeleton"),
		);
		/** Same shell and same cover box as the card body. */
		expect(skeleton).toContain("rounded-lg border bg-card p-3 sm:p-4");
		expect(skeleton).toContain("aspect-3/4 w-14");
	});

	it("the editor's child sections own their copy", () => {
		/*
		 * The placeholder draws the title and description as real text, so that copy must come from the
		 * constants next to the list. If written in two places, when the description goes from one line
		 * to two only one side would be updated. Then, when the list arrives, the sections below would
		 * shift.
		 */
		const editor = codeOf("../features/create/editor/page.tsx");
		for (const constant of [
			"loreSection()",
			"startSceneSection()",
			"sceneImageSection()",
		]) {
			expect(editor, constant).toContain(
				`<EditorSectionSkeleton {...${constant}} />`,
			);
		}
		/**
		 * Does not stand in for a section with a gray box. The border and title come into being together
		 * with the values.
		 */
		expect(editor).not.toMatch(/<Skeleton\b/);

		for (const [file, name] of [
			["../features/create/editor/sections/lore-list.tsx", "loreSection"],
			[
				"../features/create/editor/sections/start-scene-list.tsx",
				"startSceneSection",
			],
			[
				"../features/create/editor/sections/scene-image-list.tsx",
				"sceneImageSection",
			],
		] as const) {
			const source = codeOf(file);
			expect(source, file).toContain(`export const ${name} = `);
			expect(source, file).toContain(`title={${name}().title}`);
			expect(source, file).toContain(`description={${name}().description}`);
		}
	});

	it("section shells **really draw**; the border is not a gray box", () => {
		/*
		 * What is decided here is the border and inner padding. If those were also a gray box, the
		 * section itself would be created when the values arrive. Only the inside is filled.
		 */
		const fields = codeOf("../features/create/editor/fields.tsx");
		const skeleton = fields.slice(
			fields.indexOf("export function EditorSectionSkeleton"),
		);
		expect(skeleton).toContain("rounded-lg border bg-card p-4 sm:p-5");
		expect(skeleton).toContain("mb-4 flex items-start justify-between gap-3");
	});

	it("the sidebar's recent conversations use the real list's container and row padding", () => {
		/*
		 * The sidebar is a shell on every screen. If the placeholder and the list differ in height, the
		 * `All conversations` link shifts every time a screen opens.
		 */
		const source = codeOf("../components/app-shell/app-sidebar.tsx");
		const skeleton = source.slice(
			source.indexOf("export function SidebarRecentSkeleton"),
		);
		expect(skeleton).toContain("<SidebarList>");
		/** The row's padding comes from `sidebarRowClass`. */
		expect(skeleton).toContain("px-2 py-1.5");
	});
});

describe("the account placeholder holds every section that always renders", () => {
	/**
	 * This file is where staleness goes unnoticed. It is the router's pendingComponent, so it is
	 * visible only for a few hundred milliseconds on the normal path. When the real screen grows, no
	 * test breaks.
	 *
	 * Conditional sections are deliberately not here: sanctions, `My reports`, and operator tools. Most
	 * accounts do not render them. Reserving space for them would make the page shrink by that much
	 * when values arrive.
	 *
	 * Copy is compared by dictionary key: the placeholder must name the same key the real section
	 * draws, so the two cannot drift apart in either locale.
	 */
	const skeleton = read("../features/account/account-skeleton.tsx");
	const page = read("../features/account/account-page.tsx");

	const ALWAYS_PRESENT = [
		["profileSection.profile", "profile-section.tsx"],
		["contentSection.contentDisplay", "content-section.tsx"],
		["securitySection.security", "security-section.tsx"],
		["dataSection.data", "data-section.tsx"],
		["deleteAccountSection.dangerZone", "delete-account-section.tsx"],
	] as const;

	it.each(ALWAYS_PRESENT)("`%s` has a place", (key, file) => {
		expect(skeleton).toContain(`t("${key}")`);
		expect(read(`../features/account/${file}`)).toContain(`t("${key}")`);
	});

	it("the order matches the real screen", () => {
		const positions = ALWAYS_PRESENT.map(([key]) =>
			skeleton.indexOf(`t("${key}")`),
		);
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
	});

	it("conditional sections hold no place", () => {
		for (const key of [
			"account.title",
			"account.operatorTitle",
			"myReports.title",
		])
			expect(skeleton, key).not.toContain(`"${key}"`);
	});

	it("all six security sub-sections are present", () => {
		/*
		 * When a sub-section is added, add it here too. If it is omitted, the data and danger zone below
		 * would be pushed down as a whole when that section arrives.
		 */
		const section = read("../features/account/security-section.tsx");
		const keys = [
			...section.matchAll(/<SecuritySubsection\s+title=\{t\("([^"]+)"\)\}/g),
		].map((match) => match[1]);
		expect(keys).toHaveLength(6);
		for (const key of keys) expect(skeleton, key).toContain(`("${key}")`);
	});

	it("the section shell is **the same component** as the body", () => {
		expect(skeleton).toContain('from "./account-shell.tsx"');
		expect(skeleton).toContain("<AccountSection");
		/**
		 * Writing the border and padding by hand would make the section's boundary move together with the
		 * value.
		 */
		expect(codeOf("../features/account/account-skeleton.tsx")).not.toContain(
			"border-t py-6",
		);
	});

	it("the placeholder and the screen use the same copy", () => {
		/*
		 * Titles and descriptions are structure, not data, so they are drawn as real text. That means
		 * they can drift. The profile description was still the sentence from before the intro field
		 * actually existed.
		 */
		const key = "profileSection.yourNicknameAndBioAppear";
		expect(read("../features/account/profile-section.tsx")).toContain(
			`description={t("${key}")}`,
		);
		expect(skeleton).toContain(`description={t("${key}")}`);
		expect(page).not.toContain(key);
	});
});

describe("placeholder infinite animation follows reduced motion", () => {
	it("`Skeleton` is narrowed with `motion-reduce`", () => {
		/*
		 * All CSS transitions in this repository are narrowed with `motion-reduce:` (switches,
		 * checkboxes, tabs, toasts). This rule is heavier here: this animation has no end, and on a slow
		 * request it is the only thing moving on screen.
		 *
		 * Not implemented as a React hook. The value is decided only after hydration, so the placeholder
		 * the server rendered would stand in a wrong state for one frame.
		 */
		const source = readFileSync(
			join(HERE, "../../../../packages/ui-web/src/components/skeleton.tsx"),
			"utf8",
		);
		expect(source).toContain("motion-reduce:animate-none");
		expect(source).not.toContain("useReducedMotion");
	});

	it("placeholder groups leave assistive tech and the state is announced in one line", () => {
		/*
		 * Reading the placeholders one by one would make a screen with nothing on it sound like a list.
		 * Instead, one `<output>` line (implicit role="status") says what is being waited for.
		 */
		for (const file of [
			"../features/account/account-skeleton.tsx",
			"../features/gallery/gallery-skeleton.tsx",
			"../features/chat-library/chat-library-skeleton.tsx",
			"../features/persona/persona-library-skeleton.tsx",
			"../features/profile/profile-skeleton.tsx",
			"../features/story/story-detail-skeleton.tsx",
			"../features/create/create-skeleton.tsx",
		]) {
			const source = codeOf(file);
			expect(source, file).toContain('aria-hidden="true"');
			expect(source, file).toContain('<output className="sr-only">');
		}
	});
});
