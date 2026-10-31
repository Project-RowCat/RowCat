import {
	STORY_PUBLISH_ERROR_CODE,
	type StoryPlaybackDto,
	type StoryPublishRequestInput,
	type StoryRuntimePublishFailure,
} from "@rowcat/contracts";
import { RUNTIME_API_VERSION } from "@rowcat/runtime/declarations";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import { story, story_runtime } from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";
import { RATE_LIMIT_POLICIES } from "../../lib/rate-limit/policy.ts";
import { runtimeCompileStats } from "../../services/story/runtime-compile.ts";
import { createTestMember, TEST_PASSWORD } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { WEB_ORIGIN } from "../../test/http.ts";

/**
 * Runtime publication and playback: the server is the compile authority.
 *
 * Three facts need the real Hono app and Postgres rather than mocks: a client cannot send an
 * artifact (the contract has no slot for it), a compile failure leaves the already-published
 * runtime untouched (transaction boundary), and on update an absent `runtime` field means preserve
 * (rollout of old clients).
 */

const EMAIL_PREFIX = "story-runtime-test-";

const signUp = () => createTestMember(EMAIL_PREFIX, { name: "Runtime test" });

/** Smallest runtime that really compiles: one entry point, one state. */
const COUNTER_SOURCE = `import {
	Button,
	Screen,
	Text,
	defineStoryState,
	useStoryState,
} from "@rowcat/runtime";

const progress = defineStoryState({
	key: "progress",
	version: 1,
	initial: { count: 0 },
});

export default function App() {
	const [state, setState] = useStoryState(progress);
	return (
		<Screen>
			<Text>Count {state.count}</Text>
			<Button onPress={() => setState((current) => ({ count: current.count + 1 }))}>
				Increment
			</Button>
		</Screen>
	);
}
`;

/** A runtime that calls the generation capability, to check the capability table derives from source. */
const GENERATION_SOURCE = `import { Button, Screen, Text, useGeneration } from "@rowcat/runtime";

export default function App() {
	const generation = useGeneration();
	return (
		<Screen>
			<Text>ai</Text>
			<Button
				onPress={() => {
					void generation.generate({ messages: [], instructions: "hi" });
				}}
			>
				ask
			</Button>
		</Screen>
	);
}
`;

/**
 * Two remote images: one address written in source, one assembled from player input.
 *
 * Both must be in one file to show the authorization list derives from source; an empty list could
 * not show that collection actually runs.
 */
const REMOTE_ASSET_SOURCE = `import { Image, Screen, TextInput, asset, useState } from "@rowcat/runtime";

export default function App() {
	const [q, setQ] = useState("");
	return (
		<Screen>
			<TextInput value={q} onChangeText={setQ} />
			<Image source={asset("https://cdn.example.com/logo.png")} alt="logo" />
			<Image source={asset(\`https://creator.example/pixel.png?q=\${q}\`)} alt="p" />
		</Screen>
	);
}
`;

const runtimeSource = (content: string) => ({
	mode: "source" as const,
	project: {
		apiVersion: RUNTIME_API_VERSION,
		entry: "src/main.tsx",
		files: [{ path: "src/main.tsx", content }],
	},
});

function publishRequest(
	overrides: Partial<StoryPublishRequestInput> = {},
): StoryPublishRequestInput {
	return {
		originDraftId: newId(),
		metadata: { title: "Runtime story", visibility: "private" },
		play: { scenario: "A story with a runtime attached." },
		...overrides,
	};
}

const publish = (cookie: string, body: unknown): Promise<Response> =>
	Promise.resolve(
		app.request("/v2/stories", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				Cookie: cookie,
			},
			body: JSON.stringify(body),
		}),
	);

const update = (
	cookie: string,
	storyId: string,
	body: unknown,
): Promise<Response> =>
	Promise.resolve(
		app.request(`/v2/stories/${storyId}`, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				Cookie: cookie,
			},
			body: JSON.stringify(body),
		}),
	);

const playback = (cookie: string | null, storyId: string): Promise<Response> =>
	Promise.resolve(
		app.request(`/v2/stories/${storyId}/playback`, {
			headers: {
				Origin: WEB_ORIGIN,
				...(cookie ? { Cookie: cookie } : {}),
			},
		}),
	);

const play = (cookie: string, storyId: string): Promise<Response> =>
	Promise.resolve(
		app.request(`/v2/stories/${storyId}/play`, {
			headers: { Origin: WEB_ORIGIN, Cookie: cookie },
		}),
	);

const readRuntime = async (storyId: string) => {
	const [row] = await db
		.select()
		.from(story_runtime)
		.where(eq(story_runtime.story_id, storyId));
	return row ?? null;
};

interface PublishBody {
	created: boolean;
	story: { id: string; playMode: "chat" | "runtime" };
}
interface ErrorBody {
	code: string;
	details?: unknown;
}

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

/** Publishes with the runtime on and returns the story id. */
async function publishWithRuntime(
	cookie: string,
	content = COUNTER_SOURCE,
	overrides: Partial<StoryPublishRequestInput> = {},
): Promise<string> {
	const response = await publish(cookie, {
		...publishRequest(overrides),
		runtime: runtimeSource(content),
	});
	if (response.status !== 201)
		throw new Error(
			`runtime publish failed: ${response.status} ${await response.text()}`,
		);
	return ((await response.json()) as PublishBody).story.id;
}

/**
 * Nesting deep enough that the checker runs to the deadline rather than the stack or the heap: a
 * compile that is still running when the test looks at it.
 */
const SLOW_SOURCE = `${COUNTER_SOURCE}
export const z = ${"[".repeat(2_000)}${"]".repeat(2_000)};
`;

const FORBIDDEN_SOURCE = `export default function App() {\n\teval("1");\n\treturn null;\n}\n`;

/** Polls until this process's compiler holds a member's place, so the next request meets it. */
async function untilCompiling(): Promise<void> {
	for (let tries = 0; tries < 200; tries += 1) {
		if (runtimeCompileStats().members > 0) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error("no compile started");
}

describe.skipIf(!databaseReady)(
	"runtime publish — the compiler is shared",
	() => {
		/**
		 * An update named its target only after compiling, so a PUT on any story id spent a full compile
		 * before the 404. The owner and the target are cheap to read; the compile is not.
		 */
		test("an update of someone else's story compiles nothing", async () => {
			const owner = await signUp();
			const storyId = await publishWithRuntime(owner.cookie);
			const stranger = await signUp();
			const response = await update(stranger.cookie, storyId, {
				...publishRequest(),
				runtime: runtimeSource(FORBIDDEN_SOURCE),
			});
			expect(response.status).toBe(404);
		});

		test("a member's compiles are counted", async () => {
			const owner = await signUp();
			const { max } = RATE_LIMIT_POLICIES.storyRuntimeCompile;
			for (let at = 0; at < max; at += 1) {
				const response = await publish(owner.cookie, {
					...publishRequest(),
					runtime: runtimeSource(FORBIDDEN_SOURCE),
				});
				expect(response.status).toBe(400);
			}
			const over = await publish(owner.cookie, {
				...publishRequest(),
				runtime: runtimeSource(FORBIDDEN_SOURCE),
			});
			expect(over.status).toBe(429);
			expect(((await over.json()) as ErrorBody).code).toBe(
				RATE_LIMIT_POLICIES.storyRuntimeCompile.code,
			);
			expect(over.headers.get("Retry-After")).not.toBeNull();
			/** A publish that compiles nothing is not this limit's business. */
			const chat = await publish(owner.cookie, publishRequest());
			expect(chat.status).toBe(201);
		}, 120_000);

		/**
		 * The process holds two compile slots for everyone. One member used to be able to hold both, and
		 * the queue, with a few slow compiles; now a second compile from the same member is refused while
		 * the first runs, and the first ends when its client leaves.
		 */
		test("one member holds one compile, and leaving ends it", async () => {
			const owner = await signUp();
			const controller = new AbortController();
			const started = Date.now();
			const slow = Promise.resolve(
				app.request("/v2/stories", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Origin: WEB_ORIGIN,
						Cookie: owner.cookie,
					},
					body: JSON.stringify({
						...publishRequest(),
						runtime: runtimeSource(SLOW_SOURCE),
					}),
					signal: controller.signal,
				}),
			);
			await untilCompiling();

			const second = await publish(owner.cookie, {
				...publishRequest(),
				runtime: runtimeSource(COUNTER_SOURCE),
			});
			expect(second.status).toBe(409);
			expect(((await second.json()) as ErrorBody).code).toBe(
				"story_runtime_compile_in_progress",
			);
			expect(second.headers.get("Retry-After")).not.toBeNull();

			/** Someone else is not held up by that member. */
			const other = await signUp();
			await publishWithRuntime(other.cookie);

			controller.abort();
			await slow.catch(() => undefined);
			/** Ended by the abort, well before the twenty-second deadline, and its thread is gone. */
			expect(Date.now() - started).toBeLessThan(15_000);
			expect(runtimeCompileStats()).toEqual({
				inFlight: 0,
				queued: 0,
				members: 0,
			});
		}, 60_000);
	},
);

describe.skipIf(!databaseReady)("runtime publish — the server compiles", () => {
	test("sending source makes the server build the artifact", async () => {
		const owner = await signUp();
		const storyId = await publishWithRuntime(owner.cookie);

		const row = await readRuntime(storyId);
		expect(row).not.toBeNull();
		/** Metadata derives from the compile result, not from the request. */
		expect(row?.artifact_format_version).toBe(1);
		expect(row?.runtime_api_version).toBe(RUNTIME_API_VERSION);
		expect(typeof row?.source_hash).toBe("string");
		expect(row?.source_hash.length).toBeGreaterThan(0);
	});

	test("does not accept a client-built artifact", async () => {
		/**
		 * The contract has no slot for an artifact. zod strips the unknown key, so this request equals
		 * one that says nothing about runtime and yields a conversation story: no path stores a forged
		 * artifact.
		 */
		const owner = await signUp();
		const response = await publish(owner.cookie, {
			...publishRequest(),
			artifact: { formatVersion: 1, modules: [], entry: "x" },
			runtime: {
				mode: "source",
				artifact: { formatVersion: 1, modules: [] },
				project: {
					apiVersion: RUNTIME_API_VERSION,
					entry: "src/main.tsx",
					files: [{ path: "src/main.tsx", content: COUNTER_SOURCE }],
				},
			},
		});
		expect(response.status).toBe(201);
		const body = (await response.json()) as PublishBody;
		const row = await readRuntime(body.story.id);
		/** What is stored is the artifact we compiled. */
		expect(row?.compiler_version).toBe(1);
		expect(JSON.stringify(row?.artifact)).toContain("src/main.tsx");
	});

	/**
	 * The remote-image authorization list derives from source.
	 *
	 * Without this, one `asset()` line becomes a channel carrying player-typed text to the creator's
	 * server (not being able to read the response does not prevent that). The list must be non-empty
	 * while the assembled address is absent, which shows collection really runs.
	 */
	test("the remote image list derives from the source", async () => {
		const owner = await signUp();
		const storyId = await publishWithRuntime(owner.cookie, REMOTE_ASSET_SOURCE);

		const row = await readRuntime(storyId);
		const artifact = row?.artifact as { remoteAssets?: string[] } | undefined;
		expect(artifact?.remoteAssets).toEqual([
			"https://cdn.example.com/logo.png",
		]);
	});

	/**
	 * A client cannot widen the list: the contract has no slot, zod strips it, and what is stored is
	 * our compile result. If a request could set the list the defense would be void.
	 */
	test("the request can't set the remote image list", async () => {
		const owner = await signUp();
		const response = await publish(owner.cookie, {
			...publishRequest(),
			runtime: {
				...runtimeSource(REMOTE_ASSET_SOURCE),
				remoteAssets: ["https://attacker.example/anything.png"],
				project: {
					...runtimeSource(REMOTE_ASSET_SOURCE).project,
					remoteAssets: ["https://attacker.example/anything.png"],
				},
			},
		});
		expect(response.status).toBe(201);
		const body = (await response.json()) as PublishBody;
		const row = await readRuntime(body.story.id);
		const artifact = row?.artifact as { remoteAssets?: string[] } | undefined;
		expect(artifact?.remoteAssets).toEqual([
			"https://cdn.example.com/logo.png",
		]);
	});

	test("forbidden syntax blocks the publish and gives diagnostics", async () => {
		const owner = await signUp();
		const response = await publish(owner.cookie, {
			...publishRequest(),
			runtime: runtimeSource(
				`export default function App() {\n\teval("1");\n\treturn null;\n}\n`,
			),
		});
		expect(response.status).toBe(400);
		const body = (await response.json()) as ErrorBody;
		expect(body.code).toBe(STORY_PUBLISH_ERROR_CODE.runtimeInvalid);
		const failure = body.details as StoryRuntimePublishFailure;
		expect(failure.diagnostics.length).toBeGreaterThan(0);
		/** No server file path is carried; paths are inside the project. */
		for (const diagnostic of failure.diagnostics)
			expect(diagnostic.path ?? "").not.toContain("/Users");
	});

	test("a failed publish creates no story", async () => {
		const owner = await signUp();
		const originDraftId = newId();
		const response = await publish(owner.cookie, {
			...publishRequest({ originDraftId }),
			runtime: runtimeSource("export default 1;\n"),
		});
		expect(response.status).toBe(400);

		const rows = await db
			.select({ id: story.id })
			.from(story)
			.where(eq(story.origin_draft_id, originDraftId));
		expect(rows).toEqual([]);
	});

	test("refuses when there is no entry file", async () => {
		const owner = await signUp();
		const response = await publish(owner.cookie, {
			...publishRequest(),
			runtime: {
				mode: "source",
				project: {
					apiVersion: RUNTIME_API_VERSION,
					entry: "src/missing.tsx",
					files: [{ path: "src/main.tsx", content: COUNTER_SOURCE }],
				},
			},
		});
		expect(response.status).toBe(400);
		expect(((await response.json()) as ErrorBody).code).toBe(
			STORY_PUBLISH_ERROR_CODE.runtimeInvalid,
		);
	});

	test("doesn't compile an API version this server doesn't know", async () => {
		const owner = await signUp();
		const response = await publish(owner.cookie, {
			...publishRequest(),
			runtime: {
				mode: "source",
				project: {
					apiVersion: 9_999,
					entry: "src/main.tsx",
					files: [{ path: "src/main.tsx", content: COUNTER_SOURCE }],
				},
			},
		});
		expect(response.status).toBe(400);
	});

	test("capabilities derive from the source — the request doesn't set them", async () => {
		const owner = await signUp();
		const plain = await publishWithRuntime(owner.cookie, COUNTER_SOURCE);
		const ai = await publishWithRuntime(owner.cookie, GENERATION_SOURCE);

		expect((await readRuntime(plain))?.capabilities).toEqual([]);
		expect((await readRuntime(ai))?.capabilities).toEqual(["generation"]);
	});
});

describe.skipIf(!databaseReady)("runtime publish — three branches", () => {
	test("omitting the field in an update preserves the published runtime", async () => {
		/**
		 * Rollout safeguard. An old client that does not know this field sends an update with no
		 * `runtime`; reading that absence as "turned off" would let one update delete the published
		 * runtime.
		 */
		const owner = await signUp();
		const originDraftId = newId();
		const created = await publish(owner.cookie, {
			...publishRequest({ originDraftId }),
			runtime: runtimeSource(COUNTER_SOURCE),
		});
		const storyId = ((await created.json()) as PublishBody).story.id;
		const before = await readRuntime(storyId);

		const updated = await update(owner.cookie, storyId, {
			...publishRequest({ originDraftId }),
			metadata: { title: "Changes only the title", visibility: "private" },
		});
		expect(updated.status).toBe(200);

		const after = await readRuntime(storyId);
		expect(after).not.toBeNull();
		expect(after?.source_hash).toBe(before?.source_hash);
	});

	test("explicit disable deletes the published runtime", async () => {
		const owner = await signUp();
		const originDraftId = newId();
		const created = await publish(owner.cookie, {
			...publishRequest({ originDraftId }),
			runtime: runtimeSource(COUNTER_SOURCE),
		});
		const storyId = ((await created.json()) as PublishBody).story.id;

		const updated = await update(owner.cookie, storyId, {
			...publishRequest({ originDraftId }),
			runtime: { mode: "disabled" },
		});
		expect(updated.status).toBe(200);
		expect(await readRuntime(storyId)).toBeNull();
		expect(
			((await updated.json()) as { story: PublishBody["story"] }).story
				.playMode,
		).toBe("chat");
	});

	test("omitting it in the first publish makes a conversation story", async () => {
		const owner = await signUp();
		const response = await publish(owner.cookie, publishRequest());
		expect(response.status).toBe(201);
		const body = (await response.json()) as PublishBody;
		expect(body.story.playMode).toBe("chat");
		expect(await readRuntime(body.story.id)).toBeNull();
	});

	test("republishing swaps the artifact", async () => {
		const owner = await signUp();
		const originDraftId = newId();
		const created = await publish(owner.cookie, {
			...publishRequest({ originDraftId }),
			runtime: runtimeSource(COUNTER_SOURCE),
		});
		const storyId = ((await created.json()) as PublishBody).story.id;
		const before = await readRuntime(storyId);

		const updated = await update(owner.cookie, storyId, {
			...publishRequest({ originDraftId }),
			runtime: runtimeSource(GENERATION_SOURCE),
		});
		expect(updated.status).toBe(200);

		const after = await readRuntime(storyId);
		expect(after?.source_hash).not.toBe(before?.source_hash);
		expect(after?.capabilities).toEqual(["generation"]);
	});

	test("a republish that fails to compile leaves the old runtime", async () => {
		/** A failed republish leaves the already-published runtime untouched. */
		const owner = await signUp();
		const originDraftId = newId();
		const created = await publish(owner.cookie, {
			...publishRequest({ originDraftId }),
			runtime: runtimeSource(COUNTER_SOURCE),
		});
		const storyId = ((await created.json()) as PublishBody).story.id;
		const before = await readRuntime(storyId);

		const updated = await update(owner.cookie, storyId, {
			...publishRequest({ originDraftId }),
			metadata: { title: "A title I tried to fix", visibility: "private" },
			runtime: runtimeSource("export default function App( {\n"),
		});
		expect(updated.status).toBe(400);

		const after = await readRuntime(storyId);
		expect(after?.source_hash).toBe(before?.source_hash);
		/** Metadata is unchanged too: the publication never happened. */
		const [row] = await db
			.select({ title: story.title })
			.from(story)
			.where(eq(story.id, storyId));
		expect(row?.title).toBe("Runtime story");
	});

	test("retrying the same draft folds into one story", async () => {
		const owner = await signUp();
		const originDraftId = newId();
		const body = {
			...publishRequest({ originDraftId }),
			runtime: runtimeSource(COUNTER_SOURCE),
		};
		const first = await publish(owner.cookie, body);
		const second = await publish(owner.cookie, body);
		expect(first.status).toBe(201);
		/** The second is an update; 201 versus 200 already expresses that. */
		expect(second.status).toBe(200);

		const firstId = ((await first.json()) as PublishBody).story.id;
		const secondBody = (await second.json()) as PublishBody;
		expect(secondBody.story.id).toBe(firstId);
		expect(secondBody.created).toBe(false);

		const rows = await db
			.select({ story_id: story_runtime.story_id })
			.from(story_runtime)
			.where(eq(story_runtime.story_id, firstId));
		expect(rows.length).toBe(1);
	});
});

describe.skipIf(!databaseReady)("creator deletion", () => {
	/**
	 * Playback of a public work survives its creator's account deletion.
	 *
	 * `story_runtime` has no member foreign key; with one the row would vanish with the creator and
	 * the surviving public work would be an empty shell. `story_media` made the same decision.
	 */
	test("a public story's runtime remains with only the identity removed", async () => {
		const owner = await signUp();
		const reader = await signUp();
		const storyId = await publishWithRuntime(owner.cookie, COUNTER_SOURCE, {
			metadata: { title: "A remaining runtime", visibility: "public" },
		});

		const deleted = await app.request("/v2/auth/delete-user", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				Cookie: owner.cookie,
			},
			body: JSON.stringify({ password: TEST_PASSWORD }),
		});
		expect(deleted.status).toBe(200);

		const [row] = await db
			.select({ owner: story.owner })
			.from(story)
			.where(eq(story.id, storyId));
		expect(row?.owner).toBeNull();
		expect(await readRuntime(storyId)).not.toBeNull();

		/** Viewers still open a public work whose owner is gone. */
		const response = await playback(reader.cookie, storyId);
		expect(response.status).toBe(200);
		expect(((await response.json()) as StoryPlaybackDto).kind).toBe("runtime");
	});
});

describe.skipIf(!databaseReady)("playback — the unified path", () => {
	test("a runtime story gives the artifact", async () => {
		const owner = await signUp();
		const storyId = await publishWithRuntime(owner.cookie);

		const response = await playback(owner.cookie, storyId);
		expect(response.status).toBe(200);
		const body = (await response.json()) as StoryPlaybackDto;
		expect(body.kind).toBe("runtime");
		if (body.kind !== "runtime") throw new Error("not the runtime branch");
		expect(body.version).toBe(1);
		expect(body.capabilities).toEqual([]);
		expect(JSON.stringify(body.artifact)).toContain("src/main.tsx");
		/** The rating runtime generation reads (`resolveAllAges`); this work was published all-ages. */
		expect(body.adult).toBe(false);
	});

	test("a conversation story gives the playback snapshot", async () => {
		const owner = await signUp();
		const created = await publish(owner.cookie, publishRequest());
		const storyId = ((await created.json()) as PublishBody).story.id;

		const response = await playback(owner.cookie, storyId);
		expect(response.status).toBe(200);
		const body = (await response.json()) as StoryPlaybackDto;
		expect(body.kind).toBe("chat");
		if (body.kind !== "chat") throw new Error("not the conversation branch");
		expect(body.seed.storyId).toBe(storyId);
	});

	test("the old path gives a conversation snapshot even for runtime stories", async () => {
		/**
		 * Intended compatibility fallback. Already-deployed clients do not know `/playback`, and
		 * receiving a shape they do not know for a runtime story only surfaces as "the work cannot be
		 * opened".
		 */
		const owner = await signUp();
		const storyId = await publishWithRuntime(owner.cookie);

		const response = await play(owner.cookie, storyId);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { storyId: string };
		expect(body.storyId).toBe(storyId);
	});

	test("a guest doesn't receive the artifact — and existence doesn't leak either", async () => {
		const owner = await signUp();
		const storyId = await publishWithRuntime(owner.cookie, COUNTER_SOURCE, {
			metadata: { title: "Public runtime", visibility: "public" },
		});

		const known = await playback(null, storyId);
		const unknown = await playback(null, newId());
		expect(known.status).toBe(401);
		/** The same 401 as a missing story: rejection comes before lookup. */
		expect(unknown.status).toBe(401);
		expect(await known.text()).not.toContain("src/main.tsx");
	});

	/** A public runtime story also serves its artifact to non-creator members, through the same gate as conversation works. */
	test("plays someone else's public runtime story", async () => {
		const owner = await signUp();
		const stranger = await signUp();
		const storyId = await publishWithRuntime(owner.cookie, COUNTER_SOURCE, {
			metadata: { title: "Public runtime", visibility: "public" },
		});

		const response = await playback(stranger.cookie, storyId);
		expect(response.status).toBe(200);
		expect(((await response.json()) as StoryPlaybackDto).kind).toBe("runtime");
	});

	test("an operator-hidden story is closed to the creator too", async () => {
		const owner = await signUp();
		const storyId = await publishWithRuntime(owner.cookie);
		await db.update(story).set({ hidden: true }).where(eq(story.id, storyId));

		const response = await playback(owner.cookie, storyId);
		expect(response.status).toBe(404);
		expect(await response.text()).not.toContain("src/main.tsx");
	});

	test("the story projection states the playback mode", async () => {
		const owner = await signUp();
		const storyId = await publishWithRuntime(owner.cookie);

		const response = await app.request(`/v2/stories/${storyId}`, {
			headers: { Origin: WEB_ORIGIN, Cookie: owner.cookie },
		});
		expect(response.status).toBe(200);
		expect(((await response.json()) as { playMode: string }).playMode).toBe(
			"runtime",
		);
	});
});
