/** Real staged Electron + embedded Postgres/API/web + Node WASM worker. All
 * inference uses the local mock; synthetic data lives only in the harness directory.
 * Run after `pnpm --filter @rowcat/desktop stage`; this is not an installed-app test. */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import { DESKTOP, STAGE, launch, origins, prepareRun, childrenOf, type Run } from "./harness.ts";
import { type ChatBody, lastUserText, MOCK_MODEL, type MockProvider, startMockProvider } from "./mock-openai.ts";
const REPO=resolve(DESKTOP,"../..");
const EVIDENCE=resolve(process.env.E2E_EVIDENCE_DIR??join(DESKTOP,".e2e-evidence"));
const RUN_ROOT=resolve(process.env.E2E_RUN_DIR??join(EVIDENCE,"run"));
const SCREENS=join(EVIDENCE,"screenshots");
const PROTOCOL="afterstate-bridge/1";
const RECALL_HEADER="[다시 찾은 지난 장면";
interface Check {phase:string;name:string;ok:boolean;detail?:unknown}
const checks:Check[]=[];let phase="setup";
const journal=join(EVIDENCE,"journey.log");
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



function storeFiles(run: Run): string[] {
	return existsSync(run.storeDir) ? readdirSync(run.storeDir).sort() : [];
}

/** Bytes of every file in the store folder contain `text` (UTF-8)? */
function storeContains(run: Run, text: string): boolean {
	const needle = Buffer.from(text, "utf8");
	return storeFiles(run).some((f) => readFileSync(join(run.storeDir, f)).includes(needle));
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
    const language=page.getByRole("dialog").filter({has:page.getByRole("button",{name:"English",exact:true})});
    if (!await language.waitFor({state:"visible",timeout:5000}).then(()=>true,()=>false)) return;
    await language.getByRole("button",{name:"English",exact:true}).click();
    const closed=await language.waitFor({state:"hidden",timeout:2000}).then(()=>true,()=>false);
    if(!closed && await language.isVisible()) await language.getByRole("button",{name:"Close",exact:true}).click({force:true,timeout:2000}).catch(()=>{});
    await language.waitFor({state:"hidden",timeout:5000});
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
	const out = execFileSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["--filter", "@rowcat/api", "db:seed:e2e"], {
        shell: process.platform === "win32",
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
	await chooseEnglish(page);
	const row = page.getByRole("main").getByRole("listitem").filter({ hasText: "OpenAI-compatible" });
	const dialog = page.getByRole("dialog").filter({has:page.getByRole("textbox",{name:"Server address",exact:true})});
	for (let i = 0; i < 40 && !(await dialog.isVisible()); i++) {
		await row.getByRole("button", { name: "Connect" }).click({ timeout: 2_000 }).catch(() => {});
		await page.waitForTimeout(300);
	}
	writeFileSync(join(EVIDENCE, "provider-dialog.txt"), await dialog.innerText());
	await shot(page,"provider-dialog");
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

/**
 * Plants the retired rollout switch (`rowcat.memoryBackend`) the way an older build left it. Since
 * Phase 13 afterstate is the only engine: the value is never read, and the app removes it.
 */
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

async function quit(app: ElectronApplication): Promise<void> {
    await app.close();
}
async function main(): Promise<void> {
    mkdirSync(SCREENS,{recursive:true});writeFileSync(journal,"");
    if(existsSync(RUN_ROOT)) throw new Error("Use a fresh E2E_RUN_DIR to preserve existing evidence");
    const mock=await startMockProvider(join(EVIDENCE,"mock-requests.jsonl"));
    const run=prepareRun(RUN_ROOT,{kind:"wasm",path:resolve(process.env.AFTERSTATE_WASM_DIR??join(STAGE,"afterstate"))});
    let running:ElectronApplication|undefined;
    try {
        phase="startup";const startup=Date.now();let {app,page}=await launch(run);running=app;
        const o=origins(run);check("first launch initializes Postgres/API/web",page.url().startsWith(o.web),{ms:Date.now()-startup});
        check("preload exposes the protocol",await page.evaluate(()=> (window as unknown as {rowcatAfterstate:{protocol:string}}).rowcatAfterstate.protocol)===PROTOCOL);
        await chooseEnglish(page);seedStory(run);
        const a=await signUp(page,o.api,"a");await connectMock(page,o.web,mock);
        const roomA=await startChat(page,o.web);
        phase="ipc-overhead";
        const latencies:number[]=[];
        for(let i=0;i<30;i++){const started=performance.now();await bridgeCall(page,a.id,"status",{});latencies.push(performance.now()-started);}
        const sorted=latencies.toSorted((a,b)=>a-b);
        writeFileSync(join(EVIDENCE,"ipc-latency.json"),JSON.stringify({requests:latencies.length,p50Ms:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)],includes:"renderer IPC + authenticated member check + worker status"},null,2));
        phase="memory";
        const first=await send(page,mock,"안녕, 카이. 내 고양이 이름은 보리차야. 꼭 기억해 줘.");check("new conversation generates using local mock",!!first);
        await send(page,mock,"카이, 너는 열쇠를 어디에 숨겼어?");
        for(let i=1;i<=29;i++) if(!await send(page,mock,`잡담 ${i}번: 오늘은 바람이 조금 불고 하늘이 맑다.`)) throw new Error("filler generation failed");
        const q=await send(page,mock,"내 고양이 이름이 뭐였는지 기억나니?");
        check("old event recalled automatically beyond the recent window",hasRecall(q?.body)&&lastUserText(q?.body??{}).includes("보리차"));
        check("no native afterstate executable process",childrenOf(app.process().pid??0).every(p=>!p.command.includes("afterstate-bridge")));
        await bridgeCall(page,a.id,"checkpoint",{});
        check("only ciphertext/key files persist",storeFiles(run).length>0&&storeFiles(run).every(f=>/\.(index|key)$/.test(f)));
        check("private message text absent from derived files",!storeContains(run,"보리차"));
        let refused=false;try {await bridgeCall(page,"different-member","status",{});}catch{refused=true;}check("authenticated member boundary rejects another member",refused);
        phase="edit";
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

        await page.waitForTimeout(1000);
        check("edited original is absent from engine recall",!(await recallTexts(page,a.id,roomA,"빨간 우체통")).some(t=>t.includes("빨간 우체통")));
        await send(page,mock,"카이, 바뀐 열쇠 위치를 기억해 줘.");
        await bridgeCall(page,a.id,"checkpoint",{});
        phase="api-recovery";
        const apiChild=childrenOf(app.process().pid??0).find(p=>/[\\/]api[\\/]dist[\\/]index\.mjs/.test(p.command));
        check("API child identified in this isolated run",!!apiChild);
        if(apiChild){process.kill(apiChild.pid,"SIGKILL");check("API restarts after a crash",await waitFor("API restart",async()=>page.evaluate(async({api,id})=>{try{const r=await fetch(`${api}/v2/me`,{credentials:"include"});return r.ok&&(await r.json()).id===id;}catch{return false;}},{api:o.api,id:a.id}),30000));
          check("memory remains available after API restart",(await bridgeCall<{protocol:string}>(page,a.id,"status",{})).protocol===PROTOCOL);}
        phase="restart";await quit(app);running=undefined;
        ({app,page}=await launch(run));running=app;
        await page.goto(`${o.web}/chat/${roomA}`);await page.getByRole("textbox",{name:"Message"}).waitFor({timeout:30000});
        check("restart reconciles without restoring edited material",await waitFor("live manifests after restart",async()=>{try{return !(await recallTexts(page,a.id,roomA,"빨간 우체통")).some(t=>t.includes("빨간 우체통"));}catch{return false;}}));
        const corrected=await recallTexts(page,a.id,roomA,"파란 화분");check("restart retains exact corrected evidence",corrected.some(t=>t.includes("파란 화분")));
        phase="deletion";
        await page.goto(`${o.web}/chats`);
        const row=page.getByRole("main").getByRole("listitem").filter({has:page.locator(`a[href="/chat/${roomA}"]`)});
        await row.hover();await row.getByRole("button",{name:/^Manage conversation/}).click({force:true});
        await page.getByRole("menuitem",{name:"Delete conversation"}).click();await page.getByRole("button",{name:"Delete",exact:true}).click();
        await page.waitForTimeout(700);
        let erased=false;try{erased=(await recallTexts(page,a.id,roomA,"파란 화분")).length===0;}catch{erased=true;}
        check("deleted room cannot supply memory",erased);
        await bridgeCall(page,a.id,"checkpoint",{});check("deleted material is absent from disk",!storeContains(run,"파란 화분"));
        phase="unclean-restart";
        const exited=new Promise<void>(resolve=>app.process().once("exit",()=>resolve()));
        app.process().kill("SIGKILL");await exited;running=undefined;
        ({app,page}=await launch(run));running=app;
        check("unclean exit recovers local stack",page.url().startsWith(o.web));
        await page.goto(`${o.web}/chats`);
        check("deleted room stays absent after unclean restart",await page.locator(`a[href="/chat/${roomA}"]`).count()===0);
        await shot(page,"complete");await quit(app);running=undefined;
    } catch (error) {
        if(running) { const pages=running.windows(); if(pages[0]) { await shot(pages[0],"failure"); writeFileSync(join(EVIDENCE,"failure-dom.txt"),await pages[0].locator("body").innerText().catch(()=>"closed")); } }
        throw error;
    } finally { if(running)await running.close().catch(()=>{});await mock.close(); }
}
main().catch(error=>check("journey aborted",false,String(error instanceof Error?error.stack:error).slice(0,1500))).finally(()=>{
 const failed=checks.filter(c=>!c.ok);writeFileSync(join(EVIDENCE,"results.json"),JSON.stringify({passed:checks.length-failed.length,failed:failed.length,checks},null,2));process.exitCode=failed.length?1:0;
});
