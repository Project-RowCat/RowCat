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
 * Checks that the playtest builds the same prompt as a real conversation. This is the costliest
 * mismatch in the repo: the author verifies a result in the test, and readers of the published work
 * get something different. The gap shows up only after publishing, and the screen alone cannot
 * reveal which line of the assembler caused it.
 *
 * So this test does not compare the source of the two functions for similarity. It runs both and
 * compares the full requests: the system prompt character for character, the message array, and the
 * rating axis. The assembly point lives in the web app because only there can `@rowcat/authoring`
 * and `@rowcat/chat` be imported together. A sync codec order test lives in the same place for the
 * same reason (`lib/local-sync/codec-order.test.ts`).
 */

const NOW = "2026-01-01T00:00:00.000Z";
const REV = { t: 1_767_225_600_000, c: 0, d: "test-device" };
const stamp = (id: string) => ({
	id,
	routingSessionId: `routing-${id}`,
	now: NOW,
	rev: REV,
});

/** A draft with lore, scenes, and an adult rating, so every block of the assembler is exercised. */
function draftSource(over: { adult?: boolean } = {}): StoryPublicationSource {
	const draft = {
		...createStoryDraftRecord(
			{
				title: "The Night Library",
				tagline: "The books talk",
				prompt: "A library that opens only at night. The librarian is a cat.",
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
					keys: ["librarian"],
					content: "The librarian speaks little.",
					position: "system_bottom",
					order: 2,
				},
				stamp("lore-1"),
			),
			createDraftLoreEntryRecord(
				{
					draftId: draft.id,
					positionIndex: 1,
					content: "Library rule: make no sound.",
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
					content: "It's the entrance.",
				},
				stamp("scene-1"),
			),
			createDraftStartSceneRecord(
				{
					draftId: draft.id,
					position: 1,
					title: "Rooftop",
					content: "It's the rooftop.",
				},
				stamp("scene-2"),
			),
		],
	};
}

/**
 * Mimics the server's publication step (`apps/api/src/services/story/publication.ts`): the
 * publication request plus the metadata the server confirms.
 *
 * The story id, title, rating, and protection flag are injected by the server, while the authored
 * content is passed through as the client sent it. This is reproduced to produce, as values, what a
 * published room receives.
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

/** Builds both paths' requests from the same arguments. Only the origin of the seed differs. */
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

	it("adult story + eligible viewer: the same guards stand", () => {
		const { published, playtest } = requests({
			source: draftSource({ adult: true }),
			adultAllowed: true,
		});
		expect(playtest).toEqual(published);
		expect(playtest.context.requestedMode).toBe("adult");
	});

	/**
	 * When the viewer is not eligible, the test also proceeds as all-ages. This pins down, as a value,
	 * that being the author does not loosen the gate. The decision goes through the same function the
	 * real conversation uses (`resolveAllAges`), which looks only at the rating and eligibility, not
	 * at the draft.
	 */
	it("adult story + ineligible viewer: both fold to all ages", () => {
		const { published, playtest } = requests({
			source: draftSource({ adult: true }),
			adultAllowed: false,
		});
		expect(playtest).toEqual(published);
		expect(playtest.context.requestedMode).toBe("all-ages");
	});

	it("an all-ages story stays all ages even with eligibility", () => {
		const { playtest } = requests({
			source: draftSource(),
			adultAllowed: true,
		});
		expect(playtest.context.requestedMode).toBe("all-ages");
	});
});

describe("opening scene override", () => {
	it("only the chosen scene becomes the opening; the rest matches the published version", () => {
		const source = draftSource();
		const { published } = requests({ source, adultAllowed: false });
		const { playtest } = requests({
			source,
			adultAllowed: false,
			startSceneId: "scene-1",
		});

		expect(playtest.system).not.toBe(published.system);
		expect(playtest.system).toContain("It's the entrance.");
		/**
		 * Checks as a value that only the opening line differs. Lore, rules, and guards are identical, so
		 * removing each prompt's own opening line should leave the rest equal.
		 */
		expect(playtest.system.replace("It's the entrance.", "§")).toBe(
			published.system.replace("It's the rooftop.", "§"),
		);
	});
});
