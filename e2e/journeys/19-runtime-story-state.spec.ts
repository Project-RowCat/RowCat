import type { Locator, Page } from "@playwright/test";
import {
	createAccount,
	expect,
	newAccount,
	test,
} from "../support/fixtures.ts";

/**
 * Journey 19: restart carries progress over, and play reset clears it.
 *
 * This is the Phase 6A acceptance scenario. The engine invariant (discarding the VM and building a
 * new one from a snapshot continues progress) is already checked by value in @rowcat/runtime-host's
 * pipeline tests on real QuickJS. This journey adds:
 * - The two actions: whether `Restart` and `Reset play` do visibly different things.
 * - Lifetimes: on the same screen, useState starts over while useStoryState continues.
 * - Authoring path: edit the source to v2 and restart. Does the first frame already show the
 *   migrated value?
 *
 * The source is pasted for the same reason as journey 18. Typing would trigger auto-indent and
 * auto-close, which rewrite the source.
 */

/**
 * v1: the session value (`Local`) and the playthrough value (`Trust`) appear side by side on one
 * screen.
 */
const SOURCE_V1 = `import { Button, Screen, Stack, Text, color, defineStoryState, useState, useStoryState } from "@rowcat/runtime";

const game = defineStoryState({ key: "game", version: 1, initial: { trust: 40 } });

export default function App() {
	const [local, setLocal] = useState(0);
	const [story, setStory] = useStoryState(game);
	return (
		<Screen background={color("#111111")}>
			<Stack gap={12} style={{ padding: 16 }}>
				<Text style={{ color: color("#ffffff"), fontSize: 20 }}>Local: {local}</Text>
				<Text style={{ color: color("#ffffff"), fontSize: 20 }}>Trust: {story.trust}</Text>
				<Button tone="primary" onPress={() => { setLocal((value) => value + 1); setStory((current) => ({ ...current, trust: current.trust + 10 })); }}>Continue</Button>
			</Stack>
		</Screen>
	);
}
`;

/**
 * v2: a new round starts and `migrate` carries the old values across. The `initial` value of
 * `trust` being `0` is the point: if `Trust: 0` appears in the first frame, either migration did
 * not run (the save was discarded) or hydration came after render.
 */
const SOURCE_V2 = `import { Button, Screen, Stack, Text, color, defineStoryState, useState, useStoryState } from "@rowcat/runtime";

const game = defineStoryState({
	key: "game",
	version: 2,
	initial: { trust: 0, clues: [] as string[] },
	migrate: (stored, fromVersion) => {
		if (fromVersion === 1) {
			const old = stored as { trust: number };
			return { trust: old.trust, clues: [] as string[] };
		}
		throw new Error("Unsupported version " + fromVersion);
	},
});

export default function App() {
	const [local, setLocal] = useState(0);
	const [story, setStory] = useStoryState(game);
	return (
		<Screen background={color("#111111")}>
			<Stack gap={12} style={{ padding: 16 }}>
				<Text style={{ color: color("#ffffff"), fontSize: 20 }}>Local: {local}</Text>
				<Text style={{ color: color("#ffffff"), fontSize: 20 }}>Trust: {story.trust} / {story.clues.length}</Text>
				<Button tone="primary" onPress={() => { setLocal((value) => value + 1); setStory((current) => ({ ...current, trust: current.trust + 10 })); }}>Continue</Button>
			</Stack>
		</Screen>
	);
}
`;

const surface = (page: Page): Locator =>
	page.getByTestId("runtime-preview-surface");

/**
 * Selects all in the editor and pastes. The modifier-key split is explained in journey 18's
 * comment.
 */
async function paste(page: Page, source: string): Promise<void> {
	await page.evaluate((text) => navigator.clipboard.writeText(text), source);
	await page.getByRole("code").click();
	await page.keyboard.press("Control+A");
	await page.keyboard.press("ControlOrMeta+V");
}

test("restart carries saved state over, reset play clears it, and raising the version migrates it", async ({
	page,
	context,
}) => {
	test.setTimeout(300_000);
	const account = newAccount("journey19");
	await createAccount(context, account);
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);

	await page.goto("/create");
	const create = page.getByRole("button", { name: /^New story/ });
	const DRAFT_URL = /\/create\/[^/]+$/;
	await expect(async () => {
		if (!DRAFT_URL.test(page.url()))
			await create.first().click({ timeout: 2_000 });
		await page.waitForURL(DRAFT_URL, { timeout: 10_000 });
	}).toPass({ timeout: 60_000 });

	const enable = page.getByRole("button", { name: "Get started", exact: true });
	await expect(enable).toBeVisible({ timeout: 30_000 });
	await enable.click();
	/**
	 * Picks `Blank` explicitly, as in journey 18. This journey asks about the lifetime of saved state,
	 * so it also starts from the smallest project, which keeps any failure attributable.
	 */
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByRole("button", { name: /^Blank/ })).toBeVisible({
		timeout: 15_000,
	});
	await dialog.getByRole("button", { name: /^Blank/ }).click();

	const confirm = dialog.getByRole("button", { name: /^Start with / });
	await expect(confirm).toBeEnabled({ timeout: 15_000 });
	await confirm.click();
	const STUDIO_URL = /\/create\/[^/]+\/runtime$/;
	await expect(async () => {
		if (!STUDIO_URL.test(page.url()))
			await page
				.getByRole("link", { name: "Open studio" })
				.click({ timeout: 3_000 });
		await page.waitForURL(STUDIO_URL, { timeout: 10_000 });
	}).toPass({ timeout: 45_000 });

	const studioMenu = page.getByRole("button", { name: "Studio menu" });
	await expect(studioMenu).toBeVisible({ timeout: 120_000 });

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

	await paste(page, SOURCE_V1);
	await expect(page.getByRole("code")).toContainText("defineStoryState");

	const run = runButton;
	await expect(run).toBeEnabled({ timeout: 90_000 });
	await run.click();

	const local = surface(page).getByText(/^Local: \d+$/);
	const trust = surface(page).getByText(/^Trust: /);
	await expect(local).toHaveText("Local: 0", { timeout: 120_000 });
	await expect(trust).toHaveText("Trust: 40");

	const advance = surface(page).getByRole("button", { name: "Continue" });
	await advance.click();
	await expect(local).toHaveText("Local: 1");
	await expect(trust).toHaveText("Trust: 50");

	/**
	 * The State tab draws the current snapshot as JSON, rendered by the trusted studio UI. The
	 * creator's code contributes nothing to this string.
	 */
	await page.getByRole("tab", { name: "State" }).click();
	const statePanel = page.getByRole("tabpanel");
	await expect(statePanel).toContainText("game");
	await expect(statePanel).toContainText('"trust": 50');

	await page.getByRole("button", { name: "Restart" }).click();
	await expect(local).toHaveText("Local: 0", { timeout: 90_000 });
	await expect(trust).toHaveText("Trust: 50");

	await page.getByRole("button", { name: "Reset play" }).click();
	await expect(trust).toHaveText("Trust: 40", { timeout: 90_000 });
	await expect(local).toHaveText("Local: 0");

	await advance.click();
	await advance.click();
	await expect(trust).toHaveText("Trust: 60");

	await paste(page, SOURCE_V2);
	/**
	 * Monaco renders only the visible lines into the DOM, so the `migrate` block off-screen cannot be
	 * observed. The signal that the paste arrived is a visible character near the end.
	 */
	await expect(page.getByRole("code")).toContainText("clues");

	const restart = page.getByRole("button", { name: "Restart" });
	await expect(restart).toBeEnabled({ timeout: 60_000 });
	await restart.click();

	/**
	 * The first frame is already the moved value. If `Trust: 0 / 0` shows even briefly, hydration came
	 * after render, and that frame shows the player progress that seems to have vanished.
	 */
	await expect(surface(page).getByText(/^Trust: /)).toHaveText(
		"Trust: 60 / 0",
		{
			timeout: 90_000,
		},
	);
	await expect(local).toHaveText("Local: 0");

	/**
	 * The snapshot after the move is the new round. The next restart does not run the migration again.
	 */
	await expect(statePanel).toContainText('"clues"');
});
