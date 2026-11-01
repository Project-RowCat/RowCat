import type { Page, Route } from "@playwright/test";
import {
	createAccount,
	expect,
	newAccount,
	sendMessage,
	startChatFromStory,
	test,
	ui,
} from "../support/fixtures.ts";
import { API_ORIGIN, STUB_ORIGIN, WEB_ORIGIN } from "../support/origins.ts";

/**
 * Journey 24: a personal API key (BYO) generates from the browser, and the key never reaches
 * RowCat's servers.
 *
 * The adapters are value-tested (`lib/generation/adapters.test.ts`): request shape, stream parsing,
 * failure vocabulary. What no unit can say is how the pieces meet in a real document: the key typed
 * into settings is checked against the provider, sealed into this device's store, chosen as the
 * generation target, and read back when a turn starts — and the request then goes from the browser
 * to the provider with that key, while nothing addressed to RowCat carries it. That last sentence is
 * the product's promise on the connect dialog ("never sent to RowCat's server").
 *
 * The provider is replaced at the browser's edge (`page.route`), so no real key is used and nothing
 * leaves this machine. Unlike the managed path's generation double, a filled response is enough here:
 * this journey is about where the request goes and with what, not about streaming timing.
 */

const ANTHROPIC = "https://api.anthropic.com";
const REPLY = "A reply written by the provider double.";

/** One answer in Anthropic's server-sent event shape, the way the adapter parses it. */
function anthropicStream(text: string): string {
	const events: [string, unknown][] = [
		[
			"message_start",
			{
				type: "message_start",
				message: {
					id: "msg_e2e",
					type: "message",
					role: "assistant",
					model: "claude-fable-5-1",
					content: [],
					usage: { input_tokens: 12, output_tokens: 1 },
				},
			},
		],
		[
			"content_block_start",
			{
				type: "content_block_start",
				index: 0,
				content_block: { type: "text", text: "" },
			},
		],
		[
			"content_block_delta",
			{
				type: "content_block_delta",
				index: 0,
				delta: { type: "text_delta", text },
			},
		],
		["content_block_stop", { type: "content_block_stop", index: 0 }],
		[
			"message_delta",
			{
				type: "message_delta",
				delta: { stop_reason: "end_turn" },
				usage: { output_tokens: 8 },
			},
		],
		["message_stop", { type: "message_stop" }],
	];
	return events
		.map(
			([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
		)
		.join("");
}

interface ProviderCall {
	method: string;
	path: string;
	apiKey: string | undefined;
	body: unknown;
}

/** Answers the provider's two endpoints this flow uses and records what reached them. */
async function replaceAnthropic(page: Page): Promise<ProviderCall[]> {
	const calls: ProviderCall[] = [];
	await page.route(`${ANTHROPIC}/**`, async (route: Route) => {
		const request = route.request();
		const url = new URL(request.url());
		/** A browser preflight carries no key; answering it is the provider's CORS, not this test. */
		if (request.method() === "OPTIONS") {
			await route.fulfill({
				status: 204,
				headers: {
					"access-control-allow-origin": "*",
					"access-control-allow-headers": "*",
					"access-control-allow-methods": "GET, POST",
				},
			});
			return;
		}
		calls.push({
			method: request.method(),
			path: url.pathname,
			apiKey: request.headers()["x-api-key"],
			body: request.postDataJSON() ?? null,
		});
		const cors = { "access-control-allow-origin": "*" };
		if (url.pathname === "/v1/models") {
			await route.fulfill({
				status: 200,
				headers: cors,
				contentType: "application/json",
				body: JSON.stringify({ data: [{ id: "claude-fable-5-1" }] }),
			});
			return;
		}
		if (url.pathname === "/v1/messages") {
			await route.fulfill({
				status: 200,
				headers: cors,
				contentType: "text/event-stream",
				body: anthropicStream(REPLY),
			});
			return;
		}
		await route.fulfill({ status: 404, headers: cors });
	});
	return calls;
}

async function chooseOption(
	page: Page,
	trigger: import("@playwright/test").Locator,
	optionName: string,
) {
	await trigger.click();
	await page.getByRole("option", { name: optionName, exact: true }).click();
}

test("a personal Anthropic key generates from the browser and never reaches RowCat", async ({
	page,
	context,
}) => {
	const account = newAccount("journey24");
	await createAccount(context, account);
	const key = `sk-ant-e2e-${account.email.split("@")[0]}`;

	/** Everything addressed to RowCat — the API, the generation double in front of it, the web server. */
	const toRowCat: { url: string; carriesKey: boolean }[] = [];
	page.on("request", (request) => {
		const url = request.url();
		if (![API_ORIGIN, STUB_ORIGIN, WEB_ORIGIN].some((o) => url.startsWith(o)))
			return;
		const headers = Object.values(request.headers()).join("\n");
		const body = request.postData() ?? "";
		toRowCat.push({
			url,
			carriesKey: [url, headers, body].some((part) => part.includes(key)),
		});
	});
	const provider = await replaceAnthropic(page);

	await page.goto("/settings/ai");
	const anthropicRow = page
		.getByRole("main")
		.getByRole("listitem")
		.filter({ hasText: "Anthropic" });
	/** Server-rendered: the button is visible before React owns it, so press until the dialog opens. */
	const dialog = page.getByRole("dialog");
	await expect(async () => {
		await anthropicRow.getByRole("button", { name: "Connect" }).click({
			timeout: 2_000,
		});
		await expect(dialog).toBeVisible({ timeout: 2_000 });
	}).toPass({ timeout: 30_000 });
	await dialog.getByRole("textbox", { name: "API key" }).fill(key);
	await dialog.getByRole("button", { name: "Connect", exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await expect(anthropicRow).toContainText("Connected");

	/** The key was checked against the provider (listing models spends no tokens), with that key. */
	expect(provider.map((call) => [call.method, call.path])).toEqual([
		["GET", "/v1/models"],
	]);
	expect(provider[0]?.apiKey).toBe(key);

	const settings = page.getByRole("main");
	await chooseOption(
		page,
		settings.getByRole("combobox", { name: /Provider$/ }),
		"Anthropic",
	);
	await chooseOption(
		page,
		settings.getByRole("combobox", { name: /Model$/ }),
		"Claude Fable 5.1",
	);

	const roomId = await startChatFromStory(page);
	await sendMessage(page, "Hello from a personal key");
	await expect(page.getByText(REPLY)).toBeVisible();
	await expect(ui.send(page)).toBeVisible();

	const messages = provider.filter((call) => call.path === "/v1/messages");
	expect(messages).toHaveLength(1);
	expect(messages[0]?.apiKey).toBe(key);
	const body = messages[0]?.body as {
		model?: string;
		stream?: boolean;
		messages?: { role: string; content: unknown }[];
	};
	expect(body.model).toBe("claude-fable-5-1");
	expect(body.stream).toBe(true);
	expect(JSON.stringify(body.messages)).toContain("Hello from a personal key");

	/** The turn went to the provider, not to the managed door — and no RowCat request carried the key. */
	expect(toRowCat.some((r) => r.url.includes("/v2/me"))).toBe(true);
	expect(toRowCat.some((r) => r.url.includes("/chat/generate"))).toBe(false);
	expect(toRowCat.filter((r) => r.carriesKey).map((r) => r.url)).toEqual([]);

	/** The answer is this device's conversation, so it is still there after a reload. */
	await page.reload();
	await expect(page).toHaveURL(new RegExp(`/chat/${roomId}$`));
	await expect(page.getByText(REPLY)).toBeVisible();
	expect(provider.filter((call) => call.path === "/v1/messages")).toHaveLength(
		1,
	);
});
