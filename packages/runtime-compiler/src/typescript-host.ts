import { runtimePackageFiles } from "@rowcat/runtime/declarations";
import ts from "typescript-compiler-api";
import { RUNTIME_VIRTUAL_ROOT, type RuntimeCompileFile } from "./contracts.ts";
import { toVirtualPath } from "./paths.ts";

/**
 * The environment in which the creator's program runs. It has nothing to do with this app's
 * tsconfig.
 *
 * What matters most is what is absent here. It does not inherit the apps/web configuration,
 * includes no @types/*, and does not include the DOM library. That absence is the whole reason
 * document, process and <div /> do not exist in creator code.
 *
 * Why inheritance was rejected: the web app has React and DOM types, and if those declarations were
 * in the program, <div>Hello</div> would pass. That code would then have nothing it could draw
 * inside the WASM VM. The creator would write what the editor allowed and then wonder why it does
 * not run.
 */

/**
 * Default libraries are injected rather than read from ts.sys, because this package must also run
 * in browsers. The Node reader lives in environment/node.ts, the only file that knows node:fs.
 * digest sits on the same axis: calling node:crypto here would tie this module to Node.
 */
export interface RuntimeCompilerEnvironment {
	/** File names and contents such as lib.es2022.d.ts. These are names, not paths. */
	defaultLibs: readonly RuntimeCompileFile[];
	digest: (canonical: string) => string;
}

/** The library this program builds against: ES only, with no DOM and no Node. */
export const RUNTIME_DEFAULT_LIB = "lib.es2022.d.ts";

const LIB_DIRECTORY = `${RUNTIME_VIRTUAL_ROOT}/node_modules/typescript/lib`;

/**
 * noEmitOnError is the defining setting: any error means no emit. This rules out an artifact built
 * from broken types.
 *
 * allowImportingTsExtensions must stay off. It requires noEmit, which is incompatible with
 * emitting, and it would turn an innocent ./foo.ts into a type error (imports in this language are
 * written without extensions).
 */
export function runtimeCompilerOptions(): ts.CompilerOptions {
	return {
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		jsx: ts.JsxEmit.ReactJSX,
		jsxImportSource: "@rowcat/runtime",
		strict: true,
		/**
		 * Setting lib explicitly turns off automatic default-library selection, because that selection
		 * pulls in the DOM.
		 */
		lib: [RUNTIME_DEFAULT_LIB],
		/** An empty array, so no @types/* enter the program. Omitting it would include all of them. */
		types: [],
		noEmitOnError: true,
		sourceMap: true,
		/**
		 * Runtime package sources are .ts and get checked. That is intentional: every compile confirms
		 * that those files hold in this environment. Diagnostics from there are not shown to the creator;
		 * they are raised as infrastructure failures.
		 */
		skipLibCheck: false,
		forceConsistentCasingInFileNames: true,
		noFallthroughCasesInSwitch: true,
		/** Pins these values so the emitted output does not vary with the environment. */
		newLine: ts.NewLineKind.LineFeed,
		removeComments: false,
		declaration: false,
	};
}

export interface RuntimeHostInput {
	/** Maps project path to content. Every path must already be canonical. */
	files: ReadonlyMap<string, string>;
	environment: RuntimeCompilerEnvironment;
	/** Files the compiler injects, such as the entry check. They are not part of the project. */
	injected?: ReadonlyMap<string, string>;
}

export interface RuntimeHost {
	host: ts.CompilerHost;
	rootNames: string[];
}

/**
 * Builds the virtual file system. It never touches the real file system. If ts.sys were a fallback,
 * the disk of the machine running the compile would affect the result, which breaks determinism:
 * the same manuscript would become a different program on a different machine.
 */
export function createRuntimeHost(input: RuntimeHostInput): RuntimeHost {
	const virtual = new Map<string, string>();

	for (const file of runtimePackageFiles(RUNTIME_VIRTUAL_ROOT))
		virtual.set(file.path, file.content);
	for (const lib of input.environment.defaultLibs)
		virtual.set(`${LIB_DIRECTORY}/${lib.path}`, lib.content);
	for (const [path, content] of input.files)
		virtual.set(toVirtualPath(path), content);
	for (const [path, content] of input.injected ?? [])
		virtual.set(path, content);

	const cache = new Map<string, ts.SourceFile>();

	const host: ts.CompilerHost = {
		fileExists: (fileName) => virtual.has(fileName),
		readFile: (fileName) => virtual.get(fileName),
		directoryExists: (directoryName) => {
			const prefix = directoryName.endsWith("/")
				? directoryName
				: `${directoryName}/`;
			for (const path of virtual.keys())
				if (path.startsWith(prefix)) return true;
			return false;
		},
		getDirectories: () => [],
		getSourceFile: (fileName, languageVersion) => {
			const cached = cache.get(fileName);
			if (cached) return cached;
			const text = virtual.get(fileName);
			if (text === undefined) return undefined;
			const file = ts.createSourceFile(fileName, text, languageVersion, true);
			cache.set(fileName, file);
			return file;
		},
		getDefaultLibFileName: () => `${LIB_DIRECTORY}/${RUNTIME_DEFAULT_LIB}`,
		getDefaultLibLocation: () => LIB_DIRECTORY,
		writeFile: () => {},
		getCurrentDirectory: () => RUNTIME_VIRTUAL_ROOT,
		/**
		 * Case-sensitive on purpose. If it were not, ./Foo and ./foo would be the same module. That
		 * convention holds only on a developer's case-insensitive Mac and breaks in deployment.
		 */
		getCanonicalFileName: (fileName) => fileName,
		useCaseSensitiveFileNames: () => true,
		getNewLine: () => "\n",
	};

	return {
		host,
		rootNames: [
			...[...input.files.keys()].sort().map(toVirtualPath),
			...[...(input.injected?.keys() ?? [])].sort(),
		],
	};
}
