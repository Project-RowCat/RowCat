import type { ThemeCustomizationStateDto } from "@rowcat/contracts";
import type { RowCatClient } from "@rowcat/sdk";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
	clearThemeColorsMutationOptions,
	effectiveThemeSelection,
	resetThemeMutationOptions,
	saveThemeColorsMutationOptions,
	saveThemePresetMutationOptions,
	THEME_CUSTOMIZATION_QUERY_KEY,
} from "./theme.ts";
import { refreshViewerState, resetViewerState } from "./viewer.ts";

/**
 * Cache policy for the account theme. Two things are checked, both very visible on screen:
 * 1. The previous account's theme must not survive an account switch. Invalidation keeps the
 *    cached value, and that value is the color actually painted, so a leftover looks like a leak.
 * 2. The apply decision lives in one place. If two apps each wrote it, one would miss a
 *    condition.
 *
 * Does not use React. The policy is a rule on QueryClient, not a hook.
 */

const ALICE: ThemeCustomizationStateDto = {
	preset: "black",
	customization: { background: "#10131a", primary: "#9a83ff" },
};

const EMPTY: ThemeCustomizationStateDto = {
	preset: "default",
	customization: {},
};

const newClient = () =>
	new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});

/** Fake client with only the one function needed. Calling any other method fails at that point. */
const clientOf = (theme: Partial<RowCatClient["theme"]>): RowCatClient =>
	({ theme }) as RowCatClient;

async function run<TVariables>(
	queryClient: QueryClient,
	options: object,
	variables: TVariables,
): Promise<"success" | "error"> {
	const observer = new MutationObserver(
		queryClient,
		options as ConstructorParameters<typeof MutationObserver>[1],
	);
	try {
		await observer.mutate(variables);
		return "success";
	} catch {
		return "error";
	}
}

const stateIn = (queryClient: QueryClient) =>
	queryClient.getQueryData<ThemeCustomizationStateDto>(
		THEME_CUSTOMIZATION_QUERY_KEY,
	);

describe("the key is under the viewer", () => {
	/**
	 * A global key (['theme']) would sit outside the logout cleanup, and the symptom would be Alice's
	 * colors on Bob's first screen on a shared browser.
	 */
	it("the prefix is viewer", () => {
		expect(THEME_CUSTOMIZATION_QUERY_KEY[0]).toBe("viewer");
	});

	/**
	 * Does not put the member id in the key. If it did, the previous person's slot would survive under
	 * a different key that the prefix cleanup cannot clear.
	 */
	it("the key has no member id", () => {
		expect([...THEME_CUSTOMIZATION_QUERY_KEY]).toEqual([
			"viewer",
			"theme-customization",
		]);
	});
});

describe("effectiveThemeSelection", () => {
	it("with a viewer the preset and colors come together", () => {
		expect(effectiveThemeSelection(ALICE, "alice")).toEqual({
			preset: "black",
			customization: ALICE.customization,
		});
	});

	it("without a viewer there is nothing, even with a cache left", () => {
		expect(effectiveThemeSelection(ALICE, null)).toEqual({
			preset: "default",
			customization: {},
		});
	});

	it("nothing while unknown", () => {
		expect(effectiveThemeSelection(undefined, "alice")).toEqual({
			preset: "default",
			customization: {},
		});
	});

	/**
	 * The empty document returned when there is no value must be the same instance. A new {} on each
	 * call would rerun the consumer's useEffect and useMemo on every render, and on web that means
	 * erasing and rewriting the document's custom properties. When a value exists, the server response
	 * object is passed through as is, and the query cache already holds that reference.
	 */
	it("the empty color document is a stable reference", () => {
		const a = effectiveThemeSelection(ALICE, null).customization;
		const b = effectiveThemeSelection(undefined, "alice").customization;
		expect(a).toBe(b);
		expect(effectiveThemeSelection(EMPTY, "alice").customization).toBe(
			EMPTY.customization,
		);
	});
});

describe("the chosen value comes out as is", () => {
	/**
	 * An account that has not picked a preset gets 'default', and that value itself means 'no account
	 * override'.
	 */
	it("the default preset comes out as is too", () => {
		expect(effectiveThemeSelection(EMPTY, "alice")).toEqual({
			preset: "default",
			customization: {},
		});
	});
});

describe("all four writes seat the server's value as is", () => {
	it("the color save response overwrites the cache", async () => {
		const queryClient = newClient();
		queryClient.setQueryData(THEME_CUSTOMIZATION_QUERY_KEY, EMPTY);

		const result = await run(
			queryClient,
			saveThemeColorsMutationOptions(
				clientOf({ saveColors: async () => ALICE }),
				queryClient,
			),
			ALICE.customization,
		);

		expect(result).toBe("success");
		expect(stateIn(queryClient)).toEqual(ALICE);
	});

	/**
	 * Saving a preset does not erase the colors. The cached value is the server state, and the
	 * response carries the saved colors back unchanged, so the screen has no merge to imitate.
	 */
	it("the preset save response carries the colors as is", async () => {
		const queryClient = newClient();
		queryClient.setQueryData(THEME_CUSTOMIZATION_QUERY_KEY, ALICE);

		const next: ThemeCustomizationStateDto = { ...ALICE, preset: "gray" };
		const result = await run(
			queryClient,
			saveThemePresetMutationOptions(
				clientOf({ savePreset: async () => next }),
				queryClient,
			),
			"gray",
		);

		expect(result).toBe("success");
		expect(stateIn(queryClient)).toEqual(next);
		expect(stateIn(queryClient)?.customization).toEqual(ALICE.customization);
	});

	/** The reverse: saving colors leaves the preset unchanged, since the response carries it back. */
	it("the color save response carries the preset as is", async () => {
		const queryClient = newClient();
		queryClient.setQueryData(THEME_CUSTOMIZATION_QUERY_KEY, ALICE);

		const next: ThemeCustomizationStateDto = {
			...ALICE,
			customization: { primary: "#55ccff" },
		};
		await run(
			queryClient,
			saveThemeColorsMutationOptions(
				clientOf({ saveColors: async () => next }),
				queryClient,
			),
			next.customization,
		);

		expect(stateIn(queryClient)?.preset).toBe("black");
	});

	/** Clearing only the colors keeps the preset; the server response carries that fact. */
	it("the color reset response keeps the preset", async () => {
		const queryClient = newClient();
		queryClient.setQueryData(THEME_CUSTOMIZATION_QUERY_KEY, ALICE);

		const next: ThemeCustomizationStateDto = { ...ALICE, customization: {} };
		await run(
			queryClient,
			clearThemeColorsMutationOptions(
				clientOf({ clearColors: async () => next }),
				queryClient,
			),
			undefined,
		);

		expect(stateIn(queryClient)).toEqual(next);
		expect(stateIn(queryClient)?.preset).toBe("black");
	});

	it("the full reset response overwrites the cache", async () => {
		const queryClient = newClient();
		queryClient.setQueryData(THEME_CUSTOMIZATION_QUERY_KEY, ALICE);

		await run(
			queryClient,
			resetThemeMutationOptions(
				clientOf({ reset: async () => EMPTY }),
				queryClient,
			),
			undefined,
		);

		expect(stateIn(queryClient)).toEqual(EMPTY);
	});

	/**
	 * Does not create a slot that does not exist. setQueryData creates an entry even without an
	 * observer, and a value born that way looks present without ever having been asked of the server.
	 */
	it("without a held value no new cell is made", async () => {
		const queryClient = newClient();

		await run(
			queryClient,
			saveThemeColorsMutationOptions(
				clientOf({ saveColors: async () => ALICE }),
				queryClient,
			),
			ALICE.customization,
		);

		expect(stateIn(queryClient)).toBeUndefined();
	});

	/** A failure does not touch the cache. This checks the no-optimistic-update claim by value. */
	it("a failed save keeps the held value", async () => {
		const queryClient = newClient();
		queryClient.setQueryData(THEME_CUSTOMIZATION_QUERY_KEY, EMPTY);

		const result = await run(
			queryClient,
			saveThemeColorsMutationOptions(
				clientOf({
					saveColors: async () => {
						throw new Error("invalid_input");
					},
				}),
				queryClient,
			),
			ALICE.customization,
		);

		expect(result).toBe("error");
		expect(stateIn(queryClient)).toEqual(EMPTY);
	});
});

describe("no theme survives an account switch", () => {
	/**
	 * These two checks are the point of this file. Invalidation alone keeps the cached value, and the
	 * apply layer paints it as is, so the next person's first screen would show the previous person's
	 * theme.
	 */
	it("signing out drops the held theme", async () => {
		const queryClient = newClient();
		queryClient.setQueryData(THEME_CUSTOMIZATION_QUERY_KEY, ALICE);

		await resetViewerState(queryClient);

		expect(stateIn(queryClient)).toBeUndefined();
	});

	it("cleanup right after sign-in drops the held theme too", async () => {
		const queryClient = newClient();
		queryClient.setQueryData(THEME_CUSTOMIZATION_QUERY_KEY, ALICE);

		await refreshViewerState(queryClient);

		expect(stateIn(queryClient)).toBeUndefined();
	});
});
