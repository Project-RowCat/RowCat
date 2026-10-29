import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Locks the wiring of the prompt field, which types cannot check. The locked runtime for the field
 * belongs to the four sections, so it has its own file (`runtime-lock-boundaries.test.ts`).
 *
 * Mistakes here are silent. If the fullscreen editor started holding its own state, two owners of
 * the value would exist, and closing the window would lose the sentence just typed. An uncapped box
 * shows no symptom with a short body, only with long manuscripts. A save button would add a promise
 * this editor never made. Value behavior is tested in `prompt-editing.test.ts`; this file checks
 * that the screen actually passes that value through.
 */

const read = (name: string): string =>
	readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");

const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const field = stripComments(read("./prompt-field.tsx"));
const section = stripComments(read("./prompt-section.tsx"));
const editor = stripComments(read("../page.tsx"));
const fields = stripComments(read("../fields.tsx"));
describe("the field grows, then stops", () => {
	/**
	 * The cap must come from the shared constant, not a hand-written copy, because a copy would stay
	 * behind when the policy changes. The dialog's vertical bounds use one constant for the same
	 * reason.
	 */
	it("the growth cap goes through the shared constant", () => {
		expect(field).toContain("PROMPT_FIELD_GROWTH");
		expect(field).toContain("PROMPT_FIELD_ROWS");
		expect(field).not.toMatch(/max-h-\[\d+dvh\]/);
	});

	/**
	 * Other textareas do not inherit this geometry. If the description, lore content, or scene body
	 * gained the same cap, a three-line box would get a half-screen limit. That change was not part of
	 * this slice.
	 */
	it("the shared textarea field does not carry the prompt's geometry", () => {
		expect(fields).not.toContain("PROMPT_FIELD_GROWTH");
		expect(fields).not.toMatch(/max-h-\[/);
		expect(fields).not.toMatch(/field-sizing-/);
	});

	/**
	 * The editor uses this layer only for the prompt; the other fields keep the shared field. Between
	 * them sits a runtime decision layer (`prompt-section.tsx`): the editor calls that layer, and the
	 * layer calls the dedicated field. If the editor called the dedicated field directly, the field
	 * would open without the runtime decision.
	 */
	it("the editor's prompt goes through the runtime decision and uses its own field", () => {
		expect(editor).toContain("<PromptSection");
		expect(editor).not.toContain("<PromptField");
		expect(section).toContain("<PromptField");
		expect(section).toContain("useConversationAuthoringMode");
		expect(editor).toMatch(/<TextAreaField/);
	});

	/**
	 * The locked field holds no value. While runtime is on, this layer neither reads nor writes the
	 * prompt. A second state would create two owners of the value, and a path that clears the value on
	 * enable would leave nothing to return to on disable.
	 */
	it("the runtime decision layer holds no second prompt state", () => {
		expect(section).not.toMatch(/useState\(/);
		expect(section).not.toMatch(/patchDraft|updateDraft|prompt:\s*""/);
	});
});

describe("full-screen editing is not a second state", () => {
	/**
	 * One owner of the value. Two text boxes receiving the same `text` and `edit` is the essence of
	 * this slice. If that pairing breaks, the two values accept auto-save's reverts at different
	 * moments, and closing the window would lose the sentence just typed.
	 */
	it("the value has one owner", () => {
		expect(field.match(/useEditedValue\(/g)).toHaveLength(1);
		expect(field.match(/useState\(/g)).toHaveLength(1);
		expect(field).toContain("useState(false)");
	});

	/**
	 * No confirm step. Save, apply, and cancel are not actions of this window. Autosave keeps running
	 * while the window is open (`onChange` → `patchDraft`).
	 */
	it("makes no save or cancel action", () => {
		expect(field).not.toMatch(
			/onSave|onSubmit|handleSave|actions\.(save|cancel)/,
		);
		expect(field).not.toMatch(/patchDraft|updateDraft|flush\(/);
	});

	/**
	 * Done, the close button, and Esc all share one closing path. If each handled closing on its own,
	 * only users leaving through one of them would keep their caret position.
	 */
	it("there is one way to close", () => {
		expect(field.match(/const close = \(\): void =>/g)).toHaveLength(1);
		expect(field).toContain("shouldCloseDialog(details.reason, false)");
	});

	/**
	 * Not a route. A URL would create a back-navigation entry, so the user could return to the editor
	 * after the draft was deleted.
	 */
	it("makes no address", () => {
		expect(field).not.toMatch(/useNavigate|Link|navigate\(/);
	});
});
