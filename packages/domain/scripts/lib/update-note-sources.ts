import { existsSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
	isReleaseDate,
	type UpdateNoteRecord,
	updateNoteProblems,
} from "../../src/update-note.ts";

/**
 * Tool-only loader for the authored release files. Runs in Node only.
 * - A scanner, not an array in update-notes/index.ts. That array only named the release files,
 *   which the file name already does. Hand-added import and array lines could be forgotten, and the
 *   note would silently vanish. A misnamed file here fails loudly.
 * - Never reaches the app: it uses node:fs and dynamic import, which browsers and Hermes lack,
 *   and it lives outside src/ because the package exports only ./src/*. The app gets only the
 *   generated runtime registry.
 * - The file name is the identity: releasedAt must match it. If only one is changed, folder scans
 *   and the screen would show different dates with no error.
 * - Flow: releases/<year>/<date>.ts (holds internalVersion and discord) -> this loader, called by
 *   the generator and the Discord tool -> generated/update-notes.ts (releasedAt, surfaces, inApp
 *   only) -> app.
 */

export const RELEASES_DIR = join(
	import.meta.dirname,
	"..",
	"..",
	"src",
	"update-notes",
	"releases",
);

const RELEASE_FILE = /^(\d{4}-\d{2}-\d{2})\.ts$/;

/** Looks one level into year folders only. Month folders are not needed: a year is twelve files. */
const YEAR_DIR = /^\d{4}$/;

export interface UpdateNoteSource {
	/** Path relative to the repository root; failure messages point at this path. */
	readonly path: string;
	readonly record: UpdateNoteRecord;
}

const fail = (message: string): never => {
	throw new Error(message);
};

/**
 * Collects release paths in sorted order. `readdirSync` order is not used because it differs across
 * file systems and can change after a delete and recreate on the same machine.
 * Environment-dependent diffs would make the freshness check meaningless.
 */
const releaseFiles = (dir: string, year: string | null): string[] => {
	const found: string[] = [];
	for (const entry of readdirSync(dir).sort()) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			if (year !== null)
				fail(`release folder is too deep: ${path} (only releases/<YYYY>/)`);
			if (!YEAR_DIR.test(entry))
				fail(`folders under releases must be years: ${entry}`);
			found.push(...releaseFiles(path, entry));
			continue;
		}
		/** Files starting with `_` are templates or helpers, not releases. */
		if (entry.startsWith("_")) continue;
		const match = RELEASE_FILE.exec(entry);
		if (!match)
			fail(
				`release file name is not <YYYY-MM-DD>.ts: ${path} (start the name with _ if it is not a release)`,
			);
		const date = (match as RegExpExecArray)[1] as string;
		const where = `releases/${date.slice(0, 4)}/`;
		if (year === null)
			fail(`release file is outside a year folder: ${path} (${where})`);
		if (date.slice(0, 4) !== year)
			fail(`release file is in another year's folder: ${path} (${where})`);
		if (!isReleaseDate(date)) fail(`not a real date: ${path}`);
		found.push(path);
	}
	return found;
};

const looksLikeRecord = (value: unknown): value is UpdateNoteRecord =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as { releasedAt?: unknown }).releasedAt === "string" &&
	typeof (value as { inApp?: unknown }).inApp === "object" &&
	(value as { inApp?: unknown }).inApp !== null;

/**
 * Takes the record from one release file, which must export exactly one value. The export name is
 * not derived from a convention like `UPDATE_NOTE_2026_08_30`, since that would state the date
 * twice. The count is enforced instead: if release files start holding helper constants, the loader
 * would have to guess which export is the day's note.
 */
const readRecord = async (path: string): Promise<UpdateNoteRecord> => {
	const module: Record<string, unknown> = await import(
		pathToFileURL(path).href
	);
	const exported = Object.entries(module);
	if (exported.length !== 1)
		fail(
			`a release file exports exactly one value: ${path} (now ${exported.length})`,
		);
	const [name, value] = exported[0] as [string, unknown];
	if (!looksLikeRecord(value))
		fail(`${name} in ${path} is not an UpdateNoteRecord`);
	return value as UpdateNoteRecord;
};

/**
 * All authored releases, sorted oldest first and all validated. Validation lives here, not in the
 * generator, because there are two consumers (the generator and the Discord tool). Checking in only
 * one would let a broken record through the other path.
 */
export async function loadUpdateNoteSources(
	/** Tests pass a fixture folder here; the real tools always use the default. */
	dir: string = RELEASES_DIR,
): Promise<UpdateNoteSource[]> {
	const sources: UpdateNoteSource[] = [];
	const seen = new Map<string, string>();

	/**
	 * A missing folder means no releases. Git does not track empty directories, so a public checkout
	 * (which ships without releases) has no `releases/` at all. Throwing would break `pnpm
	 * updates:check` before the first release exists. An empty registry is normal, and both apps'
	 * `Updates` row draws that state.
	 */
	if (!existsSync(dir)) return [];

	for (const path of releaseFiles(dir, null)) {
		const record = await readRecord(path);
		const relative = path.slice(dir.length + 1);
		const expected = relative.slice(-13, -3);

		if (record.releasedAt !== expected)
			fail(
				`file name and releasedAt differ: ${path} (releasedAt is ${record.releasedAt})`,
			);

		/**
		 * The naming rule already pins each date to one path, so this branch is unreachable today. It
		 * stays because if the rule loosens (for example, when month folders appear), duplicate dates
		 * would pass silently. `updateNotesFor` sorts stably, so which duplicate wins would depend on
		 * input order.
		 */
		const duplicate = seen.get(record.releasedAt);
		if (duplicate !== undefined)
			fail(`two releases share a date: ${duplicate} · ${path}`);
		seen.set(record.releasedAt, path);

		const problems = updateNoteProblems(record);
		if (problems.length > 0) fail(`${path}\n  ${problems.join("\n  ")}`);

		/**
		 * Paths in failure messages must look the same on every machine, so Windows backslashes are
		 * normalized to `/`.
		 */
		sources.push({
			path: `releases/${relative.split(sep).join("/")}`,
			record,
		});
	}

	/** `YYYY-MM-DD` dates sort lexicographically in chronological order. Oldest first. */
	return sources.sort((a, b) =>
		a.record.releasedAt < b.record.releasedAt ? -1 : 1,
	);
}

export async function loadUpdateNoteRecords(
	dir: string = RELEASES_DIR,
): Promise<UpdateNoteRecord[]> {
	return (await loadUpdateNoteSources(dir)).map((source) => source.record);
}
