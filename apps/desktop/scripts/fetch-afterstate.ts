/** Release builds consume the exact published package. The engine repository is
 * private; no broad private-repository credential belongs in the public app CI. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AFTERSTATE_FILES, validateAfterstateArtifact } from "../src/afterstate-artifact.ts";

const desktop = resolve(fileURLToPath(import.meta.url), "../..");
const pin = JSON.parse(readFileSync(join(desktop, "afterstate-source.json"), "utf8"));
const distribution = pin.distribution as { name: string; version: string; integrity: string };
if (distribution?.name !== "afterstate-wasm" || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(distribution.version))
    throw new Error("missing reviewed WASM package pin");
const local = process.argv[2];
let bytes: Buffer;
if (local) bytes = readFileSync(resolve(local));
else {
    const url = `https://registry.npmjs.org/afterstate-wasm/-/afterstate-wasm-${distribution.version}.tgz`;
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`WASM package download failed (${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
}
if (bytes.length > 32 * 1024 * 1024 || `sha512-${createHash("sha512").update(bytes).digest("base64")}` !== distribution.integrity)
    throw new Error("WASM package integrity mismatch");
const scratch = mkdtempSync(join(tmpdir(), "rowcat-wasm-package-"));
try {
    const tarball = join(scratch, "package.tgz");
    writeFileSync(tarball, bytes);
    const entries = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).trim().split("\n");
    if (entries.some(entry => !entry.startsWith("package/") || entry.split("/").includes("..") || entry.includes("\\")))
        throw new Error("unsafe WASM package path");
    execFileSync("tar", ["-xzf", tarball, "-C", scratch]);
    const pkg = join(scratch, "package");
    const metadata = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));
    if (metadata.name !== distribution.name || metadata.version !== distribution.version)
        throw new Error("WASM package version mismatch");
    const output = join(desktop, ".afterstate-wasm");
    rmSync(output, { recursive: true, force: true }); mkdirSync(output, { recursive: true });
    for (const name of ["afterstate_wasm.js", "afterstate_wasm_bg.wasm"])
        cpSync(join(pkg, "nodejs", name), join(output, name));
    for (const name of ["LICENSE", "THIRD-PARTY-NOTICES.txt"])
        cpSync(join(pkg, name), join(output, name));
    writeFileSync(join(output, "package.json"), `${JSON.stringify({ name: "afterstate-wasm-desktop", type: "commonjs", license: "Apache-2.0", private: true })}\n`);
    const files = Object.fromEntries(AFTERSTATE_FILES.map(file => [file, createHash("sha256").update(readFileSync(join(output, file))).digest("hex")]));
    for (const file of AFTERSTATE_FILES)
        if (files[file] !== pin.files[file]) throw new Error(`WASM runtime file differs from pin: ${file}`);
    writeFileSync(join(output, "manifest.json"), `${JSON.stringify({
        format: "rowcat-afterstate-artifact/1", protocol: "afterstate-bridge/1", snapshot: "afterstate-portable/1",
        version: distribution.version, source: { repository: pin.repository, revision: pin.revision, sha256: pin.sha256, dirty: pin.dirty }, distribution, files,
    }, null, 2)}\n`);
    validateAfterstateArtifact(output);
    console.log(`Prepared ${distribution.name}@${distribution.version} with verified package and runtime hashes`);
} finally { rmSync(scratch, { recursive: true, force: true }); }
