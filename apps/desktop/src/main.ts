import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { APP_NAME } from "@rowcat/domain";
import {
	app,
	BrowserWindow,
	dialog,
	Menu,
	type MenuItemConstructorOptions,
	shell,
} from "electron";
import { PortsBusyError, type RunningStack, startStack } from "./stack.ts";
import { createUpdater, type DesktopUpdater } from "./updater.ts";

/**
 * The desktop shell: start the deployment on this computer, show it in a window, stop it on quit.
 *
 * **The window is the product's own web app, loaded from `localhost`.** Nothing is drawn here but a
 * waiting screen and the menu — conversations, settings and the console are the same pages the
 * browser serves. A second UI in this file would be a fourth client to keep in step.
 *
 * **It is shown in Electron's Chromium, not the default browser**, for one concrete reason: the API
 * runs as production, so its session cookie is `Secure`, and Chromium stores `Secure` cookies on
 * `http://localhost` while Safari does not reliably — a Mac whose default browser is Safari would
 * never stay signed in. `기본 브라우저에서 열기` stays in the menu for people who prefer theirs.
 *
 * Copy here is Korean because the people this installer is for read Korean; the product's own pages
 * follow its language setting.
 */

/**
 * The folder name is the product's, not the package's: Electron otherwise names it after
 * `package.json` (`@rowcat/desktop`). A development run gets its own folder, so `pnpm dev` never opens
 * — or holds the single-instance lock and ports of — the copy installed on the same computer.
 */
const appFolder = app.isPackaged ? APP_NAME : `${APP_NAME} Dev`;
app.setName(appFolder);
app.setPath("userData", join(app.getPath("appData"), appFolder));
app.setAppLogsPath();

const dataDir = join(app.getPath("userData"), "deployment");
const logFile = join(app.getPath("logs"), "rowcat.log");

let stack: RunningStack | null = null;
let mainWindow: BrowserWindow | null = null;
let updater: DesktopUpdater | null = null;
/** Set once the servers start stopping — by a quit, or by installing an update. Never cleared. */
let stopping = false;
/**
 * Set once that stop has finished. Between the two, every further quit is held: a second quit (the
 * window closed while 「설치하고 있습니다」 shows, 종료, a SIGTERM) would otherwise run to `quit`, and
 * that is where a downloaded update spawns its installer — which force-kills the Postgres still
 * shutting down.
 */
let stopped = false;

function log(source: string, line: string): void {
	// Lines can carry the setup code; this file sits in the user's own log folder, which is the
	// same audience the API's log addresses (`apps/api/src/services/setup/announce.ts`).
	try {
		appendFileSync(
			logFile,
			`${new Date().toISOString()} [${source}] ${line}\n`,
		);
	} catch {
		// A full disk must not stop the app.
	}
}

/** Built resources sit beside the app in a package, and in the repository during `pnpm desktop:dev`. */
function artifacts() {
	const root = app.isPackaged
		? process.resourcesPath
		: join(app.getAppPath(), ".stage", "resources");
	return {
		apiDir: join(root, "api"),
		webServerEntry: join(root, "web", "server", "index.mjs"),
		consoleDistDir: join(root, "console"),
		// Electron is the Node runtime for the two servers — no second Node ships with the app.
		node: {
			command: process.execPath,
			env: { ELECTRON_RUN_AS_NODE: "1" },
		},
	};
}

/** A page drawn while there is no server to show — starting up, or installing a new version. */
function statusPage(message: string): string {
	return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="ko"><meta charset="utf-8"><title>RowCat</title>
<style>
:root{color-scheme:light dark}
body{margin:0;height:100vh;display:grid;place-items:center;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;background:Canvas;color:CanvasText}
p{margin:0;opacity:.7}
</style>
<body><main><h1 style="font-size:20px;margin:0 0 6px">RowCat</h1><p>${message}</p></main></body></html>`)}`;
}

const WAITING_PAGE = statusPage(
	"준비하고 있습니다… 처음에는 1분쯤 걸릴 수 있습니다.",
);
const CHECKING_PAGE = statusPage(
	"시작하지 못했습니다. 새 버전이 있는지 확인하고 있습니다…",
);
const UPDATING_PAGE = statusPage(
	"새 버전을 설치하고 있습니다… 끝나면 RowCat이 다시 열립니다.",
);

function isLocal(url: string): boolean {
	try {
		return new URL(url).hostname === "localhost";
	} catch {
		return false;
	}
}

function createWindow(): BrowserWindow {
	const window = new BrowserWindow({
		width: 1280,
		height: 860,
		minWidth: 900,
		minHeight: 600,
		title: APP_NAME,
		webPreferences: { contextIsolation: true, sandbox: true },
	});
	// Pages on this computer open here; everything else (provider key pages, docs) in the browser.
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (isLocal(url)) return { action: "allow" };
		void shell.openExternal(url);
		return { action: "deny" };
	});
	window.webContents.on("will-navigate", (event, url) => {
		if (isLocal(url) || url.startsWith("data:")) return;
		event.preventDefault();
		void shell.openExternal(url);
	});
	window.on("closed", () => {
		if (mainWindow === window) mainWindow = null;
	});
	return window;
}

function openWindow(url: string): void {
	if (!mainWindow) mainWindow = createWindow();
	void mainWindow.loadURL(url);
	mainWindow.show();
}

/** Asks the API rather than remembering the log line: setup closes the moment someone claims it. */
async function setupOpen(running: RunningStack): Promise<boolean> {
	try {
		const response = await fetch(`${running.origins.api}/v2/setup`);
		return ((await response.json()) as { open?: boolean }).open === true;
	} catch {
		return false;
	}
}

async function showSetupCode(running: RunningStack): Promise<void> {
	const code = running.setupCode();
	if (!code || !(await setupOpen(running))) {
		await dialog.showMessageBox({
			type: "info",
			message: "관리자가 이미 정해졌습니다",
			detail:
				"이 컴퓨터의 RowCat에는 관리자 계정이 있습니다. 운영 콘솔에서 그 계정으로 로그인하세요.",
		});
		return;
	}
	const options: Electron.MessageBoxOptions = {
		type: "info",
		buttons: ["운영 콘솔 열기", "닫기"],
		defaultId: 0,
		cancelId: 1,
		message: `관리자 설정 코드: ${code}`,
		detail:
			"운영 콘솔에서 계정을 만들거나 로그인한 뒤 이 코드를 입력하면 그 계정이 이 컴퓨터의 RowCat 관리자가 됩니다. 코드는 한 번만 쓸 수 있습니다.\n\n관리자는 꼭 필요하지 않습니다. 혼자 쓰신다면 나중에 해도 됩니다.",
	};
	const { response } = mainWindow
		? await dialog.showMessageBox(mainWindow, options)
		: await dialog.showMessageBox(options);
	if (response === 0) openWindow(`${running.origins.console}/setup`);
}

/** The menu's part for the installed release: its date, and what the updater can do now. */
function updateMenu(): MenuItemConstructorOptions[] {
	if (!updater) return [];
	const date = updater.installedDate();
	const state = updater.state();
	const version: MenuItemConstructorOptions[] = date
		? [{ label: `버전 ${date}`, enabled: false }]
		: [];
	if (state.kind === "off")
		return version.length ? [...version, { type: "separator" }] : [];
	const action: MenuItemConstructorOptions =
		state.kind === "ready"
			? {
					label: `다시 시작해서 업데이트 (${state.date})`,
					click: () => void restartToUpdate(),
				}
			: state.kind === "downloading"
				? { label: `새 버전 받는 중 (${state.date})…`, enabled: false }
				: {
						label: "업데이트 확인…",
						enabled: state.kind === "idle",
						click: () => void checkForUpdate(),
					};
	return [...version, action, { type: "separator" }];
}

async function checkForUpdate(): Promise<void> {
	if (!updater) return;
	const result = await updater.checkNow();
	const options: Electron.MessageBoxOptions =
		result.kind === "failed"
			? {
					type: "warning",
					message: "업데이트를 확인하지 못했습니다",
					detail: `인터넷 연결을 확인한 뒤 다시 시도해 주세요. 자세한 내용은 로그 폴더의 rowcat.log에 있습니다.`,
				}
			: result.kind === "current"
				? {
						type: "info",
						message: "최신 버전입니다",
						detail: result.date
							? `설치된 버전: ${result.date}`
							: "이 설치 파일은 릴리스에서 받은 것이 아닙니다.",
					}
				: result.kind === "downloading"
					? {
							type: "info",
							message: `새 버전(${result.date})을 받고 있습니다`,
							detail:
								"다 받으면 RowCat 메뉴에 「다시 시작해서 업데이트」가 생깁니다. 그대로 두어도 앱을 끌 때 설치됩니다.",
						}
					: {
							type: "info",
							message: `새 버전(${result.date})이 준비되어 있습니다`,
							detail:
								"RowCat 메뉴의 「다시 시작해서 업데이트」를 누르거나, 앱을 끄면 설치됩니다.",
						};
	if (mainWindow) await dialog.showMessageBox(mainWindow, options);
	else await dialog.showMessageBox(options);
}

/**
 * Installing now: the servers stop first, then the installer starts. The NSIS installer ends every
 * process running from the install folder by force, Postgres among them, so it must find none.
 */
async function restartToUpdate(): Promise<void> {
	if (!updater || stopping) return;
	stopping = true;
	buildMenu(null);
	if (mainWindow) void mainWindow.loadURL(UPDATING_PAGE);
	try {
		await stack?.stop();
	} catch (error) {
		log(
			"desktop",
			`stop before update failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	stack = null;
	stopped = true;
	updater.installAndRestart();
	// `quitAndInstall` quits only once the installer has started; if it could not, the app still ends —
	// its servers are already down, and the next launch tries the update again.
	setTimeout(() => app.exit(0), 10_000).unref();
}

function buildMenu(running: RunningStack | null): void {
	const rowcat: MenuItemConstructorOptions[] = running
		? [
				{ label: "RowCat 열기", click: () => openWindow(running.origins.web) },
				{
					label: "운영 콘솔 열기",
					click: () => openWindow(running.origins.console),
				},
				{
					label: "기본 브라우저에서 열기",
					click: () => void shell.openExternal(running.origins.web),
				},
				{ type: "separator" },
				{
					label: "관리자 설정 코드…",
					click: () => void showSetupCode(running),
				},
				{ type: "separator" },
			]
		: [];
	const template: MenuItemConstructorOptions[] = [
		...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
		{
			label: APP_NAME,
			submenu: [
				...rowcat,
				...updateMenu(),
				{
					label: "데이터 폴더 열기",
					click: () => void shell.openPath(dataDir),
				},
				{
					label: "로그 폴더 열기",
					click: () => void shell.openPath(app.getPath("logs")),
				},
				...(process.platform === "darwin"
					? []
					: [{ role: "quit" as const, label: "종료" }]),
			],
		},
		{ role: "editMenu" },
		{ role: "viewMenu" },
		{ role: "windowMenu" },
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** How long a failed launch waits for a newer release to download before it gives up. */
const FAILED_LAUNCH_UPDATE_WAIT_MS = 3 * 60 * 1000;

/**
 * A launch that failed asks the feed before it gives up: the next release is exactly what may fix
 * it, and a copy that asked only after a successful start would stay broken until someone found the
 * release page. Ports held by another program are not that kind of failure, so they skip this.
 * `startStack` has already stopped whatever it started, so the installer finds nothing running.
 */
async function offerUpdateAfterFailure(): Promise<boolean> {
	if (!updater || updater.state().kind === "off") return false;
	if (mainWindow) void mainWindow.loadURL(CHECKING_PAGE);
	if (!(await updater.whenReady(FAILED_LAUNCH_UPDATE_WAIT_MS))) return false;
	const state = updater.state();
	const date = state.kind === "ready" ? state.date : "";
	const { response } = await dialog.showMessageBox({
		type: "error",
		buttons: ["업데이트하고 다시 시작", "닫기"],
		defaultId: 0,
		cancelId: 1,
		message: "RowCat을 시작하지 못했습니다",
		detail: `새 버전(${date})을 받아 두었습니다. 이 문제가 새 버전에서 고쳐졌을 수 있습니다.\n\n자세한 내용은 로그 폴더의 rowcat.log에 있습니다.\n${logFile}`,
	});
	if (response !== 0) {
		// Exits 0 so the downloaded update still installs on this quit.
		app.exit(0);
		return true;
	}
	stopping = true;
	stopped = true;
	updater.installAndRestart();
	setTimeout(() => app.exit(0), 10_000).unref();
	return true;
}

async function launch(): Promise<void> {
	mkdirSync(app.getPath("logs"), { recursive: true });
	updater = createUpdater({ log, onChange: () => buildMenu(stack) });
	buildMenu(null);
	openWindow(WAITING_PAGE);
	try {
		stack = await startStack({ dataDir, artifacts: artifacts(), log });
	} catch (error) {
		log(
			"desktop",
			`launch failed: ${error instanceof Error ? error.stack : String(error)}`,
		);
		if (!(error instanceof PortsBusyError) && (await offerUpdateAfterFailure()))
			return;
		await dialog.showMessageBox({
			type: "error",
			message: "RowCat을 시작하지 못했습니다",
			detail:
				error instanceof PortsBusyError
					? `이 컴퓨터의 다른 프로그램이 RowCat이 쓰는 포트(${error.ports.join(", ")})를 쓰고 있습니다. 그 프로그램을 끄거나 컴퓨터를 다시 시작한 뒤 열어 주세요.\n\n포트를 바꾸지 않는 이유: 주소가 바뀌면 이 컴퓨터에 저장된 대화와 초안이 보이지 않게 됩니다.`
					: `자세한 내용은 로그 폴더의 rowcat.log에 있습니다.\n${logFile}`,
		});
		app.exit(1);
		return;
	}
	buildMenu(stack);
	/**
	 * The setup code is not raised on launch. A native box is modal, and macOS refuses to quit an app
	 * while one is open — the first launch would be the one that cannot be closed. Nor is an
	 * administrator needed to use the app: conversations, drafts and a personal AI key all work for
	 * any member. The menu holds it for whoever wants the console.
	 */
	openWindow(stack.origins.web);
	/**
	 * Asked once the servers are up, and again when the window comes forward, at most every few hours
	 * (`update-policy.ts`) — there is no timer. A launch that failed asks on its own path above.
	 */
	updater?.checkInBackground();
	app.on("browser-window-focus", () => updater?.checkInBackground());
}

if (!app.requestSingleInstanceLock()) {
	// A second copy would try to start a second Postgres on the same data folder.
	app.quit();
} else {
	app.on("second-instance", () => {
		if (mainWindow) {
			if (mainWindow.isMinimized()) mainWindow.restore();
			mainWindow.focus();
		} else if (stack) openWindow(stack.origins.web);
	});

	app.whenReady().then(launch);

	// `kill`, a logout and an OS shutdown arrive as signals; they take the same path as the menu's quit.
	for (const signal of ["SIGTERM", "SIGINT"] as const)
		process.on(signal, () => app.quit());

	// Closing the last window keeps the servers running on macOS, as Mac apps do; elsewhere it quits.
	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") app.quit();
	});
	app.on("activate", () => {
		if (!mainWindow && stack) openWindow(stack.origins.web);
	});

	/**
	 * Quitting waits for the servers and Postgres to stop. Killed mid-write, Postgres recovers from
	 * its WAL on the next start, but the API's in-flight requests would be cut with no answer.
	 *
	 * `app.exit(0)` skips `will-quit` but still emits `quit`, and that is where a downloaded update
	 * starts its installer — after the servers are down, which is the order it needs.
	 */
	app.on("before-quit", (event) => {
		if (stopping) {
			// A quit while the servers are still stopping waits for that stop (see `stopped`).
			if (!stopped) event.preventDefault();
			return;
		}
		if (!stack) return;
		event.preventDefault();
		stopping = true;
		void stack.stop().finally(() => {
			stopped = true;
			app.exit(0);
		});
	});
}
