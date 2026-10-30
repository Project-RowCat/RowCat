/**
 * Whether this run may skip what it cannot reach.
 *
 * Locally, a missing Postgres or Redis skips the tests that need it (`database.ts`, the two Redis
 * adapter files), so a change unrelated to them does not force a local server. In CI that
 * convenience is a hole: a service container that never came up, a wrong port or a role without
 * CREATEDB all end in a green run that tested nothing, and a skipped test reads like a passed one in
 * the summary. CI sets this switch, and then each of those folds becomes a failure that names the
 * service.
 *
 * One variable, read where each fold happens, rather than a skip count checked after the run: a
 * count needs a baseline, and the suites that skip on purpose (bodies the public build does not
 * ship) would have to be listed in it.
 */
export const REQUIRE_TEST_SERVICES_ENV = "ROWCAT_REQUIRE_TEST_SERVICES";

export function testServicesRequired(): boolean {
	return process.env[REQUIRE_TEST_SERVICES_ENV] === "1";
}

/** Throws when this run requires its services; otherwise returns so the caller can skip. */
export function failIfServiceRequired(service: string, reason: string): void {
	if (!testServicesRequired()) return;
	throw new Error(
		`${service} is required in this run (${REQUIRE_TEST_SERVICES_ENV}=1), but ${reason}`,
	);
}
