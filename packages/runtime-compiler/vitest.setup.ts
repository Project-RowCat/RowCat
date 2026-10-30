import { afterEach } from "vitest";

/**
 * Every case in this package compiles synchronously, and vitest moves from one case to the next on
 * microtasks alone, so a test file holds the worker's event loop for its whole run. The worker
 * reports progress to the main process over an RPC whose reply is read on that loop and which fails
 * after 60 seconds, a limit no option or CLI flag widens. `compile.test.ts` takes 18 s alone and took
 * 101 s on the four-vCPU CI runner beside three other suites; the run failed with
 * `Timeout calling "onTaskUpdate"` although every test passed.
 *
 * One macrotask between cases lets the loop read that reply. It changes nothing a case runs, and the
 * per-case timeout stays the root `pnpm test` flag's (`turbo.json`, the `test` task).
 */
afterEach(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
