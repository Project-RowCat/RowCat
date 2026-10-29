import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

/**
 * Re-seeds the fixed fixture on every run rather than once, because the journeys stand on it.
 *
 * The fixture is a public story with no owner (`db/seed-e2e.ts` records why: the lifecycle of
 * accounts and stories created by journeys stays unentangled). But the api suite's tests delete
 * ownerless stories in their cleanup (`db.delete(story).where(isNull(story.owner))`). That is
 * correct for them, since they create anonymous stories of exactly that shape. Running `pnpm
 * test:e2e` after `pnpm test` would start with the fixture gone, and most journeys would fail at
 * the story page with 'story not found', which is this product's normal branch, so the cause would
 * not be visible.
 *
 * The seed is an upsert, so repeated runs give the same result. Rather than rely on order, it is
 * re-seeded every time, so neither suite needs to know about the other.
 *
 * No accounts are created here. Only one shared resource, which belongs to no journey, is seeded,
 * and it is fixed so journeys can go straight to its address.
 */
const run = promisify(execFile);

export default async function seedFixtures(): Promise<void> {
	const { stdout, stderr } = await run(
		"pnpm",
		["--filter", "@rowcat/api", "db:seed:e2e"],
		{ cwd: resolve(__dirname, "../..") },
	);
	const output = `${stdout}${stderr}`;
	if (!output.includes("[seed-e2e] ready"))
		throw new Error(`[e2e] couldn't seed the fixed fixtures\n${output}`);
	console.log("[e2e] fixed fixtures ready");
}
