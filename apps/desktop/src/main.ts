import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { APP_NAME } from "@rowcat/domain";
import {
	app,
	BrowserWindow,
	dialog,
	Menu,
	type MenuItemConstructorOptions,
	nativeTheme,
	screen,
	shell,
} from "electron";
import {
	PortsBusyError,
	type RunningStack,
	type ServerEvent,
	startStack,
} from "./stack.ts";
import {
	type LaunchStage,
	type StatusPage,
	stageScript,
	statusPageUrl,
	WINDOW_BACKGROUND,
} from "./status-page.ts";
import { createUpdater, type DesktopUpdater } from "./updater.ts";
import { restoreBounds, type SavedWindow } from "./window-state.ts";

/**
 * The desktop shell: start the deployment on this computer, show it in a window, stop it on quit.
 *
 * **The window is the product's own web app, loaded from `localhost`.** Nothing is drawn here but the
 * status pages (`status-page.ts`), the menu and native dialogs — conversations, settings and the console are the same pages the
 * browser serves. A second UI in this file would be a fourth client to keep in step.
 *
 * **It is shown in Electron's Chromium, not the default browser**, for one concrete reason: the API
 * runs as production, so its session cookie is `Secure`, and Chromium stores `Secure` cookies on
 * `http://localhost` while Safari does not reliably — a Mac whose default browser is Safari would
 * never stay signed in. `기본 브라우저에서 열기` stays in the menu for people who prefer theirs.
 *
 * **Two windows, one per app.** The web app is the main window and the operations console has its own,
 * so opening the console does not navigate the person away from the conversation they were in; a link
 * from one app to the other lands in the other's window (`windowFor`).
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
const windowStateFile = join(app.getPath("userData"), "window-state.json");

type WindowKind = "main" | "console";

let stack: RunningStack | null = null;
const windows = new Map<WindowKind, BrowserWindow>();
/** Where launch is, so a launch page that finishes loading after a stage moved can catch up. */
let launchStage: LaunchStage | null = "database";
/** The page the main window showed when its server stopped, to return to once it is back. */
let interruptedUrl: string | null = null;
/** One 「멈췄습니다」 box at a time: both servers can give up at once. */
let failureShown = false;
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

const CHECKING_PAGE: StatusPage = {
	kind: "message",
	title: "시작하지 못했습니다",
	detail:
		"새 버전이 있는지 확인하고 있습니다. 새 버전에서 고쳐졌을 수 있습니다.",
};
const UPDATING_PAGE: StatusPage = {
	kind: "message",
	title: "새 버전을 설치하고 있습니다",
	detail: "끝나면 RowCat이 다시 열립니다.",
};
const RESTARTING_PAGE: StatusPage = {
	kind: "message",
	title: "다시 연결하고 있습니다",
	detail:
		"화면 서버가 멈춰서 다시 시작하고 있습니다. 보던 화면으로 곧 돌아갑니다.",
};

function isLocal(url: string): boolean {
	try {
		return new URL(url).hostname === "localhost";
	} catch {
		return false;
	}
}

/** The managed window a local URL belongs to, by origin; null for pages neither app serves. */
function windowFor(url: string): WindowKind | null {
	if (!stack) return null;
	try {
		const origin = new URL(url).origin;
		if (origin === stack.origins.console) return "console";
		if (origin === stack.origins.web) return "main";
	} catch {
		// Not a URL: nothing to route.
	}
	return null;
}

const MIN_SIZE = { width: 900, height: 600 };

function readWindowState(): Partial<Record<WindowKind, unknown>> {
	try {
		return JSON.parse(readFileSync(windowStateFile, "utf8"));
	} catch {
		return {};
	}
}

function saveWindowState(kind: WindowKind, window: BrowserWindow): void {
	const saved: SavedWindow = {
		bounds: window.getNormalBounds(),
		maximized: window.isMaximized(),
	};
	try {
		writeFileSync(
			windowStateFile,
			JSON.stringify({ ...readWindowState(), [kind]: saved }),
		);
	} catch {
		// A window that opens in the default place next time is not worth an error.
	}
}

function backgroundColor(): string {
	return nativeTheme.shouldUseDarkColors
		? WINDOW_BACKGROUND.dark
		: WINDOW_BACKGROUND.light;
}

function createWindow(kind: WindowKind): BrowserWindow {
	const saved = restoreBounds(
		readWindowState()[kind],
		screen.getAllDisplays().map((display) => display.workArea),
		MIN_SIZE,
	);
	const window = new BrowserWindow({
		...(saved?.bounds ?? { width: 1280, height: 860 }),
		minWidth: MIN_SIZE.width,
		minHeight: MIN_SIZE.height,
		title: kind === "console" ? `${APP_NAME} 운영 콘솔` : APP_NAME,
		/**
		 * Hidden until the first page has painted, on the theme's background: shown at once, the window
		 * flashes white before a dark page draws.
		 */
		show: false,
		backgroundColor: backgroundColor(),
		webPreferences: { contextIsolation: true, sandbox: true },
	});
	window.once("ready-to-show", () => {
		if (saved?.maximized) window.maximize();
		window.show();
	});
	// Pages on this computer open here; everything else (provider key pages, docs) in the browser.
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (!isLocal(url)) {
			void shell.openExternal(url);
			return { action: "deny" };
		}
		const target = windowFor(url);
		if (target && target !== kind) {
			openWindow(target, url);
			return { action: "deny" };
		}
		return { action: "allow" };
	});
	window.webContents.on("will-navigate", (event, url) => {
		if (url.startsWith("data:")) return;
		if (!isLocal(url)) {
			event.preventDefault();
			void shell.openExternal(url);
			return;
		}
		const target = windowFor(url);
		if (target && target !== kind) {
			event.preventDefault();
			openWindow(target, url);
		}
	});
	if (kind === "main")
		window.webContents.on("did-finish-load", () => applyLaunchStage());
	window.on("close", () => saveWindowState(kind, window));
	window.on("closed", () => {
		if (windows.get(kind) === window) windows.delete(kind);
	});
	windows.set(kind, window);
	return window;
}

function openWindow(kind: WindowKind, url: string): void {
	const existing = windows.get(kind);
	const window = existing ?? createWindow(kind);
	void window.loadURL(url);
	if (existing) {
		if (existing.isMinimized()) existing.restore();
		existing.show();
		existing.focus();
	}
}

function showPage(page: StatusPage): void {
	openWindow("main", statusPageUrl(page));
}

function applyLaunchStage(): void {
	const window = windows.get("main");
	if (!launchStage || !window?.webContents.getURL().startsWith("data:")) return;
	window.webContents
		.executeJavaScript(stageScript(launchStage))
		.catch(() => {});
}

/** The main window when there is one, so a box opens as its sheet rather than on its own. */
async function messageBox(
	options: Electron.MessageBoxOptions,
): Promise<Electron.MessageBoxReturnValue> {
	const window = windows.get("main");
	return window
		? dialog.showMessageBox(window, options)
		: dialog.showMessageBox(options);
}

function focusedHistory(): Electron.NavigationHistory | undefined {
	return BrowserWindow.getFocusedWindow()?.webContents.navigationHistory;
}

function revealLog(): void {
	shell.showItemInFolder(logFile);
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
		await messageBox({
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
	const { response } = await messageBox(options);
	if (response === 0) openWindow("console", `${running.origins.console}/setup`);
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
	await messageBox(options);
}

/**
 * Installing now: the servers stop first, then the installer starts. The NSIS installer ends every
 * process running from the install folder by force, Postgres among them, so it must find none.
 */
async function restartToUpdate(): Promise<void> {
	if (!updater || stopping) return;
	stopping = true;
	buildMenu(null);
	if (windows.has("main")) showPage(UPDATING_PAGE);
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
				{
					label: "RowCat 열기",
					accelerator: "CmdOrCtrl+1",
					click: () => openWindow("main", running.origins.web),
				},
				{
					label: "운영 콘솔 열기",
					accelerator: "CmdOrCtrl+2",
					click: () => openWindow("console", running.origins.console),
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
				{ label: "로그 보기", click: revealLog },
				...(process.platform === "darwin"
					? []
					: [{ role: "quit" as const, label: "종료" }]),
			],
		},
		{ role: "editMenu" },
		{
			label: "보기",
			submenu: [
				{ role: "reload", label: "새로 고침" },
				{
					label: "뒤로",
					accelerator: "CmdOrCtrl+[",
					click: () => focusedHistory()?.goBack(),
				},
				{
					label: "앞으로",
					accelerator: "CmdOrCtrl+]",
					click: () => focusedHistory()?.goForward(),
				},
				{ type: "separator" },
				{ role: "resetZoom", label: "실제 크기" },
				{ role: "zoomIn", label: "확대" },
				{ role: "zoomOut", label: "축소" },
				{ type: "separator" },
				{ role: "togglefullscreen", label: "전체 화면" },
				...(app.isPackaged
					? []
					: [{ role: "toggleDevTools" as const, label: "개발자 도구" }]),
			],
		},
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
	if (windows.has("main")) showPage(CHECKING_PAGE);
	if (!(await updater.whenReady(FAILED_LAUNCH_UPDATE_WAIT_MS))) return false;
	const state = updater.state();
	const date = state.kind === "ready" ? state.date : "";
	const { response } = await dialog.showMessageBox({
		type: "error",
		buttons: ["업데이트하고 다시 시작", "로그 보기", "닫기"],
		defaultId: 0,
		cancelId: 2,
		message: "RowCat을 시작하지 못했습니다",
		detail: `새 버전(${date})을 받아 두었습니다. 이 문제가 새 버전에서 고쳐졌을 수 있습니다.`,
	});
	if (response === 1) revealLog();
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

/**
 * A server stopped after launch (`stack.ts` starts it again). The web server is what the main window
 * shows, so the window waits on a status page and returns to the same address; the API stopping is
 * left to the web app, which already says when it cannot reach its server and recovers on its own.
 * Giving up is said once, with the way out: start the whole app again, or read the log.
 */
async function onServerEvent(event: ServerEvent): Promise<void> {
	log("desktop", `${event.server} ${event.kind}`);
	const main = windows.get("main");
	if (event.server === "web" && event.kind === "restarting" && main && stack) {
		const url = main.webContents.getURL();
		if (url.startsWith(stack.origins.web)) interruptedUrl = url;
		showPage(RESTARTING_PAGE);
		return;
	}
	if (event.server === "web" && event.kind === "running" && stack) {
		openWindow("main", interruptedUrl ?? stack.origins.web);
		interruptedUrl = null;
		return;
	}
	if (event.kind !== "failed" || failureShown || stopping) return;
	failureShown = true;
	const { response } = await messageBox({
		type: "error",
		buttons: ["RowCat 다시 시작", "로그 보기", "닫기"],
		defaultId: 0,
		cancelId: 2,
		message: "RowCat의 서버가 멈췄습니다",
		detail:
			"몇 번 다시 시작해 보았지만 계속 멈춥니다. RowCat을 다시 시작하면 대부분 해결됩니다. 대화와 초안은 이 컴퓨터에 그대로 있습니다.",
	});
	failureShown = false;
	if (response === 1) revealLog();
	if (response === 0) {
		app.relaunch();
		app.quit();
	}
}

/**
 * A development run shows Electron's own icon in the Dock; the staged icon replaces it so `pnpm dev`
 * looks like what ships. A packaged app carries its icon in the bundle.
 */
function showDevelopmentIcon(): void {
	if (app.isPackaged || process.platform !== "darwin") return;
	const icon = join(app.getAppPath(), ".stage", "icons", "mac.png");
	if (existsSync(icon)) app.dock?.setIcon(icon);
}

async function launch(): Promise<void> {
	mkdirSync(app.getPath("logs"), { recursive: true });
	updater = createUpdater({ log, onChange: () => buildMenu(stack) });
	app.setAboutPanelOptions({
		applicationName: APP_NAME,
		applicationVersion: updater.installedDate() ?? "개발 빌드",
		version: "",
	});
	showDevelopmentIcon();
	buildMenu(null);
	showPage({ kind: "launch" });
	try {
		stack = await startStack({
			dataDir,
			artifacts: artifacts(),
			log,
			onStage: (stage) => {
				launchStage = stage;
				applyLaunchStage();
			},
			onServerEvent: (event) => void onServerEvent(event),
		});
	} catch (error) {
		log(
			"desktop",
			`launch failed: ${error instanceof Error ? error.stack : String(error)}`,
		);
		if (!(error instanceof PortsBusyError) && (await offerUpdateAfterFailure()))
			return;
		const portsBusy = error instanceof PortsBusyError;
		const { response } = await dialog.showMessageBox({
			type: "error",
			buttons: portsBusy ? ["닫기"] : ["닫기", "로그 보기"],
			defaultId: 0,
			cancelId: 0,
			message: "RowCat을 시작하지 못했습니다",
			detail: portsBusy
				? `이 컴퓨터의 다른 프로그램이 RowCat이 쓰는 포트(${error.ports.join(", ")})를 쓰고 있습니다. 그 프로그램을 끄거나 컴퓨터를 다시 시작한 뒤 열어 주세요.\n\n포트를 바꾸지 않는 이유: 주소가 바뀌면 이 컴퓨터에 저장된 대화와 초안이 보이지 않게 됩니다.`
				: "무엇이 잘못됐는지는 로그(rowcat.log)에 적혀 있습니다. 문의할 때 이 파일을 함께 보내 주세요.",
		});
		if (response === 1) revealLog();
		app.exit(1);
		return;
	}
	launchStage = null;
	buildMenu(stack);
	/**
	 * The setup code is not raised on launch. A native box is modal, and macOS refuses to quit an app
	 * while one is open — the first launch would be the one that cannot be closed. Nor is an
	 * administrator needed to use the app: conversations, drafts and a personal AI key all work for
	 * any member. The menu holds it for whoever wants the console.
	 */
	openWindow("main", stack.origins.web);
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
		const main = windows.get("main");
		if (main) {
			if (main.isMinimized()) main.restore();
			main.focus();
		} else if (stack) openWindow("main", stack.origins.web);
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
		if (!windows.has("main") && stack) openWindow("main", stack.origins.web);
	});
	nativeTheme.on("updated", () => {
		for (const window of windows.values())
			window.setBackgroundColor(backgroundColor());
	});

	/**
	 * Quitting waits for the servers and Postgres to stop. Killed mid-write, Postgres recovers from
	 * its WAL on the next start, but the API's in-flight requests would be cut with no answer.
	 *
	 * `app.exit(0)` skips `will-quit` but still emits `quit`, and that is where a downloaded update
	 * starts its installer — after the servers are down, which is the order it needs.
	 */
	app.on("before-quit", (event) => {
		// Quitting ends in `app.exit`, which closes the windows without their `close` event.
		if (!stopping)
			for (const [kind, window] of windows) saveWindowState(kind, window);
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
