import { StoryChatSeedDto, type StoryChatSeedInput } from "@rowcat/contracts";
import { eq, isNull } from "drizzle-orm";
import { env } from "../env.ts";
import { db } from "./client.ts";
import { story } from "./schema.ts";

/**
 * Dev-only playback payload seeding; runs only when invoked explicitly.
 *
 * ```bash
 * pnpm --filter @rowcat/api db:seed:play          # every story without a payload
 * pnpm --filter @rowcat/api db:seed:play <storyId> # one story
 * ```
 *
 * It is a CLI on purpose. A server-side "create a default when the payload is missing" branch would
 * live on in production too and open plausible fake conversations for unmigrated stories, hiding
 * what has not been moved. A missing payload must fail (`story_play_unavailable`). Refuses to run
 * in production: overwriting real data with fixtures cannot be undone.
 */

/** Demo snapshot: just enough to check generation runs (one scenario, one character, one lore entry). */
const demoSeed = (storyId: string, title: string): StoryChatSeedInput => ({
	version: 1,
	storyId,
	title,
	tagline: "Development demo snapshot",
	adult: false,
	promptProtected: false,
	scenario:
		"Rainport, a harbor city where the rain never stops. Smuggling and rumors flow at the same speed, and people tell the real stories only under an umbrella.",
	firstScene:
		"The old tavern door creaks open. Rainwater still dripping from her feet, she sits at the far end of the counter.",
	playGuide:
		"Keep scene descriptions short and write dialogue in each character's voice. Always leave the user room to choose.",
	persona: {
		name: "Traveler",
		description: "An outsider who just arrived in this city.",
	},
	characters: [
		{
			name: "Rina",
			description:
				"Owner of the tavern 'The Wet Lighthouse'. In her mid-thirties.",
			personality:
				"Curt, but the first to notice what others are going through.",
			speechStyle: "Speaks in short, clipped sentences. Never formal.",
			exampleDialogue: "Came in through the rain. Towel's over there.",
		},
	],
	lore: [
		{
			keys: ["lighthouse", "fog"],
			content:
				"The harbor lighthouse has been dark for three years. Bring it up and people change the subject.",
			constant: false,
			position: "before_history",
			order: 0,
		},
	],
});

async function main(): Promise<void> {
	if (env.NODE_ENV === "production") {
		console.error(
			"[seed-play] does not run in production — it would overwrite production stories with development fixtures",
		);
		process.exitCode = 1;
		return;
	}

	const storyId = process.argv[2];
	// Without an argument only stories with an empty payload are filled; existing values are never
	// touched.
	const rows = await db
		.select({ id: story.id, title: story.title })
		.from(story)
		.where(storyId ? eq(story.id, storyId) : isNull(story.play_payload));

	if (!rows.length) {
		console.log("[seed-play] no target stories");
		return;
	}

	for (const row of rows) {
		// Validate the fixture against the contract; a failure here would otherwise surface far from its
		// cause at read time.
		const payload = StoryChatSeedDto.parse(demoSeed(row.id, row.title));
		await db
			.update(story)
			.set({ play_payload: payload })
			.where(eq(story.id, row.id));
		console.log(`[seed-play] ${row.id} (${row.title})`);
	}
	console.log(`[seed-play] done, ${rows.length} rows`);
}

await main();
// The process only exits once the pool is closed.
await db.$client.end();
