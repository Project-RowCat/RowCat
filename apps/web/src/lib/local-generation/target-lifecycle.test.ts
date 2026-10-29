import type { GenerationTarget } from "@rowcat/chat";
import {
	PRODUCT_GENERATION_TARGET,
	resolveEffectiveGeneration,
	resolveGenerationExecution,
} from "@rowcat/chat";
import { DEFAULT_MANAGED_MODEL } from "@rowcat/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
	activateLocalDbScope,
	resetLocalDbScope,
} from "#/lib/local-data/db.ts";
import { createProviderConnectionStore } from "#/lib/local-provider/store.ts";
import { createGenerationPreferenceStore } from "./store.ts";

/**
 * What does a preference do while a connection changes hands? The answer is nothing. That is why
 * this test sets up both stores together. Each store's unit test checks only its own rule. The
 * costly mistakes in this slice occur where the two meet:
 * - Disconnecting deletes the preference. There is no way back, and nobody knows what was
 *   deleted.
 * - Disconnecting downgrades the target to RowCat. This is a silent substitution that changes the
 *   billed target and the privacy boundary.
 * - An unusable target is judged executable. The failure then appears only after the user presses
 *   send. So the test checks a full story, not a stored value: connect, executable, disconnect,
 *   blocked, reconnect, executable again. The stored preference must stay as first chosen
 *   throughout.
 */

let sequence = 0;
const nextViewer = (): string => `target-lifecycle-${++sequence}`;

const stores = (viewerId: string) => {
	const db = activateLocalDbScope(viewerId);
	return {
		preferences: createGenerationPreferenceStore(db),
		providers: createProviderConnectionStore(db, viewerId),
	};
};

const ANTHROPIC: GenerationTarget = {
	provider: "anthropic-byo",
	model: "claude-sonnet-5",
};
const KEY = "sk-ant-test-0123456789";

/** Mirrors what the generation hook does just before running: read from the store, then judge. */
const execute = async (
	scope: ReturnType<typeof stores>,
	roomId?: string,
	catalog?: readonly {
		provider: GenerationTarget["provider"];
		model: string;
	}[],
) => {
	const effective = resolveEffectiveGeneration({
		global: await scope.preferences.getGlobal(),
		room: roomId ? await scope.preferences.getRoom(roomId) : null,
	});
	return resolveGenerationExecution({
		target: effective.target,
		connectedProviders: (await scope.providers.list()).map(
			(connection) => connection.provider,
		),
		byoAllowed: true,
		catalog,
	});
};

afterEach(() => {
	resetLocalDbScope();
});

describe("disconnecting and reconnecting", () => {
	it("disconnecting keeps the chosen target, and reconnecting runs it again", async () => {
		const scope = stores(nextViewer());
		await scope.providers.connect("anthropic-byo", KEY);
		await scope.preferences.setGlobal({
			responseLength: null,
			target: ANTHROPIC,
			reasoningEffort: null,
		});

		expect((await execute(scope)).status).toBe("executable");

		await scope.providers.disconnect("anthropic-byo");

		const blocked = await execute(scope);
		expect(blocked.status).toBe("blocked");
		if (blocked.status === "blocked") {
			expect(blocked.reason).toBe("provider_not_connected");
			/**
			 * This does not point at another provider. The blocked result carries the value the user chose.
			 */
			expect(blocked.target).toEqual(ANTHROPIC);
		}
		/** The stored preference is still there. Disconnecting neither deletes nor downgrades it. */
		expect((await scope.preferences.getGlobal()).target).toEqual(ANTHROPIC);

		await scope.providers.connect("anthropic-byo", KEY);
		expect((await execute(scope)).status).toBe("executable");
		expect((await scope.preferences.getGlobal()).target).toEqual(ANTHROPIC);
	});

	it("room overrides follow the same rule", async () => {
		const scope = stores(nextViewer());
		await scope.providers.connect("anthropic-byo", KEY);
		await scope.preferences.setRoom("room-1", {
			responseLength: null,
			target: ANTHROPIC,
			reasoningEffort: null,
		});

		await scope.providers.disconnect("anthropic-byo");

		expect((await execute(scope, "room-1")).status).toBe("blocked");
		expect((await scope.preferences.getRoom("room-1")).target).toEqual(
			ANTHROPIC,
		);
		/** Other rooms without an override are unaffected, and the product default applies to them. */
		expect((await execute(scope, "room-2")).status).toBe("executable");
	});

	it("disconnecting one provider keeps the other's connection", async () => {
		const scope = stores(nextViewer());
		await scope.providers.connect("anthropic-byo", KEY);
		await scope.providers.connect("gemini-byo", "AIzaTestKey0123456789");
		await scope.preferences.setGlobal({
			responseLength: null,
			target: { provider: "gemini-byo", model: "gemini-3.7-flash" },
			reasoningEffort: null,
		});

		await scope.providers.disconnect("anthropic-byo");
		expect((await execute(scope)).status).toBe("executable");
	});
});

describe("a model gone from the catalogue", () => {
	it("the stored target stays and only the settings screen says so", async () => {
		const scope = stores(nextViewer());
		await scope.providers.connect("anthropic-byo", KEY);
		await scope.preferences.setGlobal({
			responseLength: null,
			target: ANTHROPIC,
			reasoningEffort: null,
		});

		/**
		 * The settings screen passes the catalog. Telling the user ahead of time is that screen's job.
		 */
		const inSettings = await execute(scope, undefined, [
			{ provider: "rowcat", model: DEFAULT_MANAGED_MODEL },
		]);
		expect(inSettings.status).toBe("blocked");
		if (inSettings.status === "blocked")
			expect(inSettings.reason).toBe("model_unavailable");

		/**
		 * The catalog is not passed right before generation. A server state that could not be read must
		 * not block the conversation. If the model really is missing, the provider rejects it, and that
		 * failure is accurate.
		 */
		expect((await execute(scope)).status).toBe("executable");

		expect((await scope.preferences.getGlobal()).target).toEqual(ANTHROPIC);
	});
});

describe("inheritance is not copying", () => {
	it("changing the global carries rooms without overrides", async () => {
		const scope = stores(nextViewer());
		await scope.providers.connect("gemini-byo", "AIzaTestKey0123456789");

		await scope.preferences.setRoom("room-1", {
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		});
		expect((await execute(scope, "room-1")).target).toEqual(
			PRODUCT_GENERATION_TARGET,
		);

		await scope.preferences.setGlobal({
			responseLength: null,
			target: { provider: "gemini-byo", model: "gemini-3.7-flash" },
			reasoningEffort: null,
		});

		expect((await scope.preferences.getRoom("room-1")).target).toBeNull();
		expect((await execute(scope, "room-1")).target).toEqual({
			provider: "gemini-byo",
			model: "gemini-3.7-flash",
		});
		/** The length axis stays as the room set it. The two axes do not pull each other along. */
		const effective = resolveEffectiveGeneration({
			global: await scope.preferences.getGlobal(),
			room: await scope.preferences.getRoom("room-1"),
		});
		expect(effective.responseLength).toBe("long");
		expect(effective.sources).toEqual({
			responseLength: "room",
			target: "global",
			/** No one set the reasoning axis, and changing the target does not touch it. */
			reasoningEffort: "product",
		});
	});

	it("if the inherited target is unusable, that room is blocked too", async () => {
		const scope = stores(nextViewer());
		await scope.preferences.setGlobal({
			responseLength: null,
			target: ANTHROPIC,
			reasoningEffort: null,
		});
		await scope.preferences.setRoom("room-1", {
			responseLength: "short",
			target: null,
			reasoningEffort: null,
		});

		const execution = await execute(scope, "room-1");
		expect(execution.status).toBe("blocked");
		/** The room is blocked even though it sets no target. Judgment applies to the effective value. */
		expect((await scope.preferences.getRoom("room-1")).target).toBeNull();
	});
});
