import {
	UPDATE_NOTE_SECTION_ORDER,
	type UpdateNoteRecord,
} from "../../src/update-note.ts";

/**
 * Renders the generated runtime registry from authoring records, writing each field by key. The
 * record is never spread or JSON-stringified, so `internalVersion` (which build a date was, for
 * incidents; must not appear on screen) and `discord` (paste text read only by tooling) cannot
 * reach the app bundle. Keeping them out by structure is safer than filtering: a value the app data
 * never holds cannot leak through a forgotten filter.
 *
 * The output must be deterministic (no timestamps, absolute paths, random or environment values).
 * Otherwise the generated diff changes on every run and the freshness check always reports stale.
 */

/**
 * File header of the generated output: the first thing a person reads when tempted to hand-edit it.
 */
const HEADER = `/**
 * **Generated file. Do not edit by hand.**
 *
 * The source is \`packages/domain/src/update-notes/releases/<YYYY>/<YYYY-MM-DD>.ts\`, and
 * \`pnpm updates:generate\` builds it. Editing a line here is erased by the next generation, and only
 * the deployments in between draw different text.
 *
 * ## Not the authoring record
 *
 * \`internalVersion\` and \`discord\` are absent here. The first must never reach a screen and the
 * second is text to paste, so only tools read them. Data the app **never holds** is a stronger
 * boundary than a careful projection function.
 *
 * Freshness is guarded by \`pnpm updates:check\` and the domain tests: editing an authoring file
 * without regenerating this one breaks CI first.
 */`;

const IMPORT = `import type { UpdateNoteRuntimeRecord } from "../../update-note.ts";`;

/**
 * Strings are written as JSON literals, so escaping rules are not reimplemented and Korean text
 * stays unescaped.
 */
const text = (value: string): string => JSON.stringify(value);

const list = (items: readonly string[], indent: string): string =>
	items.map((item) => `${indent}${text(item)},`).join("\n");

const renderRecord = (record: UpdateNoteRecord): string => {
	const lines: string[] = ["\t{", `\t\treleasedAt: ${text(record.releasedAt)},`];

	if (record.surfaces !== undefined)
		lines.push(
			`\t\tsurfaces: [${record.surfaces.map(text).join(", ")}],`,
		);

	lines.push("\t\tinApp: {");
	if (record.inApp.intro !== undefined)
		lines.push(`\t\t\tintro: ${text(record.inApp.intro)},`);
	/**
	 * Section order follows the product order (`UPDATE_NOTE_SECTION_ORDER`), not the key order in the
	 * authoring file.
	 */
	for (const id of UPDATE_NOTE_SECTION_ORDER) {
		const items = record.inApp[id];
		if (items === undefined) continue;
		lines.push(`\t\t\t${id}: [`, list(items, "\t\t\t\t"), "\t\t\t],");
	}
	lines.push("\t\t},", "\t},");

	return lines.join("\n");
};

/**
 * Renders the whole registry. Does not sort: the loader already yields oldest first, and
 * `updateNotesFor` decides the on-screen order (newest on top).
 */
export function renderUpdateNoteRegistry(
	records: readonly UpdateNoteRecord[],
): string {
	const declaration =
		"export const UPDATE_NOTE_RUNTIME_RECORDS: readonly UpdateNoteRuntimeRecord[] =";
	const body =
		records.length === 0
			? "\n\t[];"
			: ` [\n${records.map(renderRecord).join("\n")}\n];`;
	return `${HEADER}\n\n${IMPORT}\n\n${declaration}${body}\n`;
}
