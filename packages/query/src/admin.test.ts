import type { RowCatClient } from "@rowcat/sdk";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
	ADMIN_AUDIT_QUERY_KEY_PREFIX,
	adminDeleteStoryMutationOptions,
	adminStoryQueryKey,
} from "./admin.ts";

/**
 * Cache policy for operator-console actions. No React: the policy is rules on QueryClient, not a
 * hook.
 */

const newClient = () =>
	new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});

const clientOf = (admin: Partial<RowCatClient["admin"]>): RowCatClient =>
	({ admin }) as RowCatClient;

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

describe("adminDeleteStoryMutationOptions", () => {
	const STORY = "story-1";
	const seededClient = () => {
		const queryClient = newClient();
		queryClient.setQueryData(adminStoryQueryKey(STORY), {
			story: { id: STORY },
		});
		queryClient.setQueryData(["admin", "stories", "", "", "", "", ""], {
			items: [],
		});
		queryClient.setQueryData([...ADMIN_AUDIT_QUERY_KEY_PREFIX, "x"], {
			items: [],
		});
		queryClient.setQueryData(["admin", "ops", "features"], { items: [] });
		return queryClient;
	};

	/** A detail for a deleted work is a 404, so its cell is removed rather than re-asked. */
	it("removes the detail cell and marks only the list and audit stale", async () => {
		const queryClient = seededClient();
		const sent: unknown[] = [];
		const options = adminDeleteStoryMutationOptions(
			clientOf({
				deleteStory: async (id, input) => {
					sent.push([id, input]);
					return { outcome: "deleted" };
				},
			}),
			queryClient,
			STORY,
		);
		expect(await run(queryClient, options, { reason: "request" })).toBe(
			"success",
		);
		expect(sent).toEqual([[STORY, { reason: "request" }]]);
		expect(queryClient.getQueryData(adminStoryQueryKey(STORY))).toBeUndefined();
		expect(
			queryClient.getQueryState(["admin", "stories", "", "", "", "", ""])
				?.isInvalidated,
		).toBe(true);
		expect(
			queryClient.getQueryState([...ADMIN_AUDIT_QUERY_KEY_PREFIX, "x"])
				?.isInvalidated,
		).toBe(true);
		/**
		 * Does not invalidate the whole ["admin"] prefix: the feature switch does not move with this
		 * action.
		 */
		expect(
			queryClient.getQueryState(["admin", "ops", "features"])?.isInvalidated,
		).toBe(false);
	});

	/** If the request fails, no cell changes: the story is not optimistically removed. */
	it("on failure the detail stays", async () => {
		const queryClient = seededClient();
		const options = adminDeleteStoryMutationOptions(
			clientOf({
				deleteStory: () => Promise.reject(new Error("409")),
			}),
			queryClient,
			STORY,
		);
		expect(await run(queryClient, options, { reason: "request" })).toBe(
			"error",
		);
		expect(queryClient.getQueryData(adminStoryQueryKey(STORY))).toBeDefined();
		expect(
			queryClient.getQueryState(adminStoryQueryKey(STORY))?.isInvalidated,
		).toBe(false);
	});
});
