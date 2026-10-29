import { defineConfig } from "vitest/config";

/**
 * Test config for the query layer. No React: the policy under test is cache behavior, checked
 * directly on a QueryClient. Rendering would make policy tests break on every component edit, so
 * people would change selectors instead of the policy.
 *
 * No network either. Mutations get a fake client, so failures and delays can be simulated. That is
 * all rollback verification needs.
 */
export default defineConfig({
	test: { include: ["src/**/*.test.ts"] },
});
