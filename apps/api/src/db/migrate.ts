import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./client.ts";

/**
 * Locates the migrations folder. A fixed relative path cannot work: in development this file runs
 * as `src/db/migrate.ts`, while in deployment tsdown folds everything into `dist/index.mjs`, so the
 * `import.meta.url` depth differs and fitting one breaks the other at boot. It walks upward looking
 * for the real journal file, so a missing folder (not shipped in the runtime image) shows up
 * immediately.
 */
function migrationsFolder(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	// Stops at the repository root, or at the filesystem root if nothing is found.
	for (let depth = 0; depth < 5; depth++) {
		const candidate = join(dir, "drizzle");
		if (existsSync(join(candidate, "meta", "_journal.json"))) return candidate;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error(
		"can't find the migrations folder (drizzle/) — check that it shipped with the deploy image",
	);
}

/**
 * Applies migrations at boot. Not a separate pipeline step because a deployment that skips that
 * step would not die on "missing column" but fail only on some paths, discovered much later.
 * Applying here means a process with an outdated schema takes no traffic.
 *
 * Concurrent instances applying the same migration are handled by drizzle's migrator (transaction
 * plus the `__drizzle_migrations` record): the loser sees it already applied and skips.
 */
export async function runMigrations(): Promise<void> {
	await migrate(db, { migrationsFolder: migrationsFolder() });
}
