/** CI-only installed-app/upgrade smoke. Never opens a developer's real app data.
 * The Windows runner owns a clean profile. All accounts and sentinel data are synthetic. */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { _electron } from "@playwright/test";

if (process.env.CI !== "true") throw new Error("installed smoke requires an ephemeral CI profile");
const executablePath = process.argv[2];
const stateFile = resolve(process.argv[3] ?? "installed-smoke.json");
const seed = process.argv.includes("--seed-upgrade");
const verify = process.argv.includes("--verify-upgrade");
if (!executablePath) throw new Error("installed-smoke <executable> <state-file> [--seed-upgrade|--verify-upgrade]");
const previous = verify ? JSON.parse(readFileSync(stateFile, "utf8")) as { member: string; ports: object; sentinel: string } : null;
const application = await _electron.launch({ executablePath, timeout: 180_000 });
try {
	const page = await application.firstWindow();
	await page.waitForURL(/^http:\/\/localhost:\d+\//, { timeout: 180_000 });
	const userData = await application.evaluate(({ app }) => app.getPath("userData"));
	const settings = JSON.parse(readFileSync(join(userData, "deployment", "settings.json"), "utf8")) as { ports: { api: number } };
	const api = `http://localhost:${settings.ports.api}`;
	const member = await page.evaluate(async ({ api, verify }) => {
		if (!verify) {
			const up = await fetch(`${api}/v2/auth/sign-up/email`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `installer-${Date.now()}@example.test`, password: "synthetic-local-upgrade-pass", name: "Installer Smoke" }) });
			if (!up.ok) throw new Error("synthetic sign-up failed");
		}
		const response = await fetch(`${api}/v2/me`, { credentials: "include" });
		return (await response.json() as { id: string }).id;
	}, { api, verify });
	assert.ok(member);
	const sentinel = previous?.sentinel ?? `upgrade-${Date.now()}`;
	const stored = await page.evaluate(async ({ sentinel, verify }) => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("rowcat-installed-upgrade-smoke", 1); request.onupgradeneeded = () => request.result.createObjectStore("sentinel"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
		try {
			if (!verify) await new Promise<void>((resolve, reject) => { const tx = db.transaction("sentinel", "readwrite"); tx.objectStore("sentinel").put(sentinel, "value"); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
			return await new Promise<unknown>((resolve, reject) => { const request = db.transaction("sentinel").objectStore("sentinel").get("value"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
		} finally { db.close(); }
	}, { sentinel, verify });
	assert.equal(stored, sentinel);
	if (previous) { assert.equal(member, previous.member); assert.deepEqual(settings.ports, previous.ports); }
	if (!seed) {
		const status = await page.evaluate(async member => {
			const memory = (window as unknown as { rowcatAfterstate: { call(m: string, op: string, p: object): Promise<{ protocol: string }> } }).rowcatAfterstate;
			return memory.call(member, "status", {});
		}, member);
		assert.equal(status.protocol, "afterstate-bridge/1");
	}
	mkdirSync(dirname(stateFile), { recursive: true });
	writeFileSync(stateFile, `${JSON.stringify({ member, ports: settings.ports, sentinel, mode: seed ? "seed-upgrade" : verify ? "verified-upgrade" : "clean-install", wasm: !seed })}\n`);
	console.log(seed ? "Older installation seeded" : "Installed application smoke passed");
} finally { await application.close(); }
