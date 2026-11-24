import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { auditPackage } from "./package-audit.ts";

it("refuses secrets and local databases in an otherwise valid staging tree", () => {
	const root = mkdtempSync(join(tmpdir(), "desktop-audit-"));
	try {
		mkdirSync(join(root, "api")); writeFileSync(join(root, "api", "index.mjs"), "export {};");
		expect(() => auditPackage(root)).not.toThrow();
		for (const file of [".env", ".env.production", "private.db", "memory.sqlite3", "credentials.json"]) {
			writeFileSync(join(root, "api", file), "synthetic");
			expect(() => auditPackage(root)).toThrow("private/development file");
			rmSync(join(root, "api", file));
		}
	} finally { rmSync(root, { recursive: true, force: true }); }
});
