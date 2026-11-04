/**
 * What the installer leaves out of a server's `node_modules`. The installer's cost is its file count
 * more than its bytes, and each file is paid for several times: NSIS extracts the payload into a temp
 * folder and `CopyFiles` it into place, the temp copy is deleted, and an update first moves every file
 * the previous version wrote out of the way and deletes it — with Windows Defender scanning each write.
 * The API's production dependencies were ~15,000 files; what Node loads from them is ~2,000.
 *
 * ```text
 * a package nothing loads           dev tools an optional peer pulls in (expo through drizzle-orm and
 *                                   @better-auth/expo, esbuild, babel) — dropped whole
 * a file the trace never reached    other SQL dialects, every prism language, the CJS twin of ESM code
 * ```
 *
 * The trace (`@vercel/nft`, what Nitro already builds the web server's output with) follows `import`,
 * `require` and the path patterns Node resolves. **It does not see what a package reads with `fs`**:
 * the publication compiler lists TypeScript's `lib.*.d.ts` with `readdirSync`, and a per-file trace of
 * that package ships a compiler with no standard library. So two kinds of package are kept whole —
 * `READS_OWN_FILES`, and any package that carries a native binary (sharp's libvips is loaded by the
 * dynamic linker, not by Node). In those, only files Node never executes (declarations, source maps,
 * READMEs) go, and none at all from `READS_OWN_FILES`. Every `package.json` stays, nested ones too
 * (`{"type":"module"}` in a subfolder decides how its files load), and so does every license text.
 *
 * The container image keeps its full `node_modules`. The bundle (`dist/`) is the same bytes in both;
 * this narrows only what the desktop copy carries next to it.
 */
import { lstatSync, readdirSync, rmSync } from "node:fs";
import { join, sep } from "node:path";
import { nodeFileTrace } from "@vercel/nft";

/** Packages that read their own files at runtime with `fs`: kept whole, nothing dropped by pattern. */
export const READS_OWN_FILES = ["typescript-compiler-api"];

/** A file the OS loads rather than Node: its package is kept whole. */
const NATIVE_BINARY = /\.(node|dll|dylib|so|exe)(\.\d+)*$/i;

/** `a/node_modules/@s/p/x.js` → `a/node_modules/@s/p`. Posix separators in and out. */
export function packageRootOf(path: string): string | null {
	const marker = "node_modules/";
	const at = path.lastIndexOf(marker);
	if (at < 0) return null;
	const rest = path.slice(at + marker.length).split("/");
	const scoped = rest[0]?.startsWith("@");
	const name = scoped ? rest.slice(0, 2) : rest.slice(0, 1);
	if (!name[0] || (scoped && name.length < 2)) return null;
	return `${path.slice(0, at)}${marker}${name.join("/")}`;
}

/** The packages the trace actually loaded something from — a looked-up `package.json` does not count. */
export function loadedPackages(traced: Iterable<string>): Set<string> {
	const loaded = new Set<string>();
	for (const file of traced) {
		const root = packageRootOf(file);
		if (root && file !== `${root}/package.json`) loaded.add(root);
	}
	return loaded;
}

/**
 * Whether a package folder can go. A folder that holds a loaded package further down
 * (`foo/node_modules/bar`) stays, or deleting it would delete what is loaded.
 */
export function packageDroppable(root: string, loaded: Set<string>): boolean {
	if (loaded.has(root)) return false;
	for (const kept of loaded) if (kept.startsWith(`${root}/`)) return false;
	return true;
}

const NEVER_EXECUTED = [
	/\.[cm]?tsx?$/i, // TypeScript sources and declarations (.ts · .d.ts · .mts · .d.cts …)
	/\.map$/i,
	/\.(md|markdown)$/i,
];
const ALWAYS_KEPT = /^(package\.json|(licen[cs]e|notice|copying|authors)(\..*)?)$/i;

/** The package's name as it appears after the last `node_modules/`. */
const packageNameOf = (root: string) =>
	root.slice(root.lastIndexOf("node_modules/") + "node_modules/".length);

/** The loaded packages that keep every file but the never-executed ones. */
export function wholePackages(
	loaded: Set<string>,
	files: Iterable<string>,
): Set<string> {
	const whole = new Set(
		[...loaded].filter((root) => READS_OWN_FILES.includes(packageNameOf(root))),
	);
	for (const file of files) {
		if (!NATIVE_BINARY.test(file)) continue;
		const root = packageRootOf(file);
		if (root && loaded.has(root)) whole.add(root);
	}
	return whole;
}

/** Whether a file inside a loaded package can go. */
export function fileRemovable(
	path: string,
	traced: Set<string>,
	whole: Set<string>,
): boolean {
	if (traced.has(path)) return false;
	const name = path.slice(path.lastIndexOf("/") + 1);
	if (ALWAYS_KEPT.test(name)) return false;
	const root = packageRootOf(path);
	if (!root) return false;
	if (!whole.has(root)) return true;
	if (READS_OWN_FILES.includes(packageNameOf(root))) return false;
	return NEVER_EXECUTED.some((pattern) => pattern.test(name));
}

const posix = (path: string) => path.split(sep).join("/");

/** Every package folder under `root/node_modules`, nested ones included, as paths relative to root. */
function packageFolders(root: string, dir = "node_modules"): string[] {
	const found: string[] = [];
	let entries: string[];
	try {
		entries = readdirSync(join(root, dir));
	} catch {
		return found;
	}
	for (const name of entries) {
		if (name.startsWith(".")) continue;
		const path = `${dir}/${name}`;
		if (!lstatSync(join(root, path)).isDirectory()) continue;
		if (name.startsWith("@")) {
			for (const child of readdirSync(join(root, path))) {
				const scoped = `${path}/${child}`;
				if (!lstatSync(join(root, scoped)).isDirectory()) continue;
				found.push(scoped, ...packageFolders(root, `${scoped}/node_modules`));
			}
		} else found.push(path, ...packageFolders(root, `${path}/node_modules`));
	}
	return found;
}

function filesUnder(root: string, dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
		const path = `${dir}/${entry.name}`;
		if (entry.isDirectory()) out.push(...filesUnder(root, path));
		else if (entry.isFile()) out.push(path);
	}
	return out;
}

export interface PruneResult {
	packages: number;
	files: number;
	bytes: number;
}

/** Traces `root/dist/**\/*.mjs` and removes from `root/node_modules` what that trace never reaches. */
export async function pruneServerDependencies(root: string): Promise<PruneResult> {
	const entries = readdirSync(join(root, "dist"), { recursive: true })
		.map(String)
		.filter((file) => file.endsWith(".mjs"))
		.map((file) => join(root, "dist", file));
	const { fileList } = await nodeFileTrace(entries, { base: root, processCwd: root });
	const traced = new Set([...fileList].map(posix));
	const loaded = loadedPackages(traced);
	const result: PruneResult = { packages: 0, files: 0, bytes: 0 };
	const remove = (path: string) => {
		for (const file of lstatSync(join(root, path)).isDirectory()
			? filesUnder(root, path)
			: [path]) {
			result.files += 1;
			result.bytes += lstatSync(join(root, file)).size;
		}
		rmSync(join(root, path), { recursive: true, force: true });
	};

	// Deepest first, so a nested package is counted before a parent folder takes it with it.
	const folders = packageFolders(root).sort((a, b) => b.length - a.length);
	for (const folder of folders)
		if (packageDroppable(folder, loaded)) {
			result.packages += 1;
			remove(folder);
		}
	const files = filesUnder(root, "node_modules");
	const whole = wholePackages(loaded, files);
	for (const file of files) if (fileRemovable(file, traced, whole)) remove(file);
	return result;
}

/** Files under a folder, for the before/after line the build prints. */
export function countFiles(dir: string): number {
	return filesUnder(dir, ".").length;
}

/** The extensions migrations create, plus `plpgsql`, which initdb installs into every database. */
export function extensionsCreatedBy(migrations: Iterable<string>): Set<string> {
	const names = new Set(["plpgsql"]);
	const statement = /create\s+extension\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_-]+)"?/gi;
	for (const sql of migrations)
		for (const match of sql.matchAll(statement)) names.add((match[1] as string).toLowerCase());
	return names;
}

/**
 * `pg_trgm.control` and `pg_trgm--1.5--1.6.sql` belong to `pg_trgm`; `pg_trgm_x.sql` does not. Names may
 * hold a hyphen (`uuid-ossp--1.1.sql`), and `--` is what ends one.
 */
export function extensionFileKept(file: string, extensions: Set<string>): boolean {
	const name = /^([a-z0-9_-]+?)(?:--.*\.sql|\.control|\.sql)$/i.exec(file)?.[1];
	return name === undefined || extensions.has(name.toLowerCase());
}
