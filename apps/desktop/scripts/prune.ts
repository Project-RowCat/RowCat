/**
 * What the installer leaves out of a server's `node_modules`. The installer's cost is mostly its file
 * count, not its bytes: NSIS writes every file one at a time, Windows Defender scans each one as it
 * lands, and an update first deletes every file the previous version wrote. The API's production
 * dependencies were ~15,000 files, and two kinds of them are never loaded.
 *
 * ```text
 * a package nothing loads      the dev tools an optional peer pulls in (expo through drizzle-orm and
 *                              @better-auth/expo, esbuild, babel) — traced from dist/, dropped whole
 * a file Node never executes   type declarations, source maps, TypeScript sources, READMEs
 * ```
 *
 * **The unit of the first decision is the package, never the file.** The trace follows `import` and
 * `require`, not what a package reads from its own folder with `fs` — the publication compiler reads
 * TypeScript's `lib.*.d.ts` with `readdirSync`, and a per-file trace would ship a compiler that cannot
 * find its standard library. A package the trace entered at all is kept whole. One the trace only
 * looked up (its `package.json` and nothing else) is a package nothing loads.
 *
 * **What a package reads as data is not stripped** (`READS_OWN_FILES`). The second decision is a file
 * pattern, and a pattern cannot see `fs` either. A traced file is never stripped, whatever its name.
 * License texts always stay.
 *
 * The container image keeps its full `node_modules`. The bundle (`dist/`) is the same bytes in both;
 * this narrows only what the desktop copy carries next to it.
 */
import { lstatSync, readdirSync, rmSync } from "node:fs";
import { join, sep } from "node:path";
import { nodeFileTrace } from "@vercel/nft";

/** Packages that read their own files at runtime, so no file in them is dropped by pattern. */
export const READS_OWN_FILES = ["typescript-compiler-api"];

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
const LICENSE = /^(licen[cs]e|notice|copying|authors)(\.|$)/i;

/** Whether a file inside `node_modules` is one Node never executes and nothing here reads. */
export function fileStrippable(path: string, traced: Set<string>): boolean {
	if (traced.has(path)) return false;
	const name = path.slice(path.lastIndexOf("/") + 1);
	if (LICENSE.test(name)) return false;
	const root = packageRootOf(path);
	const pkg = root?.slice(root.lastIndexOf("node_modules/") + "node_modules/".length);
	if (pkg && READS_OWN_FILES.includes(pkg)) return false;
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

/** Traces `root/dist/**\/*.mjs` and removes from `root/node_modules` what that trace never loads. */
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
	for (const file of filesUnder(root, "node_modules"))
		if (fileStrippable(file, traced)) remove(file);
	return result;
}

/** Files under a folder, for the before/after line the build prints. */
export function countFiles(dir: string): number {
	return filesUnder(dir, ".").length;
}
