/**
 * The Phase 11 scenario shared by the A/B (`memory-ab.ts`) and the V2 replay (`v2-replay.ts`): the
 * Phase 10 character-chat transcript plus the Phase 11 probe families, as RowCat records. Synthetic.
 */
import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import type { ChatRuntimeRoom } from "../src/context.ts";
import type { ChatMemory } from "../src/memory.ts";
import { type ChatMessage, createRoomRecord } from "../src/model.ts";

export interface Turn {
	id: string;
	session: string;
	at: string;
	speaker: string;
	role: "user" | "character" | "narrator" | "player";
	channel: "scene" | "world" | "ooc";
	text: string;
}
export interface Item {
	needles: string[];
	turns: string[];
}
export interface Probe {
	id: string;
	kind: string;
	perspective: string;
	query: string;
	gold: string[];
	forbidden: string[];
	timeline: { current: string; superseded: string } | null;
}
export interface StateFact {
	id: string;
	namespace: string;
	text: string;
	from_turn: string;
	supersedes: string | null;
}
export interface Transcript {
	format: string;
	generator: string;
	seed: number;
	characters: [string, string][];
	now: string;
	turns: Turn[];
	deletions: { after_session: string; turns: string[] }[];
	items: Record<string, Item>;
	state: StateFact[];
	probes: Probe[];
}


export function loadScenario(base: Transcript) {
	// ── Phase 11 probe families (RowCat-specific), planted into the same transcript ──────────────────
	
	/** Edits applied after indexing (the user rewrote a message): id → new text. */
	const edits = new Map<string, string>();
	/** User-authored memory records (ChatMemory, source "user"). */
	const userNotes: { id: string; text: string; at: string }[] = [];
	/** Character renames: messages from this id on carry the new speaker name. */
	
	function plant(): { turns: Turn[]; probes: Probe[]; items: Record<string, Item> } {
		const turns = [...base.turns];
		const probes: Probe[] = [];
		const items: Record<string, Item> = {};
		const after = (session: string, k: number) => {
			const inSession = turns.filter((t) => t.session === session);
			const anchor = inSession[Math.min(k, inSession.length - 1)];
			if (!anchor) throw new Error(`no session ${session}`);
			return anchor;
		};
		let seq = 0;
		const insert = (anchor: Turn, t: Omit<Turn, "id" | "session" | "at">) => {
			const at = new Date(Date.parse(anchor.at) + 1_000 + seq * 10).toISOString();
			const turn: Turn = { ...t, id: `x${String(seq++).padStart(3, "0")}`, session: anchor.session, at };
			turns.splice(turns.indexOf(anchor) + 1, 0, turn);
			return turn;
		};
		const probe = (p: Omit<Probe, "perspective" | "forbidden" | "timeline"> & Partial<Probe>) =>
			probes.push({ perspective: "story", forbidden: [], timeline: null, ...p });
	
		// 1. Character rename: a minor character speaks early, is renamed later; asked by the new name.
		const renames = [
			["brass astrolabe", "the old mill"],
			["oilcloth satchel", "the chapel steps"],
			["cracked hourglass", "the salt cellar"],
		] as const;
		renames.forEach(([obj, place], i) => {
			const t = insert(after(`s00${3 + i}`, 4), {
				speaker: "Tamsin",
				role: "character",
				channel: "scene",
				text: `Tamsin: I buried the ${obj} beneath ${place}, where no one will look.`,
			});
			items[`rename_${i}`] = { needles: [obj, place], turns: [t.id] };
			probe({ id: `q-rename-${i}`, kind: "p11_rename", query: `Tamsa, what did you bury long ago, and where?`, gold: [`rename_${i}`] });
		});
		insert(after("s046", 2), {
			speaker: "Tamsa",
			role: "character",
			channel: "scene",
			text: "Tamsa: Tamsin was a name for a smaller life. Call me Tamsa now.",
		});
	
		// 2. User-authored memory overrides an old scene.
		const pets = [
			["horse", "Bramble", "Thistle"],
			["hawk", "Juniper", "Saffron"],
			["boat", "Cobble", "Pebble"],
		] as const;
		pets.forEach(([pet, old, now], i) => {
			const t = insert(after(`s00${6 + i}`, 3), {
				speaker: "Rowan",
				role: "user",
				channel: "scene",
				text: `Rowan: My ${pet} is called ${old}, and that will never change.`,
			});
			items[`override_old_${i}`] = { needles: [old], turns: [t.id] };
			items[`override_new_${i}`] = { needles: [now], turns: [] };
			userNotes.push({ id: `note-override-${i}`, text: `Rowan's ${pet} is now called ${now} (renamed by the user).`, at: base.now });
			probe({
				id: `q-override-${i}`,
				kind: "p11_memory_override",
				query: `What is Rowan's ${pet} called?`,
				gold: [`override_new_${i}`],
				timeline: { current: `override_new_${i}`, superseded: `override_old_${i}` },
			});
		});
	
		// 3. Edited message: the user rewrote a line after it was indexed; the old words must be gone.
		const edited = [
			["spare key", "blue", "red"],
			["signet ring", "mossy", "cracked"],
			["sealed letter", "flat", "round"],
		] as const;
		edited.forEach(([obj, old, now], i) => {
			const t = insert(after(`s01${1 + i}`, 5), {
				speaker: "Rowan",
				role: "user",
				channel: "scene",
				text: `Rowan: I hid the ${obj} under the ${old} stone by the gate.`,
			});
			edits.set(t.id, `Rowan: I hid the ${obj} under the ${now} stone by the gate.`);
			items[`edit_new_${i}`] = { needles: [`${now} stone`], turns: [t.id] };
			items[`edit_old_${i}`] = { needles: [`${old} stone`], turns: [t.id] };
			probe({
				id: `q-edit-${i}`,
				kind: "p11_edited",
				query: `Where did Rowan hide the ${obj}?`,
				gold: [`edit_new_${i}`],
				forbidden: [`edit_old_${i}`],
			});
		});
	
		// 4. Temporal contradiction in the world: destroyed early, rebuilt late.
		const things = ["Kestrel bridge", "east beacon", "ferry landing"];
		things.forEach((thing, i) => {
			const a = insert(after(`s01${4 + i}`, 2), {
				speaker: "Narrator",
				role: "narrator",
				channel: "world",
				text: `Narrator: The ${thing} was destroyed in the autumn storm.`,
			});
			const b = insert(after(`s05${0 + i}`, 2), {
				speaker: "Narrator",
				role: "narrator",
				channel: "world",
				text: `Narrator: After months of work the ${thing} has been rebuilt.`,
			});
			items[`temporal_old_${i}`] = { needles: [`${thing} was destroyed`], turns: [a.id] };
			items[`temporal_new_${i}`] = { needles: [`${thing} has been rebuilt`], turns: [b.id] };
			probe({
				id: `q-temporal-${i}`,
				kind: "p11_temporal",
				query: `Is the ${thing} standing now?`,
				gold: [`temporal_new_${i}`],
				timeline: { current: `temporal_new_${i}`, superseded: `temporal_old_${i}` },
			});
		});
	
		// 5. Long-distance callback in Korean (Hangul bigram path).
		const korean = [
			["등대 열쇠", "은색 상자"],
			["선장의 일지", "부엌 찬장"],
			["붉은 깃발", "종탑 지붕"],
		] as const;
		korean.forEach(([obj, place], i) => {
			const t = insert(after(`s00${2 + i}`, 6), {
				speaker: "Kael",
				role: "character",
				channel: "scene",
				text: `Kael: ${obj}는 ${place} 안에 숨겨 두었어. 아무에게도 말하지 마.`,
			});
			items[`korean_${i}`] = { needles: [place], turns: [t.id] };
			probe({ id: `q-korean-${i}`, kind: "p11_korean_callback", query: `${obj}는 어디에 숨겨 두었지?`, gold: [`korean_${i}`] });
		});
	
		return { turns, probes, items };
	}
	
	const planted = plant();
	const turns = planted.turns;
	const items = { ...base.items, ...planted.items };
	const probes = [...base.probes, ...planted.probes];
	const deleted = new Set(base.deletions.flatMap((d) => d.turns));
	
	// ── RowCat records ───────────────────────────────────────────────────────────────────────────────
	
	const ROOM = "room-aster-vale";
	let tick = 0;
	const toMessage = (t: Turn, content = t.text): ChatMessage =>
		({
			id: t.id,
			roomId: ROOM,
			role: t.role === "user" || t.role === "player" ? "user" : "assistant",
			speaker: t.speaker === "Player" ? "Rowan" : t.speaker,
			content,
			createdAt: t.at,
			updatedAt: t.at,
			dirty: 0,
			serverVersion: 0,
			// Stable: the same record has the same revision on every read; an edit bumps it.
			rev: { t: Date.parse(t.at) + (content === t.text ? 0 : 1), c: 0, d: "eval" },
			deletedAt: null,
		}) as unknown as ChatMessage;
	
	const toMemory = (id: string, content: string, at: string): ChatMemory =>
		({
			id,
			roomId: ROOM,
			content,
			source: "user",
			originAt: null,
			pinned: false,
			createdAt: at,
			updatedAt: at,
			dirty: 0,
			serverVersion: 0,
			rev: { t: Date.parse(at) + tick++, c: 0, d: "eval" },
			deletedAt: null,
		}) as unknown as ChatMemory;
	
	const room: ChatRuntimeRoom = createRoomRecord(
		{
			originStoryId: "story-aster-vale",
			seed: StoryChatSeedDto.parse({
				version: 1,
				storyId: "story-aster-vale",
				title: "Aster Vale",
				adult: false,
				promptProtected: false,
				scenario: "A harbor town on a stormy coast. The user plays Rowan, a mapmaker; Mira, Kael, Sable and Oren are companions.",
			}),
		},
		{ id: ROOM, routingSessionId: "eval-aster-vale", now: turns[0]?.at ?? base.now, rev: { t: 1, c: 0, d: "eval" } },
	);
	
	/** Every message ever written, before deletions and edits (what the index first saw). */
	const original = turns.map((t) => toMessage(t));
	/** The store at question time: deleted scenes gone, edited lines rewritten. */
	const live = turns.filter((t) => !deleted.has(t.id)).map((t) => toMessage(t, edits.get(t.id) ?? t.text));
	
	/** Memory conditions: M0 the override notes only; M1 also the current world state as user notes. */
	const notesM0 = userNotes.map((n) => toMemory(n.id, n.text, n.at));
	const superseded = new Set(base.state.map((s) => s.supersedes).filter(Boolean));
	const notesM1 = [
		...notesM0,
		...base.state
			.filter((s) => !superseded.has(s.id))
			.map((s) => toMemory(`note-${s.id.replace(/_/g, "-")}`, s.text, base.now)),
	];
	return {
		base, turns, items, probes, deleted, edits, userNotes, ROOM, room,
		toMessage, toMemory, original, live, notesM0, notesM1, planted,
	};
}

export type Scenario = ReturnType<typeof loadScenario>;
