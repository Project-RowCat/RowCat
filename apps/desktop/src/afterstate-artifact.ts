/** Runtime resources are fixed by the packager, never supplied through renderer IPC.
 * Checking them in the worker also keeps WASM compilation and hashing off main. */
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const AFTERSTATE_PROTOCOL = "afterstate-bridge/1";
export const AFTERSTATE_FILES = [
	"LICENSE",
	"THIRD-PARTY-NOTICES.txt",
	"afterstate_wasm.js",
	"afterstate_wasm_bg.wasm",
	"package.json",
] as const;

export interface AfterstateManifest {
	format: "rowcat-afterstate-artifact/1";
	protocol: string;
	snapshot: string;
	version: string;
	source: {
		repository: string;
		revision: string;
		sha256: string;
		dirty: boolean;
	};
	files: Record<string, string>;
}

export function validateAfterstateArtifact(dir: string): AfterstateManifest {
	const manifest = JSON.parse(
		readFileSync(join(dir, "manifest.json"), "utf8"),
	) as AfterstateManifest;
	if (
		manifest.format !== "rowcat-afterstate-artifact/1" ||
		manifest.protocol !== AFTERSTATE_PROTOCOL ||
		manifest.snapshot !== "afterstate-portable/1" ||
		!/^\w[\w.-]*$/.test(manifest.version) ||
		!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(manifest.source.revision) ||
		!/^[a-f0-9]{64}$/.test(manifest.source.sha256)
	)
		throw new Error("afterstate: incompatible artifact");
	const allowed = new Set<string>([...AFTERSTATE_FILES, "manifest.json"]);
	if (readdirSync(dir).some((file) => !allowed.has(file)))
		throw new Error("afterstate: unexpected artifact file");
	for (const file of AFTERSTATE_FILES) {
		const path = join(dir, file);
		const stat = lstatSync(path);
		if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024)
			throw new Error("afterstate: invalid artifact file");
		const bytes = readFileSync(path);
		if (
			createHash("sha256").update(bytes).digest("hex") !== manifest.files[file]
		)
			throw new Error("afterstate: corrupt artifact");
		if (file.endsWith(".wasm") && !WebAssembly.validate(bytes))
			throw new Error("afterstate: invalid WASM");
	}
	const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
	if (pkg.type !== "commonjs" || pkg.license !== "Apache-2.0")
		throw new Error("afterstate: incompatible bindings");
	return manifest;
}
