import type { Locator, Page } from "@playwright/test";
import {
	createAccount,
	expect,
	newAccount,
	test,
} from "../support/fixtures.ts";

/**
 * Journey 18: user-authored TSX runs in an isolated VM, and pressing a button changes the DOM.
 *
 * This is the Phase 5A acceptance scenario. Pure tests already cover the reconciler matrix
 * (@rowcat/runtime), the renderer's operations (@rowcat/runtime-renderer-web), and the TSX to
 * QuickJS to DOM pipeline (jsdom tests in that package), so this journey does not repeat them. The
 * axes it adds need a browser:
 * - Worker: the compiler and WASM load as a real worker chunk, and the main thread still
 *   responds.
 * - Shadow DOM: what the renderer draws sits in the real document tree, and the user can press
 *   it.
 * - Round trip: click, worker, VM, patch and DOM update form one path.
 * - Source authority: pressing `Restart` before autosave runs the code currently on
 *   screen.
 *
 * The fixture is pasted into the editor. The starter project used to be the fixture itself (the
 * file created on enable was a counter), but that assumption ended when the starter-template
 * gallery arrived. The default selection is the recommended (flagship) template, so `Blank` is
 * picked explicitly below. Pasting the fixture keeps the checks the same if the template body
 * changes.
 *
 * Text is entered by select-all and paste, as a user would. Typing triggers auto-indent and
 * auto-close, which rewrite the source.
 */

const COUNTER_SOURCE = `import { Button, Screen, Stack, Text, color, useState } from "@rowcat/runtime";

export default function App() {
	const [count, setCount] = useState(0);
	return (
		<Screen background={color("#111111")}>
			<Stack gap={12} style={{ padding: 16 }}>
				<Text style={{ color: color("#ffffff"), fontSize: 20 }}>Count: {count}</Text>
				<Button tone="primary" onPress={() => setCount((value) => value + 1)}>Increment</Button>
			</Stack>
		</Screen>
	);
}
`;

/**
 * The new source pasted into the editor: the same counter with one word changed (`Tally`). When
 * that word appears on screen, the worker received the editor's value, not the saved old copy.
 */
const EDITED_SOURCE = `import { Button, Screen, Stack, Text, color, useState } from "@rowcat/runtime";

export default function App() {
	const [count, setCount] = useState(0);
	return (
		<Screen background={color("#111111")}>
			<Stack gap={12} style={{ padding: 16 }}>
				<Text style={{ color: color("#ffffff"), fontSize: 20 }}>Tally: {count}</Text>
				<Button tone="primary" onPress={() => setCount((value) => value + 1)}>Increment</Button>
			</Stack>
		</Screen>
	);
}
`;

/** Text and buttons inside the shadow root. Playwright locators pierce the shadow boundary. */
const surface = (page: Page): Locator =>
	page.getByTestId("runtime-preview-surface");

/**
 * Selects all in the editor, then pastes. Select-all is a Monaco key binding, and its modifier key
 * comes from the platform the browser emulates. This project's user agent is Windows, so it is
 * Ctrl+A. Paste is the browser's native command and follows the real host's modifier key
 * (ControlOrMeta). Writing both with the same name makes one of them silently do nothing; the paste
 * would then insert at the cursor instead.
 */
async function paste(page: Page, source: string): Promise<void> {
	await page.evaluate((text) => navigator.clipboard.writeText(text), source);
	await page.getByRole("code").click();
	await page.keyboard.press("Control+A");
	await page.keyboard.press("ControlOrMeta+V");
}

test("running the preview draws the counter, and pressing it reflects VM state in the DOM", async ({
	page,
	context,
}) => {
	/**
	 * The first run loads the worker chunk (the TypeScript compiler plus WASM, several MB). The dev
	 * server transforms it on the spot, so this runs longer than the other journeys. The wait ends on
	 * the first character the renderer draws. The timeout only leaves room for that signal to arrive.
	 */
	test.setTimeout(240_000);
	const account = newAccount("journey18");
	await createAccount(context, account);

	await page.goto("/create");
	const create = page.getByRole("button", { name: /^New story/ });
	const DRAFT_URL = /\/create\/[^/]+$/;
	/**
	 * Clicks, then keeps clicking until navigation happens. A click before hydration does nothing
	 * silently. Once it has navigated away, it is not clicked again: creating the draft (repository
	 * open, IndexedDB write, navigation) can take longer than one short wait, and the editor would
	 * then have no button left to press.
	 */
	await expect(async () => {
		if (!DRAFT_URL.test(page.url()))
			await create.first().click({ timeout: 2_000 });
		await page.waitForURL(DRAFT_URL, { timeout: 10_000 });
	}).toPass({ timeout: 60_000 });

	/**
	 * Enabling goes through the starter-template gallery. While choosing, nothing is written to the
	 * draft. The record is created only by the confirm button, which creates the project row and the
	 * starter file in one transaction.
	 */
	const enable = page.getByRole("button", { name: "Get started", exact: true });
	await expect(enable).toBeVisible({ timeout: 30_000 });
	await enable.click();
	/**
	 * Picks `Blank` explicitly. The gallery's first selection is the recommended (flagship) template,
	 * a project with about thirty files (initialRuntimeTemplateSelection). This journey asks whether
	 * pasted code runs, so it starts from the smallest project. Any failure then belongs to what it is
	 * actually testing.
	 */
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByRole("button", { name: /^Blank/ })).toBeVisible({
		timeout: 15_000,
	});
	await dialog.getByRole("button", { name: /^Blank/ }).click();

	const confirm = dialog.getByRole("button", { name: /^Start with / });
	await expect(confirm).toBeEnabled({ timeout: 15_000 });
	await confirm.click();
	/**
	 * Once created, navigation goes straight to the studio. That navigation is an observable signal
	 * that the transaction has finished, so no arbitrary wait is used. If it does not navigate, the
	 * `Open studio` link in the editor takes its place. Both lead to the same address.
	 */
	const STUDIO_URL = /\/create\/[^/]+\/runtime$/;
	await expect(async () => {
		if (!STUDIO_URL.test(page.url()))
			await page
				.getByRole("link", { name: "Open studio" })
				.click({ timeout: 3_000 });
		await page.waitForURL(STUDIO_URL, { timeout: 10_000 });
	}).toPass({ timeout: 45_000 });

	/**
	 * If the pane is closed, the run button is in the DOM but not drawn, and it is absent from the
	 * accessibility tree. The way to open the pane is the studio menu in the header, and a menu item
	 * appearing is the hydration signal.
	 *
	 * The default is open now, so the opening steps below usually do not run. The hint line in
	 * runtime-workspace-state.ts says it runs in the preview, which is only true if the
	 * pane exists from the start. The branch is kept because this journey verifies the path to the run
	 * button, not the default.
	 *
	 * The trigger was once named `Layout`. When the palette became the first line, the trigger
	 * held more than layout (runtime-copy.ts), so the name was broadened. The journey stopped here
	 * while it still used the old name.
	 */
	/**
	 * Waits until the header has arrived first. Only after that does retrying the menu open have a
	 * meaning.
	 *
	 * The studio loads Monaco and the preview worker (TypeScript compiler plus WASM, several MB) late,
	 * and the dev server transforms them when requested. That cost falls entirely on whichever journey
	 * opens the studio first. A short retry budget alone would fail with 'studio menu not found', and
	 * that message does not say the header has not arrived yet.
	 */
	const studioMenu = page.getByRole("button", { name: "Studio menu" });
	await expect(studioMenu).toBeVisible({ timeout: 120_000 });

	/**
	 * The wait is for the result, not the press. Two clicks finishing without error does not mean the
	 * pane opened. If the menu was already open, the first click closes it, and the item click that
	 * follows leaves the pane closed even when it succeeds. The next line then fails with 'run not
	 * found', and that message does not give the cause.
	 *
	 * So the success signal is the existence of the run button. If the menu is already open, nothing
	 * is pressed, because opening is a toggle: a second click on an open pane closes it.
	 */
	const runButton = page.getByRole("button", { name: "Run preview" });
	await expect(async () => {
		if ((await runButton.count()) === 0) {
			await studioMenu.click({ timeout: 2_000 });
			await page
				.getByRole("menuitem", { name: "Show preview" })
				.click({ timeout: 3_000 });
		}
		await expect(runButton).toBeVisible({ timeout: 5_000 });
	}).toPass({ timeout: 120_000 });

	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await paste(page, COUNTER_SOURCE);
	await expect(page.getByRole("code")).toContainText("Count:");

	/**
	 * The run button is pressed only when the check state grants eligibility (the analysis pass plus
	 * Monaco markers). Reaching that requires the editor and type service to load, which takes time.
	 * That wait is expressed as the button becoming enabled.
	 */
	const run = runButton;
	await expect(run).toBeEnabled({ timeout: 60_000 });
	await run.click();

	/**
	 * The worker loads the compiler (TypeScript) and WASM for the first time, which is slow on a dev
	 * server. The signal to wait for is not time but the first character the renderer draws.
	 */
	const count = surface(page).getByText(/^Count: \d+$/);
	await expect(count).toHaveText("Count: 0", { timeout: 90_000 });

	const increment = surface(page).getByRole("button", { name: "Increment" });
	await increment.click();
	await expect(count).toHaveText("Count: 1");
	await increment.click();
	await expect(count).toHaveText("Count: 2");

	/**
	 * Same element. The update was a set-text patch rather than a re-render, so the handle stays
	 * valid.
	 */
	await expect(increment).toBeVisible();

	/**
	 * The renderer's output sits inside the shadow root, not in React's tree. The container having no
	 * direct children is how that is observed. If React starts drawing under it, this assertion
	 * breaks.
	 */
	const lightChildren = await surface(page).evaluate(
		(element) => element.childNodes.length,
	);
	expect(lightChildren).toBe(0);

	await page.getByRole("button", { name: "Stop" }).click();
	await expect(page.getByRole("button", { name: "Run preview" })).toBeVisible({
		timeout: 15_000,
	});
	await expect(surface(page).getByText(/^Count: /)).toHaveCount(0);

	/* Running again starts a new session, so state begins from zero. */

	await page.getByRole("button", { name: "Run preview" }).click();
	await expect(surface(page).getByText(/^Count: \d+$/)).toHaveText("Count: 0", {
		timeout: 60_000,
	});

	await paste(page, EDITED_SOURCE);
	/**
	 * Signal that the paste reached the editor. Waits after this belong to eligibility, not to the
	 * paste.
	 */
	await expect(page.getByRole("code")).toContainText("Tally");

	/**
	 * Does not wait here. The point of this step is to press before the autosave debounce (500 ms)
	 * finishes. If the preview ran the old record, what appears is `Count:`. Eligibility comes from
	 * the editor's markers, so the button can be briefly disabled. That wait belongs to eligibility,
	 * not to saving.
	 */
	const restart = page.getByRole("button", { name: "Restart" });
	await expect(restart).toBeEnabled({ timeout: 30_000 });
	await restart.click();
	await expect(surface(page).getByText(/^Tally: \d+$/)).toHaveText("Tally: 0", {
		timeout: 60_000,
	});

	/**
	 * Still not stale after the save arrives. The old implementation ran the saved record and wrote
	 * `Changes pending` when the save came in. Now what runs and what is saved are the same
	 * code, so there is nothing to write.
	 */
	await expect(page.getByText("Changes pending")).toHaveCount(0);
	await surface(page).getByRole("button", { name: "Increment" }).click();
	await expect(surface(page).getByText(/^Tally: \d+$/)).toHaveText("Tally: 1");
});
