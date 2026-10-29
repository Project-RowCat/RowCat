import type { Locator, Page } from "@playwright/test";
import {
	createAccount,
	expect,
	newAccount,
	test,
} from "../support/fixtures.ts";

/**
 * Acceptance journey for the public beta: a creator publishes a runtime they wrote in the studio,
 * and it plays.
 *
 * - Covers the chain studio, editor, publish, catalog, play, which value tests cannot express.
 *   Publish runs outside the studio, after an autosave flush, a server recompile, post-publish
 *   navigation and play eligibility. A break anywhere would leave value tests green.
 * - Does not re-walk the preview round-trip (journey 18) or the save lifecycle and play reset
 *   (journey 20).
 * - Includes one deliberate error (break, read the diagnostic, jump to the line, fix). The
 *   publish button is enabled even for non-compiling code (the server blocks it), so checking only
 *   publish would miss the creator's path.
 * - The source is the fixture: a marker unique to this account must appear on the played screen.
 *   A Blank template alone would show the same screen whoever wrote it.
 */

const MARKER = "Journey21 Ready";

const SOURCE = `import { Button, Screen, Stack, Text, color, useState } from "@rowcat/runtime";

export default function App() {
	const [count, setCount] = useState(0);
	return (
		<Screen background={color("#101014")}>
			<Stack gap={12} style={{ padding: 16 }}>
				<Text style={{ color: color("#ffffff"), fontSize: 20 }}>${MARKER}</Text>
				<Text style={{ color: color("#ffffff"), fontSize: 16 }}>Count: {count}</Text>
				<Button tone="primary" onPress={() => setCount((value) => value + 1)}>Increment</Button>
			</Stack>
		</Screen>
	);
}
`;

/**
 * A deliberately broken import, the material for the path a creator actually takes.
 *
 * An npm import is used because the diagnostic comes from this repo's compiler. Monaco's type
 * service also reports 'module not found' on that line, but this journey checks that the runtime
 * policy pass reaches the screen. The message text is written in this repo too, so the test can
 * assert it by value.
 */
const BROKEN = `import "left-pad";
${SOURCE}`;

/**
 * The diagnostic sentence, copied verbatim from `packages/runtime-compiler/src/module-graph.ts`.
 */
const FORBIDDEN_IMPORT =
	'"left-pad" can\'t be imported. A runtime project can import only @rowcat/runtime and files inside the project.';

/**
 * The text the badge is read by. It is body text (a visually hidden prefix plus the visible word),
 * not an `aria-label`, so it is found by its text rather than by name. A role-less `<span>` does
 * not support that attribute.
 */
const BETA_BADGE = "Creator runtime Beta";

const DRAFT_URL = /\/create\/[^/]+$/;
const STUDIO_URL = /\/create\/[^/]+\/runtime$/;
const STORY_URL = /\/stories\/[^/]+$/;
const PLAYER_URL = /\/chat\/runtime\/[^/]+$/;

const previewSurface = (page: Page): Locator =>
	page.getByTestId("runtime-preview-surface");
const playerSurface = (page: Page): Locator =>
	page.getByTestId("runtime-player-surface");

/**
 * Selects all of the editor and pastes. Two modifier keys are used, as in journey 18.
 *
 * Select-all is a Monaco key binding, so it uses `Ctrl` of the platform the browser emulates
 * (Windows). Paste is a native browser command, so it follows the host's modifier key.
 */
async function paste(page: Page, source: string): Promise<void> {
	await page.evaluate((text) => navigator.clipboard.writeText(text), source);
	await page.getByRole("code").click();
	await page.keyboard.press("Control+A");
	await page.keyboard.press("ControlOrMeta+V");
}

/**
 * A click before hydration silently does nothing, so keep clicking until the page arrives.
 *
 * Wait for an observable success signal (the URL), not an arbitrary delay. Once the page has moved
 * on, do not click again.
 */
async function clickUntil(
	page: Page,
	target: RegExp,
	control: () => Locator,
	budget = 60_000,
): Promise<void> {
	await expect(async () => {
		if (!target.test(page.url())) await control().click({ timeout: 3_000 });
		await page.waitForURL(target, { timeout: 10_000 });
	}).toPass({ timeout: budget });
}

test("a creator's runtime is published and that story plays", async ({
	page,
	context,
}) => {
	/**
	 * The first run is slow: the dev server transforms the worker chunk (TypeScript compiler + WASM,
	 * several MB) on demand. This journey also waits for a server recompile and a second VM boot for
	 * the play screen.
	 */
	test.setTimeout(300_000);
	const account = newAccount("journey21");
	await createAccount(context, account);
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);

	await page.goto("/create");
	await clickUntil(page, DRAFT_URL, () =>
		page.getByRole("button", { name: /^New story/ }).first(),
	);

	const start = page.getByRole("button", { name: "Get started", exact: true });
	await expect(start).toBeVisible({ timeout: 30_000 });
	await start.click();

	const dialog = page.getByRole("dialog");
	/**
	 * The screen just before creation shows the product state. If this badge disappears, the beta
	 * marker is left only in the studio header, and that screen is already after code writing has
	 * started.
	 */
	await expect(dialog.getByText(BETA_BADGE, { exact: true })).toBeVisible();

	/**
	 * Explicitly selects `Blank`. The gallery's first selection is the recommended template
	 * (`initialRuntimeTemplateSelection`), a project of over thirty files.
	 *
	 * This journey asks whether pasted code runs, not about templates, so it starts from the smallest
	 * project. A failure then points at the code.
	 */
	await expect(dialog.getByRole("button", { name: /^Blank/ })).toBeVisible({
		timeout: 15_000,
	});
	await dialog.getByRole("button", { name: /^Blank/ }).click();

	const confirm = dialog.getByRole("button", { name: /^Start with / });
	await expect(confirm).toBeEnabled({ timeout: 15_000 });
	await confirm.click();

	await clickUntil(page, STUDIO_URL, () =>
		page.getByRole("link", { name: "Open studio" }),
	);

	await expect(page.getByText(BETA_BADGE, { exact: true })).toBeVisible({
		timeout: 30_000,
	});

	/**
	 * The docs link must be inside the studio. It is on the public beta's manual checklist. Whether
	 * the link is easy to see is a human judgement, but whether it exists is checked here. If the link
	 * disappears, no type or value test would fail.
	 */
	await expect(
		page.getByRole("link", { name: "Runtime docs" }).first(),
	).toBeVisible({ timeout: 30_000 });

	/**
	 * On wide screens the panel defaults to open (`runtime-workspace-state.ts`), so the open step
	 * below usually does not run.
	 *
	 * It is kept because this journey checks the route to the run button, not the default. When the
	 * panel is closed, the only way to open it is the studio menu in the header.
	 */
	/**
	 * Waits first until the header arrives. Only after that does retrying the menu open make sense.
	 *
	 * The studio loads Monaco and the preview worker (TypeScript compiler + WASM, several MB) late,
	 * and the dev server transforms them on request. This cost falls entirely on the first journey
	 * that opens the studio. With only a short retry budget, that journey dies with `couldn't find Studio menu`,
	 * which does not say the header has not arrived yet.
	 */
	const studioMenu = page.getByRole("button", { name: "Studio menu" });
	await expect(studioMenu).toBeVisible({ timeout: 120_000 });

	/**
	 * Wait for the result, not the press. Two clicks finishing without error does not mean the panel
	 * opened. If the menu was already open, the first click closes it, and the item click that follows
	 * succeeds while the panel stays shut. The journey then dies with `couldn't find Run preview`, which does
	 * not state the cause.
	 *
	 * So the success signal is the presence of the run button. If the menu is already open, press
	 * nothing, since the open action is a toggle.
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

	/**
	 * The run button is pressed only when the check state qualifies it (analysis pass plus Monaco
	 * markers). That qualification comes only after the editor and type service load, so every wait
	 * ends on the button becoming enabled. The signal is read twice below: after the broken code and
	 * after the fix.
	 */
	const run = runButton;

	/**
	 * Without this stretch the journey only sees 'correct code gets published'. The path the creator
	 * actually takes has one more step before that: break, read the fact, go to that spot, fix.
	 *
	 * If that chain breaks (qualification set wrongly, the diagnostic not reaching `Problems`, the
	 * line not clickable), the value tests stay all green and the creator cannot find the cause.
	 */
	await paste(page, BROKEN);

	/**
	 * The qualification disappears first. The check state goes to `Checking` on every edit and
	 * then to `Problems`, so the signal to wait for is not a text but the fact that the run
	 * button becomes disabled.
	 */
	await expect(run).toBeDisabled({ timeout: 90_000 });

	/** The check status in the studio header is the route to the `Problems` panel. */
	await page.getByRole("button", { name: /Open problems panel$/ }).click();

	/**
	 * That line is a sentence written by this repo's compiler. Clicking it jumps to the location. A
	 * diagnostic not tied to a file cannot be clicked, so being clickable means a position is
	 * attached.
	 */
	const problem = page.getByRole("button", {
		name: new RegExp(FORBIDDEN_IMPORT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
	});
	await expect(problem).toBeVisible({ timeout: 90_000 });
	await problem.click();
	await expect(page.getByRole("code")).toContainText("left-pad");

	await paste(page, SOURCE);

	/**
	 * The fixed state is signaled by qualification, not by re-reading the editor text. Monaco
	 * virtualizes view lines, so DOM text order differs from on-screen order. Depending on scroll
	 * position, the same word can split into two pieces, and a failure would then reflect the editor's
	 * rendering rather than the code.
	 *
	 * If a forbidden import remains, a blocking error is raised and this button does not appear.
	 */
	await expect(run).toBeEnabled({ timeout: 90_000 });

	await run.click();
	await expect(previewSurface(page).getByText(MARKER)).toBeVisible({
		timeout: 120_000,
	});

	/**
	 * The way out is a fixed URL (the studio can be opened without going through the list). Publishing
	 * happens here rather than in the studio, which is why the journey passes through this route.
	 */
	await clickUntil(page, DRAFT_URL, () =>
		page.getByRole("link", { name: "Back to the draft editor" }),
	);

	const title = page.getByLabel("Title");
	await expect(title).toBeVisible({ timeout: 30_000 });
	await title.fill(`Journey 21 ${MARKER}`);

	/**
	 * The prompt is left empty on purpose. For a publish carrying runtime source, the prompt is not
	 * required (`validateStoryPublication`). If that rule breaks, `Some things need fixing before you can publish` appears here
	 * and the journey stops. That fact must be observed at this point.
	 */
	const publish = page.getByRole("button", { name: /^Publish/ });
	await expect(publish).toBeVisible({ timeout: 15_000 });

	/**
	 * Publishing first flushes the pending autosave, then the server recompiles the source. The
	 * success signal is navigation to the story detail page, not an arbitrary wait.
	 */
	await clickUntil(page, STORY_URL, () => publish, 120_000);

	/**
	 * The primary action label is `Play`, not `Start conversation`. The server projects
	 * `playMode`, so this label means the publish request carried a runtime and the server compiled
	 * and stored it.
	 */
	await clickUntil(page, PLAYER_URL, () =>
		page.getByRole("button", { name: "Play" }),
	);

	/**
	 * And that screen is the code this creator pasted. The whole chain, from the server-supplied
	 * artifact running in QuickJS to becoming a screen, hangs on this one line.
	 */
	await expect(playerSurface(page).getByText(MARKER)).toBeVisible({
		timeout: 120_000,
	});

	/**
	 * The play screen has no beta badge. It is not our place to comment on a work the creator
	 * published.
	 */
	await expect(page.getByText(BETA_BADGE, { exact: true })).toHaveCount(0);
});
