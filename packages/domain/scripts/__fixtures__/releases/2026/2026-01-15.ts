import type { UpdateNoteRecord } from "../../../../src/update-note.ts";

/** A fixture for the loader tests, not a release (it lives outside `releases/`). */
export const FIXTURE_OLDER: UpdateNoteRecord = {
	releasedAt: "2026-01-15",
	internalVersion: "0.1.0",
	inApp: { additions: ["Fixture sentence."] },
	discord: { additions: [{ title: "Fixture title." }] },
};
