import {
	cpSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateAfterstateArtifact } from "./afterstate-artifact.ts";

const source = resolve(process.env.AFTERSTATE_WASM_DIR ?? ".afterstate-wasm");
describe.skipIf(!existsSync(join(source, "manifest.json")))(
	"required production memory resources",
	() => {
		it("validates the real artifact and rejects missing, corrupt and extra files", () => {
			const dir = mkdtempSync(join(tmpdir(), "afterstate-artifact-"));
			try {
				cpSync(source, dir, { recursive: true });
				expect(validateAfterstateArtifact(dir).protocol).toBe(
					"afterstate-bridge/1",
				);
				writeFileSync(join(dir, ".env"), "synthetic");
				expect(() => validateAfterstateArtifact(dir)).toThrow("unexpected");
				rmSync(join(dir, ".env"));
				const file = join(dir, "afterstate_wasm_bg.wasm");
				const original = readFileSync(file);
				writeFileSync(file, Buffer.from("invalid"));
				expect(() => validateAfterstateArtifact(dir)).toThrow("corrupt");
				writeFileSync(file, original);
				rmSync(join(dir, "afterstate_wasm.js"));
				expect(() => validateAfterstateArtifact(dir)).toThrow();
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		});
		it("refuses a protocol impostor and a symlinked runtime payload", () => {
			const dir = mkdtempSync(join(tmpdir(), "afterstate-artifact-"));
			try {
				cpSync(source, dir, { recursive: true });
				const path = join(dir, "manifest.json");
				const manifest = JSON.parse(readFileSync(path, "utf8"));
				manifest.protocol = "afterstate-bridge/0";
				writeFileSync(path, JSON.stringify(manifest));
				expect(() => validateAfterstateArtifact(dir)).toThrow("incompatible");
				cpSync(join(source, "manifest.json"), path);
				rmSync(join(dir, "afterstate_wasm.js"));
				symlinkSync(
					join(source, "afterstate_wasm.js"),
					join(dir, "afterstate_wasm.js"),
				);
				expect(() => validateAfterstateArtifact(dir)).toThrow(
					"invalid artifact",
				);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		});
	},
);
