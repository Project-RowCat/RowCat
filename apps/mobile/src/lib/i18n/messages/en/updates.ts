/**
 * The update-note history (features/updates): the tab's empty line, a note's title, its open hint,
 * the dismiss button and the four section labels. Its own namespace because that slice knows nothing
 * of the inbox — not even a dictionary name (`updates-boundaries.test.ts`). The Korean uses the web's
 * words (`apps/web` `shell.updates`); `section` and `unseen` name the domain's
 * `UPDATE_NOTE_SECTION_LABEL` and `UPDATE_UNSEEN_LABEL_SUFFIX`, held equal by a test.
 */
export const updates = {
	empty: "No update notes yet.",
	title: "{{date}} update notes",
	hint: "Opens this release's update note",
	ok: "OK",
	section: {
		additions: "New features",
		improvements: "Improvements",
		fixes: "Fixes",
		notices: "Notes",
	},
	unseen: ", new update available",
};
