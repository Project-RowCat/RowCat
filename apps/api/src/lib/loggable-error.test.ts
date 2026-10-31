import { DrizzleQueryError } from "drizzle-orm/errors";
import { expect, test } from "vitest";
import { loggableError, loggableErrorText } from "./loggable-error.ts";

test("a failed query keeps its SQL and the driver's code, never the bound values", () => {
	const driver = Object.assign(
		new Error("timeout exceeded when trying to connect"),
		{
			code: "57P01",
			detail: "Key (owner, id)=(m1, secret-id) already exists.",
		},
	);
	const error = new DrizzleQueryError(
		'insert into "sync_keyring" ("owner", "keyring", "auth_key") values ($1, $2, $3)',
		["m1", "KEYRING-VALUE", "AUTH-KEY-VALUE"],
		driver,
	);

	const logged = JSON.stringify(loggableError(error));
	expect(logged).toContain('insert into \\"sync_keyring\\"');
	expect(logged).toContain("57P01");
	expect(logged).not.toContain("KEYRING-VALUE");
	expect(logged).not.toContain("AUTH-KEY-VALUE");
	expect(logged).not.toContain("secret-id");
});

test("a query error wrapped by a library is still found, and the wrapper's message dropped", () => {
	const inner = new DrizzleQueryError(
		'insert into "session" ("token") values ($1)',
		["SESSION-TOKEN"],
		Object.assign(new Error("Connection terminated"), { code: "57P01" }),
	);
	const wrapper = new Error(`Failed to create session: ${inner.message}`, {
		cause: inner,
	});
	const logged = JSON.stringify(loggableError(wrapper));
	expect(logged).toContain('insert into \\"session\\"');
	expect(logged).not.toContain("SESSION-TOKEN");
	expect(loggableErrorText(wrapper)).not.toContain("SESSION-TOKEN");
});

test("any other error is logged as it was", () => {
	const error = new Error("boom");
	expect(loggableError(error)).toBe(error);
});
