import { renderDiscordUpdateNote } from "../src/update-note.ts";
import { loadUpdateNoteRecords } from "./lib/update-note-sources.ts";

/**
 * Prints a Discord announcement to stdout: `pnpm updates:discord [YYYY-MM-DD]`.
 * - Why a tool: the Discord body is authored as typed data, and `renderDiscordUpdateNote` turns
 *   it into paste-ready text. This file only wires that function up. Putting the rule here would
 *   leave it untested, and in-app and Discord copy would quietly diverge.
 * - Not done: sending (no webhook or bot token; a person pastes), generating from the in-app body
 *   (if no Discord copy exists, the script says so), and file writes (the caller chooses any
 *   redirect).
 * - Sending is not automated, for the same reason as payment and legal notices: a person presses
 *   outbound actions. Automating it would make editing an authoring file equal to posting publicly.
 */

const [, , requested] = process.argv;

/**
 * Reads the authoring source, not the generated output, because the generated registry has no
 * `discord` field. Only this tool goes through the loader, which is Node-only and never reaches the
 * app.
 */
const all = await loadUpdateNoteRecords();

const records = requested
	? all.filter((record) => record.releasedAt === requested)
	: /**
 * With no argument, prints only the most recent release. Printing all of them would make the person
 * choose what to paste.
 */
		all.slice(-1);

if (records.length === 0) {
	process.stderr.write(
		requested
			? `no update note for ${requested}\n`
			: "no update notes are authored; copy _template.ts to releases/<year>/<date>.ts\n",
	);
	process.exit(1);
}

for (const record of records) {
	const rendered = renderDiscordUpdateNote(record);
	if (rendered === null) {
		process.stderr.write(
			`no Discord body is authored for ${record.releasedAt}\n`,
		);
		process.exit(1);
	}
	process.stdout.write(rendered);
}
