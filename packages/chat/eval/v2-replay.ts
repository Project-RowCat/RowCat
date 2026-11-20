/**
 * Replays RowCat memory V2's background maintenance over the Phase 11 scenario, with a real model,
 * so the A/B can compare against V2 **with** its rolling summary and auto-memories.
 *
 * The maintenance itself is RowCat's: `runMemoryMaintenance` (batch selection, the request from
 * `buildMemoryMaintenanceRequest`, `parseMaintenanceResult`, `planMemoryMaintenance`), the commit
 * rules of the local stores (`maintenanceStillApplies`; add/replace/remove on auto memories only),
 * and the history-rewrite rule (`planMaintenanceRewind`, applied for each deleted message as a
 * single-message delete does). Timeline: messages are written in transcript order; maintenance is
 * attempted after every reply, as the apps do after a turn; the transcript's deletions happen after
 * their session; the planted edits happen as soon as the line is written (V2 never sees the old
 * wording), so the replay does not charge V2 for a late edit.
 *
 * Model calls go to `afterstate-eval proxy` (loopback, budget ledger, response cache), never to a
 * provider directly; the proxy decides the model. No user data: the transcript is synthetic.
 *
 *   tsx eval/v2-replay.ts --transcript FILE --proxy http://127.0.0.1:8282 --out v2-state.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { ChatGenerationRequest } from "@rowcat/contracts/chat";
import { type ChatMemory, createMemoryRecord } from "../src/memory.ts";
import {
	type ChatMaintenancePlan,
	maintenanceStillApplies,
	nextSummaryEpoch,
	planMaintenanceRewind,
} from "../src/memory-maintenance.ts";
import { runMemoryMaintenance } from "../src/maintenance-runner.ts";
import type { ChatMessage } from "../src/model.ts";
import { type ChatSummary, createSummaryRecord } from "../src/summary.ts";
import { loadScenario, type Transcript } from "./scenario.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2)
	args.set(process.argv[i] ?? "", process.argv[i + 1] ?? "");
const transcriptPath = args.get("--transcript");
const outPath = args.get("--out");
const proxy = args.get("--proxy") ?? "http://127.0.0.1:8282";
if (!transcriptPath || !outPath) {
	console.error("usage: v2-replay.ts --transcript FILE --out FILE [--proxy URL]");
	process.exit(2);
}
const base = JSON.parse(readFileSync(transcriptPath, "utf8")) as Transcript;
const S = loadScenario(base);

let messages: ChatMessage[] = [];
let summary: ChatSummary | null = null;
let memories: ChatMemory[] = [];
let rev = 1;
let ids = 0;
const stamp = (now: string) => ({ now, rev: { t: rev++, c: 0, d: "replay" } });

const log = {
	attempts: 0,
	applied: 0,
	skipped: 0,
	failed: {} as Record<string, number>,
	requests: 0,
	inputChars: 0,
	outputChars: 0,
	rewinds: 0,
	summaryResets: 0,
	autoMemoriesRemovedByRewind: 0,
};

async function requestMaintenance(request: ChatGenerationRequest): Promise<string> {
	log.requests++;
	const body = {
		model: "rowcat-maintenance",
		system: request.system,
		messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
		max_tokens: request.maxOutputTokens,
	};
	log.inputChars += request.system.length + request.messages.reduce((n, m) => n + m.content.length, 0);
	const response = await fetch(`${proxy}/v1/messages`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!response.ok) throw new Error(`proxy ${response.status}: ${(await response.text()).slice(0, 200)}`);
	const json = (await response.json()) as { content: { type: string; text?: string }[] };
	const text = json.content
		.filter((b) => b.type === "text")
		.map((b) => b.text ?? "")
		.join("");
	log.outputChars += text.length;
	return text;
}

function commit(plan: ChatMaintenancePlan, now: string): boolean {
	if (!maintenanceStillApplies(plan, summary)) return false;
	for (const op of plan.operations) {
		if (op.type === "add") {
			memories.push(
				createMemoryRecord(
					{ roomId: S.ROOM, content: op.content, source: "auto", originAt: plan.through.createdAt },
					{ id: `auto-${ids++}`, ...stamp(now) },
				),
			);
			continue;
		}
		const target = memories.find((m) => m.id === op.memoryId);
		if (!target || target.source !== "auto") continue;
		if (op.type === "remove") memories = memories.filter((m) => m !== target);
		else target.content = op.content;
	}
	summary = {
		...(summary ?? createSummaryRecord({ roomId: S.ROOM, summary: "", frontier: null }, stamp(now))),
		summary: plan.summary,
		frontier: plan.through,
		epoch: summary?.epoch ?? 0,
	};
	return true;
}

/** A single-message delete: the store removes the message and rewinds maintenance past it. */
function deleteMessage(id: string, now: string) {
	const target = messages.find((m) => m.id === id);
	if (!target) return;
	messages = messages.filter((m) => m !== target);
	const rewind = planMaintenanceRewind({ summary, memories, cutoffCreatedAt: target.createdAt });
	if (!rewind.resetSummary && rewind.staleMemoryIds.length === 0) return;
	log.rewinds++;
	if (rewind.resetSummary) {
		log.summaryResets++;
		const epoch = nextSummaryEpoch(summary);
		summary = {
			...(summary ?? createSummaryRecord({ roomId: S.ROOM, summary: "", frontier: null }, stamp(now))),
			summary: "",
			frontier: null,
			epoch,
		};
	}
	const stale = new Set(rewind.staleMemoryIds);
	log.autoMemoriesRemovedByRewind += stale.size;
	memories = memories.filter((m) => !stale.has(m.id));
}

async function maintain(now: string) {
	log.attempts++;
	const outcome = await runMemoryMaintenance({
		isValid: () => true,
		loadMessages: async () => messages.map(({ id, role, speaker, content, createdAt }) => ({ id, role, speaker, content, createdAt })),
		loadSummary: async () => summary,
		loadMemories: async () => [...memories],
		requestMaintenance: (request) => requestMaintenance(request),
		commit: async (plan) => commit(plan, now),
	} as Parameters<typeof runMemoryMaintenance>[0]);
	if (outcome.status === "applied") log.applied++;
	else if (outcome.status === "skipped") log.skipped++;
	else log.failed[outcome.reason] = (log.failed[outcome.reason] ?? 0) + 1;
}

async function main() {
	const deletions = new Map<string, string[]>();
	for (const d of base.deletions) deletions.set(d.after_session, [...(deletions.get(d.after_session) ?? []), ...d.turns]);
	for (let i = 0; i < S.turns.length; i++) {
		const t = S.turns[i];
		if (!t) continue;
		const message = S.toMessage(t, S.edits.get(t.id) ?? t.text);
		messages.push(message);
		if (message.role === "assistant") await maintain(t.at);
		const next = S.turns[i + 1];
		if (!next || next.session !== t.session)
			for (const id of deletions.get(t.session) ?? []) deleteMessage(id, t.at);
		if ((i + 1) % 100 === 0) console.error(`[replay] ${i + 1}/${S.turns.length} turns, ${log.requests} requests`);
	}
	const state = {
		format: "rowcat-v2-replay/1",
		synthetic: true,
		summary: summary ? { text: summary.summary, frontier: summary.frontier, epoch: summary.epoch } : null,
		autoMemories: memories.map((m) => ({ id: m.id, content: m.content, originAt: m.originAt })),
		messagesAtEnd: messages.length,
		log,
	};
	writeFileSync(outPath as string, `${JSON.stringify(state, null, 1)}\n`);
	console.log(JSON.stringify({ ...state, autoMemories: state.autoMemories.length, summary: state.summary?.text.length }, null, 1));
}

void main();
