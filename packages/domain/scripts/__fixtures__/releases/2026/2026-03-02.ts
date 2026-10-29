import type { UpdateNoteRecord } from "../../../../src/update-note.ts";

/** A fixture for the loader tests, not a release (it lives outside `releases/`). */
export const FIXTURE_NEWER: UpdateNoteRecord = {
	releasedAt: "2026-03-02",
	internalVersion: "0.2.0",
	surfaces: ["web"],
	inApp: { fixes: ["Fixture sentence."] },
};
