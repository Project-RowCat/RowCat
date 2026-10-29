import type { UpdateNoteRecord } from "../update-note.ts";

/**
 * Template for a new update note, not a release. It lives outside `releases/` and its name starts
 * with `_`, so the scanner sees it, but nothing here reaches a screen.
 *
 * - Copy it to releases/<year>/<YYYY-MM-DD>.ts, write the user-facing copy, then run pnpm
 *   updates:generate and the domain tests.
 * - No manual registry edit is needed: the file name is the discovery key, and a mismatch with
 *   releasedAt fails the generate step. A forgotten import once dropped a release silently.
 * - Describe what users can now do, not how the code changed.
 * - Delete empty sections instead of leaving empty arrays.
 * - In-app text is one line; Discord may add an explanation. Derive neither from the other.
 * - Do not write the version number in copy (the public identity is the date) or a closing
 *   greeting.
 */
export const UPDATE_NOTE_TEMPLATE: UpdateNoteRecord = {
	releasedAt: "2026-01-01",
	internalVersion: "0.0.0",
	/** Omitting this means all surfaces. Set it only for releases that apply to one surface. */
	surfaces: ["web", "mobile"],
	inApp: {
		intro: "Describe this update in a sentence or two.",
		additions: ["Something users can now do."],
		improvements: ["Something that got better in the existing experience."],
		fixes: ["A problem users could have hit, and the fact that it is fixed."],
		notices: ["Something users must know, such as a rollout or a limit."],
	},
	discord: {
		intro: "Briefly introduce the whole update.",
		additions: [
			{
				title: "Feature name",
				detail: "Explain what was added and what users can do with it.",
			},
		],
		improvements: [{ title: "One line without a description is fine." }],
		fixes: [{ title: "The fixed problem." }],
		notices: [{ title: "Write this only when needed." }],
	},
};
