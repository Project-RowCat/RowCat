import { StoryChatSeedDto, type StoryChatSeedInput } from "@rowcat/contracts";
import { RUNTIME_API_VERSION } from "@rowcat/runtime/declarations";
import { eq } from "drizzle-orm";
import { env } from "../env.ts";
import { compileStoryRuntime } from "../services/story/runtime.ts";
import { db } from "./client.ts";
import { member, story, story_comment, story_runtime, user } from "./schema.ts";

/**
 * Fixed fixtures for the browser journeys (E2E); runs only when invoked explicitly.
 *
 * ```bash
 * pnpm --filter @rowcat/api db:seed:e2e
 * ```
 *
 * Separate from `db:seed:play` because the jobs are opposite: that one fills playback payloads into
 * **existing** works (a migration tool), this one **creates** works journeys can open by link.
 * Merged, a dev backfill would start inventing data and could no longer show what is still
 * unmigrated.
 *
 * ## Fixed ids
 *
 * Journeys enter `/stories/<id>` directly. Finding the story by title in the gallery would tie them
 * to discovery sorting, filters and pagination and break them for reasons unrelated to
 * conversation.
 *
 * ## The owner exists
 *
 * The fixture used to have `owner` NULL (a public work whose identity was erased by account
 * deletion), which kept its lifetime independent of the accounts journeys create. Work ownership
 * (since removed, `docs/oss/PLAN.md` stage 3) then required an owner, so the fixture got one
 * dedicated creator: a fixed row belonging to no journey, which keeps that independence. Ownerless
 * public works play now, but the owner stays because it is closer to an ordinary work; an ownerless
 * one is an exceptional branch (no author line) that conversation journeys do not test.
 *
 * ## The creator cannot log in
 *
 * Only `user` and `member` rows are made, with **no credentials (`account` row)**: no password or
 * social identity, so no path signs in as this account. Journeys only need "the work has an owner";
 * a seed that creates loginable accounts is a dev back door (`seed-dev-user.ts` goes through the
 * ordinary signup API because that account must really log in). The `.test` address also receives
 * no mail.
 *
 * ## Journey comments are deleted
 *
 * The fixture has a fixed id, so it is never cleaned up. Journeys create fresh accounts but share
 * the work, so by-products not attached to accounts accumulate, and only comments actually break
 * journeys:
 *
 * ```text
 * comments list oldest first, 20 per page    from the 21st on, new comments are on page two
 * the moderation journey reports on screen   it cannot press a line that is not on page one
 * ```
 *
 * The symptom reads as "the comment was not saved": the new comment is stored but absent from the
 * screen and page one, and nothing says the cause is accumulated residue (hit around the twentieth
 * run). Fixing it on the journey side is worse: paging through `Load more` would make it a pagination
 * journey, and self-cleanup at the end is skipped by failed runs (and erases the failure evidence).
 * So the starting state is set here; globalSetup runs this script every time, so journeys always
 * start at zero comments.
 *
 * The story row is still never deleted (upsert): deleting cascades away favorites and view logs and
 * a failed rerun would leave no fixture. Deletion is narrowed to **this story's comments**, a table
 * with no incoming foreign keys (notifications deliberately have no FK,
 * `db/tables/notification.ts`).
 *
 * ## Refused in production
 *
 * Writing fixtures into production data cannot be undone (same judgement as `db:seed:play`).
 */

/** The story journeys open. It rides in the address, so **changing it breaks the journeys.** */
export const E2E_STORY_ID = "e2e-story-chat";

/**
 * The story runtime journeys open: a row **separate from the conversation fixture**. Merged, the
 * two journeys break each other's premise: attaching a runtime makes `playMode` `runtime`, and the
 * conversation journey's `Start conversation` becomes `Play` and creates no room.
 */
export const E2E_RUNTIME_STORY_ID = "e2e-story-runtime";

/**
 * The fixture creator: one fixed member who cannot log in. The id is fixed like the story's, so the
 * upsert is idempotent; issuing a new one each run would pile up ownerless member rows.
 */
const E2E_CREATOR_ID = "e2e-fixture-creator";
const E2E_CREATOR_USER_ID = "e2e-fixture-user";
/** `.test` reaches no mailbox, so no mail can go out by mistake. */
const E2E_CREATOR_EMAIL = "e2e-fixture@rowcat.test";
/** Same word as the story's `author` display; different axes, but no reason for them to look different. */
const E2E_CREATOR_NICKNAME = "RowCat E2E";

const e2eSeed = (storyId: string, title: string): StoryChatSeedInput => ({
	version: 1,
	storyId,
	title,
	tagline: "Fixed snapshot for the E2E journeys",
	adult: false,
	promptProtected: false,
	scenario:
		"Just enough background for an automated journey to start a conversation. There is no reason for this sentence to grow.",
	/**
	 * The first scene is the value journeys check by eye (the room was made and the seed arrived); a
	 * short, unique sentence so the screen has one thing to find.
	 */
	firstScene: "This is the E2E first scene.",
	playGuide: "Answer briefly.",
	persona: { name: "Traveler", description: "Someone walking the journeys." },
	characters: [
		{
			name: "Guide",
			description: "The fixed fixture's counterpart.",
			personality: "Concise.",
			speechStyle: "Speaks briefly.",
			exampleDialogue: "This is where it starts.",
		},
	],
	lore: [],
});

/**
 * The runtime fixture's **creator source**; the value journeys check by eye lives here. Short and
 * deterministic: journeys count only `Count 0`, press, `Count 1`, reopen, `Count 1`, reset, `Count
 * 0`, so the screen has no other text. **No AI**: it would put the trusted notice first, which is a
 * different axis from the save lifetime this journey verifies.
 */
const E2E_RUNTIME_SOURCE = `import {
	Button,
	Screen,
	Stack,
	Text,
	defineStoryState,
	useStoryState,
} from "@rowcat/runtime";

const run = defineStoryState({
	key: "run",
	version: 1,
	initial: { count: 0 },
});

export default function App() {
	const [story, setStory] = useStoryState(run);
	return (
		<Screen>
			<Stack gap={12}>
				<Text>Count {story.count}</Text>
				<Button
					onPress={() => setStory((current) => ({ count: current.count + 1 }))}
				>
					Increment
				</Button>
			</Stack>
		</Screen>
	);
}
`;

/**
 * Seeds the runtime fixture, **through the same compiler as the product**. Hand-writing the
 * artifact could differ from what the compiler produces now, and a passing journey would then say
 * nothing about whether code a creator actually published runs.
 */
async function seedRuntimeStory(now: Date): Promise<boolean> {
	const title = "E2E runtime journey story";
	const compiled = compileStoryRuntime({
		apiVersion: RUNTIME_API_VERSION,
		entry: "src/main.tsx",
		files: [{ path: "src/main.tsx", content: E2E_RUNTIME_SOURCE }],
	});

	/**
	 * The playback snapshot exists for runtime works too: the compatibility fallback old clients use
	 * via `/play` relies on it, and leaving it empty would break that fallback for this fixture alone.
	 */
	const payload = StoryChatSeedDto.parse(e2eSeed(E2E_RUNTIME_STORY_ID, title));

	await db
		.insert(story)
		.values({
			id: E2E_RUNTIME_STORY_ID,
			owner: E2E_CREATOR_ID,
			title,
			description: "The fixed runtime story the browser journeys use.",
			author: E2E_CREATOR_NICKNAME,
			tags: ["e2e", "runtime"],
			adult: false,
			visibility: "public",
			hidden: false,
			play_payload: payload,
		})
		.onConflictDoUpdate({
			target: story.id,
			set: {
				owner: E2E_CREATOR_ID,
				title,
				visibility: "public",
				hidden: false,
				play_payload: payload,
			},
		});

	const { artifact } = compiled;
	await db
		.insert(story_runtime)
		.values({
			story_id: E2E_RUNTIME_STORY_ID,
			artifact,
			artifact_format_version: artifact.formatVersion,
			runtime_api_version: artifact.apiVersion,
			compiler_version: artifact.compilerVersion,
			source_hash: artifact.sourceHash,
			capabilities: compiled.capabilities,
		})
		.onConflictDoUpdate({
			target: story_runtime.story_id,
			set: {
				artifact,
				artifact_format_version: artifact.formatVersion,
				runtime_api_version: artifact.apiVersion,
				compiler_version: artifact.compilerVersion,
				source_hash: artifact.sourceHash,
				capabilities: compiled.capabilities,
				updated_at: now,
			},
		});

	await db
		.delete(story_comment)
		.where(eq(story_comment.story_id, E2E_RUNTIME_STORY_ID));

	const [row] = await db
		.select({ owner: story.owner })
		.from(story)
		.where(eq(story.id, E2E_RUNTIME_STORY_ID))
		.limit(1);
	return row?.owner === E2E_CREATOR_ID;
}

async function main(): Promise<void> {
	if (env.NODE_ENV === "production") {
		console.error("[seed-e2e] does not run in production.");
		process.exitCode = 1;
		return;
	}

	const title = "E2E conversation journey story";
	const payload = StoryChatSeedDto.parse(e2eSeed(E2E_STORY_ID, title));
	const now = new Date();

	/**
	 * The creator comes **before the story** because `story.owner` references the member row; the
	 * reverse order stops the first run at the foreign key.
	 *
	 * Auth identity and member row are separate in this repository (`db/tables/member.ts`): Better
	 * Auth owns `user`, the product owns `member`. The seed makes each, but **no credentials for
	 * either**.
	 */
	await db
		.insert(user)
		.values({
			id: E2E_CREATOR_USER_ID,
			name: E2E_CREATOR_NICKNAME,
			email: E2E_CREATOR_EMAIL,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: user.id,
			set: { name: E2E_CREATOR_NICKNAME, updatedAt: now },
		});

	/**
	 * No gates are opened: `status`, `role`, the adult axes and the age axis are all defaults. This
	 * member only owns a story, and exposure decisions do not look at those axes (`galleryWhere` in
	 * `services/story/index.ts`). If the seed opened values, journeys would eventually lean on them
	 * and this file would become a script that hands out permissions rather than a fixture.
	 */
	await db
		.insert(member)
		.values({
			id: E2E_CREATOR_ID,
			user_id: E2E_CREATOR_USER_ID,
			nickname: E2E_CREATOR_NICKNAME,
		})
		.onConflictDoUpdate({
			target: member.id,
			set: { nickname: E2E_CREATOR_NICKNAME },
		});

	/**
	 * One upsert statement, not delete and reinsert. Deleting would cascade away favorites and view
	 * logs pointing at the story, and a failed rerun would leave the fixture **missing**, which
	 * journeys read as "story not found" and point somewhere unrelated to conversation.
	 *
	 * `owner` is also on the update side. Without it, a database already seeded with owner NULL would
	 * stay that way forever, and the symptom ("journey 404s in setup") would not reveal that the
	 * fixture is the cause.
	 */
	await db
		.insert(story)
		.values({
			id: E2E_STORY_ID,
			owner: E2E_CREATOR_ID,
			title,
			description: "The fixed story the browser journeys use.",
			author: E2E_CREATOR_NICKNAME,
			tags: ["e2e"],
			adult: false,
			visibility: "public",
			hidden: false,
			play_payload: payload,
		})
		.onConflictDoUpdate({
			target: story.id,
			set: {
				owner: E2E_CREATOR_ID,
				title,
				visibility: "public",
				hidden: false,
				play_payload: payload,
			},
		});

	/**
	 * Clears comments left by earlier runs, **this story's only**. The story id is in the predicate on
	 * purpose: an unconditional `db.delete(story_comment)` would also wipe comments of dev data in the
	 * same database, silently (the seed reports success).
	 */
	await db
		.delete(story_comment)
		.where(eq(story_comment.story_id, E2E_STORY_ID));

	/**
	 * The check looks at the **owner** too. Counting only that the row exists would mark a database
	 * left over from the old ownerless fixture as "ready", and journeys would walk the no-author
	 * exception branch.
	 */
	const [row] = await db
		.select({ id: story.id, owner: story.owner })
		.from(story)
		.where(eq(story.id, E2E_STORY_ID))
		.limit(1);
	const ready = row?.owner === E2E_CREATOR_ID;
	console.log(`[seed-e2e] ${ready ? "ready" : "failed"} ${E2E_STORY_ID}`);
	if (!ready) process.exitCode = 1;

	const runtimeReady = await seedRuntimeStory(now);
	console.log(
		`[seed-e2e] ${runtimeReady ? "ready" : "failed"} ${E2E_RUNTIME_STORY_ID}`,
	);
	if (!runtimeReady) process.exitCode = 1;
}

await main();

await db.$client.end();
