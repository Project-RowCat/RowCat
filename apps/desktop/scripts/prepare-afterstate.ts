/** Installs an explicit, verified artifact into the local build cache. The cache
 * is an output, not a runtime dependency on a sibling repository. */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AFTERSTATE_FILES, validateAfterstateArtifact } from "../src/afterstate-artifact.ts";

const source = process.argv[2] ?? process.env.AFTERSTATE_WASM_DIR;
if (!source) throw new Error("Pass the generated desktop artifact directory explicitly");
const desktop = resolve(fileURLToPath(import.meta.url), "../..");
const input = resolve(source);
const manifest = validateAfterstateArtifact(input);
const output = join(desktop, ".afterstate-wasm");
if (input !== output) {
	rmSync(output, { recursive: true, force: true });
	mkdirSync(output, { recursive: true });
	for (const file of [...AFTERSTATE_FILES, "manifest.json"])
		cpSync(join(input, file), join(output, file));
}
if (process.argv.includes("--lock")) {
    const existing = JSON.parse(readFileSync(join(desktop, "afterstate-source.json"), "utf8"));
    if (existing.distribution && existing.distribution.version !== manifest.version)
        throw new Error("Update the reviewed package pin explicitly before changing WASM versions");
	writeFileSync(join(desktop, "afterstate-source.json"), `${JSON.stringify({
		format: "rowcat-afterstate-source/1", ...manifest.source,
        ...(existing.distribution ? { distribution: existing.distribution, files: manifest.files } : {}),
	}, null, 2)}\n`);
}
// Require the checked source pin even for local staging. Dirty pins permit only
// explicitly labelled internal packages; publication needs a clean source commit.
const pin = JSON.parse(readFileSync(join(desktop, "afterstate-source.json"), "utf8"));
if (pin.revision !== manifest.source.revision || pin.sha256 !== manifest.source.sha256)
	throw new Error("afterstate source pin differs; review provenance before --lock");
console.log(`Prepared afterstate ${manifest.version} (${manifest.source.dirty ? "uncommitted source; internal only" : manifest.source.revision})`);
