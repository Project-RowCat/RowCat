import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loreRuntimeLock } from "./sections/lore-list.tsx";
import { promptRuntimeLock } from "./sections/prompt-editing.ts";
import { sceneImageRuntimeLock } from "./sections/scene-image-list.tsx";
import { startSceneRuntimeLock } from "./sections/start-scene-list.tsx";

const read = (name: string): string =>
	readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");

const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const lockWiring = stripComments(read("./runtime-lock.tsx"));

/**
 * The four conversation-material sections that pass the runtime check. This list is what the tests
 * in this file inspect.
 */
const MATERIAL_SECTIONS = [
	["prompt", "./sections/prompt-section.tsx"],
	["lore", "./sections/lore-list.tsx"],
	["opening scene", "./sections/start-scene-list.tsx"],
	["scene image", "./sections/scene-image-list.tsx"],
] as const;

const materials = MATERIAL_SECTIONS.map(
	([name, path]) => [name, stripComments(read(path))] as const,
);

/**
 * The three list sections. The prompt is the body of its section and has no list wrapper, so it is
 * filtered out.
 */
const lists = materials.filter(([name]) => name !== "prompt");

/**
 * With runtime enabled, four sections lock, and all four share the same wiring. Runtime play never
 * creates a conversation room, so none of the four values is read. If each section subscribed and
 * decided on its own, one would eventually fail to pass `loading`, and it would stay open for one
 * frame before the project loads. Typing in that frame would pass through auto-save into the old
 * runtime value. The field locks right after, so nothing visible reveals the mistake.
 */
describe("turning runtime on locks the conversation material", () => {
	it("one place calls the decision", () => {
		expect(lockWiring).toContain("resolveConversationAuthoringMode");
		for (const [, text] of materials)
			expect(text).not.toContain("resolveConversationAuthoringMode");
	});

	it.each(
		materials,
	)("the %s section goes through that place", (_name, text) => {
		expect(text).toContain("useConversationAuthoringMode");
		/**
		 * Sections must not open their own subscription. The shared point must hold `loading` together
		 * with the value.
		 */
		expect(text).not.toContain("useDraftRuntimeProject");
		/**
		 * The screen must not restate the decision. Any check on `enabled` belongs inside the pure
		 * function.
		 */
		expect(text).not.toMatch(/isRuntimeEnabled|\.enabled\b/);
	});

	/**
	 * A locked list section never shows `Add` (add). The early return must come before it, since adding
	 * an entry where it will not be used is noise. For the situation image, that tap would be an
	 * upload that cannot be undone.
	 */
	it.each(lists)("the %s list branches before its actions", (_name, text) => {
		const locked = text.indexOf('mode === "locked"');
		expect(locked).toBeGreaterThan(-1);
		expect(text.indexOf("action={")).toBeGreaterThan(locked);
	});

	/**
	 * The locked section holds no value. A second state would create two owners of the value, and a
	 * path that clears the value on enable would leave nothing to return to on disable.
	 */
	it.each(
		materials,
	)("the %s section does not write the draft", (_name, text) => {
		expect(text).not.toMatch(/patchDraft|updateDraft/);
	});

	/**
	 * The lock copy must say that the value is kept. Without that sentence, creators read their draft
	 * as erased. That misreading is cleared only by turning runtime off, and creators who do not turn
	 * it off would believe the work is lost for good.
	 */
	it.each([
		["prompt", promptRuntimeLock],
		["lore", loreRuntimeLock],
		["opening scene", startSceneRuntimeLock],
		["scene image", sceneImageRuntimeLock],
	] as const)("the %s lock copy says the value is kept and comes back", (_name, lock) => {
		const { body } = lock();
		expect(body).toContain("kept");
		expect(body).toMatch(/once runtime is off/);
	});
});
