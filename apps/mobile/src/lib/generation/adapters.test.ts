import { CONTINUATION_FALLBACK_NUDGE } from "@rowcat/chat";
import type {
	ChatGenerationMessage,
	ChatGenerationRequest,
	ChatStreamEvent,
	ChatToolDeclaration,
} from "@rowcat/contracts";
import { describe, expect, it } from "vitest";
import {
	fakeFetch,
	fakeResponse,
	respondWith,
	sseFrame,
	streamOf,
} from "../../test/byo-fetch.ts";
import { anthropicAdapter } from "./anthropic.ts";
import type { ByoAdapter, ByoTransportInput } from "./byo.ts";
import { ProviderError } from "./errors.ts";
import { geminiAdapter } from "./gemini.ts";

/**
 * Protocol of the two BYO adapters: the mapping and its boundary.
 *
 * Every failure this file targets compiles cleanly and only shows up on device. Four of them are
 * hard to undo:
 *
 * ```text
 * vendor body leak     error messages carry account info and prompts
 * thinking leak        model reasoning flows into the bubble and is saved as-is
 * truncated stream     an incomplete response is confirmed as complete
 * usage swap           without adding Anthropic's input axis, total input is a fraction of the real value
 * late request         if `start()` is lazy, the plaintext key outlives the credential callback
 * ```
 *
 * The last line is the axis added later. It is the only one that checks **timing** (the "two-step"
 * group).
 */

/**
 * Builds a user or assistant message. Tool messages are not built here: they only make sense next
 * to their paired call, so the tool tests build the whole array.
 */
const message = (
	role: "user" | "assistant",
	content: string,
): ChatGenerationMessage => ({ role, content });

const request = (
	overrides: Partial<ChatGenerationRequest> = {},
): ChatGenerationRequest => ({
	system: "System prompt",
	messages: [message("user", "Hi")],
	maxOutputTokens: 768,
	reasoningEffort: null,
	context: { requestedMode: "all-ages", minorCharacterPresent: false },
	tools: [],
	/** Plain generation by default. The continuation path sets up its own describe block. */
	continuation: false,
	...overrides,
});

const drain = async (
	events: AsyncIterable<ChatStreamEvent>,
): Promise<ChatStreamEvent[]> => {
	const seen: ChatStreamEvent[] = [];
	for await (const event of events) seen.push(event);
	return seen;
};

/**
 * Runs the adapter once: **sends the request** (`start`) and reads the response to the end.
 *
 * The two steps share one helper because most checks here compare what went out with what came
 * back. The helper must not hide timing, so **checks that call `start()` directly are below** (the
 * "two-step" group). That is where this contract's P0 is held.
 *
 * A failure thrown by `start()` (before the stream begins) and one mid-stream surface in the same
 * place.
 */
const run = async (
	adapter: ByoAdapter,
	input: ByoTransportInput,
): Promise<ChatStreamEvent[]> => drain(await adapter.start(input));

const bodyOf = (raw: string | undefined): Record<string, unknown> =>
	JSON.parse(raw ?? "{}") as Record<string, unknown>;

const signal = () => new AbortController().signal;

/** Minimal normal Anthropic response flow, including the terminal event. */
const anthropicStream = (extra: readonly string[] = []) =>
	streamOf([
		sseFrame(
			JSON.stringify({
				type: "message_start",
				message: {
					model: "claude-sonnet-5",
					usage: {
						input_tokens: 10,
						cache_creation_input_tokens: 3,
						cache_read_input_tokens: 7,
					},
				},
			}),
		),
		sseFrame(
			JSON.stringify({
				type: "content_block_delta",
				delta: { type: "text_delta", text: "H" },
			}),
		),
		...extra,
		sseFrame(
			JSON.stringify({
				type: "message_delta",
				delta: { stop_reason: "end_turn" },
				usage: { output_tokens: 5 },
			}),
		),
		sseFrame(JSON.stringify({ type: "message_stop" })),
	]);

/** Minimal normal Gemini response flow. The finish reason is the basis for completion. */
const geminiStream = (extraParts: readonly unknown[] = []) =>
	streamOf([
		sseFrame(
			JSON.stringify({
				candidates: [{ content: { parts: [{ text: "H" }, ...extraParts] } }],
				modelVersion: "gemini-3-pro",
			}),
		),
		sseFrame(
			JSON.stringify({
				candidates: [{ finishReason: "STOP" }],
				usageMetadata: {
					promptTokenCount: 20,
					cachedContentTokenCount: 7,
					candidatesTokenCount: 5,
				},
			}),
		),
	]);

describe("Anthropic adapter", () => {
	it("endpoint and auth header", async () => {
		const transport = respondWith(fakeResponse({ body: anthropicStream() }));
		await run(anthropicAdapter, {
			request: request(),
			model: "claude-sonnet-5",
			secret: "sk-test",
			signal: signal(),
			fetch: transport.fetch,
		});

		const call = transport.calls[0];
		expect(call?.url).toBe("https://api.anthropic.com/v1/messages");
		expect(call?.method).toBe("POST");
		expect(call?.headers["x-api-key"]).toBe("sk-test");
		expect(call?.headers["anthropic-version"]).toBe("2023-06-01");
		/**
		 * **Does not attach browser-only headers.** This runtime has no CORS preflight, and attaching
		 * them by habit leads the next reader to diagnose native failures as CORS.
		 */
		expect(
			call?.headers["anthropic-dangerous-direct-browser-access"],
		).toBeUndefined();
	});

	it("the system prompt is top-level and untouched", async () => {
		const transport = respondWith(fakeResponse({ body: anthropicStream() }));
		await run(anthropicAdapter, {
			request: request({ system: "The value our assembler made" }),
			model: "claude-sonnet-5",
			secret: "sk",
			signal: signal(),
			fetch: transport.fetch,
		});
		expect(bodyOf(transport.calls[0]?.body).system).toEqual([
			{
				type: "text",
				text: "The value our assembler made",
				cache_control: { type: "ephemeral" },
			},
		]);
	});

	/**
	 * **Two breakpoints: the automatic one and the end of the system block.** Past `CHAT_HISTORY_LIMIT`
	 * the history window drops its oldest message every turn, so the automatic breakpoint alone never
	 * finds its previous entry again. Dropping either is silent — the symptom is the bill.
	 */
	it("caches the system prompt on its own breakpoint as well as automatically", async () => {
		const transport = respondWith(fakeResponse({ body: anthropicStream() }));
		await run(anthropicAdapter, {
			request: request(),
			model: "claude-sonnet-5",
			secret: "sk",
			signal: signal(),
			fetch: transport.fetch,
		});
		const sent = bodyOf(transport.calls[0]?.body);
		expect(sent.cache_control).toEqual({ type: "ephemeral" });
		expect(
			(sent.system as Array<{ cache_control: unknown }>)[0]?.cache_control,
		).toEqual({ type: "ephemeral" });
	});

	it("an empty system prompt stays a string (an empty text block is a 400)", async () => {
		const transport = respondWith(fakeResponse({ body: anthropicStream() }));
		await run(anthropicAdapter, {
			request: request({ system: "" }),
			model: "claude-sonnet-5",
			secret: "sk",
			signal: signal(),
			fetch: transport.fetch,
		});
		expect(bodyOf(transport.calls[0]?.body).system).toBe("");
	});

	/**
	 * **If the user speaks again after an unanswered user turn, the messages become `user, user`.**
	 * Sent as-is, that room gets a 400 forever after one failure.
	 */
	it("consecutive turns of the same role merge with a blank line", async () => {
		const transport = respondWith(fakeResponse({ body: anthropicStream() }));
		await run(anthropicAdapter, {
			request: request({
				messages: [
					message("user", "one"),
					message("user", "two"),
					message("assistant", "Answer"),
					message("assistant", "Answer2"),
					message("user", "three"),
				],
			}),
			model: "claude-sonnet-5",
			secret: "sk",
			signal: signal(),
			fetch: transport.fetch,
		});
		expect(bodyOf(transport.calls[0]?.body).messages).toEqual([
			{ role: "user", content: "one\n\ntwo" },
			{ role: "assistant", content: "Answer\n\nAnswer2" },
			{ role: "user", content: "three" },
		]);
	});

	/**
	 * **Reasoning APIs differ by generation.** Pushing one table onto every Claude makes the newest
	 * generation return a 400.
	 *
	 * ```text
	 * adaptive only   thinking: { type: "adaptive" } + output_config.effort   rejects "enabled"
	 * extended only   thinking: { type: "enabled", budget_tokens }            rejects "adaptive"
	 * ```
	 *
	 * Do not represent a whole company with one model. This file once checked only `claude-sonnet-5`,
	 * and code sending an extended budget to that model passed green in the meantime.
	 */
	describe("reasoning mode", () => {
		const bodyFor = async (
			model: string,
			reasoningEffort: ChatGenerationRequest["reasoningEffort"],
		) => {
			const transport = respondWith(fakeResponse({ body: anthropicStream() }));
			await run(anthropicAdapter, {
				request: request({ reasoningEffort }),
				model,
				secret: "sk",
				signal: signal(),
				fetch: transport.fetch,
			});
			return bodyOf(transport.calls[0]?.body);
		};

		const ADAPTIVE = [
			"claude-fable-5-1",
			"claude-fable-5",
			"claude-opus-5-5",
			"claude-opus-5",
			"claude-sonnet-5-5",
			"claude-sonnet-5",
			"claude-opus-4-8",
			"claude-opus-4-7",
			"claude-opus-4-6",
			"claude-sonnet-4-6",
		];
		const MANUAL = ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"];

		it("absent means the key itself is absent", async () => {
			const body = await bodyFor("claude-sonnet-5", null);
			expect("thinking" in body).toBe(false);
			expect("output_config" in body).toBe(false);
			expect(body.max_tokens).toBe(768);
		});

		it.each(ADAPTIVE)("%s is adaptive + effort level", async (model) => {
			const body = await bodyFor(model, "medium");
			expect(body.thinking).toEqual({ type: "adaptive" });
			expect(body.output_config).toEqual({ effort: "medium" });
		});

		/** A leaked old parameter makes the request a 400, and turning reasoning off hides the cause. */
		it.each(ADAPTIVE)("%s has no thinking budget", async (model) => {
			expect(JSON.stringify(await bodyFor(model, "high"))).not.toContain(
				"budget_tokens",
			);
		});

		/**
		 * **Adaptive reasoning does not get output-cap arithmetic.** There is no budget to add, and an
		 * arbitrary number raises the billing cap by an amount the user never chose.
		 */
		it.each(ADAPTIVE)("%s keeps the output cap", async (model) => {
			expect((await bodyFor(model, "high")).max_tokens).toBe(768);
		});

		it.each(MANUAL)("%s is a thinking budget", async (model) => {
			expect((await bodyFor(model, "medium")).thinking).toEqual({
				type: "enabled",
				budget_tokens: 4096,
			});
		});

		it.each(MANUAL)("%s has no adaptive or effort", async (model) => {
			const body = await bodyFor(model, "medium");
			expect("output_config" in body).toBe(false);
			expect(JSON.stringify(body)).not.toContain("adaptive");
		});

		/**
		 * In extended mode, thinking tokens are consumed within `max_tokens`, so the cap is **raised by
		 * that amount**. Otherwise raising the reasoning level shortens the response the user sees.
		 */
		it("only the extended mode raises the output cap by that much", async () => {
			expect((await bodyFor("claude-haiku-4-5", "medium")).max_tokens).toBe(
				768 + 4096,
			);
		});

		/** This provider has no `minimal` band. Running without reasoning beats sending a value it would reject. */
		it.each([
			...ADAPTIVE,
			...MANUAL,
		])("on %s minimal drops the parameter", async (model) => {
			const body = await bodyFor(model, "minimal");
			expect("thinking" in body).toBe(false);
			expect("output_config" in body).toBe(false);
		});

		/** Stored preferences outlive the catalogue, so do not guess the method for an unknown name. */
		it("carries nothing for models not in the table", async () => {
			const body = await bodyFor("claude-retired-model", "high");
			expect("thinking" in body).toBe(false);
			expect("output_config" in body).toBe(false);
		});

		/** Do not send a value that **disables** thinking. Some models reject it with a 400. */
		it("doesn't send a value that turns thinking off", async () => {
			expect(
				JSON.stringify(await bodyFor("claude-fable-5", "low")),
			).not.toContain("disabled");
		});
	});

	/**
	 * **Thinking deltas do not flow into the bubble.** The reasoning level decides how much the model
	 * thinks, not whether that thinking is shown.
	 */
	it("doesn't stream thinking deltas", async () => {
		const transport = respondWith(
			fakeResponse({
				body: anthropicStream([
					sseFrame(
						JSON.stringify({
							type: "content_block_delta",
							delta: {
								type: "thinking_delta",
								text: "What it thought privately",
							},
						}),
					),
					sseFrame(
						JSON.stringify({
							type: "content_block_delta",
							delta: { type: "text_delta", text: "i" },
						}),
					),
				]),
			}),
		);
		const events = await run(anthropicAdapter, {
			request: request(),
			model: "claude-sonnet-5",
			secret: "sk",
			signal: signal(),
			fetch: transport.fetch,
		});
		const text = events
			.filter((event) => event.type === "delta")
			.map((event) => event.text)
			.join("");
		expect(text).toBe("Hi");
		expect(JSON.stringify(events)).not.toContain("What it thought privately");
	});

	/**
	 * **P0.** This provider's `input_tokens` excludes the cache. Without adding, a long conversation
	 * with a good cache hit is recorded at a fraction of its real total input. That is why the three
	 * numbers are kept distinct: unsummed, none of them can match the total by coincidence.
	 */
	it("total input is the sum of the three axes", async () => {
		const transport = respondWith(fakeResponse({ body: anthropicStream() }));
		const events = await run(anthropicAdapter, {
			request: request(),
			model: "claude-sonnet-5",
			secret: "sk",
			signal: signal(),
			fetch: transport.fetch,
		});
		const usage = events.find((event) => event.type === "usage");
		expect(usage).toEqual({
			type: "usage",
			model: "claude-sonnet-5",
			inputTokens: 20,
			cachedInputTokens: 7,
			cacheWriteInputTokens: 3,
			outputTokens: 5,
		});
	});

	/** Usage arrives **before** `done`. If it arrived after, it would land after saving and not attach to that message. */
	it("usage comes before the finish", async () => {
		const transport = respondWith(fakeResponse({ body: anthropicStream() }));
		const kinds = (
			await run(anthropicAdapter, {
				request: request(),
				model: "claude-sonnet-5",
				secret: "sk",
				signal: signal(),
				fetch: transport.fetch,
			})
		).map((event) => event.type);
		expect(kinds.indexOf("usage")).toBeLessThan(kinds.indexOf("done"));
		expect(kinds.at(-1)).toBe("done");
	});

	/** Values the provider did not state are **not sent**. 0 would claim that nothing was cached. */
	it("axes the provider didn't report have no key", async () => {
		const transport = respondWith(
			fakeResponse({
				body: streamOf([
					sseFrame(
						JSON.stringify({
							type: "message_start",
							message: { model: "m", usage: { input_tokens: 4 } },
						}),
					),
					sseFrame(JSON.stringify({ type: "message_stop" })),
				]),
			}),
		);
		const usage = (
			await run(anthropicAdapter, {
				request: request(),
				model: "m",
				secret: "sk",
				signal: signal(),
				fetch: transport.fetch,
			})
		).find((event) => event.type === "usage");
		expect(usage).toEqual({ type: "usage", model: "m", inputTokens: 4 });
	});

	describe("failure", () => {
		it.each([
			[401, "invalid_credential"],
			[403, "invalid_credential"],
			[402, "quota_exceeded"],
			[404, "model_unavailable"],
			[429, "rate_limited"],
			[500, "provider_error"],
			[503, "provider_error"],
		])("%i → %s", async (status, code) => {
			const transport = respondWith(fakeResponse({ ok: false, status }));
			const error = await run(anthropicAdapter, {
				request: request(),
				model: "m",
				secret: "sk",
				signal: signal(),
				fetch: transport.fetch,
			}).catch((thrown: unknown) => thrown);
			expect(error).toBeInstanceOf(ProviderError);
			expect((error as ProviderError).code).toBe(code);
		});

		it("carries Retry-After as is", async () => {
			const transport = respondWith(
				fakeResponse({
					ok: false,
					status: 429,
					headers: { "retry-after": "42" },
				}),
			);
			const error = await run(anthropicAdapter, {
				request: request(),
				model: "m",
				secret: "sk",
				signal: signal(),
				fetch: transport.fetch,
			}).catch((thrown: unknown) => thrown);
			expect((error as ProviderError).retryAfterSeconds).toBe(42);
		});

		/** A failure after the stream starts is **not thrown**. It flows as an event. */
		it("errors mid-stream are events", async () => {
			const transport = respondWith(
				fakeResponse({
					body: streamOf([
						sseFrame(
							JSON.stringify({
								type: "content_block_delta",
								delta: { type: "text_delta", text: "Partial" },
							}),
						),
						sseFrame(
							JSON.stringify({
								type: "error",
								error: { type: "overloaded_error" },
							}),
						),
					]),
				}),
			);
			const events = await run(anthropicAdapter, {
				request: request(),
				model: "m",
				secret: "sk",
				signal: signal(),
				fetch: transport.fetch,
			});
			expect(events[0]).toEqual({ type: "delta", text: "Partial" });
			expect(events[1]).toEqual({
				type: "error",
				code: "rate_limited",
				message: expect.any(String),
			});
			expect(events.some((event) => event.type === "done")).toBe(false);
		});

		/**
		 * **A stream that ends without a terminal event is not complete.** Reporting it as a normal
		 * finish would confirm the truncated response locally as a complete one.
		 */
		it("ending without a finish ends in an error event", async () => {
			const transport = respondWith(
				fakeResponse({
					body: streamOf([
						sseFrame(
							JSON.stringify({
								type: "content_block_delta",
								delta: { type: "text_delta", text: "Cut" },
							}),
						),
					]),
				}),
			);
			const events = await run(anthropicAdapter, {
				request: request(),
				model: "m",
				secret: "sk",
				signal: signal(),
				fetch: transport.fetch,
			});
			expect(events.at(-1)?.type).toBe("error");
			expect(events.some((event) => event.type === "done")).toBe(false);
		});

		/** Aborting is not an error. Callers must treat it as the user pressing stop. */
		it("the abort signal is thrown as is", async () => {
			const controller = new AbortController();
			controller.abort();
			const transport = respondWith(fakeResponse({ body: anthropicStream() }));
			const thrown = await run(anthropicAdapter, {
				request: request(),
				model: "m",
				secret: "sk",
				signal: controller.signal,
				fetch: transport.fetch,
			}).catch((error: unknown) => error);
			expect((thrown as Error).name).toBe("AbortError");
			expect(thrown).not.toBeInstanceOf(ProviderError);
		});

		/** One request, one round trip. **No automatic retry.** */
		it("doesn't resend on failure", async () => {
			const transport = respondWith(fakeResponse({ ok: false, status: 500 }));
			await run(anthropicAdapter, {
				request: request(),
				model: "m",
				secret: "sk",
				signal: signal(),
				fetch: transport.fetch,
			}).catch(() => undefined);
			expect(transport.calls).toHaveLength(1);
		});
	});

	it("validation is a single model-list call, not a generation", async () => {
		const transport = respondWith(fakeResponse({}));
		expect(
			await anthropicAdapter.probe({
				secret: "sk",
				signal: signal(),
				fetch: transport.fetch,
			}),
		).toEqual({ ok: true });
		expect(transport.calls[0]?.method).toBe("GET");
		expect(transport.calls[0]?.url).toContain("/v1/models");
		expect(transport.calls[0]?.body).toBeUndefined();
	});

	it("validation failures come back as values", async () => {
		const transport = respondWith(fakeResponse({ ok: false, status: 401 }));
		const check = await anthropicAdapter.probe({
			secret: "sk",
			signal: signal(),
			fetch: transport.fetch,
		});
		expect(check.ok).toBe(false);
		expect(check.ok === false && check.error.code).toBe("invalid_credential");
	});
});

/**
 * Sends once at this tier and returns the `safetySettings` that actually went out.
 *
 * It reads the body because that is what **actually reaches the provider**. Calling the function
 * directly would not confirm that it is attached to the request. The web's helper of the same name
 * does the same job.
 */
const sentSafetySettings = async (
	requestedMode: "all-ages" | "adult",
): Promise<{ category: string; threshold: string }[]> => {
	const transport = respondWith(fakeResponse({ body: geminiStream() }));
	await run(geminiAdapter, {
		request: request({
			context: { requestedMode, minorCharacterPresent: false },
		}),
		model: "gemini-3-pro",
		secret: "gm",
		signal: signal(),
		fetch: transport.fetch,
	});
	return (bodyOf(transport.calls[0]?.body).safetySettings ?? []) as {
		category: string;
		threshold: string;
	}[];
};

describe("Gemini adapter", () => {
	/**
	 * **P0.** A query string is recorded in proxy and access logs. Headers have no such path.
	 */
	it("the key is in the header, not in the URL", async () => {
		const transport = respondWith(fakeResponse({ body: geminiStream() }));
		await run(geminiAdapter, {
			request: request(),
			model: "gemini-3-pro",
			secret: "gm-secret",
			signal: signal(),
			fetch: transport.fetch,
		});
		const call = transport.calls[0];
		expect(call?.headers["x-goog-api-key"]).toBe("gm-secret");
		expect(call?.url).not.toContain("gm-secret");
		expect(call?.url).not.toContain("key=");
		expect(call?.url).toContain(
			"https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro:streamGenerateContent?alt=sse",
		);
	});

	it("the system is systemInstruction and the role is model", async () => {
		const transport = respondWith(fakeResponse({ body: geminiStream() }));
		await run(geminiAdapter, {
			request: request({
				system: "Our system",
				messages: [
					message("user", "one"),
					message("user", "two"),
					message("assistant", "Answer"),
				],
			}),
			model: "gemini-3-pro",
			secret: "gm",
			signal: signal(),
			fetch: transport.fetch,
		});
		const body = bodyOf(transport.calls[0]?.body);
		expect(body.systemInstruction).toEqual({
			parts: [{ text: "Our system" }],
		});
		expect(body.contents).toEqual([
			{ role: "user", parts: [{ text: "one\n\ntwo" }] },
			{ role: "model", parts: [{ text: "Answer" }] },
		]);
	});

	/**
	 * **Reasoning APIs differ by generation.** 3.x takes level names and 2.5 takes a token budget.
	 * **Sending both in one request returns a 400.** The levels each model has also differ (3.7 Flash
	 * and 3.1 Pro have no `minimal`).
	 */
	describe("reasoning mode", () => {
		const configFor = async (
			model: string,
			reasoningEffort: ChatGenerationRequest["reasoningEffort"],
		) => {
			const transport = respondWith(fakeResponse({ body: geminiStream() }));
			await run(geminiAdapter, {
				request: request({ reasoningEffort }),
				model,
				secret: "gm",
				signal: signal(),
				fetch: transport.fetch,
			});
			return bodyOf(transport.calls[0]?.body).generationConfig as Record<
				string,
				unknown
			>;
		};

		const LEVELS = [
			"gemini-3.8-flash",
			"gemini-3.7-flash",
			"gemini-3.6-flash",
			"gemini-3.5-flash",
			"gemini-3.5-flash-lite",
			"gemini-3.1-pro-preview",
			"gemini-3.1-flash-lite",
			"gemini-3-flash-preview",
		];
		const BUDGETS = ["gemini-2.5-pro", "gemini-2.5-flash"];

		it("absent means the key itself is absent", async () => {
			const config = await configFor("gemini-3.5-flash", null);
			expect("thinkingConfig" in config).toBe(false);
		});

		it.each(LEVELS)("%s is a level name", async (model) => {
			expect((await configFor(model, "high")).thinkingConfig).toEqual({
				thinkingLevel: "high",
			});
		});

		it.each(LEVELS)("%s has no thinking budget", async (model) => {
			expect(JSON.stringify(await configFor(model, "medium"))).not.toContain(
				"thinkingBudget",
			);
		});

		it.each(BUDGETS)("%s is a thinking budget", async (model) => {
			expect((await configFor(model, "high")).thinkingConfig).toEqual({
				thinkingBudget: 16384,
			});
		});

		it.each(BUDGETS)("%s has no level name", async (model) => {
			expect(JSON.stringify(await configFor(model, "medium"))).not.toContain(
				"thinkingLevel",
			);
		});

		/** This is where `minimal` actually differs. 3.7 Flash, 3.1 Pro and 2.5 Pro do not have it. */
		it("only models with minimal send that level", async () => {
			expect(
				(await configFor("gemini-3.5-flash", "minimal")).thinkingConfig,
			).toEqual({ thinkingLevel: "minimal" });
			expect(
				(await configFor("gemini-2.5-flash", "minimal")).thinkingConfig,
			).toEqual({ thinkingBudget: 0 });
			expect(
				"thinkingConfig" in (await configFor("gemini-3.7-flash", "minimal")),
			).toBe(false);
			expect(
				"thinkingConfig" in (await configFor("gemini-2.5-pro", "minimal")),
			).toBe(false);
		});

		/**
		 * `gemini-2.5-flash-lite` is **not in the table.** Thinking is off by default and its budget
		 * floor is 512, so there is no value that turns it off. The inherited `Standard` would turn its
		 * thinking on.
		 */
		it("carries nothing for 2.5 Flash-Lite", async () => {
			expect(
				"thinkingConfig" in (await configFor("gemini-2.5-flash-lite", "high")),
			).toBe(false);
		});

		it("carries nothing for models not in the table", async () => {
			expect(
				"thinkingConfig" in (await configFor("gemini-retired-model", "high")),
			).toBe(false);
		});

		/**
		 * **⚠︎ This claim was reversed.** For a while this spot said the provider does not subtract
		 * thinking tokens from the output cap, so Anthropic's adjustment must not be carried over. That
		 * is not true: `maxOutputTokens` caps **thinking and body together**
		 * (googleapis/python-genai#2062, confirmed 2026-09-02). So where the budget is known, the cap is
		 * raised by that amount.
		 */
		it("the budget mode raises the output cap by the budget", async () => {
			expect(
				(await configFor("gemini-2.5-flash", "medium")).maxOutputTokens,
			).toBe(768 + 4_096);
			expect((await configFor("gemini-2.5-pro", "high")).maxOutputTokens).toBe(
				768 + 16_384,
			);
		});

		/**
		 * **A budget of 0 differs from `undefined`.** It is a chosen decision to turn thinking off, so
		 * there is nothing to add. It is not the same value as having no axis at all.
		 */
		it("a budget of 0 doesn't raise the cap", async () => {
			expect(
				(await configFor("gemini-2.5-flash", "minimal")).maxOutputTokens,
			).toBe(768);
		});

		/**
		 * **The level method does not get this arithmetic.** There is no budget to add, and adding an
		 * arbitrary number raises the cap by more than the user chose. Those tokens are billed to the
		 * user's provider account.
		 */
		it("the level mode keeps the output cap", async () => {
			expect(
				(await configFor("gemini-3.5-flash", "high")).maxOutputTokens,
			).toBe(768);
		});

		/** With reasoning off, the body is the same as before this axis existed. */
		it("without reasoning the cap stays", async () => {
			expect((await configFor("gemini-2.5-flash", null)).maxOutputTokens).toBe(
				768,
			);
		});
	});

	/** A part with `thought: true` is a thinking summary, not conversation body. */
	it("doesn't stream thinking parts", async () => {
		const transport = respondWith(
			fakeResponse({
				body: geminiStream([
					{ text: "What it thought privately", thought: true },
					{ text: "i" },
				]),
			}),
		);
		const events = await run(geminiAdapter, {
			request: request(),
			model: "g",
			secret: "gm",
			signal: signal(),
			fetch: transport.fetch,
		});
		expect(
			events
				.filter((event) => event.type === "delta")
				.map((event) => event.text)
				.join(""),
		).toBe("Hi");
		expect(JSON.stringify(events)).not.toContain("What it thought privately");
	});

	/** This provider's `promptTokenCount` is a total **that includes the cache** (the opposite of Anthropic). */
	it("carries usage over as is", async () => {
		const transport = respondWith(fakeResponse({ body: geminiStream() }));
		const usage = (
			await run(geminiAdapter, {
				request: request(),
				model: "g",
				secret: "gm",
				signal: signal(),
				fetch: transport.fetch,
			})
		).find((event) => event.type === "usage");
		expect(usage).toEqual({
			type: "usage",
			model: "gemini-3-pro",
			inputTokens: 20,
			cachedInputTokens: 7,
			outputTokens: 5,
		});
	});

	/** This API has no terminal event. The **finish reason** takes its place. */
	it("the finish reason is the basis for completion", async () => {
		const transport = respondWith(fakeResponse({ body: geminiStream() }));
		const events = await run(geminiAdapter, {
			request: request(),
			model: "g",
			secret: "gm",
			signal: signal(),
			fetch: transport.fetch,
		});
		expect(events.at(-1)).toEqual({ type: "done", finishReason: "STOP" });
	});

	it("ending without a finish reason is an error event", async () => {
		const transport = respondWith(
			fakeResponse({
				body: streamOf([
					sseFrame(
						JSON.stringify({
							candidates: [{ content: { parts: [{ text: "Cut" }] } }],
						}),
					),
				]),
			}),
		);
		const events = await run(geminiAdapter, {
			request: request(),
			model: "g",
			secret: "gm",
			signal: signal(),
			fetch: transport.fetch,
		});
		expect(events.at(-1)?.type).toBe("error");
		expect(events.some((event) => event.type === "done")).toBe(false);
	});

	it("the status code table is the same as Anthropic's", async () => {
		for (const [status, code] of [
			[401, "invalid_credential"],
			[402, "quota_exceeded"],
			[404, "model_unavailable"],
			[429, "rate_limited"],
			[500, "provider_error"],
		] as const) {
			const transport = respondWith(fakeResponse({ ok: false, status }));
			const error = await run(geminiAdapter, {
				request: request(),
				model: "g",
				secret: "gm",
				signal: signal(),
				fetch: transport.fetch,
			}).catch((thrown: unknown) => thrown);
			expect((error as ProviderError).code, `${status}`).toBe(code);
		}
	});

	/**
	 * This API sometimes returns **400** for a wrong key. The status table folds that into
	 * `provider_error`, which gives the wrong guidance at the validation step.
	 */
	it("a 400 in validation is a key problem", async () => {
		const transport = respondWith(fakeResponse({ ok: false, status: 400 }));
		const check = await geminiAdapter.probe({
			secret: "gm",
			signal: signal(),
			fetch: transport.fetch,
		});
		expect(check.ok === false && check.error.code).toBe("invalid_credential");
	});

	it("validation is a single model-list call", async () => {
		const transport = respondWith(fakeResponse({}));
		expect(
			await geminiAdapter.probe({
				secret: "gm",
				signal: signal(),
				fetch: transport.fetch,
			}),
		).toEqual({ ok: true });
		expect(transport.calls[0]?.method).toBe("GET");
		expect(transport.calls[0]?.headers["x-goog-api-key"]).toBe("gm");
		expect(transport.calls[0]?.url).not.toContain("gm");
	});

	/* ── Content filter ──────────────────────────────────────────────────────── */

	/**
	 * ⚠️ **This group guards whether a response with explicit content arrives.**
	 *
	 * For a while this adapter sent no `safetySettings`, and the default thresholds blocked whole
	 * responses that our adult guard allowed. The user only saw one `Regenerate` with no cause. Without
	 * pinning the values, a commit that returns to that state passes green. The values are the same as
	 * the web's group.
	 */
	it("adult turns send every adjustable threshold down", async () => {
		expect(await sentSafetySettings("adult")).toEqual([
			{ category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
			{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
			{ category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
			{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
		]);
	});

	/**
	 * The all-ages tier **keeps its filter** with the same weight. That tier's guards forbid sexual
	 * description at both ends, so keeping the safety net costs nothing, and BYO has no server-side
	 * re-check.
	 */
	it("all-ages turns keep the net", async () => {
		const sent = await sentSafetySettings("all-ages");
		expect(sent.map((entry) => entry.threshold)).toEqual([
			"BLOCK_ONLY_HIGH",
			"BLOCK_ONLY_HIGH",
			"BLOCK_ONLY_HIGH",
			"BLOCK_ONLY_HIGH",
		]);
	});

	/** Sending a removed category makes only that model answer with a 400. The list of four is pinned by value. */
	it("vanished categories aren't carried", async () => {
		const sent = await sentSafetySettings("adult");
		expect(sent.map((entry) => entry.category)).not.toContain(
			"HARM_CATEGORY_CIVIC_INTEGRITY",
		);
	});

	it("a response that ended in a block is a named failure", async () => {
		const transport = respondWith(
			fakeResponse({
				body: streamOf([
					sseFrame(
						JSON.stringify({
							candidates: [
								{
									content: { parts: [{ text: "Body" }] },
									finishReason: "SAFETY",
								},
							],
						}),
					),
				]),
			}),
		);
		const events = await run(geminiAdapter, {
			request: request(),
			model: "gemini-3-pro",
			secret: "gm",
			signal: signal(),
			fetch: transport.fetch,
		});
		/* Whatever was received flows through as-is. It is not rolled back. */
		expect(events[0]).toEqual({ type: "delta", text: "Body" });
		expect(events.at(-1)).toMatchObject({
			type: "error",
			code: "content_blocked",
		});
		/* Ending with `done` would make the caller read a normal finish and show `Regenerate` with no cause. */
		expect(events.some((event) => event.type === "done")).toBe(false);
	});

	/** A branch blocked before any candidate exists. Without reading it, the user gets the same sentence as a truncated stream. */
	it("a response whose prompt was blocked is the same failure", async () => {
		const transport = respondWith(
			fakeResponse({
				body: streamOf([
					sseFrame(
						JSON.stringify({
							promptFeedback: { blockReason: "PROHIBITED_CONTENT" },
						}),
					),
				]),
			}),
		);
		const events = await run(geminiAdapter, {
			request: request(),
			model: "gemini-3-pro",
			secret: "gm",
			signal: signal(),
			fetch: transport.fetch,
		});
		expect(events).toEqual([
			{
				type: "error",
				code: "content_blocked",
				message: expect.stringContaining("content policy"),
			},
		]);
	});

	/**
	 * ⚠️ **A response cut off by the cap is not a block.** Writing `!== "STOP"` would catch it here,
	 * and then `Change the scene` would appear where `Continue generating` should be.
	 */
	it("a response cut by the cap isn't reported as blocked", async () => {
		const transport = respondWith(
			fakeResponse({
				body: streamOf([
					sseFrame(
						JSON.stringify({
							candidates: [
								{
									content: { parts: [{ text: "Body" }] },
									finishReason: "MAX_TOKENS",
								},
							],
						}),
					),
				]),
			}),
		);
		const events = await run(geminiAdapter, {
			request: request(),
			model: "gemini-3-pro",
			secret: "gm",
			signal: signal(),
			fetch: transport.fetch,
		});
		expect(events.at(-1)).toEqual({ type: "done", finishReason: "MAX_TOKENS" });
	});
});

describe("vendor response bodies don't leak", () => {
	/**
	 * **P0.** Upstream error bodies mix in account ids and org ids, and sometimes echo back the prompt
	 * we sent. Hand the adapter a stream carrying the body and check that **nothing reads it**. If it
	 * were read, those strings would appear in the error message.
	 */
	const leaky = () =>
		fakeResponse({
			ok: false,
			status: 500,
			body: streamOf([
				JSON.stringify({
					error: {
						message:
							"SECRET_PROVIDER_ACCOUNT_ID / PRIVATE_PROMPT_TEXT / RAW_VENDOR_DIAGNOSTIC",
					},
				}),
			]),
		});

	const adapters: [string, ByoAdapter][] = [
		["anthropic", anthropicAdapter],
		["gemini", geminiAdapter],
	];

	it.each(
		adapters,
	)("the %s adapter doesn't read the body", async (_name, adapter) => {
		const transport = respondWith(leaky());
		const thrown = await run(adapter, {
			request: request(),
			model: "m",
			secret: "sk",
			signal: signal(),
			fetch: transport.fetch,
		}).catch((error: unknown) => error);

		const serialized = `${(thrown as Error).message}\n${JSON.stringify(thrown)}\n${(thrown as Error).stack ?? ""}`;
		for (const leak of [
			"SECRET_PROVIDER_ACCOUNT_ID",
			"PRIVATE_PROMPT_TEXT",
			"RAW_VENDOR_DIAGNOSTIC",
		])
			expect(serialized, leak).not.toContain(leak);
	});

	it.each(
		adapters,
	)("%s validation doesn't read the body either", async (_name, adapter) => {
		const transport = respondWith(leaky());
		const check = await adapter.probe({
			secret: "sk",
			signal: signal(),
			fetch: transport.fetch,
		});
		expect(check.ok).toBe(false);
		const serialized = JSON.stringify(
			check.ok === false ? check.error.message : "",
		);
		expect(serialized).not.toContain("SECRET_PROVIDER_ACCOUNT_ID");
	});

	/** Keys do not appear in errors either. Errors are where they get logged as-is. */
	it.each(adapters)("%s failures carry no API key", async (_name, adapter) => {
		const transport = respondWith(fakeResponse({ ok: false, status: 401 }));
		const thrown = await run(adapter, {
			request: request(),
			model: "m",
			secret: "sk-DO-NOT-LEAK",
			signal: signal(),
			fetch: transport.fetch,
		}).catch((error: unknown) => error);
		expect(
			`${(thrown as Error).message}${JSON.stringify(thrown)}`,
		).not.toContain("sk-DO-NOT-LEAK");
	});
});

describe("send failures", () => {
	/**
	 * **Do not describe a native failure as a browser failure.** This runtime has no CORS and no
	 * extensions, so a request that never reaches the server is a network failure.
	 */
	it("fetch throwing is network", async () => {
		const transport = fakeFetch(() => {
			throw new TypeError("Network request failed");
		});
		for (const adapter of [anthropicAdapter, geminiAdapter]) {
			const thrown = await run(adapter, {
				request: request(),
				model: "m",
				secret: "sk",
				signal: signal(),
				fetch: transport.fetch,
			}).catch((error: unknown) => error);
			expect((thrown as ProviderError).code).toBe("network");
		}
	});

	/** A 200 with no body is not a stream either. It must not silently complete as an empty response. */
	it("a success response with no body is a provider failure", async () => {
		const transport = respondWith(fakeResponse({ ok: true, body: null }));
		const thrown = await run(anthropicAdapter, {
			request: request(),
			model: "m",
			secret: "sk",
			signal: signal(),
			fetch: transport.fetch,
		}).catch((error: unknown) => error);
		expect(thrown).toBeInstanceOf(ProviderError);
	});
});

describe("two stages — start() sends the request and only parsing remains", () => {
	/**
	 * **P0.** This is the whole reason this contract exists.
	 *
	 * When the adapter was `stream(): AsyncIterable`, it was an async generator. Calling it ran none
	 * of the body and only created a generator object. The first byte went out after the caller
	 * started iterating, and in the meantime the input holding the plaintext key lived on in that
	 * closure and **left the credential callback.**
	 *
	 * So what is checked here is not a value but **timing**: whether the transport was called
	 * **before** `start()` resolved. The old implementation fails this assertion, since `calls` is
	 * empty at that point.
	 */
	/**
	 * A body that sends no bytes until **we open it**.
	 *
	 * `streamOf` cannot be used as-is. A `ReadableStream` calls `pull` to fill its queue even before a
	 * reader attaches, so counting "how many chunks were read" yields 1 even though nobody has read
	 * anything yet. That counter cannot ask whether the data was buffered.
	 *
	 * So instead of counting, it **blocks.** If `start()` finishes while the body is still blocked,
	 * the function did not wait for the response.
	 */
	function gatedBody(frames: readonly string[]) {
		let open!: () => void;
		const gate = new Promise<void>((resolve) => {
			open = resolve;
		});
		const encoder = new TextEncoder();
		let index = 0;
		const body = new ReadableStream<Uint8Array>({
			async pull(controller) {
				await gate;
				if (index >= frames.length) {
					controller.close();
					return;
				}
				controller.enqueue(encoder.encode(frames[index] ?? ""));
				index += 1;
			},
		});
		return { body, open };
	}

	/** The **minimal normal frames** of both providers. The body above streams these in pieces. */
	const ANTHROPIC_FRAMES = [
		sseFrame(
			JSON.stringify({ type: "message_start", message: { model: "m" } }),
		),
		sseFrame(JSON.stringify({ type: "message_stop" })),
	];
	const GEMINI_FRAMES = [
		sseFrame(
			JSON.stringify({
				candidates: [
					{ content: { parts: [{ text: "H" }] }, finishReason: "STOP" },
				],
			}),
		),
	];

	const adapters: [string, ByoAdapter, readonly string[]][] = [
		["anthropic", anthropicAdapter, ANTHROPIC_FRAMES],
		["gemini", geminiAdapter, GEMINI_FRAMES],
	];

	it.each(
		adapters,
	)("%s: the provider request goes out before start() returns", async (_name, adapter, frames) => {
		const transport = respondWith(fakeResponse({ body: streamOf(frames) }));

		const events = await adapter.start({
			request: request(),
			model: "m",
			secret: "sk",
			signal: signal(),
			fetch: transport.fetch,
		});

		/** **Before iteration starts.** The request has already gone out. */
		expect(transport.calls).toHaveLength(1);
		expect(transport.calls[0]?.method).toBe("POST");

		/** What remains is parsing. Events come after that. */
		expect((await drain(events)).at(-1)?.type).toBe("done");
	});

	/**
	 * **P0.** The response is **not buffered.**
	 *
	 * The easiest "fix" is to read the whole stream inside `start()` and return an array. That passes
	 * the assertion above but removes streaming, and the secret then lives until the response ends. So
	 * this checks that `start()` finishes **without having streamed any part of the body**.
	 */
	it.each(
		adapters,
	)("%s: start() doesn't wait for the body", async (_name, adapter, frames) => {
		const gated = gatedBody(frames);

		let resolved = false;
		const pending = adapter
			.start({
				request: request(),
				model: "m",
				secret: "sk",
				signal: signal(),
				fetch: respondWith(fakeResponse({ body: gated.body })).fetch,
			})
			.then((events) => {
				resolved = true;
				return events;
			});

		/** One macrotask lets all queued microtasks flush. */
		await new Promise((resolve) => setTimeout(resolve, 0));

		/**
		 * **The body has not sent a single byte, yet `start()` has finished.** A buffering implementation
		 * would still be `false` here. This check blocks that "easiest fix".
		 */
		expect(resolved, "start() waited for the response body").toBe(true);

		/** Once opened, events flow from then on. */
		gated.open();
		expect((await drain(await pending)).at(-1)?.type).toBe("done");
	});

	/**
	 * **P0.** The returned iterator does not hold the secret.
	 *
	 * This check is an honest proxy. There is no way to inspect a closure's contents from JavaScript,
	 * so it serializes **everything the iterator can reach**: the iterator object, its prototype, and
	 * every event that flows out. The structural guarantee lives in the parser's argument types
	 * (`AnthropicResponseStream` and `GeminiResponseStream` have no `secret` slot). Here the fact is
	 * checked by value.
	 */
	it.each(
		adapters,
	)("%s: the returned iterator carries no secret", async (_name, adapter, frames) => {
		const events = await adapter.start({
			request: request(),
			model: "m",
			secret: "sk-DO-NOT-LEAK",
			signal: signal(),
			fetch: respondWith(fakeResponse({ body: streamOf(frames) })).fetch,
		});

		const reachable = [
			JSON.stringify(events),
			JSON.stringify(Object.getOwnPropertyNames(events)),
			JSON.stringify(await drain(events)),
		].join("\n");
		expect(reachable).not.toContain("sk-DO-NOT-LEAK");
	});

	/**
	 * A failure **before** the stream starts is now rejected by `start()`. Before, it only surfaced
	 * once iteration began. The caller (the router) therefore receives the failure inside the
	 * credential callback, and a turn with no text stays unanswered.
	 */
	it.each(
		adapters,
	)("%s: start() rejects HTTP failures", async (_name, adapter) => {
		const thrown = await adapter
			.start({
				request: request(),
				model: "m",
				secret: "sk",
				signal: signal(),
				fetch: respondWith(fakeResponse({ ok: false, status: 401 })).fetch,
			})
			.catch((error: unknown) => error);
		expect(thrown).toBeInstanceOf(ProviderError);
		expect((thrown as ProviderError).code).toBe("invalid_credential");
	});

	/**
	 * **Abort is still signaled directly.** Even after `start()` finishes, the upstream socket stays
	 * tied to that signal, so reads are cut off even if the iterator does not hold `signal` itself.
	 */
	it.each(
		adapters,
	)("%s: an abort after start() cuts the reading", async (_name, adapter, frames) => {
		const controller = new AbortController();
		const source = streamOf(frames);
		const gated = new ReadableStream<Uint8Array>({
			async pull(target) {
				const reader = source.getReader();
				const { done, value } = await reader.read();
				reader.releaseLock();
				if (done || controller.signal.aborted) {
					/** Breaks like a real transport. This models the signal reaching the socket. */
					const error = new Error("Aborted");
					error.name = "AbortError";
					target.error(error);
					return;
				}
				target.enqueue(value);
			},
		});

		const events = await adapter.start({
			request: request(),
			model: "m",
			secret: "sk",
			signal: controller.signal,
			fetch: respondWith(fakeResponse({ body: gated })).fetch,
		});
		controller.abort();

		const thrown = await drain(events).catch((error: unknown) => error);
		expect((thrown as Error).name).toBe("AbortError");
	});
});

/* ══════════════════════════════════════════════════════════════════════════
 * Continuation: providers differ in the conditions for accepting a prefill
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * This app also has `Continue generating` (`chat-screen.tsx`), and its request is built by the **same
 * assembler** as the web. Upstream constraints therefore carry over too. If the two apps handled
 * them differently, the same conversation would continue differently on each device.
 *
 * ```text
 * Anthropic   varies by model. Only the 4.5 generation accepts a prefill, and it cannot be
 *             combined with thinking or trailing whitespace.
 *             4.6 and later reject a prefill with a 400, so they fall back to a nudge (thinking is still sent).
 * Gemini      accepts a conversation ending in the `model` role. It can be used with thinking.
 * ```
 */
const continuationMessages = [
	message("user", "Continue"),
	message("assistant", "The door opens and he"),
];

/**
 * **Continuation shape table. The values match the web adapter test** (confirmed with real requests
 * on 2026-09-23). If the two apps differ on even one line, the same conversation continues
 * differently per device or gets a 400.
 */
const PREFILL_CONTINUATION_MODELS = [
	"claude-opus-4-5",
	"claude-sonnet-4-5",
	"claude-haiku-4-5",
];
const NUDGE_CONTINUATION_MODELS = [
	"claude-fable-5-1",
	"claude-fable-5",
	"claude-opus-5-5",
	"claude-opus-5",
	"claude-sonnet-5-5",
	"claude-sonnet-5",
	"claude-opus-4-8",
	"claude-opus-4-7",
	"claude-opus-4-6",
	"claude-sonnet-4-6",
];

describe("Continue generating", () => {
	type SentMessages = { role: string; content: string }[];

	const anthropicBody = async (
		overrides: Partial<ChatGenerationRequest> = {},
		model = "claude-haiku-4-5",
	) => {
		const transport = respondWith(fakeResponse({ body: anthropicStream() }));
		await run(anthropicAdapter, {
			request: request({
				messages: continuationMessages,
				continuation: true,
				...overrides,
			}),
			model,
			secret: "sk",
			signal: signal(),
			fetch: transport.fetch,
		});
		return bodyOf(transport.calls[0]?.body);
	};

	/**
	 * **Trailing whitespace is a 400.** A truncated response usually stops mid-sentence, so its last
	 * character is often a space. In that case `Continue generating` in that room always fails.
	 */
	it.each(
		PREFILL_CONTINUATION_MODELS,
	)("Anthropic %s — keeps it as a prefill and strips trailing whitespace", async (model) => {
		const sent = await anthropicBody({}, model);
		expect((sent.messages as SentMessages).at(-1)).toEqual({
			role: "assistant",
			content: "The door opens and he",
		});
	});

	/**
	 * ⚠️ **Models that do not accept a prefill end with a nudge.** While these lines were sent as a
	 * prefill, `Continue generating` for those models always returned a 400. The truncated response goes before the
	 * nudge exactly as stored.
	 */
	it.each(
		NUDGE_CONTINUATION_MODELS,
	)("Anthropic %s — ends with a nudge and the cut reply stays as stored", async (model) => {
		const messages = (await anthropicBody({}, model)).messages as SentMessages;
		expect(messages.at(-1)).toEqual({
			role: "user",
			content: CONTINUATION_FALLBACK_NUDGE,
		});
		expect(messages.at(-2)).toEqual({
			role: "assistant",
			content: "The door opens and he",
		});
	});

	/** An unknown model gets the nudge. Every model accepts this shape (the same decision as the web). */
	it("Anthropic — a model not in the table goes to nudge", async () => {
		const messages = (await anthropicBody({}, "claude-retired-model"))
			.messages as SentMessages;
		expect(messages.at(-1)).toEqual({
			role: "user",
			content: CONTINUATION_FALLBACK_NUDGE,
		});
	});

	/** ⚠️ This provider does not accept thinking and prefill together, so the prefill is kept. */
	it.each(
		PREFILL_CONTINUATION_MODELS,
	)("Anthropic %s — continuation carries no thinking parameter", async (model) => {
		const sent = await anthropicBody({ reasoningEffort: "high" }, model);
		expect(sent.thinking).toBeUndefined();
		expect(sent.output_config).toBeUndefined();
		expect(sent.max_tokens).toBe(768);
	});

	/** A nudge has no prefill, so that constraint does not apply. The reasoning level the user chose is kept. */
	it.each(
		NUDGE_CONTINUATION_MODELS,
	)("Anthropic %s — continuation still carries thinking as is", async (model) => {
		const sent = await anthropicBody({ reasoningEffort: "high" }, model);
		expect(sent.thinking).toEqual({ type: "adaptive" });
		expect(sent.output_config).toEqual({ effort: "high" });
	});

	/** **Plain generation is unchanged in every character.** */
	it("Anthropic — outside continuation, thinking is carried as is", async () => {
		const transport = respondWith(fakeResponse({ body: anthropicStream() }));
		await run(anthropicAdapter, {
			request: request({ reasoningEffort: "high" }),
			model: "claude-sonnet-5",
			secret: "sk",
			signal: signal(),
			fetch: transport.fetch,
		});
		expect(bodyOf(transport.calls[0]?.body).thinking).toEqual({
			type: "adaptive",
		});
	});

	/** For histories with no text to continue, both shapes set a nudge. The two adapters follow the same rule. */
	it.each([
		"claude-haiku-4-5",
		"claude-sonnet-5",
	])("Anthropic %s — stands a nudge when the last turn isn't the assistant", async (model) => {
		const messages = (
			await anthropicBody({ messages: [message("user", "Hi")] }, model)
		).messages as SentMessages;
		expect(messages.at(-1)).toEqual({
			role: "user",
			content: CONTINUATION_FALLBACK_NUDGE,
		});
	});

	/** A response stored as only whitespace is dropped in both shapes. This API rejects empty assistant messages too. */
	it.each([
		"claude-haiku-4-5",
		"claude-sonnet-5",
	])("Anthropic %s — drops a whitespace-only reply and goes to nudge", async (model) => {
		const messages = (
			await anthropicBody(
				{ messages: [message("user", "Hi"), message("assistant", "   ")] },
				model,
			)
		).messages as SentMessages;
		expect(messages.at(-1)?.role).toBe("user");
		expect(messages).toHaveLength(2);
		expect(messages.some((entry) => entry.role === "assistant")).toBe(false);
	});

	/**
	 * ⚠️ **Thinking is not dropped here.** That constraint belongs to the Anthropic API. Copying one
	 * adapter's handling to the other would make users of a provider without that constraint lose
	 * their settings for no reason.
	 */
	it("Gemini — keeps the prefill in the `model` role and keeps thinking", async () => {
		const transport = respondWith(fakeResponse({ body: geminiStream() }));
		await run(geminiAdapter, {
			request: request({
				messages: continuationMessages,
				continuation: true,
				reasoningEffort: "high",
			}),
			model: "gemini-3.5-flash",
			secret: "key",
			signal: signal(),
			fetch: transport.fetch,
		});
		const sent = bodyOf(transport.calls[0]?.body);
		const contents = sent.contents as {
			role: string;
			parts: { text: string }[];
		}[];
		expect(contents.at(-1)?.role).toBe("model");
		expect(contents.at(-1)?.parts[0]?.text).toBe("The door opens and he");
		const config = sent.generationConfig as Record<string, unknown>;
		expect(config.thinkingConfig).toBeDefined();
	});
});

/* ══════════════════════════════════════════════════════════════════════════
 * Tool calls
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The **tool mapping** of both adapters. This group guards three things.
 *
 * One is **symmetry of absence.** A request body that declares no tools must match the body from
 * before this axis existed, byte for byte. That fact is all of the compatibility for older clients.
 *
 * Two is **complete-argument** semantics. Anthropic streams partial JSON as deltas and Gemini gives
 * a complete object. The adapter absorbs that difference so the screen and router do not each carry
 * code that assembles fragments.
 *
 * Three is **dropping parallel calls.** The contract is narrowed to one call per stream, so the
 * second call is discarded and the turn still ends normally. ⚠️ For a while this was an error, on
 * the grounds that dropping it makes the next request a 400 because of an unpaired call. But this
 * device builds the next request's assistant turn (`nextChatToolRequest`), so the dropped call is
 * never seen upstream again. That premise was missing. Ending with an error would kill the turn
 * after its body had already streamed.
 */

const DICE: ChatToolDeclaration = {
	name: "dice",
	description: "Rolls a die",
	parameters: [
		{
			name: "sides",
			type: "number",
			description: "number of faces",
			required: true,
			choices: [],
		},
		{
			name: "label",
			type: "string",
			description: "",
			required: false,
			choices: ["a", "b"],
		},
	],
};

/** A history after one round trip: body, call and result, in order. */
const toolHistory: ChatGenerationMessage[] = [
	{ role: "user", content: "Roll it" },
	{
		role: "assistant",
		content: "He picked up the die.",
		toolCall: { id: "toolu_1", name: "dice", arguments: { sides: 20 } },
	},
	{ role: "tool", callId: "toolu_1", content: "17" },
];

describe("Anthropic tool calls", () => {
	it("no tools means the key itself is absent", async () => {
		const transport = respondWith(fakeResponse({ body: anthropicStream() }));
		await run(anthropicAdapter, {
			request: request(),
			model: "claude-sonnet-5",
			secret: "sk",
			signal: signal(),
			fetch: transport.fetch,
		});
		const sent = bodyOf(transport.calls[0]?.body);
		expect("tools" in sent).toBe(false);
		expect("tool_choice" in sent).toBe(false);
	});

	/** The contract is narrowed to one call per stream, so **ask the provider not to make parallel calls first.** */
	it("declaring tools turns parallel calls off too", async () => {
		const transport = respondWith(fakeResponse({ body: anthropicStream() }));
		await run(anthropicAdapter, {
			request: request({ tools: [DICE] }),
			model: "claude-sonnet-5",
			secret: "sk",
			signal: signal(),
			fetch: transport.fetch,
		});
		const sent = bodyOf(transport.calls[0]?.body);
		expect(sent.tool_choice).toEqual({
			type: "auto",
			disable_parallel_tool_use: true,
		});
		expect(sent.tools).toEqual([
			{
				name: "dice",
				description: "Rolls a die",
				input_schema: {
					type: "object",
					properties: {
						sides: { type: "number", description: "number of faces" },
						label: { type: "string", enum: ["a", "b"] },
					},
					required: ["sides"],
					additionalProperties: false,
				},
			},
		]);
	});

	/** This API has no tool role. The result is **a block inside the user turn**. */
	it("moves calls and results into blocks", async () => {
		const transport = respondWith(fakeResponse({ body: anthropicStream() }));
		await run(anthropicAdapter, {
			request: request({ messages: toolHistory, tools: [DICE] }),
			model: "claude-sonnet-5",
			secret: "sk",
			signal: signal(),
			fetch: transport.fetch,
		});
		expect(bodyOf(transport.calls[0]?.body).messages).toEqual([
			{ role: "user", content: "Roll it" },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "He picked up the die." },
					{
						type: "tool_use",
						id: "toolu_1",
						name: "dice",
						input: { sides: 20 },
					},
				],
			},
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "toolu_1", content: "17" },
				],
			},
		]);
	});

	/** This API rejects empty text blocks with a 400. Calling with no prose is normal. */
	it("doesn't create an empty text block for an assistant turn without a body", async () => {
		const transport = respondWith(fakeResponse({ body: anthropicStream() }));
		await run(anthropicAdapter, {
			request: request({
				messages: [
					{ role: "user", content: "Roll it" },
					{
						role: "assistant",
						content: "",
						toolCall: { id: "toolu_1", name: "dice", arguments: {} },
					},
					{ role: "tool", callId: "toolu_1", content: "17" },
				],
			}),
			model: "claude-sonnet-5",
			secret: "sk",
			signal: signal(),
			fetch: transport.fetch,
		});
		const messages = bodyOf(transport.calls[0]?.body).messages as {
			content: unknown;
		}[];
		expect(messages[1]?.content).toEqual([
			{ type: "tool_use", id: "toolu_1", name: "dice", input: {} },
		]);
	});

	/** Partial JSON is finished inside the adapter. What goes out is one complete object. */
	it("gathers fragmented arguments and emits them at once", async () => {
		const transport = respondWith(
			fakeResponse({
				body: anthropicStream([
					sseFrame(
						JSON.stringify({
							type: "content_block_start",
							content_block: { type: "tool_use", id: "toolu_9", name: "dice" },
						}),
					),
					sseFrame(
						JSON.stringify({
							type: "content_block_delta",
							delta: { type: "input_json_delta", partial_json: '{"sid' },
						}),
					),
					sseFrame(
						JSON.stringify({
							type: "content_block_delta",
							delta: { type: "input_json_delta", partial_json: 'es":20}' },
						}),
					),
				]),
			}),
		);
		const events = await run(anthropicAdapter, {
			request: request({ tools: [DICE] }),
			model: "claude-sonnet-5",
			secret: "sk",
			signal: signal(),
			fetch: transport.fetch,
		});
		expect(events.filter((event) => event.type === "tool_call")).toEqual([
			{
				type: "tool_call",
				call: { id: "toolu_9", name: "dice", arguments: { sides: 20 } },
			},
		]);
		/** This is not a terminal frame. `done` comes separately after it. */
		expect(events.at(-1)?.type).toBe("done");
	});

	/**
	 * `disable_parallel_tool_use` was sent, so this branch is insurance for a day the provider does
	 * not honor that request. **The point is that the argument deltas of a dropped block do not mix
	 * into the earlier call.** If they did, the two calls' JSON could join and parse successfully, and
	 * the arguments that go out would be values nobody requested.
	 */
	it("of parallel calls only the first remains, and later blocks' arguments don't mix in", async () => {
		const transport = respondWith(
			fakeResponse({
				body: anthropicStream([
					sseFrame(
						JSON.stringify({
							type: "content_block_start",
							content_block: { type: "tool_use", id: "toolu_1", name: "dice" },
						}),
					),
					sseFrame(
						JSON.stringify({
							type: "content_block_delta",
							delta: { type: "input_json_delta", partial_json: '{"sides":6}' },
						}),
					),
					sseFrame(
						JSON.stringify({
							type: "content_block_start",
							content_block: { type: "tool_use", id: "toolu_2", name: "dice" },
						}),
					),
					sseFrame(
						JSON.stringify({
							type: "content_block_delta",
							delta: { type: "input_json_delta", partial_json: '{"sides":20}' },
						}),
					),
				]),
			}),
		);
		const events = await run(anthropicAdapter, {
			request: request({ tools: [DICE] }),
			model: "claude-sonnet-5",
			secret: "sk",
			signal: signal(),
			fetch: transport.fetch,
		});
		expect(events.filter((event) => event.type === "tool_call")).toEqual([
			{
				type: "tool_call",
				call: { id: "toolu_1", name: "dice", arguments: { sides: 6 } },
			},
		]);
		expect(events.at(-1)?.type).toBe("done");
	});

	/**
	 * ⚠️ **A broken argument does not kill the turn.** When the output cap is reached, the argument
	 * JSON ends the stream cut in half. That is common, and the call itself is fine. Sending it marked
	 * as unreadable lets the call reach judgement and return one sentence, so the model can call
	 * again.
	 */
	it("broken argument JSON goes out as an unreadable call", async () => {
		const transport = respondWith(
			fakeResponse({
				body: anthropicStream([
					sseFrame(
						JSON.stringify({
							type: "content_block_start",
							content_block: { type: "tool_use", id: "toolu_1", name: "dice" },
						}),
					),
					sseFrame(
						JSON.stringify({
							type: "content_block_delta",
							delta: { type: "input_json_delta", partial_json: '{"sides":' },
						}),
					),
				]),
			}),
		);
		const events = await run(anthropicAdapter, {
			request: request({ tools: [DICE] }),
			model: "claude-sonnet-5",
			secret: "sk",
			signal: signal(),
			fetch: transport.fetch,
		});
		expect(events.filter((event) => event.type === "tool_call")).toEqual([
			{
				type: "tool_call",
				call: { id: "toolu_1", name: "dice", arguments: null },
			},
		]);
		expect(events.filter((event) => event.type === "error")).toEqual([]);
	});

	/**
	 * Only the case where no matching reply can be built remains. If the name is outside the
	 * vocabulary there is no slot to carry it, and an invented name would stop the upstream from
	 * recognising its own call.
	 */
	it("a name outside the vocabulary ends in an error", async () => {
		const transport = respondWith(
			fakeResponse({
				body: anthropicStream([
					sseFrame(
						JSON.stringify({
							type: "content_block_start",
							content_block: {
								type: "tool_use",
								id: "toolu_1",
								name: "functions.dice",
							},
						}),
					),
				]),
			}),
		);
		const events = await run(anthropicAdapter, {
			request: request({ tools: [DICE] }),
			model: "claude-sonnet-5",
			secret: "sk",
			signal: signal(),
			fetch: transport.fetch,
		});
		expect(events.at(-1)?.type).toBe("error");
	});
});

describe("Gemini tool calls", () => {
	it("no tools means the key itself is absent", async () => {
		const transport = respondWith(fakeResponse({ body: geminiStream() }));
		await run(geminiAdapter, {
			request: request(),
			model: "gemini-3-pro",
			secret: "AIza",
			signal: signal(),
			fetch: transport.fetch,
		});
		const sent = bodyOf(transport.calls[0]?.body);
		expect("tools" in sent).toBe(false);
		expect("toolConfig" in sent).toBe(false);
	});

	/** Uppercase types are not the spec. They are **this provider's dialect**. */
	it("moves declarations into this provider's schema dialect", async () => {
		const transport = respondWith(fakeResponse({ body: geminiStream() }));
		await run(geminiAdapter, {
			request: request({ tools: [DICE] }),
			model: "gemini-3-pro",
			secret: "AIza",
			signal: signal(),
			fetch: transport.fetch,
		});
		const sent = bodyOf(transport.calls[0]?.body);
		expect(sent.tools).toEqual([
			{
				functionDeclarations: [
					{
						name: "dice",
						description: "Rolls a die",
						parameters: {
							type: "OBJECT",
							properties: {
								sides: { type: "NUMBER", description: "number of faces" },
								label: { type: "STRING", enum: ["a", "b"] },
							},
							required: ["sides"],
						},
					},
				],
			},
		]);
		/** Keys outside this API's schema vocabulary are not sent. Unknown keys get a 400. */
		const parameters = (
			sent.tools as { functionDeclarations: { parameters: object }[] }[]
		)[0]?.functionDeclarations[0]?.parameters;
		expect(parameters && "additionalProperties" in parameters).toBe(false);
	});

	/**
	 * ⚠️ This provider gives calls no identifier, so **the pairing value is the function name.** The
	 * adapter therefore puts the name in the identifier slot and uses it again as the name when
	 * returning results.
	 */
	it("carries the name as the identifier", async () => {
		const transport = respondWith(
			fakeResponse({
				body: geminiStream([
					{ functionCall: { name: "dice", args: { sides: 20 } } },
				]),
			}),
		);
		const events = await run(geminiAdapter, {
			request: request({ tools: [DICE] }),
			model: "gemini-3-pro",
			secret: "AIza",
			signal: signal(),
			fetch: transport.fetch,
		});
		expect(events.filter((event) => event.type === "tool_call")).toEqual([
			{
				type: "tool_call",
				call: { id: "dice", name: "dice", arguments: { sides: 20 } },
			},
		]);
	});

	it("returns the result under that name", async () => {
		const transport = respondWith(fakeResponse({ body: geminiStream() }));
		await run(geminiAdapter, {
			request: request({
				messages: [
					{ role: "user", content: "Roll it" },
					{
						role: "assistant",
						content: "He picked up the die.",
						toolCall: { id: "dice", name: "dice", arguments: { sides: 20 } },
					},
					{ role: "tool", callId: "dice", content: "17" },
				],
			}),
			model: "gemini-3-pro",
			secret: "AIza",
			signal: signal(),
			fetch: transport.fetch,
		});
		expect(bodyOf(transport.calls[0]?.body).contents).toEqual([
			{ role: "user", parts: [{ text: "Roll it" }] },
			{
				role: "model",
				parts: [
					{ text: "He picked up the die." },
					{ functionCall: { name: "dice", args: { sides: 20 } } },
				],
			},
			{
				role: "user",
				parts: [
					{ functionResponse: { name: "dice", response: { result: "17" } } },
				],
			},
		]);
	});

	/**
	 * ⚠️ **Without the signature the request is a 400.** Gemini 3 requires the thought signature it
	 * attached to the turn's first `functionCall` to come back unchanged, and lowering or disabling
	 * the thinking level does not exempt it. The device reassembles the next request's assistant turn,
	 * so unless the value is carried on the call, tools **never** work on these models.
	 */
	it("keeps the signature attached to the call", async () => {
		const transport = respondWith(
			fakeResponse({
				body: geminiStream([
					{
						functionCall: { name: "dice", args: { sides: 20 } },
						thoughtSignature: "Cg8KDQoLc2ln",
					},
				]),
			}),
		);
		const events = await run(geminiAdapter, {
			request: request({ tools: [DICE] }),
			model: "gemini-3-pro",
			secret: "AIza",
			signal: signal(),
			fetch: transport.fetch,
		});
		expect(events.filter((event) => event.type === "tool_call")).toEqual([
			{
				type: "tool_call",
				call: {
					id: "dice",
					name: "dice",
					arguments: { sides: 20 },
					providerState: "Cg8KDQoLc2ln",
				},
			},
		]);
	});

	it("returns the kept signature to that part", async () => {
		const transport = respondWith(fakeResponse({ body: geminiStream() }));
		await run(geminiAdapter, {
			request: request({
				messages: [
					{ role: "user", content: "Roll it" },
					{
						role: "assistant",
						content: "",
						toolCall: {
							id: "dice",
							name: "dice",
							arguments: { sides: 20 },
							providerState: "Cg8KDQoLc2ln",
						},
					},
					{ role: "tool", callId: "dice", content: "17" },
				],
			}),
			model: "gemini-3-pro",
			secret: "AIza",
			signal: signal(),
			fetch: transport.fetch,
		});
		expect(bodyOf(transport.calls[0]?.body).contents).toEqual([
			{ role: "user", parts: [{ text: "Roll it" }] },
			{
				role: "model",
				parts: [
					{
						functionCall: { name: "dice", args: { sides: 20 } },
						thoughtSignature: "Cg8KDQoLc2ln",
					},
				],
			},
			{
				role: "user",
				parts: [
					{ functionResponse: { name: "dice", response: { result: "17" } } },
				],
			},
		]);
	});

	/**
	 * The 2.5 generation does not require this value. If none exists, **the key itself must be
	 * absent**. An invented value is a wrong signature and triggers the same 400.
	 */
	it("no signature means no key is created", async () => {
		const transport = respondWith(fakeResponse({ body: geminiStream() }));
		await run(geminiAdapter, {
			request: request({
				messages: [
					{ role: "user", content: "Roll it" },
					{
						role: "assistant",
						content: "",
						toolCall: { id: "dice", name: "dice", arguments: { sides: 20 } },
					},
					{ role: "tool", callId: "dice", content: "17" },
				],
			}),
			model: "gemini-2.5-flash",
			secret: "AIza",
			signal: signal(),
			fetch: transport.fetch,
		});
		const parts = (
			bodyOf(transport.calls[0]?.body).contents as { parts: object[] }[]
		)[1]?.parts;
		expect(parts?.[0] && "thoughtSignature" in parts[0]).toBe(false);
	});

	/**
	 * This provider has no switch to disable parallel calls, so **this state is produced as one
	 * ordinary response.** Ending with an error would kill that turn. Keep the first call and discard
	 * the rest.
	 */
	it("of parallel calls only the first remains and the turn stays alive", async () => {
		const transport = respondWith(
			fakeResponse({
				body: geminiStream([
					{ functionCall: { name: "dice", args: { sides: 6 } } },
					{ functionCall: { name: "dice", args: { sides: 20 } } },
				]),
			}),
		);
		const events = await run(geminiAdapter, {
			request: request({ tools: [DICE] }),
			model: "gemini-3-pro",
			secret: "AIza",
			signal: signal(),
			fetch: transport.fetch,
		});
		expect(events.filter((event) => event.type === "tool_call")).toEqual([
			{
				type: "tool_call",
				call: { id: "dice", name: "dice", arguments: { sides: 6 } },
			},
		]);
		expect(events.at(-1)?.type).toBe("done");
	});
});
