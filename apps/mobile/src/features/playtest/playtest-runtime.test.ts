import {
	buildPlaytestSnapshot,
	createDraftLoreEntryRecord,
	createDraftStartSceneRecord,
	createStoryDraftRecord,
	prepareStoryPublication,
	type StoryPublicationSource,
} from "@rowcat/authoring";
import {
	buildChatGenerationRequest,
	type ChatRuntimeMessage,
	createRoomRecord,
	resolveAllAges,
} from "@rowcat/chat";
import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import { describe, expect, it } from "vitest";

/**
 * **Does the playtest build the same prompt as a real conversation?**
 *
 * The costliest mismatch in this repository lives here: the result the creator checked in the test
 * differs from what readers get after publishing. That difference surfaces only **after**
 * publishing, and the screen alone cannot tell which line of the assembler caused it.
 *
 * So this test does not compare the two functions' sources for similarity. **It runs both for real
 * and compares the resulting requests whole**: every character of the system prompt, the message
 * array, and the rating axis.
 *
 * It is the same table as `apps/web/src/features/playtest/playtest-runtime.test.ts`. Each app keeps
 * its own copy because the check verifies **that app's assembly point**: only an app can import
 * `@rowcat/authoring` and `@rowcat/chat` together (authoring does not depend on conversation
 * rules), and this app's playtest session is where the two meet.
 */

const NOW = "2026-01-01T00:00:00.000Z";
const REV = { t: 1_767_225_600_000, c: 0, d: "test-device" };
const stamp = (id: string) => ({
	id,
	routingSessionId: `routing-${id}`,
	now: NOW,
	rev: REV,
});

/** A draft with lore, scenes and an adult rating, so every block of the assembler is exercised. */
function draftSource(over: { adult?: boolean } = {}): StoryPublicationSource {
	const draft = {
		...createStoryDraftRecord(
			{
				title: "The Night Library",
				tagline: "The books talk",
				prompt: "A library open only at night. The librarian is a cat.",
				adult: over.adult ?? false,
			},
			stamp("draft-1"),
		),
		defaultStartSceneId: "scene-2",
	};
	return {
		draft,
		sceneImages: [],
		lore: [
			createDraftLoreEntryRecord(
				{
					draftId: draft.id,
					positionIndex: 0,
					keys: ["Librarian"],
					content: "The librarian speaks sparingly.",
					position: "system_bottom",
					order: 2,
				},
				stamp("lore-1"),
			),
			createDraftLoreEntryRecord(
				{
					draftId: draft.id,
					positionIndex: 1,
					content: "The library's rule: make no sound.",
					constant: true,
					position: "system_top",
				},
				stamp("lore-2"),
			),
		],
		startScenes: [
			createDraftStartSceneRecord(
				{
					draftId: draft.id,
					position: 0,
					title: "Entrance",
					content: "This is the entrance.",
				},
				stamp("scene-1"),
			),
			createDraftStartSceneRecord(
				{
					draftId: draft.id,
					position: 1,
					title: "Rooftop",
					content: "This is the rooftop.",
				},
				stamp("scene-2"),
			),
		],
	};
}

/**
 * Imitates what the server does: **the publish request plus the metadata the server finalizes**.
 *
 * This assembly is `apps/api/src/services/story/publication.ts`'s. We reproduce it here to make
 * "what goes into the room on publish" a value. The server injects the story id, title, rating and
 * protection flag; the authored content is exactly what the client sent.
 */
function publishedSeed(source: StoryPublicationSource) {
	const { publication } = prepareStoryPublication(source);
	return StoryChatSeedDto.parse({
		version: 1,
		storyId: "story-from-server",
		title: publication.metadata.title,
		adult: publication.metadata.adult,
		promptProtected: publication.metadata.promptProtected,
		...publication.play,
	});
}

const history: ChatRuntimeMessage[] = [
	{ role: "user", speaker: "", content: "Hi, librarian." },
	{ role: "assistant", speaker: "", content: "…" },
];

/** Builds both paths' requests from the same arguments. Only the seed's origin differs. */
function requests(input: {
	source: StoryPublicationSource;
	adultAllowed: boolean;
	startSceneId?: string | null;
}) {
	const seed = publishedSeed(input.source);
	const room = createRoomRecord(
		{ originStoryId: "story-from-server", seed },
		stamp("room-1"),
	);
	const snapshot = buildPlaytestSnapshot(input.source, {
		...(input.startSceneId !== undefined
			? { startSceneId: input.startSceneId }
			: {}),
	});
	const viewer = { adultAllowed: input.adultAllowed };

	return {
		published: buildChatGenerationRequest({
			room,
			messages: history,
			allAges: resolveAllAges(room, viewer),
		}),
		/**
		 * Same shape as the playtest session's `runtime` (`use-playtest.ts`): only the seed and the draft
		 * rating, with no room identity and no persona override.
		 */
		playtest: buildChatGenerationRequest({
			room: { seed: snapshot.seed },
			messages: history,
			allAges: resolveAllAges(snapshot, viewer),
		}),
	};
}

describe("the same runtime as the published version", () => {
	it("the system prompt and messages are **entirely** the same", () => {
		const { published, playtest } = requests({
			source: draftSource(),
			adultAllowed: false,
		});
		expect(playtest).toEqual(published);
	});

	it("adult story + eligible viewer — the same guards stand", () => {
		const { published, playtest } = requests({
			source: draftSource({ adult: true }),
			adultAllowed: true,
		});
		expect(playtest).toEqual(published);
		expect(playtest.context.requestedMode).toBe("adult");
	});

	/**
	 * **Without entitlement, the test also runs as all-ages.**
	 *
	 * Pins by value that the creator does not loosen the gate. The decision goes through the same
	 * function as a real conversation (`resolveAllAges`), which looks at **the rating and the
	 * entitlement**, not the draft.
	 */
	it("adult story + ineligible viewer — both fold to all-ages", () => {
		const { published, playtest } = requests({
			source: draftSource({ adult: true }),
			adultAllowed: false,
		});
		expect(playtest).toEqual(published);
		expect(playtest.context.requestedMode).toBe("all-ages");
	});

	it("an all-ages story is all-ages even for an eligible viewer", () => {
		const { playtest } = requests({
			source: draftSource(),
			adultAllowed: true,
		});
		expect(playtest.context.requestedMode).toBe("all-ages");
	});
});

describe("opening scene override", () => {
	it("only the chosen scene changes the opening, and the rest matches the published version", () => {
		const source = draftSource();
		const { published } = requests({ source, adultAllowed: false });
		const { playtest } = requests({
			source,
			adultAllowed: false,
			startSceneId: "scene-1",
		});

		expect(playtest.system).not.toBe(published.system);
		expect(playtest.system).toContain("This is the entrance.");
		/**
		 * Verifies by value that only the opening line differs: lore, rules and guards are unchanged.
		 * Remove each prompt's own opening and the rest must match.
		 */
		expect(playtest.system.replace("This is the entrance.", "§")).toBe(
			published.system.replace("This is the rooftop.", "§"),
		);
	});
});

/**
 * **Do not invent a story id.**
 *
 * A draft has no such value, and filling it in would corrupt the meaning of
 * `StoryChatSeedDto.storyId` (the publication's provenance). So the playtest seed is a subset that
 * does not carry that field, and this check verifies it by value. The type alone cannot catch a key
 * attached at runtime.
 */
describe("story identity", () => {
	it("the playback seed has no story id", () => {
		const snapshot = buildPlaytestSnapshot(draftSource());
		expect(Object.keys(snapshot.seed)).not.toContain("storyId");
		expect(snapshot.draftId).toBe("draft-1");
	});
});
