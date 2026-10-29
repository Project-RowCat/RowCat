import { join } from "node:path";

/**
 * Where the generated file lives, and the **bootstrap stub**. This module imports nothing from `src/`.
 *
 * That fact is why this file exists. The rules module (`src/update-note.ts`) imports the generated
 * file, so **without the generated file the rules module cannot even be imported**. If the generator
 * imported that module statically, a repository with the file deleted could not regenerate it.
 *
 * So the generator takes only the location and the stub from here, writes an empty registry first,
 * and imports the rules dynamically afterwards. The stub lives for that one statement only; the real
 * generated file overwrites it right away.
 */

export const GENERATED_FILE = join(
	import.meta.dirname,
	"..",
	"..",
	"src",
	"update-notes",
	"generated",
	"update-notes.ts",
);

/** A registry with no releases. It is never committed; it exists for one moment before generation. */
export const BOOTSTRAP_REGISTRY = `/** A placeholder during generation; pnpm updates:generate overwrites it right away. */

import type { UpdateNoteRuntimeRecord } from "../../update-note.ts";

export const UPDATE_NOTE_RUNTIME_RECORDS: readonly UpdateNoteRuntimeRecord[] =
	[];
`;
