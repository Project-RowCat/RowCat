import type { RuntimeCompileFile } from "@rowcat/runtime-compiler/contracts";

/**
 * The default libraries the worker passes to the compiler. They are an asset of the bundle, not a
 * CDN fetch (the same choice Monaco's worker makes).
 * - The compiler environment needs lib.es2022.d.ts-family files as files
 *   (RuntimeCompilerEnvironment). Node reads them from the installed TypeScript's lib folder
 *   (environment/node.ts); here Vite imports them as strings.
 * - The list is the full chain ES2022 references: es2022 refers to es2021, down through es2020 to
 *   es5, which refers to the two decorator libs. A missing one surfaces as a 'library definition
 *   not found' infrastructure failure that looks like the creator's fault.
 * - DOM, Node and ESNext libraries are deliberately absent. Including them would make document
 *   exist in creator code (typescript-host.ts).
 * - Only the preview worker imports this module, so it is kept out of the studio's main bundle.
 */
const LIBS = import.meta.glob(
	[
		"/node_modules/typescript-compiler-api/lib/lib.es5.d.ts",
		"/node_modules/typescript-compiler-api/lib/lib.es20{15,16,17,18,19,20,21,22}*.d.ts",
		"/node_modules/typescript-compiler-api/lib/lib.decorators*.d.ts",
	],
	{ query: "?raw", import: "default", eager: true },
) as Record<string, string>;

const fileName = (path: string): string =>
	path.slice(path.lastIndexOf("/") + 1);

export function runtimeLibFiles(): RuntimeCompileFile[] {
	return Object.entries(LIBS)
		.map(([path, content]) => ({ path: fileName(path), content }))
		.sort((left, right) => (left.path < right.path ? -1 : 1));
}
