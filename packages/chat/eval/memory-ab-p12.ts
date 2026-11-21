/**
 * Phase 12 A/B: knowledge isolation, current-vs-earlier facts, renames and multi-scene evidence,
 * through RowCat's own adapter and assembler, with the real afterstate engine.
 *
 * The Phase 10 transcript records who witnessed each turn (`audience`); here that becomes RowCat
 * scenes (`scene.ts`): a scene starts wherever the audience changes; the user (Rowan) is present in
 * every in-scene turn; world narration and OOC are shared (`room`). Each probe is asked from its
 * perspective: `char:X` → a scene with the user and X present; `story`/`real` → everyone present.
 *
 * Arms (all with the same window, notes, V2 state and probe):
 *   A+V2      V2 as shipped (Phase 11 replayed summary and auto-memories), no recall
 *   C11+V2    + Phase 11 recall (no audience filter, no aliases, no supersession)
 *   C12+V2    + Phase 12 recall (scenes → perspective filter, aliases, supersession)
 *   C12       Phase 12 recall without V2's summary/auto-memories
 *   C12L+V2   Phase 12 recall in a room that started marking scenes halfway (late adoption):
 *             the unmarked first half is unknown audience and is not recalled
 *
 * Metrics per probe: gold (every needle of every gold item in the request), forbidden (any needle
 * of a probe-listed forbidden item), unauthorized (any item whose every source turn the
 * perspective did not witness) split by where it appears — recall block vs the rest of the request
 * (window, summary, memories) — stale/current, and for multi-gold probes the share of gold items
 * found (evidence-set completeness) in the engine's results and in the request.
 *
 *   pnpm exec tsx eval/memory-ab-p12.ts --transcript T.json --v2-state v2-state.json --out DIR
 *
 * Synthetic data. Retrieval-level only (no model is called).
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnAfterstate } from "../src/afterstate-stdio.test.helper.ts";
import type { ChatCharacter } from "../src/character.ts";
import { buildChatGenerationRequest, recallBlock, selectMemoriesForContext } from "../src/context.ts";
import {
	type AfterstatePort,
	type ChatRecallSnapshot,
	type ConversationMemorySource,
	recallAliases,
	recallForTurn,
	recallRequestFor,
	reconcileConversation,
} from "../src/conversation-memory.ts";
import { chatHistoryWindow } from "../src/history-window.ts";
import type { ChatMemory } from "../src/memory.ts";
import type { ChatMessage } from "../src/model.ts";
import {
	type ChatScene,
	type ChatSceneAudience,
	perspectiveAdmits,
	recallPerspective,
	type ResolvedAudience,
} from "../src/scene.ts";
import { loadScenario, type Probe, type Transcript, type Turn } from "./scenario.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
	const k = process.argv[i] ?? "";
	if (k === "--no-plant") args.set(k, "1");
	else args.set(k, process.argv[++i] ?? "");
}
const transcriptPath = args.get("--transcript");
const outDir = args.get("--out");
const v2StatePath = args.get("--v2-state");
const dumpPath = args.get("--dump-contexts");
if (!transcriptPath || !outDir || !v2StatePath) {
	console.error("usage: memory-ab-p12.ts --transcript FILE --v2-state FILE --out DIR [--dump-contexts FILE]");
	process.exit(2);
}
const SEED = Number(args.get("--seed") ?? 20261121);
const base = JSON.parse(readFileSync(transcriptPath, "utf8")) as Transcript;
const plant = args.get("--no-plant") === undefined;
const S = loadScenario(base, { plant });
const { turns, items, probes, deleted, ROOM, room, toMessage, live, notesM1 } = S;

interface V2State {
	summary: { text: string; frontier: { createdAt: string; messageId: string } | null } | null;
	autoMemories: { id: string; content: string; originAt: string | null }[];
}
const v2 = JSON.parse(readFileSync(v2StatePath, "utf8")) as V2State;
const autoMemories: ChatMemory[] = v2.autoMemories.map(
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

// ── Scenes from the transcript's audiences ──────────────────────────────────────────────────────────

type TurnWithAudience = Turn & { audience?: string[] };
const audienceOfTurn = (t: TurnWithAudience): ChatSceneAudience => {
	if (t.channel !== "scene" || !t.audience || t.audience.length === 0) return { kind: "room" };
	return { kind: "participants", members: ["user", ...t.audience.map((c) => `char:${c}`)].sort() };
};
const key = (a: ChatSceneAudience | ResolvedAudience) =>
	a.kind === "participants" ? `p:${a.members.join(",")}` : a.kind;
let sceneSeq = 0;
const sceneRecord = (anchor: Turn, audience: ChatSceneAudience): ChatScene => ({
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
function scenesFrom(fromIndex: number): ChatScene[] {
	const out: ChatScene[] = [];
	let last = "";
	turns.forEach((t, i) => {
		if (i < fromIndex) return;
		const a = audienceOfTurn(t as TurnWithAudience);
		if (key(a) !== last) out.push(sceneRecord(t, a));
		last = key(a);
	});
	return out;
}
const scenesFull = scenesFrom(0);
const halfway = Math.floor(turns.length / 2);
const scenesLate = scenesFrom(halfway);
const turnAudience = new Map(turns.map((t) => [t.id, audienceOfTurn(t as TurnWithAudience)]));

// Characters: the transcript's four companions, plus the renamed minor character (renamed in room
// settings, so the old name is kept as an alias — `aliasesAfterRename`).
const characters: ChatCharacter[] = [
	...base.characters.map(([id, name, aliases]) => ({ id, name, prompt: "", ...(aliases?.length ? { aliases } : {}) })),
	...(plant ? [{ id: "tamsa", name: "Tamsa", prompt: "", aliases: ["Tamsin"] }] : []),
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

const perspectiveScene = (p: Probe, anchor: ChatMessage): ChatScene => {
	const who = p.perspective.startsWith("char:") ? p.perspective.slice(5) : null;
	const audience: ChatSceneAudience = who
		? { kind: "participants", members: ["user", `char:${who}`].sort() }
		: { kind: "room" };
	return {
		...sceneRecord({ id: anchor.id, at: anchor.createdAt } as Turn, audience),
		id: `scene-probe-${p.id}`,
	};
};

// ── Measurement helpers ─────────────────────────────────────────────────────────────────────────────

const has = (text: string, item: string) => {
	const needles = items[item]?.needles ?? [];
	const lower = text.toLowerCase();
	return needles.length > 0 && needles.every((n) => lower.includes(n.toLowerCase()));
};
const strings = (v: unknown, out: string[] = []): string[] => {
	if (typeof v === "string") out.push(v);
	else if (Array.isArray(v)) for (const x of v) strings(x, out);
	else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, out);
	return out;
};
const requestText = (req: unknown) => {
	const r = req as { messages?: unknown; system?: unknown };
	return strings([r.system ?? "", r.messages ?? req]).join("\n");
};
const tokens = (text: string) => Math.ceil(text.length / 4);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (xs: number[], q: number) => {
	const s = [...xs].sort((a, b) => a - b);
	return s.length ? (s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0) : 0;
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
function pairedDiff(pairs: { cluster: string; a: number; b: number }[], seed: number) {
	const clusters = new Map<string, { a: number; b: number }[]>();
	for (const p of pairs) clusters.set(p.cluster, [...(clusters.get(p.cluster) ?? []), p]);
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
	for (let i = 0; i < 2000; i++) boots.push(diff(keys.map(() => keys[Math.floor(r() * keys.length)] ?? "")));
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
const clusterOf = (p: Probe) => [...p.gold, ...p.forbidden].sort().join("+") || p.id;
/** Same split rule and seed as Phase 11, so the Phase 11 held-out half stays the held-out half. */
const splitOf = (p: Probe): "dev" | "heldout" =>
	(createHash("sha256").update(`${SEED}:${clusterOf(p)}`).digest()[0] ?? 0) % 2 === 0 ? "dev" : "heldout";

/** Items the probe's perspective did not witness: every source turn's audience is not admitted. */
function unauthorizedItems(p: Probe): string[] {
	const who = p.perspective.startsWith("char:") ? p.perspective.slice(5) : null;
	const view = who
		? ({ kind: "participants", members: ["user", `char:${who}`].sort(), unknown: "exclude" } as const)
		: ({ kind: "room", unknown: "exclude" } as const);
	return Object.entries(items)
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

// ── Run ──────────────────────────────────────────────────────────────────────────────────────────────

interface Arm {
	arm: string;
	v2: boolean;
	recall: "none" | "p11" | "p12";
	scenes: "full" | "late";
	/** `false`: the assembler gets no scenes (no window marks, no scene notice); recall still filters. */
	notice?: boolean;
}
const ARMS: Arm[] = [
	{ arm: "A+V2", v2: true, recall: "none", scenes: "full" },
	{ arm: "C11+V2", v2: true, recall: "p11", scenes: "full" },
	{ arm: "C12+V2", v2: true, recall: "p12", scenes: "full" },
	{ arm: "C12", v2: false, recall: "p12", scenes: "full" },
	{ arm: "C12L+V2", v2: true, recall: "p12", scenes: "late" },
	// Post-hoc (after the in-character run): scene-filtered recall, but no window marks or scene notice.
	{ arm: "C12n+V2", v2: true, recall: "p12", scenes: "full", notice: false },
];

interface Row {
	probe: string;
	kind: string;
	perspective: string;
	cluster: string;
	split: "dev" | "heldout";
	arm: string;
	gold: boolean | null;
	goldShare: number | null;
	goldShareEngine: number | null;
	forbidden: boolean | null;
	unauthorizedRecall: number;
	unauthorizedElsewhere: number;
	unauthorizedTotal: number;
	/** Where the "elsewhere" exposures sit: summary, memory block, window (scene-marked or not). */
	unauthorizedSummary: number;
	unauthorizedMemories: number;
	unauthorizedWindowMarked: number;
	unauthorizedWindowUnmarked: number;
	stale: boolean | null;
	current: boolean | null;
	staleInRecall: boolean | null;
	recalled: number;
	tokens: number;
	recallMs: number;
}

async function main() {
	const dirs: string[] = [];
	const engine = async (memories: ChatMemory[], scenes: ChatScene[]) => {
		const dir = mkdtempSync(join(tmpdir(), "rowcat-p12-"));
		dirs.push(dir);
		const port = await spawnAfterstate({ store: { user: { dir, user: "eval" } } });
		const source: ConversationMemorySource = {
			listAllMessages: async () => live,
			listMemories: async () => memories,
			listScenes: async () => scenes,
			listCharacters: async () => characters,
		};
		await reconcileConversation(port, source, ROOM, { maxItems: 100_000 });
		return port;
	};
	// One index per arm configuration, built as the apps would (scenes known at indexing time).
	const ports = {
		p11v2: await engine([...notesM1, ...autoMemories], []),
		fullV2: await engine([...notesM1, ...autoMemories], scenesFull),
		full: await engine(notesM1, scenesFull),
		lateV2: await engine([...notesM1, ...autoMemories], scenesLate),
	};
	let lastEvidence: { text: string }[] = [];
	const spy = (target: AfterstatePort): AfterstatePort => ({
		call: async <T>(op: Parameters<AfterstatePort["call"]>[0], params: object) => {
			const r = await target.call<T>(op, params);
			if (op === "recall") lastEvidence = (r as { evidence: { text: string }[] }).evidence;
			return r;
		},
	});
	const window = chatHistoryWindow(live, null);
	const windowV2 = chatHistoryWindow(live, v2.summary?.frontier ?? null);
	const rows: Row[] = [];
	const dumped: { arm: string; probe: string; context: string; tokens: number }[] = [];
	const aliases = recallAliases(characters);

	for (const p of probes) {
		const q = toMessage({ id: "probe", session: "now", at: base.now, speaker: base.user_character ?? "Rowan", role: "user", channel: "scene", text: p.query });
		const forbiddenAll = unauthorizedItems(p);
		for (const spec of ARMS) {
			const memories = spec.v2 ? [...notesM1, ...autoMemories] : notesM1;
			const history = [...(spec.v2 ? windowV2 : window), q];
			const baseScenes = spec.scenes === "full" ? scenesFull : scenesLate;
			const scenes = [...baseScenes, perspectiveScene(p, q)];
			const port =
				spec.recall === "p11" ? ports.p11v2 : !spec.v2 ? ports.full : spec.scenes === "late" ? ports.lateV2 : ports.fullV2;
			let recall: ChatRecallSnapshot | null = null;
			let recallMs = 0;
			lastEvidence = [];
			if (spec.recall !== "none") {
				const req = recallRequestFor(history, memories);
				const t0 = performance.now();
				recall = await recallForTurn(spy(port), {
					roomId: ROOM,
					query: req.query,
					windowLength: req.windowLength,
					messages: [...live, q],
					memories,
					memoryIdsInContext: req.memoryIdsInContext,
					...(spec.recall === "p12"
						? { scenes, aliases }
						: { scenes: [], unscoped: true, supersession: false, continuation: 0 }),
				});
				recallMs = performance.now() - t0;
				if (process.env.DEBUG_PROBE === p.id) {
					console.error(spec.arm, JSON.stringify(lastEvidence.map((e) => ({ ...(e as object), text: e.text.slice(0, 60) })), null, 0));
					console.error(spec.arm, "kept", JSON.stringify(recall.passages.map((x) => [x.id, x.superseded, x.text.slice(0, 50)])));
				}
			}
			const request = buildChatGenerationRequest({
				room,
				messages: history,
				memories,
				allAges: true,
				...(spec.v2 && v2.summary?.text ? { summary: v2.summary.text } : {}),
				...(recall ? { recall } : {}),
				...(spec.recall === "p12" && spec.notice !== false ? { scenes: { scenes, cast } } : {}),
			});
			if (dumpPath && ["A+V2", "C11+V2", "C12+V2", "C12n+V2"].includes(spec.arm)) {
				dumped.push({ arm: spec.arm, probe: p.id, context: JSON.stringify(request), tokens: tokens(requestText(request)) });
			}
			const full = requestText(request).split(p.query).join(" ");
			const block = recallBlock(recall) ?? "";
			const rest = block ? full.split(block).join(" ") : full;
			const engineText = lastEvidence.map((e) => e.text).join("\n");
			const unauthRecall = forbiddenAll.filter((i) => has(block, i)).length;
			const unauthElse = forbiddenAll.filter((i) => has(rest, i)).length;
			const summaryText = spec.v2 ? (v2.summary?.text ?? "") : "";
			const memoryText = selectMemoriesForContext(memories).map((m) => m.content).join("\n");
			const hist = (request as { messages: { content: string }[] }).messages.map((m) => m.content.split(p.query).join(" "));
			const isMarked = (c: string) => /^\(이 장면을 본 인물|^\(어떤 인물도/.test(c);
			const marked = hist.filter(isMarked).join("\n");
			const unmarked = hist.filter((c) => !isMarked(c)).join("\n").split(block).join(" ");
			rows.push({
				probe: p.id,
				kind: p.kind,
				perspective: p.perspective,
				cluster: clusterOf(p),
				split: splitOf(p),
				arm: spec.arm,
				gold: p.gold.length ? p.gold.every((g) => has(full, g)) : null,
				goldShare: p.gold.length ? p.gold.filter((g) => has(full, g)).length / p.gold.length : null,
				goldShareEngine:
					p.gold.length && spec.recall !== "none" ? p.gold.filter((g) => has(engineText, g)).length / p.gold.length : null,
				forbidden: p.forbidden.length ? p.forbidden.some((f) => has(full, f)) : null,
				unauthorizedRecall: unauthRecall,
				unauthorizedElsewhere: unauthElse,
				unauthorizedTotal: forbiddenAll.filter((i) => has(full, i)).length,
				unauthorizedSummary: forbiddenAll.filter((i) => has(summaryText, i)).length,
				unauthorizedMemories: forbiddenAll.filter((i) => has(memoryText, i)).length,
				unauthorizedWindowMarked: forbiddenAll.filter((i) => has(marked, i)).length,
				unauthorizedWindowUnmarked: forbiddenAll.filter((i) => has(unmarked, i)).length,
				stale: p.timeline ? has(full, p.timeline.superseded) : null,
				current: p.timeline ? has(full, p.timeline.current) : null,
				staleInRecall: p.timeline ? has(block, p.timeline.superseded) : null,
				recalled: recall?.passages.length ?? 0,
				tokens: tokens(requestText(request)),
				recallMs,
			});
		}
	}
	for (const port of Object.values(ports)) await port.close();
	for (const d of dirs) rmSync(d, { recursive: true, force: true });
	if (dumpPath) {
		writeFileSync(dumpPath, `${dumped.map((d) => JSON.stringify(d)).join("\n")}\n`);
		const turnText = new Map(turns.map((t) => [t.id, t.text]));
		const needles = (ids: readonly string[]) => ids.map((i) => items[i]?.needles ?? []);
		const texts = (ids: readonly string[]) =>
			ids.map((i) => (items[i]?.turns ?? []).map((t) => turnText.get(t) ?? "").join(" / "));
		writeFileSync(
			`${dumpPath}.probes.json`,
			`${JSON.stringify(
				{
					synthetic: true,
					language: base.language ?? "en",
					characters: base.characters,
					userCharacter: base.user_character ?? "Rowan",
					probes: probes.map((p) => ({
						id: p.id,
						kind: p.kind,
						perspective: p.perspective,
						query: p.query,
						split: splitOf(p),
						cluster: clusterOf(p),
						gold: needles(p.gold),
						goldText: texts(p.gold),
						forbidden: needles(p.forbidden),
						forbiddenText: texts(p.forbidden),
						unauthorized: needles(unauthorizedItems(p)),
						timeline: p.timeline
							? { current: needles([p.timeline.current])[0], superseded: needles([p.timeline.superseded])[0] }
							: null,
					})),
				},
				null,
				1,
			)}\n`,
		);
	}

	// ── Aggregate ──────────────────────────────────────────────────────────────────────────────────
	const rate = (rs: Row[], k: keyof Row) => {
		const v = rs.map((r) => r[k]).filter((x): x is boolean => typeof x === "boolean");
		return v.length ? { rate: mean(v.map(Number)), n: v.length } : { rate: null, n: 0 };
	};
	const num = (rs: Row[], k: keyof Row) => {
		const v = rs.map((r) => r[k]).filter((x): x is number => typeof x === "number");
		return v.length ? { mean: mean(v), n: v.length } : { mean: null, n: 0 };
	};
	type UK =
		| "unauthorizedRecall"
		| "unauthorizedElsewhere"
		| "unauthorizedTotal"
		| "unauthorizedSummary"
		| "unauthorizedMemories"
		| "unauthorizedWindowMarked"
		| "unauthorizedWindowUnmarked";
	const anyRate = (rs: Row[], k: UK) => ({
		probesWithAny: rs.filter((r) => r[k] > 0).length,
		items: rs.reduce((n, r) => n + r[k], 0),
		n: rs.length,
	});
	const summary: Record<string, unknown> = {};
	for (const split of ["all", "dev", "heldout"] as const)
		for (const { arm } of ARMS) {
			const rs = rows.filter((r) => r.arm === arm && (split === "all" || r.split === split));
			summary[`${split}/${arm}`] = {
				gold: rate(rs, "gold"),
				goldShare: num(rs, "goldShare"),
				goldShareEngine: num(rs, "goldShareEngine"),
				forbidden: rate(rs, "forbidden"),
				unauthorizedRecall: anyRate(rs, "unauthorizedRecall"),
				unauthorizedElsewhere: anyRate(rs, "unauthorizedElsewhere"),
				unauthorizedTotal: anyRate(rs, "unauthorizedTotal"),
				unauthorizedSummary: anyRate(rs, "unauthorizedSummary"),
				unauthorizedMemories: anyRate(rs, "unauthorizedMemories"),
				unauthorizedWindowMarked: anyRate(rs, "unauthorizedWindowMarked"),
				unauthorizedWindowUnmarked: anyRate(rs, "unauthorizedWindowUnmarked"),
				stale: rate(rs, "stale"),
				staleInRecall: rate(rs, "staleInRecall"),
				current: rate(rs, "current"),
				tokensMean: mean(rs.map((r) => r.tokens)),
				recalledMean: mean(rs.map((r) => r.recalled)),
				recallP50: pct(rs.map((r) => r.recallMs), 0.5),
				recallP95: pct(rs.map((r) => r.recallMs), 0.95),
			};
		}
	const byKind: Record<string, Record<string, unknown>> = {};
	for (const k of [...new Set(probes.map((p) => p.kind))].sort()) {
		byKind[k] = {};
		for (const { arm } of ARMS) {
			const rs = rows.filter((r) => r.arm === arm && r.kind === k);
			byKind[k][arm] = {
				n: rs.length,
				gold: rate(rs, "gold").rate,
				goldShare: num(rs, "goldShare").mean,
				goldShareEngine: num(rs, "goldShareEngine").mean,
				forbidden: rate(rs, "forbidden").rate,
				unauthorizedRecall: rs.filter((r) => r.unauthorizedRecall > 0).length,
				unauthorizedTotal: rs.filter((r) => r.unauthorizedTotal > 0).length,
				stale: rate(rs, "stale").rate,
				staleInRecall: rate(rs, "staleInRecall").rate,
			};
		}
	}
	const paired: Record<string, unknown> = {};
	let s = SEED;
	const comparisons: [string, string, keyof Row][] = [
		["A+V2", "C11+V2", "gold"],
		["A+V2", "C12+V2", "gold"],
		["C11+V2", "C12+V2", "gold"],
		["C12+V2", "C12L+V2", "gold"],
		["C12", "C12+V2", "gold"],
	];
	for (const split of ["all", "dev", "heldout"] as const)
		for (const [x, y, k] of comparisons) {
			const xs = rows.filter((r) => r.arm === x && (split === "all" || r.split === split) && r[k] !== null);
			const ys = new Map(rows.filter((r) => r.arm === y).map((r) => [r.probe, r]));
			paired[`${split}: ${y} - ${x} (${k})`] = pairedDiff(
				xs.map((r) => ({ cluster: r.cluster, a: Number(r[k]), b: Number(ys.get(r.probe)?.[k]) })),
				s++,
			);
		}
	const coverage = {
		messages: live.length,
		unknownInLateRoom: live.filter((m) => turns.findIndex((t) => t.id === m.id) < halfway).length,
		scenesFull: scenesFull.length,
		scenesLate: scenesLate.length,
	};
	const result = {
		format: "rowcat-memory-ab-p12/1",
		synthetic: true,
		seed: SEED,
		arms: ARMS,
		corpus: { probes: probes.length, characters: cast, coverage, v2: { summaryChars: v2.summary?.text.length ?? 0, autoMemories: autoMemories.length } },
		summary,
		byKind,
		paired,
		rows,
	};
	mkdirSync(outDir as string, { recursive: true });
	writeFileSync(join(outDir as string, "results.json"), `${JSON.stringify(result, null, 1)}\n`);
	const line = (arm: string, split = "all") => {
		const x = summary[`${split}/${arm}`] as Record<string, { rate?: number | null; mean?: number | null; probesWithAny?: number; n: number }>;
		const f = (v: number | null | undefined) => (v === null || v === undefined ? "–" : v.toFixed(3));
		return `| ${arm} | ${f(x.gold?.rate)} | ${f(x.goldShare?.mean)} | ${f(x.forbidden?.rate)} | ${x.unauthorizedRecall?.probesWithAny}/${x.unauthorizedRecall?.n} | ${x.unauthorizedElsewhere?.probesWithAny}/${x.unauthorizedElsewhere?.n} | ${f(x.stale?.rate)} | ${f(x.staleInRecall?.rate)} | ${f(x.current?.rate)} |`;
	};
	const table = (split: string) =>
		[
			`### ${split}`,
			"| arm | gold | gold share | probe-forbidden | unauthorized in recall (probes) | unauthorized elsewhere (probes) | stale in request | stale in recall | current |",
			"|---|---|---|---|---|---|---|---|---|",
			...ARMS.map((a) => line(a.arm, split)),
		].join("\n");
	const leakRow = (arm: string) => {
		const x = summary[`all/${arm}`] as Record<string, { probesWithAny: number; n: number }>;
		const c = (k: string) => `${x[k]?.probesWithAny}/${x[k]?.n}`;
		return `| ${arm} | ${c("unauthorizedRecall")} | ${c("unauthorizedWindowUnmarked")} | ${c("unauthorizedWindowMarked")} | ${c("unauthorizedSummary")} | ${c("unauthorizedMemories")} |`;
	};
	const leakTable = [
		"## Where unauthorized items reach the request (probes with any, all probes)",
		"| arm | recall block | window, unmarked | window, scene-marked | V2 summary | memory block |",
		"|---|---|---|---|---|---|",
		...ARMS.map((a) => leakRow(a.arm)),
	].join("\n");
	writeFileSync(
		join(outDir as string, "results.md"),
		`# Phase 12 RowCat A/B (synthetic, retrieval level)\n\nGenerated by \`packages/chat/eval/memory-ab-p12.ts\`. Probes: ${probes.length}.\n\n${["all", "dev", "heldout"].map(table).join("\n\n")}\n\n${leakTable}\n\n## Paired (gold in request)\n\n| comparison | n | Δ | 95% CI | discordant (a only / b only) | McNemar p |\n|---|---|---|---|---|---|\n${Object.entries(
			paired,
		)
			.map(([k, v]) => {
				const x = v as ReturnType<typeof pairedDiff>;
				return `| ${k} | ${x.n} | ${x.diff.toFixed(3)} | [${x.ci[0]?.toFixed(3)}, ${x.ci[1]?.toFixed(3)}] | ${x.discordant.aOnly} / ${x.discordant.bOnly} | ${x.mcnemarP.toPrecision(2)} |`;
			})
			.join("\n")}\n`,
	);
	console.log(JSON.stringify({ coverage, paired: Object.keys(paired).length }, null, 1));
}

void main();
