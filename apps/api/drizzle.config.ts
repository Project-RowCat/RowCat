import { defineConfig } from "drizzle-kit";

/**
 * Migration generation only; the runtime (src/db/client.ts) never reads this file, so DATABASE_URL
 * here is the developer shell's value for `db:generate`/`db:push`.
 */
export default defineConfig({
	schema: "./src/db/schema.ts",
	out: "./drizzle",
	dialect: "postgresql",
	dbCredentials: {
		url:
			process.env.DATABASE_URL ??
			"postgres://rowcat:rowcat@localhost:5432/rowcat",
	},
	// Generated SQL is read and reviewed by a person; destructive changes are caught there.
	verbose: true,
	strict: true,
});
