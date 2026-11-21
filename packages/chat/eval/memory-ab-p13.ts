/**
 * Phase 13 A/B: afterstate as RowCat's only long-term memory (Memory V2 removed), through RowCat's
 * own adapter and assembler, with the real afterstate engine. Retrieval level: no model is called.
 *
 * The Phase 10 transcript records who witnessed each turn (`audience`); that becomes RowCat scenes
 * (`scene.ts`) exactly as in Phase 12: a scene starts wherever the audience changes, the user is in
 * every in-scene turn, world narration and OOC are shared (`room`). Each probe is asked from its
 * perspective (`char:X` → a scene with the user and X; `story`/`real` → the room) through the
 * product path: `chatHistoryWindow` (message-count window), `recallRequestFor` + `recallForTurn`,
 * `consolidatedForTurn` + `consolidatedText`, and `buildChatGenerationRequest` (which scopes the
 * whole request with `scopePromptInput`).
 *
 * Arms (same window, same user memories, same probe):
 *   AS               recall over an index that was never consolidated; no earlier-episodes block
 *   AS+C             the product: recall (digests visible) + consolidated episodes block
 *   AS+C+H           AS+C with V2's historical summary and automatic memories imported into the index
 *                    as migration evidence (they reach only rooms without scenes)
 *   AS-noscene       diagnostic, not a product configuration: AS+C in a room with no scenes at all
 *   AS+C+H-noscene   diagnostic: AS+C+H in a room with no scenes (where the import can act)
 *   AS+C+F           AS+C plus the facts block (`factsForTurn` + `factsText`): structured facts the
 *                    person stated, extracted by afterstate-cognitive's rules (no model)
 *   AS-noscene+F     diagnostic: AS-noscene plus the facts block
 *
 * Metrics per probe: gold (every needle of every gold item somewhere in the request), gold share,
 * where gold sits (recall / earlier-episodes / facts / memory block / window), probe-forbidden,
 * unauthorized items (every source turn unwitnessed by the perspective) by block, stale/current for
 * current-vs-earlier probes, request tokens and the tokens the long-term blocks add, and the engine's
 * episode validation (episodes the bridge returned vs the ones the adapter kept, with drop reasons).
 *
 *   pnpm exec tsx eval/memory-ab-p13.ts --transcript T.json [--no-plant] --v2-state V2.json \
 *     --heldout H.json --frozen FROZEN/results.json --out DIR
 *
 * Synthetic data only. Nothing leaves the machine.
 */
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AFTERSTATE_BRIDGE_BIN,
	type StdioAfterstate,
	spawnAfterstate,
} from "../src/afterstate-stdio.test.helper.ts";
import type { ChatCharacter } from "../src/character.ts";
import {
	buildChatGenerationRequest,
	consolidatedText,
	factsText,
	recallBlock,
	selectMemoriesForContext,
} from "../src/context.ts";
import {
	type AfterstatePort,
	type ChatConsolidatedSnapshot,
	type ChatFactsSnapshot,
	type ChatRecallSnapshot,
	type ConversationMemorySource,
	consolidateConversation,
	consolidatedForTurn,
	digestStillLive,
	factsForTurn,
	recallAliases,
	recallForTurn,
	recallRequestFor,
	reconcileConversation,
} from "../src/conversation-memory.ts";
import { chatHistoryWindow } from "../src/history-window.ts";
import type { ChatMemory } from "../src/memory.ts";
import type { ChatMessage } from "../src/model.ts";
import { scopePromptInput } from "../src/prompt-scope.ts";
import {
	type ChatScene,
	type ChatSceneAudience,
	perspectiveAdmits,
	type ResolvedAudience,
	recallPerspective,
	resolveMessageAudiences,
} from "../src/scene.ts";
import { type ChatSummary, summaryIdFor } from "../src/summary.ts";
import {
	type Item,
	loadScenario,
	type Probe,
	type Transcript,
	type Turn,
} from "./scenario.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
	const k = process.argv[i] ?? "";
	if (k === "--no-plant") args.set(k, "1");
	else args.set(k, process.argv[++i] ?? "");
}
const transcriptPath = args.get("--transcript");
const outDir = args.get("--out");
if (!transcriptPath || !outDir) {
	console.error(
		"usage: memory-ab-p13.ts --transcript FILE --out DIR [--no-plant] [--v2-state FILE] [--heldout FILE] [--frozen FILE]",
	);
	process.exit(2);
}
const SEED = Number(args.get("--seed") ?? 20261121);
const base = JSON.parse(readFileSync(transcriptPath, "utf8")) as Transcript;
const plant = args.get("--no-plant") === undefined;
const S = loadScenario(base, { plant });
const { turns, deleted, ROOM, room, toMessage, live, notesM1 } = S;

interface V2State {
	summary: {
		text: string;
		frontier: { createdAt: string; messageId: string } | null;
	} | null;
	autoMemories: { id: string; content: string; originAt: string | null }[];
}
const v2StatePath = args.get("--v2-state");
const v2 = v2StatePath
	? (JSON.parse(readFileSync(v2StatePath, "utf8")) as V2State)
	: null;

interface HeldoutFile {
	format: string;
	authored: string;
	items: Record<string, Item>;
	probes: Probe[];
}
const heldoutPath = args.get("--heldout");
const heldout = heldoutPath
	? (JSON.parse(readFileSync(heldoutPath, "utf8")) as HeldoutFile)
	: null;
const heldoutSha = heldoutPath
	? createHash("sha256").update(readFileSync(heldoutPath)).digest("hex")
	: null;

interface FrozenRow {
	probe: string;
	arm: string;
	gold: boolean | null;
	goldShare: number | null;
	unauthorizedTotal: number;
	tokens: number;
}
interface FrozenFile {
	summary: Record<
		string,
		Record<
			string,
			{
				rate?: number | null;
				mean?: number | null;
				probesWithAny?: number;
				n: number;
			}
		>
	>;
	rows: FrozenRow[];
}
const frozenPath = args.get("--frozen");
const frozen = frozenPath
	? (JSON.parse(readFileSync(frozenPath, "utf8")) as FrozenFile)
	: null;

/** Item universes: the original probes measure against the original items (comparable to Phase 12/13). */
const originalItems: Record<string, Item> = S.items;
const allItems: Record<string, Item> = {
	...S.items,
	...(heldout?.items ?? {}),
};
for (const id of Object.keys(heldout?.items ?? {}))
	if (id in S.items)
		throw new Error(`held-out item id ${id} collides with a transcript item`);

type ProbeSet = "original" | "heldout";
const probeSets: { set: ProbeSet; probe: Probe }[] = [
	...S.probes.map((probe) => ({ set: "original" as const, probe })),
	...(heldout?.probes ?? []).map((probe) => ({
		set: "heldout" as const,
		probe,
	})),
];
// A held-out probe must point at items that exist, with needles present in their live source turns.
const liveText = new Map(live.map((m) => [m.id, m.content.toLowerCase()]));
for (const { set, probe } of probeSets) {
	const universe = set === "original" ? originalItems : allItems;
	for (const id of [...probe.gold, ...probe.forbidden])
		if (!universe[id]) throw new Error(`${probe.id}: unknown item ${id}`);
	if (set !== "heldout") continue;
	for (const id of [...probe.gold, ...probe.forbidden]) {
		const it = universe[id] as Item;
		for (const t of it.turns)
			for (const n of it.needles)
				if (!liveText.get(t)?.includes(n.toLowerCase()))
					throw new Error(`${probe.id}: needle "${n}" not in ${t}`);
	}
}

// ── Scenes from the transcript's audiences (as Phase 12) ─────────────────────────────────────────────

type TurnWithAudience = Turn & { audience?: string[] };
const audienceOfTurn = (t: TurnWithAudience): ChatSceneAudience => {
	if (t.channel !== "scene" || !t.audience || t.audience.length === 0)
		return { kind: "room" };
	return {
		kind: "participants",
		members: ["user", ...t.audience.map((c) => `char:${c}`)].sort(),
	};
};
const key = (a: ChatSceneAudience | ResolvedAudience) =>
	a.kind === "participants" ? `p:${a.members.join(",")}` : a.kind;
let sceneSeq = 0;
const sceneRecord = (
	anchor: { id: string; at: string },
	audience: ChatSceneAudience,
): ChatScene => ({
	id: `scene-${String(sceneSeq++).padStart(4, "0")}`,
	roomId: ROOM,
	startAt: { createdAt: anchor.at, messageId: anchor.id },
	audience,
	createdAt: anchor.at,
	updatedAt: anchor.at,
	deletedAt: null,
	dirty: 0,
	serverVersion: 0,
	rev: { t: Date.parse(anchor.at), c: 0, d: "eval" },
});
const scenesFull: ChatScene[] = [];
{
	let last = "";
	for (const t of turns) {
		const a = audienceOfTurn(t as TurnWithAudience);
		if (key(a) !== last) scenesFull.push(sceneRecord(t, a));
		last = key(a);
	}
}
const turnAudience = new Map(
	turns.map((t) => [t.id, audienceOfTurn(t as TurnWithAudience)]),
);

const characters: ChatCharacter[] = [
	...base.characters.map(([id, name, aliases]) => ({
		id,
		name,
		prompt: "",
		...(aliases?.length ? { aliases } : {}),
	})),
	...(plant
		? [{ id: "tamsa", name: "Tamsa", prompt: "", aliases: ["Tamsin"] }]
		: []),
].map(
	(c) =>
		({
			...c,
			roomId: ROOM,
			createdAt: base.now,
			updatedAt: base.now,
			deletedAt: null,
			dirty: 0,
			serverVersion: 0,
			rev: { t: 1, c: 0, d: "eval" },
		}) as ChatCharacter,
);
const cast = characters.map((c) => ({ id: c.id, name: c.name }));
const aliases = recallAliases(characters);

const perspectiveScene = (p: Probe, anchor: ChatMessage): ChatScene => {
	const who = p.perspective.startsWith("char:") ? p.perspective.slice(5) : null;
	const audience: ChatSceneAudience = who
		? { kind: "participants", members: ["user", `char:${who}`].sort() }
		: { kind: "room" };
	return {
		...sceneRecord({ id: anchor.id, at: anchor.createdAt }, audience),
		id: `scene-probe-${p.id}`,
	};
};

// ── V2 history as migration input ────────────────────────────────────────────────────────────────────

const autoMemories: ChatMemory[] = (v2?.autoMemories ?? []).map(
	(m) =>
		({
			id: m.id,
			roomId: ROOM,
			content: m.content,
			source: "auto",
			originAt: m.originAt,
			pinned: false,
			createdAt: base.now,
			updatedAt: base.now,
			dirty: 0,
			serverVersion: 0,
			rev: { t: 1, c: 0, d: "eval" },
			deletedAt: null,
		}) as unknown as ChatMemory,
);
const v2Summary: ChatSummary | null = v2?.summary?.text
	? ({
			id: summaryIdFor(ROOM),
			roomId: ROOM,
			summary: v2.summary.text,
			frontier: v2.summary.frontier,
			epoch: 0,
			createdAt: v2.summary.frontier?.createdAt ?? base.now,
			updatedAt: v2.summary.frontier?.createdAt ?? base.now,
			deletedAt: null,
			dirty: 0,
			serverVersion: 0,
			rev: { t: 2, c: 0, d: "eval" },
		} as ChatSummary)
	: null;

// ── Measurement helpers ─────────────────────────────────────────────────────────────────────────────

const hasIn =
	(universe: Record<string, Item>) => (text: string, item: string) => {
		const needles = universe[item]?.needles ?? [];
		const lower = text.toLowerCase();
		return (
			needles.length > 0 &&
			needles.every((n) => lower.includes(n.toLowerCase()))
		);
	};
const strings = (v: unknown, out: string[] = []): string[] => {
	if (typeof v === "string") out.push(v);
	else if (Array.isArray(v)) for (const x of v) strings(x, out);
	else if (v && typeof v === "object")
		for (const x of Object.values(v)) strings(x, out);
	return out;
};
const requestText = (req: unknown) => {
	const r = req as { messages?: unknown; system?: unknown };
	return strings([r.system ?? "", r.messages ?? req]).join("\n");
};
const tokens = (text: string) => Math.ceil(text.length / 4);
const mean = (xs: number[]) =>
	xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const pct = (xs: number[], q: number) => {
	const s = [...xs].sort((a, b) => a - b);
	return s.length
		? (s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0)
		: 0;
};
function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
function pairedDiff(
	pairs: { cluster: string; a: number; b: number }[],
	seed: number,
) {
	const clusters = new Map<string, { a: number; b: number }[]>();
	for (const p of pairs)
		clusters.set(p.cluster, [...(clusters.get(p.cluster) ?? []), p]);
	const keys = [...clusters.keys()].sort();
	const diff = (sel: string[]) => {
		let n = 0;
		let s = 0;
		for (const k of sel)
			for (const p of clusters.get(k) ?? []) {
				s += p.b - p.a;
				n++;
			}
		return n ? s / n : 0;
	};
	const r = rng(seed);
	const boots: number[] = [];
	for (let i = 0; i < 2000; i++)
		boots.push(diff(keys.map(() => keys[Math.floor(r() * keys.length)] ?? "")));
	const bWins = pairs.filter((p) => p.b > p.a).length;
	const aWins = pairs.filter((p) => p.a > p.b).length;
	const n = aWins + bWins;
	const k = Math.min(aWins, bWins);
	let tail = 0;
	let c = 1;
	for (let i = 0; i <= n; i++) {
		if (i > 0) c = (c * (n - i + 1)) / i;
		if (i <= k) tail += c;
	}
	return {
		n: pairs.length,
		clusters: keys.length,
		diff: diff(keys),
		ci: [pct(boots, 0.025), pct(boots, 0.975)],
		discordant: { aOnly: aWins, bOnly: bWins },
		mcnemarP: n === 0 ? 1 : Math.min(1, (2 * tail) / 2 ** n),
	};
}
const clusterOf = (p: Probe) =>
	[...p.gold, ...p.forbidden].sort().join("+") || p.id;

/** Items the probe's perspective did not witness: every live source turn's audience is not admitted. */
function unauthorizedItems(p: Probe, universe: Record<string, Item>): string[] {
	const who = p.perspective.startsWith("char:") ? p.perspective.slice(5) : null;
	const view = who
		? ({
				kind: "participants",
				members: ["user", `char:${who}`].sort(),
				unknown: "exclude",
			} as const)
		: ({ kind: "room", unknown: "exclude" } as const);
	return Object.entries(universe)
		.filter(([, it]) => {
			const sources = it.turns.filter((t) => !deleted.has(t));
			return (
				sources.length > 0 &&
				sources.every((t) => {
					const a = turnAudience.get(t);
					return a ? !perspectiveAdmits(view, a) : false;
				})
			);
		})
		.map(([id]) => id);
}

// ── Engines ─────────────────────────────────────────────────────────────────────────────────────────

interface EngineSpec {
	name: string;
	scenes: boolean;
	history: boolean;
	consolidate: boolean;
}
interface Engine {
	spec: EngineSpec;
	port: StdioAfterstate;
	index: {
		messages: number;
		notes: number;
		summaries: number;
		complete: boolean;
	};
	consolidation: {
		episodes: number;
		written: number;
		complete: boolean;
		calls: number;
	} | null;
}

interface Arm {
	arm: string;
	engine: string;
	scenes: boolean;
	history: boolean;
	consolidated: boolean;
	facts?: boolean;
	diagnostic?: boolean;
}
const ARMS: Arm[] = [
	{
		arm: "AS",
		engine: "scene",
		scenes: true,
		history: false,
		consolidated: false,
	},
	{
		arm: "AS+C",
		engine: "scene+C",
		scenes: true,
		history: false,
		consolidated: true,
	},
	...(v2
		? [
				{
					arm: "AS+C+H",
					engine: "scene+C+H",
					scenes: true,
					history: true,
					consolidated: true,
				},
			]
		: []),
	{
		arm: "AS+C+F",
		engine: "scene+C",
		scenes: true,
		history: false,
		consolidated: true,
		facts: true,
	},
	{
		arm: "AS-noscene",
		engine: "noscene+C",
		scenes: false,
		history: false,
		consolidated: true,
		diagnostic: true,
	},
	...(v2
		? [
				{
					arm: "AS+C+H-noscene",
					engine: "noscene+C+H",
					scenes: false,
					history: true,
					consolidated: true,
					diagnostic: true,
				},
			]
		: []),
	{
		arm: "AS-noscene+F",
		engine: "noscene+C",
		scenes: false,
		history: false,
		consolidated: true,
		facts: true,
		diagnostic: true,
	},
];
const ENGINES: EngineSpec[] = [
	{ name: "scene", scenes: true, history: false, consolidate: false },
	{ name: "scene+C", scenes: true, history: false, consolidate: true },
	...(v2
		? [{ name: "scene+C+H", scenes: true, history: true, consolidate: true }]
		: []),
	{ name: "noscene+C", scenes: false, history: false, consolidate: true },
	...(v2
		? [{ name: "noscene+C+H", scenes: false, history: true, consolidate: true }]
		: []),
];

interface Row {
	set: ProbeSet;
	probe: string;
	kind: string;
	perspective: string;
	cluster: string;
	arm: string;
	gold: boolean | null;
	goldShare: number | null;
	goldShareEngine: number | null;
	goldInRecall: boolean | null;
	goldInConsolidated: boolean | null;
	goldInMemories: boolean | null;
	goldInWindow: boolean | null;
	forbidden: boolean | null;
	forbiddenInConsolidated: boolean | null;
	goldInFacts: boolean | null;
	forbiddenInFacts: boolean | null;
	unauthorizedFacts: number;
	staleInFacts: boolean | null;
	facts: number;
	factsRaw: number;
	factsEarlier: number;
	factsFromNotes: number;
	tokensFactsText: number;
	factsMs: number;
	unauthorizedRecall: number;
	unauthorizedConsolidated: number;
	unauthorizedMemories: number;
	unauthorizedWindow: number;
	unauthorizedTotal: number;
	stale: boolean | null;
	current: boolean | null;
	staleInRecall: boolean | null;
	staleInConsolidated: boolean | null;
	recalled: number;
	recalledDigests: number;
	recalledSummary: number;
	recalledAuto: number;
	recallDigestsRaw: number;
	episodes: number;
	episodesRaw: number;
	episodeDrops: {
		missingSource: number;
		allInWindow: number;
		notAdmitted: number;
		notLive: number;
		budget: number;
	};
	tokens: number;
	tokensLongTerm: number;
	tokensRecallBlock: number;
	tokensConsolidatedText: number;
	windowMessages: number;
	recallMs: number;
	consolidatedMs: number;
}

interface RawDigest {
	id: string;
	text: string;
	sources: string[];
}

async function main() {
	const dirs: string[] = [];
	const engines = new Map<string, Engine>();
	for (const spec of ENGINES) {
		const dir = mkdtempSync(join(tmpdir(), "rowcat-p13-"));
		dirs.push(dir);
		const port = await spawnAfterstate({
			store: { user: { dir, user: "eval" } },
		});
		const memories = spec.history ? [...notesM1, ...autoMemories] : notesM1;
		const source: ConversationMemorySource = {
			listAllMessages: async () => live,
			listMemories: async () => memories,
			listScenes: async () => (spec.scenes ? scenesFull : []),
			listCharacters: async () => characters,
			...(spec.history ? { getSummary: async () => v2Summary } : {}),
		};
		const r = await reconcileConversation(port, source, ROOM, {
			maxItems: 100_000,
		});
		let consolidation: Engine["consolidation"] = null;
		if (spec.consolidate) {
			let calls = 0;
			let written = 0;
			let report = await consolidateConversation(port, ROOM, { calls: 1 });
			calls++;
			written += report.written;
			while (!report.complete && calls < 1_000) {
				report = await consolidateConversation(port, ROOM, { calls: 1 });
				calls++;
				written += report.written;
			}
			consolidation = {
				episodes: report.episodes,
				written,
				complete: report.complete,
				calls,
			};
		}
		engines.set(spec.name, {
			spec,
			port,
			index: {
				messages: r.messages.live,
				notes: r.notes.live,
				summaries: r.summaries.live,
				complete: r.complete,
			},
			consolidation,
		});
		console.error(
			`engine ${spec.name}: indexed`,
			JSON.stringify(r.messages),
			consolidation ? JSON.stringify(consolidation) : "",
		);
	}

	let lastEvidence: { record: string; text: string }[] = [];
	let lastDigests: RawDigest[] = [];
	let lastFacts: unknown[] = [];
	const spy = (target: AfterstatePort): AfterstatePort => ({
		call: async <T>(
			op: Parameters<AfterstatePort["call"]>[0],
			params: object,
		) => {
			const r = await target.call<T>(op, params);
			if (op === "recall")
				lastEvidence = (r as { evidence: { record: string; text: string }[] })
					.evidence;
			if (op === "digests")
				lastDigests = (r as { digests: RawDigest[] }).digests ?? [];
			if (op === "facts") lastFacts = (r as { facts: unknown[] }).facts ?? [];
			return r;
		},
	});

	const rows: Row[] = [];
	for (const { set, probe: p } of probeSets) {
		const universe = set === "original" ? originalItems : allItems;
		const has = hasIn(universe);
		const q = toMessage({
			id: "probe",
			session: "now",
			at: base.now,
			speaker: base.user_character ?? "Rowan",
			role: "user",
			channel: "scene",
			text: p.query,
		});
		const all = [...live, q];
		const history = chatHistoryWindow(all);
		const forbiddenAll = unauthorizedItems(p, universe);
		for (const spec of ARMS) {
			const engine = engines.get(spec.engine) as Engine;
			const port = spy(engine.port);
			const memories = spec.history ? [...notesM1, ...autoMemories] : notesM1;
			const scenes = spec.scenes ? [...scenesFull, perspectiveScene(p, q)] : [];
			const req = recallRequestFor(history, memories, undefined, { scenes });
			lastEvidence = [];
			lastDigests = [];
			lastFacts = [];
			let t0 = performance.now();
			const recall: ChatRecallSnapshot = await recallForTurn(port, {
				roomId: ROOM,
				query: req.query,
				windowLength: req.windowLength,
				messages: all,
				memories,
				memoryIdsInContext: req.memoryIdsInContext,
				scenes,
				aliases,
				...(spec.history ? { summary: v2Summary } : {}),
			});
			const recallMs = performance.now() - t0;
			const recallEvidence = lastEvidence;
			let consolidated: ChatConsolidatedSnapshot | null = null;
			let consolidatedMs = 0;
			const drops = {
				missingSource: 0,
				allInWindow: 0,
				notAdmitted: 0,
				notLive: 0,
				budget: 0,
			};
			if (spec.consolidated) {
				t0 = performance.now();
				consolidated = await consolidatedForTurn(port, {
					roomId: ROOM,
					messages: all,
					windowLength: history.length,
					scenes,
				});
				consolidatedMs = performance.now() - t0;
				// Why the adapter dropped what the bridge returned (restating its checks, for diagnosis only).
				const liveById = new Map(all.map((m) => [m.id, m]));
				const windowSet = new Set(history.map((m) => m.id));
				const perspective = recallPerspective(scenes);
				const audiences = resolveMessageAudiences(all, scenes);
				let valid = 0;
				for (const d of lastDigests) {
					const src = d.sources.map((id) => liveById.get(id));
					if (src.length === 0 || src.some((s) => s === undefined))
						drops.missingSource++;
					else if (src.every((s) => s && windowSet.has(s.id)))
						drops.allInWindow++;
					else if (
						!src.every(
							(s) =>
								s &&
								perspectiveAdmits(
									perspective,
									audiences.get(s.id) ?? { kind: "unknown" },
								),
						)
					)
						drops.notAdmitted++;
					else if (!digestStillLive(d.text, src as ChatMessage[]))
						drops.notLive++;
					else valid++;
				}
				drops.budget = valid - consolidated.episodes.length;
			}
			const consText = consolidatedText(consolidated);
			let factsSnapshot: ChatFactsSnapshot | null = null;
			let factsMs = 0;
			if (spec.facts) {
				t0 = performance.now();
				factsSnapshot = await factsForTurn(port, {
					roomId: ROOM,
					messages: all,
					memories,
					scenes,
				});
				factsMs = performance.now() - t0;
			}
			const factText = factsText(factsSnapshot);
			const noteIds = new Set(memories.map((m) => m.id));
			const assembly = {
				room,
				messages: history,
				memories,
				allAges: true,
				recall,
				...(consText ? { consolidated: consText } : {}),
				...(factText ? { facts: factText } : {}),
				...(spec.scenes ? { scenes: { scenes, cast } } : {}),
			};
			const request = buildChatGenerationRequest(assembly);
			const bare = buildChatGenerationRequest({
				...assembly,
				recall: null,
				consolidated: undefined,
				facts: undefined,
			});
			const scoped = scopePromptInput(assembly).input;
			const full = requestText(request).split(p.query).join(" ");
			const block = recallBlock(recall) ?? "";
			const memoryText = selectMemoriesForContext(scoped.memories ?? [])
				.map((m) => m.content)
				.join("\n");
			const windowText = (
				request as { messages: { content: string }[] }
			).messages
				.map((m) => m.content.split(block).join(" ").split(p.query).join(" "))
				.join("\n");
			const engineText = [
				...recallEvidence.map((e) => e.text),
				...lastDigests.map((d) => d.text),
			].join("\n");
			const anyGold = (text: string) =>
				p.gold.length ? p.gold.some((g) => has(text, g)) : null;
			rows.push({
				set,
				probe: p.id,
				kind: p.kind,
				perspective: p.perspective,
				cluster: clusterOf(p),
				arm: spec.arm,
				gold: p.gold.length ? p.gold.every((g) => has(full, g)) : null,
				goldShare: p.gold.length
					? p.gold.filter((g) => has(full, g)).length / p.gold.length
					: null,
				goldShareEngine: p.gold.length
					? p.gold.filter((g) => has(engineText, g)).length / p.gold.length
					: null,
				goldInRecall: anyGold(block),
				goldInConsolidated: anyGold(consText),
				goldInMemories: anyGold(memoryText),
				goldInWindow: anyGold(windowText),
				forbidden: p.forbidden.length
					? p.forbidden.some((f) => has(full, f))
					: null,
				forbiddenInConsolidated: p.forbidden.length
					? p.forbidden.some((f) => has(consText, f))
					: null,
				unauthorizedRecall: forbiddenAll.filter((i) => has(block, i)).length,
				unauthorizedConsolidated: forbiddenAll.filter((i) => has(consText, i))
					.length,
				unauthorizedMemories: forbiddenAll.filter((i) => has(memoryText, i))
					.length,
				unauthorizedWindow: forbiddenAll.filter((i) => has(windowText, i))
					.length,
				unauthorizedTotal: forbiddenAll.filter((i) => has(full, i)).length,
				goldInFacts: anyGold(factText),
				forbiddenInFacts: p.forbidden.length
					? p.forbidden.some((f) => has(factText, f))
					: null,
				unauthorizedFacts: forbiddenAll.filter((i) => has(factText, i)).length,
				staleInFacts: p.timeline ? has(factText, p.timeline.superseded) : null,
				facts: factsSnapshot?.facts.length ?? 0,
				factsRaw: lastFacts.length,
				factsEarlier:
					factsSnapshot?.facts.filter((f) => f.status === "earlier").length ??
					0,
				factsFromNotes:
					factsSnapshot?.facts.filter((f) =>
						f.sources.some((id) => noteIds.has(id)),
					).length ?? 0,
				tokensFactsText: tokens(factText),
				factsMs,
				stale: p.timeline ? has(full, p.timeline.superseded) : null,
				current: p.timeline ? has(full, p.timeline.current) : null,
				staleInRecall: p.timeline ? has(block, p.timeline.superseded) : null,
				staleInConsolidated: p.timeline
					? has(consText, p.timeline.superseded)
					: null,
				recalled: recall.passages.length,
				recalledDigests: recall.passages.filter((x) => x.kind === "digest")
					.length,
				recalledSummary: recall.passages.filter((x) => x.kind === "summary")
					.length,
				recalledAuto: recall.passages.filter(
					(x) => x.automatic && x.kind !== "summary",
				).length,
				recallDigestsRaw: recallEvidence.filter((e) => e.record === "digest")
					.length,
				episodes: consolidated?.episodes.length ?? 0,
				episodesRaw: lastDigests.length,
				episodeDrops: drops,
				tokens: tokens(requestText(request)),
				tokensLongTerm:
					tokens(requestText(request)) - tokens(requestText(bare)),
				tokensRecallBlock: tokens(block),
				tokensConsolidatedText: tokens(consText),
				windowMessages: scoped.messages.length,
				recallMs,
				consolidatedMs,
			});
			if (process.env.DEBUG_PROBE === p.id)
				console.error(
					spec.arm,
					JSON.stringify({
						recall: recall.passages.map((x) => [x.kind, x.text.slice(0, 70)]),
						episodes: consolidated?.episodes.map((e) => e.excerpts),
						facts: factsSnapshot?.facts.map((f) => [f.status, f.statement]),
					}),
				);
		}
	}
	const engineReport = Object.fromEntries(
		[...engines.values()].map((e) => [
			e.spec.name,
			{ ...e.spec, index: e.index, consolidation: e.consolidation },
		]),
	);
	for (const e of engines.values()) await e.port.close();
	for (const d of dirs) rmSync(d, { recursive: true, force: true });

	// ── Aggregate ──────────────────────────────────────────────────────────────────────────────────
	const rate = (rs: Row[], k: keyof Row) => {
		const v = rs
			.map((r) => r[k])
			.filter((x): x is boolean => typeof x === "boolean");
		return v.length
			? { rate: mean(v.map(Number)), n: v.length }
			: { rate: null, n: 0 };
	};
	const num = (rs: Row[], k: keyof Row) => {
		const v = rs
			.map((r) => r[k])
			.filter((x): x is number => typeof x === "number");
		return v.length ? { mean: mean(v), n: v.length } : { mean: null, n: 0 };
	};
	type UK =
		| "unauthorizedRecall"
		| "unauthorizedConsolidated"
		| "unauthorizedMemories"
		| "unauthorizedWindow"
		| "unauthorizedFacts"
		| "unauthorizedTotal";
	const anyRate = (rs: Row[], k: UK) => ({
		probesWithAny: rs.filter((r) => r[k] > 0).length,
		items: rs.reduce((n, r) => n + r[k], 0),
		n: rs.length,
	});
	const sum = (rs: Row[], f: (r: Row) => number) =>
		rs.reduce((n, r) => n + f(r), 0);
	const summary: Record<string, unknown> = {};
	for (const set of ["original", "heldout"] as const)
		for (const { arm } of ARMS) {
			const rs = rows.filter((r) => r.arm === arm && r.set === set);
			if (!rs.length) continue;
			summary[`${set}/${arm}`] = {
				gold: rate(rs, "gold"),
				goldShare: num(rs, "goldShare"),
				goldShareEngine: num(rs, "goldShareEngine"),
				goldInRecall: rate(rs, "goldInRecall"),
				goldInConsolidated: rate(rs, "goldInConsolidated"),
				goldInMemories: rate(rs, "goldInMemories"),
				goldInWindow: rate(rs, "goldInWindow"),
				forbidden: rate(rs, "forbidden"),
				forbiddenInConsolidated: rate(rs, "forbiddenInConsolidated"),
				unauthorizedRecall: anyRate(rs, "unauthorizedRecall"),
				unauthorizedConsolidated: anyRate(rs, "unauthorizedConsolidated"),
				unauthorizedMemories: anyRate(rs, "unauthorizedMemories"),
				unauthorizedWindow: anyRate(rs, "unauthorizedWindow"),
				unauthorizedFacts: anyRate(rs, "unauthorizedFacts"),
				goldInFacts: rate(rs, "goldInFacts"),
				forbiddenInFacts: rate(rs, "forbiddenInFacts"),
				staleInFacts: rate(rs, "staleInFacts"),
				factsMean: mean(rs.map((r) => r.facts)),
				factsRawMean: mean(rs.map((r) => r.factsRaw)),
				factsEarlierMean: mean(rs.map((r) => r.factsEarlier)),
				factsFromNotesMean: mean(rs.map((r) => r.factsFromNotes)),
				probesWithFacts: rs.filter((r) => r.facts > 0).length,
				tokensFactsTextMean: mean(rs.map((r) => r.tokensFactsText)),
				factsP50: pct(
					rs.map((r) => r.factsMs),
					0.5,
				),
				unauthorizedTotal: anyRate(rs, "unauthorizedTotal"),
				stale: rate(rs, "stale"),
				staleInRecall: rate(rs, "staleInRecall"),
				staleInConsolidated: rate(rs, "staleInConsolidated"),
				current: rate(rs, "current"),
				tokensMean: mean(rs.map((r) => r.tokens)),
				tokensLongTermMean: mean(rs.map((r) => r.tokensLongTerm)),
				tokensRecallBlockMean: mean(rs.map((r) => r.tokensRecallBlock)),
				tokensConsolidatedTextMean: mean(
					rs.map((r) => r.tokensConsolidatedText),
				),
				recalledMean: mean(rs.map((r) => r.recalled)),
				recalledDigestsMean: mean(rs.map((r) => r.recalledDigests)),
				recalledSummaryProbes: rs.filter((r) => r.recalledSummary > 0).length,
				recalledAutoProbes: rs.filter((r) => r.recalledAuto > 0).length,
				recallDigestsRawMean: mean(rs.map((r) => r.recallDigestsRaw)),
				episodesMean: mean(rs.map((r) => r.episodes)),
				episodesRawMean: mean(rs.map((r) => r.episodesRaw)),
				probesWithZeroEpisodes: rs.filter((r) => r.episodes === 0).length,
				episodeDrops: {
					missingSource: sum(rs, (r) => r.episodeDrops.missingSource),
					allInWindow: sum(rs, (r) => r.episodeDrops.allInWindow),
					notAdmitted: sum(rs, (r) => r.episodeDrops.notAdmitted),
					notLive: sum(rs, (r) => r.episodeDrops.notLive),
					budget: sum(rs, (r) => r.episodeDrops.budget),
				},
				windowMessagesMean: mean(rs.map((r) => r.windowMessages)),
				recallP50: pct(
					rs.map((r) => r.recallMs),
					0.5,
				),
				recallP95: pct(
					rs.map((r) => r.recallMs),
					0.95,
				),
				consolidatedP50: pct(
					rs.map((r) => r.consolidatedMs),
					0.5,
				),
				consolidatedP95: pct(
					rs.map((r) => r.consolidatedMs),
					0.95,
				),
			};
		}
	const byKind: Record<string, Record<string, unknown>> = {};
	for (const set of ["original", "heldout"] as const)
		for (const k of [
			...new Set(rows.filter((r) => r.set === set).map((r) => r.kind)),
		].sort()) {
			const entry: Record<string, unknown> = {};
			for (const { arm } of ARMS) {
				const rs = rows.filter(
					(r) => r.set === set && r.arm === arm && r.kind === k,
				);
				entry[arm] = {
					n: rs.length,
					gold: rate(rs, "gold").rate,
					goldShare: num(rs, "goldShare").mean,
					goldInConsolidated: rate(rs, "goldInConsolidated").rate,
					forbidden: rate(rs, "forbidden").rate,
					unauthorizedTotal: rs.filter((r) => r.unauthorizedTotal > 0).length,
					stale: rate(rs, "stale").rate,
					current: rate(rs, "current").rate,
				};
			}
			byKind[`${set}/${k}`] = entry;
		}
	const paired: Record<string, unknown> = {};
	let s = SEED;
	const comparisons: [string, string][] = [
		["AS", "AS+C"],
		["AS+C", "AS+C+F"],
		["AS-noscene", "AS-noscene+F"],
		["AS+C", "AS+C+H"],
		["AS+C", "AS-noscene"],
		["AS-noscene", "AS+C+H-noscene"],
	];
	for (const set of ["original", "heldout"] as const)
		for (const [x, y] of comparisons) {
			if (!ARMS.some((a) => a.arm === y)) continue;
			const xs = rows.filter(
				(r) => r.arm === x && r.set === set && r.gold !== null,
			);
			const ys = new Map(
				rows
					.filter((r) => r.arm === y && r.set === set)
					.map((r) => [r.probe, r]),
			);
			if (!xs.length) continue;
			paired[`${set}: ${y} - ${x} (gold)`] = pairedDiff(
				xs.map((r) => ({
					cluster: r.cluster,
					a: Number(r.gold),
					b: Number(ys.get(r.probe)?.gold),
				})),
				s++,
			);
		}

	// Against the frozen Phase 13 initial rows (V2 present): same original probes, per probe.
	let versusFrozen: Record<string, unknown> | null = null;
	if (frozen) {
		const fz = (arm: string) =>
			new Map(
				frozen.rows.filter((r) => r.arm === arm).map((r) => [r.probe, r]),
			);
		versusFrozen = {};
		for (const ref of ["C12n+V2", "C12+V2"]) {
			const fRows = fz(ref);
			for (const arm of ["AS", "AS+C", "AS+C+F"]) {
				const mine = rows.filter(
					(r) => r.set === "original" && r.arm === arm && r.gold !== null,
				);
				const pairs = mine
					.filter(
						(r) =>
							fRows.get(r.probe)?.gold !== null &&
							fRows.get(r.probe) !== undefined,
					)
					.map((r) => ({
						cluster: r.cluster,
						a: Number(fRows.get(r.probe)?.gold),
						b: Number(r.gold),
					}));
				const lost = mine
					.filter((r) => fRows.get(r.probe)?.gold === true && r.gold === false)
					.map((r) => r.probe);
				const gained = mine
					.filter((r) => fRows.get(r.probe)?.gold === false && r.gold === true)
					.map((r) => r.probe);
				versusFrozen[`${arm} - ${ref} (gold)`] = {
					...pairedDiff(pairs, s++),
					lost,
					gained,
				};
			}
		}
		// Which of the probes AS loses against C12n+V2 do the episodes bring back?
		const fN = fz("C12n+V2");
		const asRows = new Map(
			rows
				.filter((r) => r.set === "original" && r.arm === "AS")
				.map((r) => [r.probe, r]),
		);
		const ascRows = rows.filter(
			(r) => r.set === "original" && r.arm === "AS+C",
		);
		const lostByAS = ascRows.filter(
			(r) =>
				fN.get(r.probe)?.gold === true && asRows.get(r.probe)?.gold === false,
		);
		versusFrozen.episodesRecover = {
			lostByAS: lostByAS.length,
			recoveredByAS_C: lostByAS
				.filter((r) => r.gold === true)
				.map((r) => r.probe),
			recoveredViaEpisodeBlock: lostByAS
				.filter((r) => r.gold === true && r.goldInConsolidated === true)
				.map((r) => r.probe),
		};
	}

	const coverage = {
		messages: live.length,
		messagesWithQuery: live.length + 1,
		window: chatHistoryWindow([...live, live[0]]).length,
		scenes: scenesFull.length,
		probes: { original: S.probes.length, heldout: heldout?.probes.length ?? 0 },
		notes: notesM1.length,
		v2: v2
			? {
					summaryChars: v2.summary?.text.length ?? 0,
					autoMemories: autoMemories.length,
				}
			: null,
	};
	const result = {
		format: "rowcat-memory-ab-p13/1",
		synthetic: true,
		seed: SEED,
		plant,
		language: base.language ?? "en",
		arms: ARMS,
		bridge: {
			path: AFTERSTATE_BRIDGE_BIN,
			sha256: createHash("sha256")
				.update(readFileSync(AFTERSTATE_BRIDGE_BIN))
				.digest("hex"),
		},
		engines: engineReport,
		heldout: heldout
			? { file: heldoutPath, sha256: heldoutSha, authored: heldout.authored }
			: null,
		frozen: frozenPath ?? null,
		corpus: { coverage, characters: cast },
		summary,
		byKind,
		paired,
		versusFrozen,
		rows,
	};
	mkdirSync(outDir as string, { recursive: true });
	writeFileSync(
		join(outDir as string, "results.json"),
		`${JSON.stringify(result, null, 1)}\n`,
	);

	// ── Markdown ───────────────────────────────────────────────────────────────────────────────────
	type Agg = Record<
		string,
		{
			rate?: number | null;
			mean?: number | null;
			probesWithAny?: number;
			n: number;
		}
	> &
		Record<string, unknown>;
	const f3 = (v: number | null | undefined) =>
		v === null || v === undefined ? "–" : v.toFixed(3);
	const c = (x: { probesWithAny?: number; n: number } | undefined) =>
		x ? `${x.probesWithAny}/${x.n}` : "–";
	const mainLine = (label: string, x: Agg | undefined) =>
		x
			? `| ${label} | ${f3(x.gold?.rate)} | ${f3(x.goldShare?.mean)} | ${f3(x.forbidden?.rate)} | ${c(x.unauthorizedTotal)} | ${f3(x.stale?.rate)} | ${f3(x.current?.rate)} | ${Math.round(Number(x.tokensMean ?? 0))} | ${x.tokensLongTermMean === undefined ? "–" : Math.round(Number(x.tokensLongTermMean))} |`
			: "";
	const frozenAgg = (arm: string) =>
		frozen?.summary[`all/${arm}`] as Agg | undefined;
	const mainTable = (set: ProbeSet) =>
		[
			"| arm | gold | gold share | probe-forbidden | unauthorized anywhere (probes) | stale | current | tokens | long-term tokens |",
			"|---|---|---|---|---|---|---|---|---|",
			...(set === "original" && frozen
				? ["A+V2", "C12n+V2", "C12+V2"].map((a) =>
						mainLine(`${a} (frozen, Phase 13 initial)`, frozenAgg(a)),
					)
				: []),
			...ARMS.map((a) =>
				mainLine(
					`${a.arm}${a.diagnostic ? " (diagnostic)" : ""}`,
					summary[`${set}/${a.arm}`] as Agg | undefined,
				),
			),
		].join("\n");
	const whereTable = (set: ProbeSet) =>
		[
			"| arm | gold in recall | gold in episodes | gold in memory block | gold in window | gold in facts | unauth. recall | unauth. episodes | unauth. memory block | unauth. window | unauth. facts | stale in recall | stale in episodes | stale in facts |",
			"|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
			...ARMS.map((a) => {
				const x = summary[`${set}/${a.arm}`] as Agg | undefined;
				if (!x) return "";
				return `| ${a.arm} | ${f3(x.goldInRecall?.rate)} | ${f3(x.goldInConsolidated?.rate)} | ${f3(x.goldInMemories?.rate)} | ${f3(x.goldInWindow?.rate)} | ${f3(x.goldInFacts?.rate)} | ${c(x.unauthorizedRecall)} | ${c(x.unauthorizedConsolidated)} | ${c(x.unauthorizedMemories)} | ${c(x.unauthorizedWindow)} | ${c(x.unauthorizedFacts)} | ${f3(x.staleInRecall?.rate)} | ${f3(x.staleInConsolidated?.rate)} | ${f3(x.staleInFacts?.rate)} |`;
			}),
		].join("\n");
	const engineTable = (set: ProbeSet) =>
		[
			"| arm | recalled passages | of which episodes | episodes (bridge → kept) | probes with 0 episodes | drops: source gone / all in window / not admitted / not live / budget | recall tokens | episode tokens | facts (bridge → kept; earlier; from notes) | probes with facts | facts tokens | recall p50/p95 ms | episodes p50/p95 ms | facts p50 ms |",
			"|---|---|---|---|---|---|---|---|---|---|---|---|---|",
			...ARMS.map((a) => {
				const x = summary[`${set}/${a.arm}`] as
					| Record<string, unknown>
					| undefined;
				if (!x) return "";
				const n = (k: string, d = 2) => Number(x[k] ?? 0).toFixed(d);
				const dr = x.episodeDrops as Record<string, number>;
				return `| ${a.arm} | ${n("recalledMean")} | ${n("recalledDigestsMean")} | ${n("episodesRawMean")} → ${n("episodesMean")} | ${x.probesWithZeroEpisodes} | ${dr.missingSource} / ${dr.allInWindow} / ${dr.notAdmitted} / ${dr.notLive} / ${dr.budget} | ${n("tokensRecallBlockMean", 0)} | ${n("tokensConsolidatedTextMean", 0)} | ${n("factsRawMean")} → ${n("factsMean")}; ${n("factsEarlierMean")}; ${n("factsFromNotesMean")} | ${x.probesWithFacts} | ${n("tokensFactsTextMean", 0)} | ${n("recallP50", 0)} / ${n("recallP95", 0)} | ${n("consolidatedP50", 0)} / ${n("consolidatedP95", 0)} | ${n("factsP50", 0)} |`;
			}),
		].join("\n");
	const pairedTable = [
		"| comparison | n | Δ | 95% CI | discordant (a only / b only) | McNemar p |",
		"|---|---|---|---|---|---|",
		...Object.entries(paired).map(([k, v]) => {
			const x = v as ReturnType<typeof pairedDiff>;
			return `| ${k} | ${x.n} | ${x.diff.toFixed(3)} | [${x.ci[0]?.toFixed(3)}, ${x.ci[1]?.toFixed(3)}] | ${x.discordant.aOnly} / ${x.discordant.bOnly} | ${x.mcnemarP.toPrecision(2)} |`;
		}),
	].join("\n");
	const frozenTable = versusFrozen
		? [
				"| comparison (original probes) | n | Δ | 95% CI | lost | gained |",
				"|---|---|---|---|---|---|",
				...Object.entries(versusFrozen)
					.filter(([k]) => k !== "episodesRecover")
					.map(([k, v]) => {
						const x = v as ReturnType<typeof pairedDiff> & {
							lost: string[];
							gained: string[];
						};
						return `| ${k} | ${x.n} | ${x.diff.toFixed(3)} | [${x.ci[0]?.toFixed(3)}, ${x.ci[1]?.toFixed(3)}] | ${x.lost.length} | ${x.gained.length} |`;
					}),
				"",
				`Probes AS loses against frozen C12n+V2 and AS+C brings back: ${JSON.stringify(versusFrozen.episodesRecover)}`,
			].join("\n")
		: "(no frozen rows given)";
	const kindTable = (set: ProbeSet) =>
		[
			`| kind | n | ${ARMS.map((a) => `${a.arm} gold`).join(" | ")} | ${ARMS.map((a) => `${a.arm} unauth.`).join(" | ")} |`,
			`|---|---|${ARMS.map(() => "---").join("|")}|${ARMS.map(() => "---").join("|")}|`,
			...Object.entries(byKind)
				.filter(([k]) => k.startsWith(`${set}/`))
				.map(([k, v]) => {
					const e = v as Record<
						string,
						{ n: number; gold: number | null; unauthorizedTotal: number }
					>;
					const first = e[ARMS[0]?.arm ?? ""];
					return `| ${k.slice(set.length + 1)} | ${first?.n ?? 0} | ${ARMS.map((a) => f3(e[a.arm]?.gold)).join(" | ")} | ${ARMS.map((a) => e[a.arm]?.unauthorizedTotal ?? 0).join(" | ")} |`;
				}),
		].join("\n");
	const sections = (set: ProbeSet) =>
		summary[`${set}/AS`]
			? [
					`## ${set === "original" ? "Original probes (Phase 10/11/12 — recall was tuned on these; not held out)" : `Held-out probes (${heldoutPath}, sha256 ${heldoutSha?.slice(0, 12)}…)`}`,
					"",
					mainTable(set),
					"",
					"### Where gold and unauthorized items sit (probes with any)",
					"",
					whereTable(set),
					"",
					"### Engine and adapter",
					"",
					engineTable(set),
					"",
					"### By kind",
					"",
					kindTable(set),
				].join("\n")
			: "";
	writeFileSync(
		join(outDir as string, "results.md"),
		[
			"# Phase 13 afterstate-only long-term memory (synthetic, retrieval level)",
			"",
			`Generated by \`packages/chat/eval/memory-ab-p13.ts\` (${plant ? "planted" : "no plant"}, ${base.language ?? "en"}). Messages ${live.length}, window ${coverage.window}, scenes ${scenesFull.length}. No model called.`,
			"",
			`Bridge: \`${AFTERSTATE_BRIDGE_BIN}\` (sha256 ${createHash("sha256").update(readFileSync(AFTERSTATE_BRIDGE_BIN)).digest("hex").slice(0, 16)}…).`,
			"",
			`Engines: ${Object.entries(engineReport)
				.map(
					([k, v]) =>
						`${k} (episodes ${v.consolidation?.episodes ?? "–"}, index complete ${v.index.complete})`,
				)
				.join("; ")}`,
			"",
			sections("original"),
			"",
			sections("heldout"),
			"",
			"## Paired (gold in request)",
			"",
			pairedTable,
			"",
			"## Against the frozen Phase 13 initial rows (V2 present)",
			"",
			frozenTable,
			"",
		].join("\n"),
	);
	console.log(JSON.stringify({ coverage, engines: engineReport }, null, 1));
}

void main();
