/**
 * The afterstate memory index in the real desktop window, end to end (Phase 12).
 *
 *   pnpm turbo run build --filter=@rowcat/api --filter=web --filter=admin
 *   AFTERSTATE_BRIDGE_BIN=<afterstate>/target/release/afterstate-bridge pnpm --filter @rowcat/desktop stage
 *   AFTERSTATE_BRIDGE_BIN=… E2E_EVIDENCE_DIR=<dir> pnpm --filter @rowcat/desktop exec tsx e2e/afterstate-window.e2e.ts
 *
 * Launches the staged Electron app (`harness.ts`), signs up synthetic accounts on its own local
 * stack, connects a local OpenAI-compatible mock as the BYO provider (`mock-openai.ts`, which logs
 * every request body) and drives the conversation screen: recall of a turn that left the history
 * window, a correction, room deletion, restart, legacy ↔ afterstate, a killed engine, a missing
 * engine and an impostor engine. Nothing leaves this computer and no real provider is called.
 *
 * Not a vitest file: it needs the built servers, the staged app and a window, so it runs on demand.
 * It records every check (pass or fail) and keeps going, then writes `results.json` and exits 1 if
 * any check failed.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import {
	type BridgeKind,
	bridgeProcesses,
	childrenOf,
	DESKTOP,
	launch,
	listeners,
	origins,
	prepareRun,
	type Run,
	setBridge,
	socketsOf,
} from "./harness.ts";
import { type ChatBody, lastUserText, MOCK_MODEL, type MockProvider, startMockProvider } from "./mock-openai.ts";

const REPO = resolve(DESKTOP, "../..");
const BRIDGE = process.env.AFTERSTATE_BRIDGE_BIN ?? resolve(REPO, "../../rust/afterstate/target/release/afterstate-bridge");
const EVIDENCE = resolve(process.env.E2E_EVIDENCE_DIR ?? join(DESKTOP, ".e2e-evidence"));
const RUN_ROOT = resolve(process.env.E2E_RUN_DIR ?? join(EVIDENCE, "run"));
const SCREENS = join(EVIDENCE, "screenshots");
const PROTOCOL = "afterstate-bridge/1";
const RECALL_HEADER = "[다시 찾은 지난 장면";
/**
 * The main process's log. Under the harness Electron names the logs folder after its own app
 * (`Electron`), since `appData` moved before `main.ts` set the name; a plain `pnpm dev` writes to
 * `RowCat Dev`.
 */
const DESKTOP_LOG = join(homedir(), "Library/Logs/Electron/rowcat.log");

// ---------------------------------------------------------------- recording

interface Check {
	phase: string;
	name: string;
	ok: boolean;
	detail?: unknown;
}
const checks: Check[] = [];
let phase = "setup";
let appPids = new Set<number>();
const journal = join(EVIDENCE, "journey.log");

function note(line: string): void {
	const text = `${new Date().toISOString()} [${phase}] ${line}`;
	console.log(text);
	appendFileSync(journal, `${text}\n`);
}

function check(name: string, ok: boolean, detail?: unknown): boolean {
	checks.push({ phase, name, ok, ...(detail === undefined ? {} : { detail }) });
	note(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
	return ok;
}

async function attempt(name: string, work: () => Promise<void>): Promise<void> {
	try {
		await work();
	} catch (error) {
		check(`${name} (threw)`, false, String(error instanceof Error ? error.message : error).slice(0, 600));
	}
}

async function shot(page: Page, name: string): Promise<void> {
	try {
		await page.screenshot({ path: join(SCREENS, `${name}.png`) });
	} catch {
		// A closed window has nothing to show.
	}
}

// ---------------------------------------------------------------- app helpers

const sha16 = (user: string) =>
	createHash("sha256").update(`afterstate-ffi/user/v1\0${user}`).digest("hex").slice(0, 32);

function storeFiles(run: Run): string[] {
	return existsSync(run.storeDir) ? readdirSync(run.storeDir).sort() : [];
}

/** Bytes of every file in the store folder contain `text` (UTF-8)? */
function storeContains(run: Run, text: string): boolean {
	const needle = Buffer.from(text, "utf8");
	return storeFiles(run).some((f) => readFileSync(join(run.storeDir, f)).includes(needle));
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function waitFor(what: string, test: () => boolean | Promise<boolean>, ms = 20_000): Promise<boolean> {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (await test()) return true;
		await new Promise((r) => setTimeout(r, 200));
	}
	note(`timed out waiting for ${what}`);
	return false;
}

async function chooseEnglish(page: Page): Promise<void> {
	const english = page.getByRole("button", { name: "English" });
	if (await english.isVisible().catch(() => false)) await english.click();
}

async function signUp(page: Page, api: string, label: string): Promise<{ id: string; email: string }> {
	const email = `desktop-${label}-${Date.now().toString(36)}@rowcat.test`;
	const result = await page.evaluate(
		async ({ api, email, name }) => {
			const up = await fetch(`${api}/v2/auth/sign-up/email`, {
				method: "POST",
				credentials: "include",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ email, password: "rowcat-e2e-pass", name }),
			});
			const me = await fetch(`${api}/v2/me`, { credentials: "include" });
			return { up: up.status, me: me.status, body: (await me.json()) as { id?: string; viewer?: { id?: string } } };
		},
		{ api, email, name: `Desktop ${label.toUpperCase()}` },
	);
	const id = result.body.id ?? result.body.viewer?.id ?? "";
	check(`sign-up ${label} (synthetic account on the local stack)`, result.up === 200 && result.me === 200 && id !== "", {
		up: result.up,
		me: result.me,
		email,
	});
	return { id, email };
}

function seedStory(run: Run): void {
	const s = JSON.parse(readFileSync(join(run.userData, "deployment", "settings.json"), "utf8")) as {
		ports: { database: number };
		databasePassword: string;
	};
	const out = execFileSync("pnpm", ["--filter", "@rowcat/api", "db:seed:e2e"], {
		cwd: REPO,
		env: {
			...process.env,
			DATABASE_URL: `postgres://rowcat:${s.databasePassword}@127.0.0.1:${s.ports.database}/rowcat`,
		},
		encoding: "utf8",
	});
	check("fixture story seeded into the app's own Postgres", out.includes("[seed-e2e] ready"));
}

async function connectMock(page: Page, web: string, mock: MockProvider): Promise<void> {
	await page.goto(`${web}/settings/ai`);
	const row = page.getByRole("main").getByRole("listitem").filter({ hasText: "OpenAI-compatible" });
	const dialog = page.getByRole("dialog");
	for (let i = 0; i < 40 && !(await dialog.isVisible()); i++) {
		await row.getByRole("button", { name: "Connect" }).click({ timeout: 2_000 }).catch(() => {});
		await page.waitForTimeout(300);
	}
	await dialog.getByRole("textbox", { name: "Server address" }).fill(`${mock.origin}/v1`);
	await dialog.getByRole("textbox", { name: "Models" }).fill(MOCK_MODEL);
	await dialog.getByRole("textbox", { name: "API key" }).fill("sk-dummy-local-mock");
	await dialog.getByRole("button", { name: "Connect", exact: true }).click();
	await dialog.waitFor({ state: "hidden", timeout: 15_000 });
	const main = page.getByRole("main");
	await main.getByRole("combobox", { name: /^Generation target Provider$/ }).click();
	await page.getByRole("option", { name: "OpenAI-compatible", exact: true }).click();
	const model = main.getByRole("combobox", { name: /^Generation target Model$/ });
	if (await model.isVisible().catch(() => false)) {
		const current = await model.textContent();
		if (!current?.includes(MOCK_MODEL)) {
			await model.click();
			await page.getByRole("option", { name: MOCK_MODEL, exact: true }).click();
		}
	}
	await shot(page, `${phase}-settings-ai`);
	check("mock provider connected (GET /v1/models probe reached the mock)", mock.calls.some((c) => c.path === "/v1/models"));
}

async function setBackend(page: Page, mode: "legacy" | "afterstate"): Promise<void> {
	await page.evaluate((m) => localStorage.setItem("rowcat.memoryBackend", m), mode);
	await page.reload();
	await page.waitForLoadState("domcontentloaded");
}

async function startChat(page: Page, web: string): Promise<string> {
	await page.goto(`${web}/stories/e2e-story-chat`);
	const start = page.getByRole("button", { name: "Start conversation" });
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline && !/\/chat\/[^/]+$/.test(page.url())) {
		await start.click({ timeout: 2_000 }).catch(() => {});
		await page.waitForURL(/\/chat\/[^/]+$/, { timeout: 3_000 }).catch(() => {});
	}
	const id = new URL(page.url()).pathname.split("/").pop() ?? "";
	await page.getByRole("textbox", { name: "Message" }).waitFor({ timeout: 30_000 });
	return id;
}

/** Sends one turn and waits for the mock's streamed reply to finish rendering. */
async function send(page: Page, mock: MockProvider, text: string): Promise<{ body: ChatBody; reply: string } | null> {
	const before = mock.calls.length;
	const composer = page.getByRole("textbox", { name: "Message" });
	await composer.click();
	await composer.fill(text);
	await composer.press("Enter");
	let found: { body: ChatBody; reply: string } | null = null;
	await waitFor(
		`the turn "${text.slice(0, 24)}" at the mock`,
		() => {
			const call = mock.calls
				.slice(before)
				.find((c) => (c.body as ChatBody)?.stream === true && lastUserText(c.body as ChatBody).endsWith(text));
			if (call) found = { body: call.body as ChatBody, reply: call.reply ?? "" };
			return found !== null;
		},
		30_000,
	);
	if (!found) return null;
	const reply = (found as { reply: string }).reply;
	try {
		// Generation over: the composer's Send button is back.
		await page.getByRole("button", { name: "Send" }).waitFor({ timeout: 30_000 });
		const jump = page.getByRole("button", { name: "Jump to latest" });
		if (await jump.isVisible().catch(() => false)) await jump.click().catch(() => {});
		await page.getByText(reply, { exact: false }).last().waitFor({ state: "attached", timeout: 30_000 });
	} catch (error) {
		await shot(page, `${phase}-send-failed-${Date.now()}`);
		throw error;
	}
	return found;
}

const requestText = (body: ChatBody | undefined) => JSON.stringify(body?.messages ?? []);
const hasRecall = (body: ChatBody | undefined) => lastUserText(body ?? {}).includes(RECALL_HEADER);

async function bridgeCall<T>(page: Page, member: string, op: string, params: object): Promise<T> {
	return page.evaluate(
		([m, o, p]) =>
			(window as unknown as { rowcatAfterstate: { call(a: string, b: string, c: object): Promise<unknown> } }).rowcatAfterstate.call(
				m as string,
				o as string,
				p as object,
			),
		[member, op, params] as const,
	) as Promise<T>;
}

async function recallTexts(page: Page, member: string, room: string, query: string): Promise<string[]> {
	const r = await bridgeCall<{ evidence: { text: string }[] }>(page, member, "recall", {
		conversation: room,
		query,
		visible: { story: true, ooc: true, notes: true },
	});
	return r.evidence.map((e) => e.text);
}

async function quit(app: ElectronApplication, run: Run, label: string): Promise<void> {
	const pid = app.process().pid ?? 0;
	const started = Date.now();
	await Promise.race([app.close(), new Promise((r) => setTimeout(r, 60_000))]);
	const exited = await waitFor("the app to exit", () => !alive(pid), 60_000);
	check(`${label}: app quit within 60 s`, exited, { ms: Date.now() - started });
	const orphans = await waitFor("bridge processes to end", () => bridgeProcesses(run).length === 0 && !impostorRunning(), 10_000);
	check(`${label}: no afterstate-bridge process left after quit`, orphans, { left: bridgeProcesses(run) });
}

function desktopLogFrom(offset: number): string {
	try {
		return readFileSync(DESKTOP_LOG).subarray(offset).toString("utf8");
	} catch {
		return "";
	}
}

// ---------------------------------------------------------------- the journey

const IMPOSTOR_WRONG_PROTOCOL = `#!/bin/sh
# An outdated engine: answers every JSON line with ok and a protocol this app does not speak.
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\\([0-9]*\\).*/\\1/p')
  printf '{"id":%s,"ok":true,"result":{"protocol":"afterstate-bridge/0","opened":true}}\\n' "\${id:-0}"
done
`;
const IMPOSTOR_SILENT = `#!/bin/sh
# An engine that starts and never answers (wrong binary, hung startup).
exec sleep 3599
`;
const impostorRunning = (): boolean => {
	try {
		execFileSync("pgrep", ["-f", "sleep 3599"]);
		return true;
	} catch {
		return false;
	}
};

async function main(): Promise<void> {
	if (!existsSync(BRIDGE)) throw new Error(`no bridge at ${BRIDGE}`);
	if (!existsSync(join(DESKTOP, ".stage", "resources", "web"))) throw new Error("stage the app first");
	rmSync(RUN_ROOT, { recursive: true, force: true });
	mkdirSync(SCREENS, { recursive: true });
	writeFileSync(journal, "");
	const logOffset = existsSync(DESKTOP_LOG) ? statSync(DESKTOP_LOG).size : 0;
	const mock = await startMockProvider(join(EVIDENCE, "mock-requests.jsonl"));
	writeFileSync(join(EVIDENCE, "mock-requests.jsonl"), "");
	note(`bridge ${BRIDGE} sha256 ${createHash("sha256").update(readFileSync(BRIDGE)).digest("hex")}`);
	note(`mock provider ${mock.origin}`);

	const real: BridgeKind = { kind: "real", path: BRIDGE };
	const run = prepareRun(RUN_ROOT, real);
	const listenBefore = listeners();
	writeFileSync(join(EVIDENCE, "listeners-before.txt"), `${listenBefore.join("\n")}\n`);

	// ------------------------------------------------ 1. startup, accounts, provider
	phase = "1-startup";
	const t0 = Date.now();
	let { app, page } = await launch(run);
	const o = origins(run);
	check("app started and the window shows the web origin", page.url().startsWith(o.web), { ms: Date.now() - t0, url: page.url() });
	page.on("console", (m) => {
		if (m.type() === "error" || m.type() === "warning") appendFileSync(join(EVIDENCE, "renderer-console.log"), `[${phase}] ${m.type()} ${m.text()}\n`);
	});
	check("preload exposes rowcatAfterstate with the bridge protocol", (await page.evaluate(() => (window as unknown as { rowcatAfterstate?: { protocol: string } }).rowcatAfterstate?.protocol)) === PROTOCOL);
	check("no engine process before any member opens a conversation", bridgeProcesses(run).length === 0, bridgeProcesses(run));
	await chooseEnglish(page);
	seedStory(run);
	const a = await signUp(page, o.api, "a");
	await connectMock(page, o.web, mock);
	await setBackend(page, "afterstate");
	const listenAppUp = listeners();
	writeFileSync(join(EVIDENCE, "listeners-app-up-no-engine.txt"), `${listenAppUp.join("\n")}\n`);

	// ------------------------------------------------ 2. a room, Korean turns, recall beyond the window
	phase = "2-recall";
	const roomA = await startChat(page, o.web);
	note(`member A ${a.id}, room A ${roomA}`);
	await waitFor("member A's engine", () => bridgeProcesses(run).length === 1);
	const mainPid = app.process().pid ?? 0;
	const firstBridges = bridgeProcesses(run);
	check("one engine child process for member A, parented by the Electron main process", firstBridges.length === 1 && firstBridges[0]?.ppid === mainPid, { firstBridges, mainPid });
	const expectedA = `afterstate-${sha16(a.id)}.db`;
	await waitFor("A's store file", () => storeFiles(run).includes(expectedA));
	check("account-scoped index file under <userData>/afterstate, named from the member id", storeFiles(run).includes(expectedA), { dir: run.storeDir, files: storeFiles(run), expected: expectedA });
	const bridgeSockets = firstBridges.map((b) => socketsOf(b.pid));
	check("the engine process holds no socket at all", bridgeSockets.every((s) => s === ""), bridgeSockets);

	const t1 = await send(page, mock, "안녕, 카이. 내 고양이 이름은 보리차야. 꼭 기억해 줘.");
	check("first Korean turn generated through the mock (streamed reply rendered)", t1 !== null && !hasRecall(t1.body), t1?.reply);
	const t2 = await send(page, mock, "카이, 너는 열쇠를 어디에 숨겼어?");
	check("scripted reply with the fact rendered", t2?.reply.includes("빨간 우체통") === true, t2?.reply);
	await shot(page, "2-first-turns");
	const FILLERS = 29;
	for (let i = 1; i <= FILLERS; i++) {
		const t = await send(page, mock, `잡담 ${i}번: 오늘은 바람이 조금 불고 하늘이 맑다.`);
		if (!t) {
			check(`filler turn ${i}`, false);
			break;
		}
	}
	const q1 = await send(page, mock, "내 고양이 이름이 뭐였는지 기억나니?");
	const q1Messages = q1?.body.messages ?? [];
	check(
		"the cat-name turn is outside the history window sent with this turn",
		!q1Messages.slice(0, -1).some((m) => typeof m.content === "string" && m.content.includes("보리차")),
		{ messagesSent: q1Messages.length },
	);
	check("recall block is in the last user turn and carries the early Korean fact", hasRecall(q1?.body) && lastUserText(q1?.body ?? {}).includes("보리차"), lastUserText(q1?.body ?? {}).slice(0, 700));
	const q2 = await send(page, mock, "카이가 열쇠를 숨긴 장소가 어디였지?");
	check("recall carries the character's early line (빨간 우체통)", hasRecall(q2?.body) && lastUserText(q2?.body ?? {}).includes("빨간 우체통"), lastUserText(q2?.body ?? {}).slice(0, 700));
	await shot(page, "2-recall-turn");

	// ------------------------------------------------ 3. correction: edit the early reply
	phase = "3-correction";
	await attempt("edit the early assistant reply", async () => {
		const target = page.getByText("열쇠는 등대 옆 빨간 우체통 안에 숨겨 두었어.");
		// The list is virtual (only rows on screen exist): scroll to the top and load older rows.
		const list = page.locator("div.overflow-y-auto").filter({ has: page.locator("[data-index]") }).first();
		for (let i = 0; i < 80 && (await target.count()) === 0; i++) {
			const older = page.getByRole("button", { name: "Load earlier messages" });
			if (await older.isVisible().catch(() => false)) await older.click().catch(() => {});
			await list.evaluate((el) => {
				el.scrollTop = 0;
			});
			await page.waitForTimeout(200);
		}
		const row = page.locator("[data-index]").filter({ has: target });
		await row.scrollIntoViewIfNeeded();
		await row.hover();
		await row.getByRole("button", { name: "Edit message" }).click();
		const editor = page.getByRole("textbox", { name: "Message content" });
		await editor.fill("열쇠는 정원의 파란 화분 밑에 숨겨 두었어.");
		// The product's edit rule: saving an earlier message deletes every message after it.
		const notice = await page.getByText(/Saving deletes the \d+ messages after this one/).textContent().catch(() => null);
		note(`edit dialog says: ${notice}`);
		await shot(page, "3-edit-dialog");
		await page.getByRole("button", { name: "Save" }).click();
		await page.getByText("열쇠는 정원의 파란 화분 밑에 숨겨 두었어.").waitFor({ timeout: 10_000 });
		check("assistant reply edited in place", true);
	});
	// The edit cut the room back to four messages; grow it past the window again, in new words.
	for (let i = 1; i <= FILLERS; i++) {
		const t = await send(page, mock, `산책 ${i}번: 저녁에는 강가를 따라 천천히 걸었다.`);
		if (!t) {
			check(`post-edit filler turn ${i}`, false);
			break;
		}
	}
	await page.waitForTimeout(1_000);
	const truncated = await recallTexts(page, a.id, roomA, "잡담 바람 하늘 맑다");
	check("the 62 messages the edit deleted are gone from the index", truncated.length === 0, truncated);
	const q3 = await send(page, mock, "카이가 열쇠를 숨긴 장소가 어디였는지 다시 알려 줘.");
	check("after the edit the recall block carries the corrected text", hasRecall(q3?.body) && lastUserText(q3?.body ?? {}).includes("파란 화분"), lastUserText(q3?.body ?? {}).slice(0, 700));
	check("after the edit no part of the request carries the old text", q3 !== null && !requestText(q3?.body).includes("빨간 우체통"));
	await page.waitForTimeout(1_500);
	const afterEdit = await recallTexts(page, a.id, roomA, "열쇠 숨긴 장소 우체통 화분");
	check("engine recall after reconcile: corrected passage present, old passage gone", afterEdit.some((t) => t.includes("파란 화분")) && !afterEdit.some((t) => t.includes("빨간 우체통")), afterEdit);
	await bridgeCall(page, a.id, "checkpoint", {});
	check("old text erased from the store files (after a WAL checkpoint)", !storeContains(run, "빨간 우체통"), { files: storeFiles(run) });
	check("corrected text present in the store files", storeContains(run, "파란 화분"));

	// ------------------------------------------------ 4. room deletion erases its index
	phase = "4-room-deletion";
	const roomDel = await startChat(page, o.web);
	note(`room to delete ${roomDel}`);
	await send(page, mock, "이 방의 비밀 단어는 무지개송어다. 삭제 시험용 문장이야.");
	await send(page, mock, "두 번째 문장도 무지개송어 이야기다.");
	await page.waitForTimeout(1_500);
	const beforeDelete = await recallTexts(page, a.id, roomDel, "무지개송어 비밀 단어");
	check("room to delete is indexed (engine recall finds its words)", beforeDelete.length > 0, beforeDelete.length);
	await attempt("delete the room from the conversation library", async () => {
		await page.goto(`${o.web}/chats`);
		const item = page.getByRole("main").getByRole("listitem").filter({ has: page.locator(`a[href="/chat/${roomDel}"]`) });
		await item.waitFor({ timeout: 15_000 });
		await item.hover();
		await item.getByRole("button", { name: /^Manage conversation/ }).click({ force: true });
		await page.getByRole("menuitem", { name: "Delete conversation" }).click();
		await page.getByRole("button", { name: "Delete", exact: true }).click();
		await page.waitForTimeout(1_500);
	});
	await shot(page, "4-after-delete");
	const afterDelete = await recallTexts(page, a.id, roomDel, "무지개송어 비밀 단어");
	check("deleted room: engine recall finds nothing", afterDelete.length === 0, afterDelete);
	const otherRoom = await recallTexts(page, a.id, roomA, "고양이 이름 보리차");
	check("the other room's index is untouched", otherRoom.some((t) => t.includes("보리차")), otherRoom.length);
	await bridgeCall(page, a.id, "checkpoint", {});
	check("deleted room's words are gone from the store files", !storeContains(run, "무지개송어"));
	check("the edit-deleted messages' words are gone from the store files", !storeContains(run, "잡담 7번"));

	// ------------------------------------------------ 5. legacy ↔ afterstate
	phase = "5-backend-switch";
	await page.goto(`${o.web}/chat/${roomA}`);
	await setBackend(page, "legacy");
	const legacy = await send(page, mock, "레거시 모드에서 내 고양이 이름이 뭐였는지 기억나니?");
	check("legacy: request has no recall block", legacy !== null && !hasRecall(legacy.body) && !requestText(legacy.body).includes(RECALL_HEADER));
	await setBackend(page, "afterstate");
	const back = await send(page, mock, "다시 afterstate 모드에서 내 고양이 이름이 뭐였는지 기억나니?");
	check("afterstate again: recall block back with the fact", hasRecall(back?.body) && lastUserText(back?.body ?? {}).includes("보리차"));

	// ------------------------------------------------ 6. second member: one engine per member
	phase = "6-second-member";
	await attempt("sign out member A", async () => {
		await page.getByRole("button", { name: /account menu$/ }).click();
		await page.getByRole("menuitem", { name: "Sign out" }).click();
		await page.waitForTimeout(1_500);
	});
	const b = await signUp(page, o.api, "b");
	await connectMock(page, o.web, mock);
	await setBackend(page, "afterstate");
	const roomB = await startChat(page, o.web);
	note(`member B ${b.id}, room B ${roomB}`);
	await send(page, mock, "B의 기록: 우리 집 강아지 이름은 호두과자다.");
	await waitFor("member B's engine", () => bridgeProcesses(run).length === 2);
	const two = bridgeProcesses(run);
	check("two engine processes, one per member, both children of the main process", two.length === 2 && two.every((p) => p.ppid === mainPid), two);
	check("two store files, one per member", storeFiles(run).filter((f) => f.endsWith(".db")).length === 2 && storeFiles(run).includes(`afterstate-${sha16(b.id)}.db`), storeFiles(run));
	const bSeesA = await recallTexts(page, b.id, roomA, "고양이 이름 보리차");
	check("member B's store does not hold member A's room", bSeesA.length === 0);
	const listenDuring = listeners();
	writeFileSync(join(EVIDENCE, "listeners-during.txt"), `${listenDuring.join("\n")}\n`);
	const bridgePids = new Set(two.map((p) => String(p.pid)));
	check(
		"no listening TCP port belongs to an engine process",
		listenDuring.every((l) => !bridgePids.has(l.split(" ")[1] ?? "")),
		{ newSinceBeforeLaunch: listenDuring.filter((l) => !listenBefore.includes(l)) },
	);
	check(
		"starting two engines opened no listening port (app up, no engine → two engines)",
		listenDuring.filter((l) => !listenAppUp.includes(l)).length === 0,
		{ appeared: listenDuring.filter((l) => !listenAppUp.includes(l)), gone: listenAppUp.filter((l) => !listenDuring.includes(l)) },
	);
	appPids = new Set(listenDuring.filter((l) => !listenBefore.includes(l)).map((l) => Number(l.split(" ")[1])));

	// ------------------------------------------------ 7. engine killed mid-session
	phase = "7-engine-killed";
	const bBridge = two.find((p) => !firstBridges.some((f) => f.pid === p.pid));
	if (bBridge) {
		process.kill(bBridge.pid, "SIGKILL");
		await waitFor("the killed engine to go", () => !alive(bBridge.pid));
		note(`killed member B's engine ${bBridge.pid}`);
	}
	const afterKill = await send(page, mock, "엔진이 죽은 뒤에도 대화가 이어지는지 확인하는 문장이다.");
	check("turn after the engine was killed still generates", afterKill !== null);
	note(`recall block in that turn: ${hasRecall(afterKill?.body)}`);
	check("main process still alive", alive(mainPid));
	const afterKill2 = await send(page, mock, "B의 강아지 이름이 뭐였는지 다시 말해 볼래?");
	check("a second turn after the kill also generates", afterKill2 !== null);
	note(`engine processes after the kill: ${JSON.stringify(bridgeProcesses(run))}`);
	check(
		"the killed member's engine is started again on the next call (recovery)",
		bridgeProcesses(run).length === 2,
		bridgeProcesses(run),
	);
	await shot(page, "7-after-kill");

	// ------------------------------------------------ 8. quit, restart, index reopens
	phase = "8-quit-restart";
	const statusB = await bridgeCall<{ memories: { active: number } }>(page, b.id, "status", {}).catch(() => null);
	await quit(app, run, "quit");
	check("old text still absent after the closing checkpoint", !storeContains(run, "빨간 우체통"));
	({ app, page } = await launch(run));
	page.on("console", (m) => {
		if (m.type() === "error" || m.type() === "warning") appendFileSync(join(EVIDENCE, "renderer-console.log"), `[${phase}] ${m.type()} ${m.text()}\n`);
	});
	check("app restarted on the same data folder", page.url().startsWith(o.web));
	const cold = Date.now();
	const reopenedA = await recallTexts(page, a.id, roomA, "고양이 이름 보리차");
	note(`first engine call after restart (spawn + handshake + recall) took ${Date.now() - cold} ms; the turn's recall budget is 400 ms`);
	check("member A's index reopened from its file (recall finds the early fact)", reopenedA.some((t) => t.includes("보리차")), reopenedA.length);
	const reStatusB = await bridgeCall<{ memories: { active: number } }>(page, b.id, "status", {}).catch(() => null);
	check("member B's index reopened with its memories", reStatusB !== null && reStatusB.memories.active > 0, { before: statusB?.memories, after: reStatusB?.memories });
	const signedIn = await page.evaluate(
		async ({ api, email }) =>
			(
				await fetch(`${api}/v2/auth/sign-in/email`, {
					method: "POST",
					credentials: "include",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ email, password: "rowcat-e2e-pass" }),
				})
			).status,
		{ api: o.api, email: a.email },
	);
	check("member A signs back in", signedIn === 200, signedIn);
	await page.goto(`${o.web}/chat/${roomA}`);
	await page.getByRole("textbox", { name: "Message" }).waitFor({ timeout: 30_000 });
	const afterRestart = await send(page, mock, "재시작한 뒤에도 내 고양이 이름이 뭐였는지 기억나니?");
	check("after restart a turn recalls through the reopened index", hasRecall(afterRestart?.body) && lastUserText(afterRestart?.body ?? {}).includes("보리차"), lastUserText(afterRestart?.body ?? {}).slice(0, 500));
	check("…and the corrected passage, never the old one", !requestText(afterRestart?.body).includes("빨간 우체통"));
	await quit(app, run, "quit after restart");

	// ------------------------------------------------ 9. engine missing
	phase = "9-engine-missing";
	setBridge(run, { kind: "missing" });
	({ app, page } = await launch(run));
	check("app starts without the engine", page.url().startsWith(o.web));
	await page.goto(`${o.web}/chat/${roomA}`);
	await page.getByRole("textbox", { name: "Message" }).waitFor({ timeout: 30_000 });
	const missing = await send(page, mock, "엔진 파일이 없을 때 내 고양이 이름이 뭐였는지 기억나니?");
	check("turn generates without the engine (V2 fallback)", missing !== null);
	check("…with no recall block", missing !== null && !hasRecall(missing.body));
	check("no engine process", bridgeProcesses(run).length === 0);
	await shot(page, "9-missing");
	await quit(app, run, "quit (engine missing)");

	// ------------------------------------------------ 10. impostor engines
	for (const [label, source, executable] of [
		["wrong-protocol", IMPOSTOR_WRONG_PROTOCOL, true],
		["silent", IMPOSTOR_SILENT, true],
		["not-executable", IMPOSTOR_SILENT, false],
	] as const) {
		phase = `10-impostor-${label}`;
		setBridge(run, { kind: "script", source, executable });
		({ app, page } = await launch(run));
		check("app starts with the impostor engine", page.url().startsWith(o.web));
		await page.goto(`${o.web}/chat/${roomA}`);
		await page.getByRole("textbox", { name: "Message" }).waitFor({ timeout: 30_000 });
		const t = await send(page, mock, `가짜 엔진(${label})일 때도 내 고양이 이름이 뭐였는지 기억나니?`);
		check("turn generates (controlled fallback)", t !== null);
		check("…with no recall block", t !== null && !hasRecall(t.body));
		const status = await Promise.race([
			bridgeCall(page, a.id, "status", {}).then(
				(r) => ({ settled: "resolved", r }),
				(e: Error) => ({ settled: "rejected", r: e.message }),
			),
			new Promise((r) => setTimeout(() => r({ settled: "pending after 15 s" }), 15_000)),
		]);
		note(`status through the impostor: ${JSON.stringify(status)}`);
		check("the host refuses an engine that does not speak afterstate-bridge/1", (status as { settled: string }).settled === "rejected", status);
		check("main process alive", alive(app.process().pid ?? 0));
		check("no impostor process left running after the refusal", bridgeProcesses(run).length === 0 && !impostorRunning(), bridgeProcesses(run));
		await shot(page, `10-${label}`);
		await quit(app, run, `quit (impostor ${label})`);
	}
	setBridge(run, real);

	// ------------------------------------------------ wrap up
	phase = "wrap-up";
	const listenAfter = listeners();
	writeFileSync(join(EVIDENCE, "listeners-after.txt"), `${listenAfter.join("\n")}\n`);
	check(
		"every process that listened during the run (app, API, web, Postgres) is gone",
		[...appPids].every((pid) => !alive(pid)),
		{ pids: [...appPids], stillListening: listenAfter.filter((l) => appPids.has(Number(l.split(" ")[1]))) },
	);
	await mock.close();
	writeFileSync(join(EVIDENCE, "desktop-main.log"), desktopLogFrom(logOffset));
	writeFileSync(join(EVIDENCE, "store-files.txt"), `${storeFiles(run).map((f) => `${f} ${statSync(join(run.storeDir, f)).size}`).join("\n")}\n`);
	note(`main process children were: ${JSON.stringify(childrenOf(mainPid))}`);
}

main()
	.catch((error) => {
		check("journey aborted", false, String(error instanceof Error ? error.stack : error).slice(0, 2000));
	})
	.finally(() => {
		const failed = checks.filter((c) => !c.ok);
		writeFileSync(join(EVIDENCE, "results.json"), JSON.stringify({ passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));
		note(`${checks.length - failed.length} passed, ${failed.length} failed`);
		process.exit(failed.length > 0 ? 1 : 0);
	});
