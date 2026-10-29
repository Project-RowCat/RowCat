import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readPushReceipts, sendPushMessages } from "./expo.ts";

/**
 * Provider adapter: classification is everything. Pinned here:
 * - result order equals input order (losing it hides which device failed)
 * - retry, permanent failure and disabling the registration are different actions
 * - "not ready" is not failure (folding unready receipts to failure records half of normal
 *   deliveries as failed)
 */

const message = (token: string) => ({
	token,
	title: "RowCat",
	body: "You have a new follower.",
	data: { version: 1 as const, notificationId: "n1" },
	channelId: "default",
});

const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("sending", () => {
	test("an empty batch makes no request", async () => {
		expect(await sendPushMessages([], null)).toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("keeps the ids of successful tickets", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ data: [{ status: "ok", id: "ticket-1" }] }),
		);
		expect(
			await sendPushMessages([message("ExponentPushToken[a]")], null),
		).toEqual([{ status: "accepted", ticketId: "ticket-1" }]);
	});

	/** Losing the mapping would hide which device failed. */
	test("the result has the same order and length as the input", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				data: [
					{ status: "ok", id: "t1" },
					{
						status: "error",
						message: "…",
						details: { error: "DeviceNotRegistered" },
					},
					{ status: "ok", id: "t3" },
				],
			}),
		);
		const outcomes = await sendPushMessages(
			["a", "b", "c"].map((t) => message(`ExponentPushToken[${t}]`)),
			null,
		);
		expect(outcomes.map((o) => o.status)).toEqual([
			"accepted",
			"unregistered",
			"accepted",
		]);
	});

	/** A short response must not record the remainder as success. */
	test("a missing ticket is a retry", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ data: [{ status: "ok", id: "t1" }] }),
		);
		const outcomes = await sendPushMessages(
			[message("ExponentPushToken[a]"), message("ExponentPushToken[b]")],
			null,
		);
		expect(outcomes[1]).toEqual({ status: "retry", code: "missing_ticket" });
	});

	describe("classification", () => {
		const outcomeFor = async (error: string) => {
			fetchMock.mockResolvedValue(
				jsonResponse({ data: [{ status: "error", details: { error } }] }),
			);
			const [outcome] = await sendPushMessages(
				[message("ExponentPushToken[a]")],
				null,
			);
			return outcome;
		};

		/** Only this branch disables the registration; that differs from settling one delivery. */
		test("DeviceNotRegistered is the branch that turns the registration off", async () => {
			expect(await outcomeFor("DeviceNotRegistered")).toEqual({
				status: "unregistered",
				code: "DeviceNotRegistered",
			});
		});

		test("MessageRateExceeded sends again later", async () => {
			expect((await outcomeFor("MessageRateExceeded"))?.status).toBe("retry");
		});

		test("what the same request can't fix is a permanent failure", async () => {
			expect((await outcomeFor("MessageTooBig"))?.status).toBe("permanent");
			expect((await outcomeFor("InvalidCredentials"))?.status).toBe(
				"permanent",
			);
		});

		/**
		 * An unknown code must not fold to retry; resending endlessly for an unknown reason would hold
		 * that registration in the batch forever.
		 */
		test("an unknown code is a permanent failure", async () => {
			expect((await outcomeFor("SomethingNew"))?.status).toBe("permanent");
		});
	});

	describe("send failures", () => {
		test("a network failure is a retry", async () => {
			fetchMock.mockRejectedValue(new Error("offline"));
			const [outcome] = await sendPushMessages(
				[message("ExponentPushToken[a]")],
				null,
			);
			expect(outcome).toEqual({ status: "retry", code: "network" });
		});

		test("5xx and 429 are retries, 4xx is a permanent failure", async () => {
			fetchMock.mockResolvedValue(jsonResponse({}, 503));
			expect(
				(await sendPushMessages([message("ExponentPushToken[a]")], null))[0]
					?.status,
			).toBe("retry");

			fetchMock.mockResolvedValue(jsonResponse({}, 429));
			expect(
				(await sendPushMessages([message("ExponentPushToken[a]")], null))[0]
					?.status,
			).toBe("retry");

			fetchMock.mockResolvedValue(jsonResponse({}, 400));
			expect(
				(await sendPushMessages([message("ExponentPushToken[a]")], null))[0]
					?.status,
			).toBe("permanent");
		});
	});

	describe("Auth", () => {
		test("no access token means no header", async () => {
			fetchMock.mockResolvedValue(
				jsonResponse({ data: [{ status: "ok", id: "t" }] }),
			);
			await sendPushMessages([message("ExponentPushToken[a]")], null);
			const headers = fetchMock.mock.calls[0]?.[1]?.headers as
				| Record<string, string>
				| undefined;
			expect(headers?.authorization).toBeUndefined();
		});

		test("with one, sends it as Bearer", async () => {
			fetchMock.mockResolvedValue(
				jsonResponse({ data: [{ status: "ok", id: "t" }] }),
			);
			await sendPushMessages([message("ExponentPushToken[a]")], "secret-value");
			const headers = fetchMock.mock.calls[0]?.[1]?.headers as
				| Record<string, string>
				| undefined;
			expect(headers?.authorization).toBe("Bearer secret-value");
		});
	});

	/**
	 * The destination is a constant, so deployment settings do not decide where push tokens go.
	 */
	test("the only destination is Expo", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ data: [{ status: "ok", id: "t" }] }),
		);
		await sendPushMessages([message("ExponentPushToken[a]")], null);
		expect(fetchMock.mock.calls[0]?.[0]).toBe(
			"https://exp.host/--/api/v2/push/send",
		);
	});
});

describe("receipts", () => {
	test("an empty list makes no request", async () => {
		expect((await readPushReceipts([], null)).size).toBe(0);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("success ends as delivered", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ data: { t1: { status: "ok" } } }),
		);
		expect((await readPushReceipts(["t1"], null)).get("t1")).toEqual({
			status: "delivered",
		});
	});

	/**
	 * A missing receipt is not a failure: Expo omits the key until the receipt is ready, so folding it
	 * records half of normal deliveries as failed.
	 */
	test("a receipt that doesn't exist yet isn't a failure", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ data: {} }));
		expect((await readPushReceipts(["t1"], null)).get("t1")).toEqual({
			status: "pending",
		});
	});

	test("a dead token is the branch that turns the registration off", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				data: {
					t1: { status: "error", details: { error: "DeviceNotRegistered" } },
				},
			}),
		);
		expect((await readPushReceipts(["t1"], null)).get("t1")?.status).toBe(
			"unregistered",
		);
	});

	test("when the lookup itself fails, everything folds into the same branch", async () => {
		fetchMock.mockRejectedValue(new Error("offline"));
		const outcomes = await readPushReceipts(["t1", "t2"], null);
		expect(outcomes.get("t1")?.status).toBe("retry");
		expect(outcomes.get("t2")?.status).toBe("retry");
	});
});
