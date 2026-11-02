/**
 * The pages the window shows while there is no server to show: starting up, restarting a server that
 * stopped, installing a new version.
 *
 * **One document, updated in place.** Launch moves through three stages, and loading a new `data:` page
 * per stage blanks the window between them. So the page is loaded once and the main process calls
 * `setStage(n)` in it (`stageScript`); the page owns nothing else.
 *
 * **The colors are the product's first frame, copied, not imported.** The window opens on these and
 * then on the web app, and a different background between the two is a flash. The values are the
 * design tokens' `--background` / `--foreground` / `--muted-foreground` / `--border` (`packages/design/src/tokens.ts`)
 * — copied because the desktop app takes no workspace package but `@rowcat/domain` (AGENTS.md, layer
 * rules), and a page that drifted from them would show only as a slightly different grey.
 *
 * What this does not hold: a progress percentage or an elapsed timer. Neither stage reports how far
 * along it is (migrations run inside the API's boot), and a bar that guesses moves at the wrong speed.
 */

export const WINDOW_BACKGROUND = { light: "#ffffff", dark: "#09090b" };

/** Launch's stages, in the order `startStack` reaches them. */
export const LAUNCH_STAGES = ["database", "api", "web"] as const;
export type LaunchStage = (typeof LAUNCH_STAGES)[number];

const STAGE_LABEL: Record<LaunchStage, string> = {
	database: "데이터베이스를 엽니다",
	api: "서버를 시작합니다 — 업데이트 뒤에는 조금 더 걸립니다",
	web: "화면을 준비합니다",
};

export type StatusPage =
	| { kind: "launch" }
	| { kind: "message"; title: string; detail: string };

export function statusPageUrl(page: StatusPage): string {
	return `data:text/html;charset=utf-8,${encodeURIComponent(statusPageHtml(page))}`;
}

export function statusPageHtml(page: StatusPage): string {
	const title = page.kind === "launch" ? "준비하고 있습니다" : page.title;
	const stages = LAUNCH_STAGES.map(
		(stage, index) =>
			`<li data-state="${index === 0 ? "current" : "pending"}"><span class="mark" aria-hidden="true"></span>${escapeHtml(STAGE_LABEL[stage])}</li>`,
	).join("");
	const body =
		page.kind === "launch"
			? `<ol>${stages}</ol><p class="note">처음 실행할 때는 1분쯤 걸릴 수 있습니다.</p>`
			: `<p class="note">${escapeHtml(page.detail)}</p>`;
	return `<!doctype html>
<html lang="ko"><meta charset="utf-8"><title>RowCat</title>
<style>
:root{color-scheme:light dark;--bg:oklch(1 0 0);--fg:oklch(0.141 0.005 285.823);--muted:oklch(0.552 0.016 285.938);--line:oklch(0.92 0.004 286.32)}
@media (prefers-color-scheme:dark){:root{--bg:oklch(0.141 0.005 285.823);--fg:oklch(0.985 0 0);--muted:oklch(0.705 0.015 286.067);--line:oklch(0.274 0.006 286.033)}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:14px/1.6 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic","Segoe UI",sans-serif;-webkit-user-select:none;user-select:none;cursor:default}
main{width:min(420px,calc(100vw - 48px))}
header{display:flex;align-items:center;gap:12px;margin-bottom:20px}
.spinner{width:20px;height:20px;border-radius:50%;border:2px solid var(--line);border-top-color:var(--fg);animation:spin .9s linear infinite;flex:none}
h1{font-size:18px;font-weight:600;margin:0}
ol{list-style:none;margin:0 0 16px;padding:0;display:grid;gap:10px}
li{display:flex;gap:10px;align-items:flex-start;color:var(--muted)}
li[data-state=current]{color:var(--fg)}
.mark{flex:none;width:8px;height:8px;margin-top:7px;border-radius:50%;border:1.5px solid currentColor}
li[data-state=current] .mark{background:currentColor;animation:pulse 1.4s ease-in-out infinite}
li[data-state=done] .mark{background:currentColor;border-color:currentColor;opacity:.5}
.note{margin:0;color:var(--muted)}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.spinner{animation-duration:2.4s}li[data-state=current] .mark{animation:none}}
</style>
<body><main aria-live="polite"><header><span class="spinner" aria-hidden="true"></span><h1>${escapeHtml(title)}</h1></header>${body}</main>
<script>
function setStage(n){document.querySelectorAll("li").forEach(function(li,i){li.dataset.state=i<n?"done":i===n?"current":"pending"})}
</script></body></html>`;
}

/** What the main process runs in a loaded launch page to move it to `stage`. */
export function stageScript(stage: LaunchStage): string {
	return `typeof setStage==="function"&&setStage(${LAUNCH_STAGES.indexOf(stage)})`;
}

function escapeHtml(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}
