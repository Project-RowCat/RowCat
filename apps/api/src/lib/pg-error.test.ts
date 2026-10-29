import { describe, expect, test } from "vitest";
import {
	findPostgresError,
	isUniqueViolation,
	isUniqueViolationOn,
	PG_UNIQUE_VIOLATION,
} from "./pg-error.ts";

/**
 * Driver error translation: matching broadly would disguise unrelated failures as domain errors.
 * These checks run without a DB; the real race is covered by `routes/admin/mobile-updates.test.ts`,
 * which is skipped when Postgres is absent, so the decision itself keeps an always-running net.
 */

/** The shape node-postgres's `DatabaseError` carries. */
const pgError = (code: string, constraint?: string) =>
	Object.assign(new Error("duplicate key value violates unique constraint"), {
		code,
		...(constraint ? { constraint } : {}),
	});

describe("findPostgresError", () => {
	test("reads the top-level error's code", () => {
		expect(findPostgresError(pgError("23505", "uq_a"), "23505")).toEqual({
			constraint: "uq_a",
		});
	});

	// Follows the `cause` chain: drizzle wraps driver errors, so checking only the top turns a 409
	// into a silent 500.
	test("finds wrapped errors too", () => {
		const wrapped = new Error("Failed query", {
			cause: pgError("23505", "uq_b"),
		});
		expect(findPostgresError(wrapped, "23505")).toEqual({ constraint: "uq_b" });
	});

	test("does not find a different SQLSTATE", () => {
		expect(findPostgresError(pgError("23503", "fk_a"), "23505")).toBeNull();
	});

	test("null when there is no constraint name — it does not invent one", () => {
		expect(findPostgresError(pgError("23505"), "23505")).toEqual({
			constraint: null,
		});
	});

	test("plain errors without a code and primitives do not pass", () => {
		expect(findPostgresError(new Error("boom"), "23505")).toBeNull();
		expect(findPostgresError("23505", "23505")).toBeNull();
		expect(findPostgresError(null, "23505")).toBeNull();
	});

	// Circular `cause` chains exist in practice; the chain is not followed forever.
	test("stops at a cyclic cause", () => {
		const a = new Error("a");
		const b = new Error("b", { cause: a });
		(a as { cause?: unknown }).cause = b;
		expect(findPostgresError(a, "23505")).toBeNull();
	});
});

describe("isUniqueViolationOn", () => {
	test("only a violation of that constraint is true", () => {
		const error = pgError(
			PG_UNIQUE_VIOLATION,
			"uq_mobile_update_job_active_stream",
		);
		expect(
			isUniqueViolationOn(error, "uq_mobile_update_job_active_stream"),
		).toBe(true);
		expect(isUniqueViolation(error)).toBe(true);
	});

	// A failure of another unique constraint the same statement can hit must not be disguised as this
	// domain error.
	test("a unique violation of another constraint is false", () => {
		const error = pgError(PG_UNIQUE_VIOLATION, "uq_story_owner_origin_draft");
		expect(
			isUniqueViolationOn(error, "uq_mobile_update_job_active_stream"),
		).toBe(false);
		expect(isUniqueViolation(error)).toBe(true);
	});

	test("a unique violation with an unknown constraint name is false", () => {
		expect(
			isUniqueViolationOn(
				pgError(PG_UNIQUE_VIOLATION),
				"uq_mobile_update_job_active_stream",
			),
		).toBe(false);
	});

	test("an unrelated error is false", () => {
		expect(
			isUniqueViolationOn(
				new Error("boom"),
				"uq_mobile_update_job_active_stream",
			),
		).toBe(false);
		expect(isUniqueViolation(new Error("boom"))).toBe(false);
	});
});
