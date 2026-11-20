/**
 * RowCat memory V2 vs the afterstate index: a paired A/B through RowCat's own assembler.
 *
 * Every arm builds the request a turn would send with `buildChatGenerationRequest` — the single
 * assembler web and mobile use — from the same room, the same messages, the same memory records,
 * the same probe question and the same clock. The arms differ only in what the memory backend adds:
 *
 *   A  memory V2 as shipped: the history window (`chatHistoryWindow`), the memory block, no recall.
 *   B  A, with the history window extended by older messages up to the recall budget
 *      (`CHAT_RECALL_CONTEXT_CHAR_BUDGET`), so C's extra characters are matched (isolates budget).
 *   C  A plus afterstate recall exactly as the apps run it: indexed with `reconcileConversation`,
 *      recalled with `recallForTurn` (lexical per layer + RRF; the bridge's only retrieval mode).
 *
 * D (hybrid), E (cognitive recall) and F (reranking) are not available through the RowCat
 * integration (the embedded bridge is lexical) and are not run; the report says so.
 *
 * No model is called. Metrics are retrieval-level: is the planted text in the request. V2's rolling
 * summary and auto-memories are produced by a model in production and cannot be produced here, so
 * arm A is V2 **without** its model-derived records — a lower bound for V2.
 *
 *   pnpm exec tsx eval/memory-ab.ts --transcript <phase10 transcript.synthetic.json> --out <dir>
 *
 * Synthetic data. Not evidence of RowCat production quality.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnAfterstate } from "../src/afterstate-stdio.test.helper.ts";
import { buildChatGenerationRequest } from "../src/context.ts";
import {
	type AfterstatePort,
	CHAT_RECALL_CONTEXT_CHAR_BUDGET,
	type ChatRecallSnapshot,
	type ConversationMemorySource,
	recallForTurn,
	recallRequestFor,
	reconcileConversation,
} from "../src/conversation-memory.ts";
import { chatHistoryWindow } from "../src/history-window.ts";
import type { ChatMemory } from "../src/memory.ts";
import type { ChatMessage } from "../src/model.ts";
import { loadScenario, type Probe, type Transcript } from "./scenario.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2)
	args.set(process.argv[i] ?? "", process.argv[i + 1] ?? "");
const transcriptPath = args.get("--transcript");
const outDir = args.get("--out");
if (!transcriptPath || !outDir) {
	console.error("usage: memory-ab.ts --transcript FILE --out DIR [--seed N]");
	process.exit(2);
}
const SEED = Number(args.get("--seed") ?? 20261121);
/** Optional: V2's own summary and auto-memories from `v2-replay.ts` (adds the `+V2` arms). */
const v2StatePath = args.get("--v2-state");
/** Optional: write the M1 requests of A, C*, A+V2, C*+V2 for an answer stage (JSONL). */
const dumpPath = args.get("--dump-contexts");
const base = JSON.parse(readFileSync(transcriptPath, "utf8")) as Transcript;
const {
	turns,
	items,
	probes,
	deleted,
	edits,
	ROOM,
	room,
	toMessage,
	original,
	live,
	notesM0,
	notesM1,
	planted,
} = loadScenario(base);
// ── Measurement helpers ──────────────────────────────────────────────────────────────────────────

const strings = (v: unknown, out: string[] = []): string[] => {
	if (typeof v === "string") out.push(v);
	else if (Array.isArray(v)) for (const x of v) strings(x, out);
	else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, out);
	return out;
};
/** The request's prose: the message contents (system, history, recall), not routing metadata. */
const requestText = (req: unknown): string => {
	const r = req as { messages?: unknown; system?: unknown };
	return strings([r.system ?? "", r.messages ?? req]).join("\n");
};
const has = (text: string, item: string) => {
	const needles = items[item]?.needles ?? [];
	return needles.length > 0 && needles.every((n) => text.toLowerCase().includes(n.toLowerCase()));
};
/** Phase 10's estimator: characters / 4, rounded up. */
const tokens = (text: string) => Math.ceil(text.length / 4);
const pct = (xs: number[], q: number) => {
	const s = [...xs].sort((a, b) => a - b);
	return s.length ? (s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0) : 0;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Seeded PRNG (mulberry32) for the bootstrap. */
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

/** Paired difference with a cluster bootstrap: probes about the same planted item resample together. */
function pairedDiff(pairs: { cluster: string; a: number; b: number }[], seed: number) {
	const clusters = new Map<string, { a: number; b: number }[]>();
	for (const p of pairs) {
		const list = clusters.get(p.cluster) ?? [];
		list.push(p);
		clusters.set(p.cluster, list);
	}
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
	// Exact McNemar (two-sided binomial on discordant pairs).
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
	const p = n === 0 ? 1 : Math.min(1, (2 * tail) / 2 ** n);
	return {
		n: pairs.length,
		clusters: keys.length,
		diff: diff(keys),
		ci: [pct(boots, 0.025), pct(boots, 0.975)],
		discordant: { aOnly: aWins, bOnly: bWins },
		mcnemarP: p,
	};
}

/** Knowledge-boundary probes of Phase 10: a RowCat room has no private scenes (the user saw all). */
const BOUNDARY_KINDS = new Set(["boundary_leak", "secret_leak", "belief"]);
/** Probes about the same planted items form one group: they are resampled together. */
const clusterOf = (p: Probe) => [...p.gold, ...p.forbidden].sort().join("+") || p.id;
/** Seeded split by group: recall variants are chosen on `dev`, reported on `heldout`. */
const splitOf = (p: Probe): "dev" | "heldout" =>
	(createHash("sha256").update(`${SEED}:${clusterOf(p)}`).digest()[0] ?? 0) % 2 === 0 ? "dev" : "heldout";

// ── Run ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Arms. `C` is the integration as first committed (rank fusion, the user's words plus the tail of
 * the reply they answer). The `C-*` variants change one thing each: the bridge's cross-layer
 * fusion (`coverage`), the query (`user`: the user's words only; `short`: the reply tail only when
 * the user's words are fewer than four).
 */
type QueryMode = "tail" | "user" | "short" | "product";
interface ArmSpec {
	arm: string;
	/** `fusion: "default"` sends none (the bridge's default); `query: "product"` is `recallRequestFor`'s. */
	recall?: { fusion: "rank" | "coverage" | "default"; query: QueryMode };
	/** With V2's model-written summary (and its frontier-based window) and auto-memories. */
	v2?: boolean;
	extended?: boolean;
}
const ARMS: ArmSpec[] = [
	{ arm: "A" },
	{ arm: "B", extended: true },
	{ arm: "C", recall: { fusion: "rank", query: "tail" } },
	{ arm: "C-cov", recall: { fusion: "coverage", query: "tail" } },
	{ arm: "C-user", recall: { fusion: "rank", query: "user" } },
	{ arm: "C-cov-user", recall: { fusion: "coverage", query: "user" } },
	{ arm: "C-cov-short", recall: { fusion: "coverage", query: "short" } },
	{ arm: "C*", recall: { fusion: "default", query: "product" } },
	{ arm: "A+V2", v2: true },
	{ arm: "C*+V2", v2: true, recall: { fusion: "default", query: "product" } },
];
const DUMPED = new Set(["A", "C*", "A+V2", "C*+V2"]);

interface V2State {
	summary: { text: string; frontier: { createdAt: string; messageId: string } | null } | null;
	autoMemories: { id: string; content: string; originAt: string | null }[];
}
const v2: V2State | null = v2StatePath ? (JSON.parse(readFileSync(v2StatePath, "utf8")) as V2State) : null;
const ACTIVE = ARMS.filter((a) => !a.v2 || v2 !== null);
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

/** The request as the answer stage reads it: roles in order, the probe question taken out. */
function renderForAnswer(request: { system: string; messages: { role: string; content: string }[] }, question: string) {
	const parts = [`[system]\n${request.system}`];
	for (const m of request.messages) {
		const content = m.content.split(question).join("").trim();
		if (content) parts.push(`[${m.role}]\n${content}`);
	}
	return parts.join("\n\n");
}

/** The query of the first commit: the user's words plus the last 300 characters of the reply. */
function tailQuery(history: readonly Pick<ChatMessage, "role" | "content">[]): string {
	const lastUser = [...history].reverse().find((m) => m.role === "user")?.content.trim() ?? "";
	const lastAssistant = [...history].reverse().find((m) => m.role === "assistant")?.content ?? "";
	return [lastUser.slice(0, 1_200), lastAssistant.trim().slice(-300)].filter(Boolean).join("\n");
}

interface Row {
	probe: string;
	kind: string;
	cluster: string;
	split: "dev" | "heldout";
	memory: "M0" | "M1";
	arm: string;
	gold: boolean | null;
	forbidden: boolean | null;
	current: boolean | null;
	stale: boolean | null;
	rank: number | null;
	recalled: number;
	chars: number;
	tokens: number;
	assembleMs: number;
	recallMs: number;
}

async function main() {
	const dir = mkdtempSync(join(tmpdir(), "rowcat-ab-"));
	const port = await spawnAfterstate({ store: { user: { dir, user: "eval-member" } } });
	const pid = port.pid;
	const rss = () => {
		try {
			return Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)]).toString().trim()) * 1024;
		} catch {
			return null;
		}
	};
	const rssStart = rss();

	// Index the room as the apps do: a migration preview, then everything ever written, then the store
	// as it is now (deleted scenes and edited lines reconciled away), then a no-op pass.
	const sourceOf = (messages: ChatMessage[], memories: ChatMemory[]): ConversationMemorySource => ({
		listAllMessages: async () => messages,
		listMemories: async () => memories,
	});
	const timed = async <T>(f: () => Promise<T>): Promise<[T, number]> => {
		const t0 = performance.now();
		const v = await f();
		return [v, performance.now() - t0];
	};
	const opts = { maxItems: 100_000 };
	const [preview, previewMs] = await timed(() =>
		reconcileConversation(port, sourceOf(original, notesM1), ROOM, { ...opts, dryRun: true }),
	);
	const [first, initialMs] = await timed(() => reconcileConversation(port, sourceOf(original, notesM1), ROOM, opts));
	const [second, reconcileMs] = await timed(() => reconcileConversation(port, sourceOf(live, notesM1), ROOM, opts));
	const [third, noopMs] = await timed(() => reconcileConversation(port, sourceOf(live, notesM1), ROOM, opts));
	await port.call("checkpoint", {});
	// The +V2 arms read an index that also holds V2's auto-memories (as the apps would index them).
	const portV2 = v2 ? await spawnAfterstate() : null;
	if (portV2) await reconcileConversation(portV2, sourceOf(live, [...notesM1, ...autoMemories]), ROOM, opts);
	const rssIndexed = rss();
	const dbBytes = readdirSync(dir).reduce((s, f) => s + statSync(join(dir, f)).size, 0);

	// Erasure on disk: no deleted or pre-edit line may remain in the store files, unless the very same
	// line is still live elsewhere (the generator repeats filler lines).
	const liveText = new Set(live.map((m) => m.content));
	const erasedTexts = [...deleted, ...edits.keys()]
		.map((id) => turns.find((t) => t.id === id)?.text ?? "")
		.filter((text) => text && !liveText.has(text));
	const fileBytes = Buffer.concat(readdirSync(dir).map((f) => readFileSync(join(dir, f))));
	const residue = erasedTexts.filter((text) => fileBytes.includes(Buffer.from(text, "utf8"))).length;

	// Engine evidence before selection, for Recall@k; the fusion each arm asks for.
	let lastEvidence: { text: string }[] = [];
	const portWith = (fusion: "rank" | "coverage" | "default", target: AfterstatePort = port): AfterstatePort => ({
		call: async <T>(op: Parameters<AfterstatePort["call"]>[0], params: object) => {
			const r = await target.call<T>(op, op === "recall" && fusion !== "default" ? { ...params, fusion } : params);
			if (op === "recall") lastEvidence = (r as { evidence: { text: string }[] }).evidence;
			return r;
		},
	});

	const window = chatHistoryWindow(live, null);
	const windowStart = live.length - window.length;
	// B: the window plus older messages up to the recall budget, newest first.
	let extra = 0;
	let bStart = windowStart;
	while (bStart > 0) {
		const m = live[bStart - 1];
		if (!m || extra + m.content.length > CHAT_RECALL_CONTEXT_CHAR_BUDGET) break;
		extra += m.content.length;
		bStart--;
	}
	const windowB = live.slice(bStart);
	const windowV2 = chatHistoryWindow(live, v2?.summary?.frontier ?? null);
	const dumped: { arm: string; probe: string; context: string; tokens: number }[] = [];

	const rows: Row[] = [];
	const digests = new Map<string, ReturnType<typeof createHash>>();
	const asked = (q: string): ChatMessage =>
		toMessage({ id: "probe", session: "now", at: base.now, speaker: "Rowan", role: "user", channel: "scene", text: q });

	for (const memoryCondition of ["M0", "M1"] as const) {
		const notes = memoryCondition === "M0" ? notesM0 : notesM1;
		for (const p of probes) {
			const q = asked(p.query);
			for (const spec of ACTIVE) {
				const memories = spec.v2 ? [...notes, ...autoMemories] : notes;
				const history = [...(spec.v2 ? windowV2 : spec.extended ? windowB : window), q];
				let recall: ChatRecallSnapshot | null = null;
				let recallMs = 0;
				lastEvidence = [];
				if (spec.recall) {
					const req = recallRequestFor(history, memories);
					const words = p.query.trim().split(/\s+/).length;
					const mode = spec.recall.query;
					const query =
						mode === "product"
							? req.query
							: mode === "tail" || (mode === "short" && words < 4)
								? tailQuery(history)
								: p.query;
					const r0 = performance.now();
					recall = await recallForTurn(portWith(spec.recall.fusion, spec.v2 && portV2 ? portV2 : port), {
						roomId: ROOM,
						query,
						windowLength: req.windowLength,
						messages: [...live, q],
						memories,
						memoryIdsInContext: req.memoryIdsInContext,
					});
					recallMs = performance.now() - r0;
				}
				const a0 = performance.now();
				const request = buildChatGenerationRequest({
					room,
					messages: history,
					memories,
					allAges: true,
					...(spec.v2 && v2?.summary?.text ? { summary: v2.summary.text } : {}),
					...(recall ? { recall } : {}),
				});
				if (memoryCondition === "M1" && DUMPED.has(spec.arm)) {
					const context = renderForAnswer(request, p.query);
					dumped.push({ arm: spec.arm, probe: p.id, context, tokens: tokens(context) });
				}
				const assembleMs = performance.now() - a0;
				const full = requestText(request);
				const text = full.split(p.query).join(" ");
				const key = `${memoryCondition}/${spec.arm}`;
				const h = digests.get(key) ?? createHash("sha256");
				h.update(full);
				digests.set(key, h);
				const firstGoldRank = lastEvidence.findIndex((e) => p.gold.some((g) => has(e.text, g)));
				rows.push({
					probe: p.id,
					kind: p.kind,
					cluster: clusterOf(p),
					split: splitOf(p),
					memory: memoryCondition,
					arm: spec.arm,
					gold: p.gold.length ? p.gold.every((g) => has(text, g)) : null,
					forbidden: p.forbidden.length ? p.forbidden.some((f) => has(text, f)) : null,
					current: p.timeline ? has(text, p.timeline.current) : null,
					stale: p.timeline ? has(text, p.timeline.superseded) : null,
					rank: spec.recall && p.gold.length ? (firstGoldRank >= 0 ? firstGoldRank + 1 : null) : null,
					recalled: recall?.passages.length ?? 0,
					chars: full.length,
					tokens: tokens(full),
					assembleMs,
					recallMs,
				});
			}
		}
	}
	const rssEnd = rss();
	await port.close();
	await (portV2 as { close?: () => Promise<void> } | null)?.close?.();
	if (dumpPath) {
		writeFileSync(dumpPath, `${dumped.map((d) => JSON.stringify(d)).join("\n")}\n`);
		writeFileSync(
			`${dumpPath}.probes.json`,
			`${JSON.stringify(
				{
					synthetic: true,
					characters: base.characters,
					turns: turns.filter((t) => !deleted.has(t.id)).map((t) => ({ ...t, text: edits.get(t.id) ?? t.text })),
					probes: probes.map((p) => ({
						...p,
						goldNeedles: p.gold.flatMap((g) => items[g]?.needles ?? []),
						forbiddenNeedles: p.forbidden.flatMap((f) => items[f]?.needles ?? []),
					})),
				},
				null,
				1,
			)}\n`,
		);
	}
	rmSync(dir, { recursive: true, force: true });

	// ── Aggregate ────────────────────────────────────────────────────────────────────────────────
	const SPLITS = ["all", "dev", "heldout"] as const;
	const sel = (split: string, m: string, arm: string, f: (r: Row) => boolean = () => true) =>
		rows.filter((r) => (split === "all" || r.split === split) && r.memory === m && r.arm === arm && f(r));
	const rate = (rs: Row[], k: keyof Row) => {
		const v = rs.map((r) => r[k]).filter((x): x is boolean => typeof x === "boolean");
		return v.length ? { rate: mean(v.map(Number)), n: v.length } : { rate: null, n: 0 };
	};
	const notBoundary = (r: Row) => !BOUNDARY_KINDS.has(r.kind);
	const summary: Record<string, unknown> = {};
	for (const split of SPLITS)
		for (const m of ["M0", "M1"])
			for (const { arm, recall } of ACTIVE) {
				const rs = sel(split, m, arm, notBoundary);
				const ranked = rs.filter((r) => r.gold !== null);
				summary[`${split}/${m}/${arm}`] = {
					gold: rate(rs, "gold"),
					recallAt5: recall ? mean(ranked.map((r) => (r.rank !== null && r.rank <= 5 ? 1 : 0))) : null,
					recallAt10: recall ? mean(ranked.map((r) => (r.rank !== null && r.rank <= 10 ? 1 : 0))) : null,
					forbidden: rate(rs, "forbidden"),
					current: rate(rs, "current"),
					stale: rate(rs, "stale"),
					tokensMean: mean(rs.map((r) => r.tokens)),
					tokensP95: pct(
						rs.map((r) => r.tokens),
						0.95,
					),
					recalledMean: mean(rs.map((r) => r.recalled)),
					assembleP50: pct(
						rs.map((r) => r.assembleMs),
						0.5,
					),
					assembleP95: pct(
						rs.map((r) => r.assembleMs),
						0.95,
					),
					recallP50: pct(
						rs.map((r) => r.recallMs),
						0.5,
					),
					recallP95: pct(
						rs.map((r) => r.recallMs),
						0.95,
					),
					recallP99: pct(
						rs.map((r) => r.recallMs),
						0.99,
					),
				};
			}
	const kinds = [...new Set(probes.map((p) => p.kind))].sort();
	const byKind: Record<string, Record<string, unknown>> = {};
	for (const k of kinds) {
		const entry: Record<string, unknown> = {};
		for (const m of ["M0", "M1"])
			for (const { arm } of ACTIVE) {
				const rs = sel("all", m, arm, (r) => r.kind === k);
				entry[`${m}/${arm}`] = { gold: rate(rs, "gold"), forbidden: rate(rs, "forbidden"), stale: rate(rs, "stale") };
			}
		byKind[k] = entry;
	}
	const paired: Record<string, unknown> = {};
	let s = SEED;
	const comparisons: [string, string][] = [
		["A", "B"],
		["A", "C"],
		["B", "C"],
		...(v2 ? ([["A", "A+V2"], ["A+V2", "C*+V2"], ["C*", "C*+V2"]] as [string, string][]) : []),
		...ARMS.filter((a) => a.arm.startsWith("C-")).flatMap((a): [string, string][] => [
			["A", a.arm],
			["C", a.arm],
		]),
	];
	for (const split of SPLITS)
		for (const m of ["M0", "M1"])
			for (const [x, y] of comparisons) {
				const xs = sel(split, m, x, notBoundary).filter((r) => r.gold !== null);
				const ys = new Map(sel(split, m, y, notBoundary).map((r) => [r.probe, r]));
				paired[`${split}/${m}: ${y} - ${x}`] = pairedDiff(
					xs.map((r) => ({ cluster: r.cluster, a: Number(r.gold), b: Number(ys.get(r.probe)?.gold) })),
					s++,
				);
			}

	const result = {
		format: "rowcat-memory-ab/1",
		synthetic: true,
		transcript: { format: base.format, generator: base.generator, seed: base.seed, now: base.now },
		seed: SEED,
		arms: ACTIVE,
		v2: v2 ? { summaryChars: v2.summary?.text.length ?? 0, frontier: v2.summary?.frontier ?? null, autoMemories: autoMemories.length, windowV2: windowV2.length } : null,
		corpus: {
			messagesWritten: original.length,
			messagesLive: live.length,
			deleted: deleted.size,
			edited: edits.size,
			userNotes: { M0: notesM0.length, M1: notesM1.length },
			probes: probes.length,
			phase11Probes: planted.probes.length,
			boundaryProbesExcluded: probes.filter((p) => BOUNDARY_KINDS.has(p.kind)).length,
			split: {
				dev: probes.filter((p) => splitOf(p) === "dev" && !BOUNDARY_KINDS.has(p.kind)).length,
				heldout: probes.filter((p) => splitOf(p) === "heldout" && !BOUNDARY_KINDS.has(p.kind)).length,
			},
			window: { A: window.length, B: windowB.length, bExtraChars: extra },
		},
		index: {
			migrationDryRun: { ms: previewMs, wouldIngest: preview.messages.missing + preview.notes.missing },
			initial: { ms: initialMs, messages: first.messages, notes: first.notes },
			afterDeletesAndEdits: { ms: reconcileMs, messages: second.messages },
			noop: { ms: noopMs, messages: third.messages },
			dbBytes,
			erasedTextsChecked: erasedTexts.length,
			erasedResidueOnDisk: residue,
			bridgeRss: { start: rssStart, indexed: rssIndexed, end: rssEnd },
		},
		summary,
		byKind,
		paired,
		digests: Object.fromEntries([...digests].map(([k, h]) => [k, h.digest("hex")])),
		rows,
	};
	mkdirSync(outDir as string, { recursive: true });
	writeFileSync(join(outDir as string, "results.json"), `${JSON.stringify(result, null, 1)}\n`);
	console.log(JSON.stringify({ corpus: result.corpus, index: result.index }, null, 1));
}

void main();
