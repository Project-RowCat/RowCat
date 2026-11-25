/** Packaging verification uses the installed resources and Electron's Node mode.
 * Its fresh database is outside the bundle and outside every real app-data folder.
 * Server logs can contain a setup code, so only the final verdict reaches stdout. Postgres's own
 * lines carry no setup code; they reach stderr when the smoke fails, since they hold the reason. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type RunningStack, startStack } from "./stack.ts";

if (!process.argv[2])
	throw new Error("usage: stack-smoke <packaged-resources>");
const resources = resolve(process.argv[2]);
const dataDir = mkdtempSync(join(tmpdir(), "rowcat-packaged-stack-"));
let stack: RunningStack | undefined;
const postgresLog: string[] = [];
try {
	stack = await startStack({
		dataDir,
		artifacts: {
			apiDir: join(resources, "api"),
			webServerEntry: join(resources, "web", "server", "index.mjs"),
			consoleDistDir: join(resources, "console"),
			node: { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: "1" } },
		},
		log: (source, line) => {
			if (source === "postgres") postgresLog.push(line);
		},
	});
	for (const origin of [
		stack.origins.api,
		stack.origins.web,
		stack.origins.console,
	]) {
		const response = await fetch(origin, {
			signal: AbortSignal.timeout(20_000),
		});
		// The API root has no route; its readiness probe was already passed by startStack.
		assert.ok(response.status < 500);
		await response.body?.cancel();
	}
	console.log(
		JSON.stringify({
			packagedPostgres: "passed",
			api: "passed",
			web: "passed",
			console: "passed",
		}),
	);
} catch (error) {
	console.error(postgresLog.join("\n"));
	throw error;
} finally {
	await stack?.stop();
	rmSync(dataDir, { recursive: true, force: true });
}
