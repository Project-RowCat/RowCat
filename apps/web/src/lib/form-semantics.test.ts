import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Statically checks the semantic wiring of forms, so the visible hierarchy and the read hierarchy
 * stay the same.
 *
 * What these checks share is that a mistake leaves the screen looking correct. A radio without
 * `name` still looks like a working choice list, because React draws the selected state, but
 * arrow-key movement and tab order break. An orphan `<Label>`, an untyped button inside a form, or
 * a hand-written id each pass types, tests, and review as an ordinary diff.
 *
 * The checks verify policy, not render output, because this repo's web tests do not render React.
 * They judge the shape of source. Where a check is pinned to a list, it also counts the files, so
 * an emptied list cannot silently guard nothing.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB_SRC = join(HERE, "..");

/**
 * Comments are removed first.
 *
 * Every check in this file asks whether a token appears in the source. If comments stayed,
 * sentences explaining a rule would count as code that obeys it. Comments in this repo often quote
 * names such as `aria-describedby` and `htmlFor`.
 *
 * Line comments are removed only when `//` begins a line (after whitespace), so that `https://` is
 * not cut.
 */
function stripComments(source: string): string {
	return source
		.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^[ \t]*\/\/.*$/gm, "");
}

function screenSources(): { path: string; source: string }[] {
	const out: { path: string; source: string }[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) {
				walk(full);
				continue;
			}
			if (!entry.endsWith(".tsx") || entry.includes(".test.")) continue;
			out.push({
				path: full,
				source: stripComments(readFileSync(full, "utf8")),
			});
		}
	};
	walk(join(WEB_SRC, "features"));
	return out;
}

/**
 * Extracts only the attribute section of the opening `<Tag` tag.
 *
 * `indexOf('>')` is not enough. JSX attributes often contain arrow functions (`onChange={(e) =>
 * ...}`), and the `>` inside one closes the tag early. The scan therefore counts brace depth and
 * quotes and finds the `>` at depth zero. It is not an HTML parser; it only needs to handle the JSX
 * syntax this repo actually uses.
 */
function openingTags(source: string, tag: string): string[] {
	const tags: string[] = [];
	const opener = new RegExp(`<${tag}(?=[\\s/>])`, "g");
	for (const match of source.matchAll(opener)) {
		let depth = 0;
		let quote: string | null = null;
		for (let i = match.index + match[0].length; i < source.length; i += 1) {
			const char = source[i];
			if (quote) {
				if (char === quote) quote = null;
				continue;
			}
			if (char === '"' || char === "'" || char === "`") {
				quote = char;
				continue;
			}
			if (char === "{") depth += 1;
			else if (char === "}") depth -= 1;
			else if (char === ">" && depth === 0) {
				tags.push(source.slice(match.index, i + 1));
				break;
			}
		}
	}
	return tags;
}

describe("radio groups", () => {
	/**
	 * `name` forms the group. Browsers treat only radios with the same `name` as one group, and give
	 * that group two behaviors: arrow keys move within it, and a single tab stop covers the whole
	 * group (only the selected radio stays in the tab order).
	 *
	 * Without `name`, each row becomes its own group and both behaviors vanish. `checked` comes from
	 * React state, so nothing visible changes. The defect cannot be reproduced with a mouse, so a
	 * human reviewer cannot be expected to notice it.
	 */
	it('every `type="radio"` input has a `name`', () => {
		const missing: string[] = [];
		for (const { path, source } of screenSources()) {
			for (const tag of openingTags(source, "input")) {
				if (!tag.includes('type="radio"')) continue;
				if (!/\sname[={]/.test(tag)) missing.push(path);
			}
		}
		expect(missing).toEqual([]);
	});

	/** Also counts the target files, so this check does not become vacuous if the radios disappear. */
	it("both choice screens stand as radios", () => {
		const radios = screenSources().flatMap(({ path, source }) =>
			openingTags(source, "input")
				.filter((tag) => tag.includes('type="radio"'))
				.map(() => path),
		);
		expect(radios.length).toBeGreaterThanOrEqual(2);
	});
});

describe("label pairing", () => {
	/**
	 * An orphan `<Label>` does nothing. Pressing it does not focus the control, and assistive
	 * technology does not establish the relationship. Usually an `aria-label` is then added to the
	 * control separately, so the same word has two sources and fixing only one leaves the other stale.
	 *
	 * The check is limited to these files because the shared layout component (`SettingsRow`) takes
	 * `htmlFor` as optional. A row with two controls (generation target) cannot attach one label to
	 * just one of them, so it has its own layout.
	 */
	const LABELLED_FILES = [
		join(WEB_SRC, "features", "create", "editor", "page.tsx"),
		join(
			WEB_SRC,
			"features",
			"create",
			"editor",
			"sections",
			"lore-editor-card.tsx",
		),
		join(WEB_SRC, "features", "create", "publishing", "publish-panel.tsx"),
		join(WEB_SRC, "features", "create", "editor", "fields.tsx"),
		join(WEB_SRC, "features", "create", "editor", "tag-input.tsx"),
		join(WEB_SRC, "features", "create", "cover", "field.tsx"),
	];

	it("every `<Label>` in create points at a control", () => {
		const orphans: string[] = [];
		for (const path of LABELLED_FILES) {
			const source = stripComments(readFileSync(path, "utf8"));
			for (const tag of openingTags(source, "Label")) {
				if (!tag.includes("htmlFor")) orphans.push(`${path} :: ${tag}`);
			}
		}
		expect(orphans).toEqual([]);
	});
});

describe("buttons in forms", () => {
	/**
	 * A button inside a `<form>` submits by default. If cancel, add, delete, or preview does not
	 * declare its type, pressing it submits the form. The symptom is 'I pressed cancel and it saved',
	 * which cannot be undone.
	 */
	it("every button inside `<form>` states its `type`", () => {
		const untyped: string[] = [];
		for (const { path, source } of screenSources()) {
			let cursor = 0;
			while (true) {
				const open = source.indexOf("<form", cursor);
				if (open === -1) break;
				const close = source.indexOf("</form>", open);
				if (close === -1) break;
				const body = source.slice(open, close);
				cursor = close + 1;
				for (const tag of [
					...openingTags(body, "Button"),
					...openingTags(body, "button"),
				]) {
					if (!/\stype=/.test(tag)) untyped.push(`${path} :: ${tag}`);
				}
			}
		}
		expect(untyped).toEqual([]);
	});
});

describe("form control ids", () => {
	/**
	 * Hand-written ids are literals for values that must be unique across the whole document.
	 *
	 * The risk is concrete even in single-dialog screens. The primitive keeps content mounted during
	 * its exit animation, so a closing dialog and a newly opened one can be mounted together briefly.
	 * If the same id appears twice, `aria-describedby` reads the first match, which is the just-closed
	 * dialog's failure.
	 *
	 * For that reason every form in this repo uses `useId`. This check confirms the rule in the files
	 * that actually carry ids.
	 */
	const ID_OWNING_FILES = [
		join(WEB_SRC, "features", "sync", "unlock-dialog.tsx"),
		join(WEB_SRC, "features", "sync", "approve-pairing-dialog.tsx"),
		join(WEB_SRC, "features", "sync", "recovery-code-dialog.tsx"),
		join(WEB_SRC, "features", "sync", "sync-section.tsx"),
		join(WEB_SRC, "features", "chat", "room", "rename-dialog.tsx"),
		join(WEB_SRC, "features", "chat", "messages", "edit-dialog.tsx"),
	];

	it("id and htmlFor are not string literals", () => {
		const literals: string[] = [];
		for (const path of ID_OWNING_FILES) {
			const source = stripComments(readFileSync(path, "utf8"));
			for (const match of source.matchAll(/\s(id|htmlFor)="([^"]*)"/g)) {
				literals.push(`${path} :: ${match[1]}="${match[2]}"`);
			}
		}
		expect(literals).toEqual([]);
	});

	it("those files really use `useId`", () => {
		for (const path of ID_OWNING_FILES) {
			expect(readFileSync(path, "utf8")).toContain("useId(");
		}
	});
});

describe("unnamed fields", () => {
	/**
	 * A placeholder is not a name. It disappears when typing starts, and it usually conveys the
	 * value's format rather than what the field is (`RCAT-XXXX-...` was an example). A window title or
	 * description can give context, but neither is this control's name.
	 *
	 * So a field with a placeholder must have at least one name source: an `htmlFor` in the same file,
	 * or the control's own `aria-label`. This check does not decide which, because both are correct in
	 * different places.
	 */
	it("controls with a placeholder have a name source", () => {
		const nameless: string[] = [];
		for (const { path, source } of screenSources()) {
			for (const tag of [
				...openingTags(source, "Input"),
				...openingTags(source, "input"),
				...openingTags(source, "Textarea"),
				...openingTags(source, "textarea"),
			]) {
				if (!tag.includes("placeholder=")) continue;
				/*
				 * `id` is a condition under which a label can point at the control, not a name in itself. This
				 * check does not verify that a matching label exists. The label may live in another component
				 * (`FieldFrame`), and that relation cannot be followed without rendering.
				 *
				 * What it catches is a field with none of the three: its only name is the placeholder, which
				 * vanishes once typing starts.
				 */
				const named = /\s(aria-label|aria-labelledby|id)[={]/.test(tag);
				if (!named) nameless.push(`${path} :: ${tag.slice(0, 60)}`);
			}
		}
		expect(nameless).toEqual([]);
	});
});

/**
 * Form contract for the two moderation dialogs.
 *
 * The checks above are repo-wide policy (radio `name`, form-button `type`, hand-written ids). This
 * block locks two things: that these two dialogs really are forms, and two failure modes within
 * them. Each one leaves the screen looking fine:
 * - maxLength truncation: pasted text silently loses its tail, and the guidance line never
 *   appears.
 * - A server failure shown on the field: one dropped connection turns the user's text into an
 *   'invalid value'.
 * - Two submission paths: the next guard attaches to only one of them, and which one runs depends
 *   on the input method.
 */
const MODERATION = join(WEB_SRC, "features", "moderation");
const APPEAL_DIALOG = join(MODERATION, "appeal-dialog.tsx");
const REPORT_DIALOG = join(MODERATION, "report-dialog.tsx");
const moderationSource = (path: string): string =>
	stripComments(readFileSync(path, "utf8"));

/**
 * The bodies between `<form ...>` and `</form>`. Buttons outside a form are not targets of this
 * check.
 */
function formBodies(source: string): string[] {
	const bodies: string[] = [];
	let cursor = 0;
	while (true) {
		const open = source.indexOf("<form", cursor);
		if (open === -1) break;
		const close = source.indexOf("</form>", open);
		if (close === -1) break;
		bodies.push(source.slice(open, close));
		cursor = close + 1;
	}
	return bodies;
}

describe("appeal dialog", () => {
	it("the body is not cut with `maxLength`", () => {
		/*
		 * Truncating would make the over-limit condition unrepresentable. The guidance line would never
		 * render, and a user who pastes a long text would submit a body whose end was cut off, with no
		 * symptom.
		 */
		expect(moderationSource(APPEAL_DIALOG)).not.toContain("maxLength");
	});

	it("the body field states its own overflow", () => {
		const tag = openingTags(moderationSource(APPEAL_DIALOG), "Textarea")[0];
		expect(
			tag,
			"no appeal body field; check whether the file moved",
		).toBeDefined();
		expect(tag).toMatch(/\saria-invalid=/);
		expect(tag).toMatch(/\saria-describedby=/);
		/**
		 * The fact that the field is required is stated on the field itself. A disabled button cannot
		 * take its place.
		 */
		expect(tag).toMatch(/\srequired[\s/>]/);
	});

	it("the hint is really tied to the field; `useId` makes the id", () => {
		const source = moderationSource(APPEAL_DIALOG);
		const tag = openingTags(source, "Textarea")[0] ?? "";
		const described = tag.match(/aria-describedby=\{([^}]*)\}/)?.[1] ?? "";
		const identifier = described.match(/([A-Za-z_$][\w$]*Id)\b/)?.[1];
		expect(
			identifier,
			"aria-describedby does not point at an identifier",
		).toBeDefined();
		expect(source).toContain(`id={${identifier}}`);
		expect(source).toContain("useId(");
	});

	it("a server failure does not invalidate the field", () => {
		/*
		 * `aria-invalid` is true only when the **current value** breaks a rule. Putting the submission
		 * error here would make a momentary network failure read the user's text aloud as an invalid
		 * value. A form-level failure belongs to the single line at the bottom.
		 */
		const tag =
			openingTags(moderationSource(APPEAL_DIALOG), "Textarea")[0] ?? "";
		const invalid = tag.match(/aria-invalid=\{([^}]*)\}/)?.[1] ?? "";
		expect(invalid).not.toMatch(/(^|[^.\w])error\b/);
	});

	it("the character count is not read out as a live region", () => {
		/*
		 * Announcing every character would make writing in this field impossible. The fact that needs
		 * announcing is stated by the one guidance line.
		 */
		expect(moderationSource(APPEAL_DIALOG)).not.toContain("aria-live");
	});
});

describe("real forms in moderation dialogs", () => {
	it.each([
		["appeal", APPEAL_DIALOG],
		["report", REPORT_DIALOG],
	])("the %s dialog has `<form onSubmit>`", (_label, path) => {
		const bodies = formBodies(moderationSource(path));
		expect(bodies.length).toBe(1);
		expect(bodies[0]).toContain("onSubmit=");
	});

	it("the receipt face stays outside the form", () => {
		/*
		 * This dialog has nothing to submit, so it should not be wrapped in a form. Wrapping it would
		 * turn the close button into a button inside the form.
		 */
		const [form] = formBodies(moderationSource(REPORT_DIALOG));
		expect(form).not.toContain("dialog.close");
	});

	it("there is one submit path; the button does not submit alongside the form", () => {
		for (const path of [APPEAL_DIALOG, REPORT_DIALOG]) {
			for (const form of formBodies(moderationSource(path))) {
				expect(form, path).not.toMatch(
					/onClick=\{\(\)\s*=>\s*void submit\(\)\}/,
				);
			}
		}
	});

	it("buttons in the form state their type, and there is exactly one submit", () => {
		for (const path of [APPEAL_DIALOG, REPORT_DIALOG]) {
			const [form] = formBodies(moderationSource(path));
			const buttons = openingTags(form, "Button");
			expect(buttons.length, path).toBeGreaterThanOrEqual(2);
			const submits = buttons.filter((tag) => tag.includes('type="submit"'));
			const plain = buttons.filter((tag) => tag.includes('type="button"'));
			expect(submits.length, `${path} submit button`).toBe(1);
			expect(plain.length, `${path} cancel button`).toBe(buttons.length - 1);
		}
	});

	it("Enter is not turned into submit; both dialogs' body fields are multi-line", () => {
		for (const path of [APPEAL_DIALOG, REPORT_DIALOG])
			expect(moderationSource(path), path).not.toContain("onKeyDown");
	});
});

describe("report reason", () => {
	it("the select primitive carries the required fact", () => {
		/*
		 * `required` passed to Base UI's `Select` is emitted as `aria-required` on the trigger. If it
		 * were written on a wrapping `<div>`, the element that receives focus would not state that fact.
		 */
		const tag = openingTags(moderationSource(REPORT_DIALOG), "Select")[0];
		expect(tag, "no reason select; check whether the file moved").toBeDefined();
		expect(tag).toMatch(/\srequired[\s/>]/);
	});

	it("no error just for being empty", () => {
		/*
		 * The empty reason shown when the dialog opens is not yet chosen; it has not been violated. A red
		 * message shown at open would soon be ignored, and it would go unread where it matters.
		 */
		const tag = openingTags(moderationSource(REPORT_DIALOG), "Select")[0] ?? "";
		expect(tag).not.toMatch(/aria-invalid/);
		expect(moderationSource(REPORT_DIALOG)).not.toContain("Choose a reason");
	});

	it("the description stays optional", () => {
		const tags = openingTags(moderationSource(REPORT_DIALOG), "Textarea");
		expect(tags.length).toBe(1);
		expect(tags[0]).not.toMatch(/\srequired[\s/>]/);
		expect(tags[0]).not.toMatch(/aria-required/);
		expect(tags[0]).not.toMatch(/aria-invalid/);
	});
});
