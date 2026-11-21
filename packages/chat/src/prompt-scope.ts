/**
 * What a turn may carry, decided once for the whole request (`docs/chat/SCENES.md` §5).
 *
 * Phase 12 filtered the afterstate recall block by who witnessed what, but the rest of the request
 * still carried what the present characters never saw: window messages from a private scene (with
 * only a note saying "these characters do not know this"), memory V2's summary and its extracted
 * memories (built over the whole room), and user-written memories. A note asking the model to
 * ignore text it has already read is not a boundary, and a cheap model reasoned worse with it.
 *
 * So the boundary is the input, not the wording: this function removes every source the turn may
 * not draw on **before** anything is assembled. Every path that builds a prompt goes through it —
 * the device assembler (`buildChatGenerationRequest`) and the device half of server assembly
 * (`storyChatAssemblyRequest`), so a protected room's server never receives what was withheld.
 *
 * - **Rooms without scenes are untouched** (unless afterstate owns memory, below). Memory V2's
 *   semantics — everything is shared history — still hold there, and the request is byte-identical.
 * - **Rooms with scenes** take the perspective of the scene in effect now (`recallPerspective`) and
 *   apply the same admission rule recall uses (`perspectiveAdmits`) to:
 *   - window messages — a message the present cast did not all witness is left out, and history
 *     from before the first scene is `unknown` and left out too (fail closed; the user can declare
 *     earlier history shared by starting a `room` scene at the first message);
 *   - user-written memories — one with an `audience` is admitted by that audience; one without is
 *     shared (the compatibility policy: before this field existed every memory reached every turn,
 *     and the user wrote it to be used);
 *   - the V2 summary and auto-extracted memories — always left out: they were made over the whole
 *     room and carry no record of who saw what, so no rule can admit part of them.
 * - **afterstate-owned memory** (`memoryOwner: "afterstate"`) leaves out the V2 summary and
 *   auto-extracted memories in every room: afterstate's recall replaces them, and its maintenance
 *   no longer runs (`conversationMemoryHooks`). The records stay in storage for rollback.
 *
 * Idempotent: scoping a scoped input changes nothing. Pure: no clock, no storage.
 */

import type { ChatContextMemory, ChatRuntimeMessage } from "./context.ts";
import {
	type ChatPerspective,
	type ChatScene,
	perspectiveAdmits,
	recallPerspective,
	resolveMessageAudiences,
} from "./scene.ts";

/** Who maintains long-term memory for a conversation (`conversation-memory.ts`). */
export type ChatMemoryOwner = "v2" | "afterstate";

/** The parts of the assembly input this policy reads and narrows. */
export interface PromptScopeInput {
	messages: readonly ChatRuntimeMessage[];
	memories?: readonly ChatContextMemory[];
	summary?: string;
	scenes?: { scenes: readonly ChatScene[] } | null;
	memoryOwner?: ChatMemoryOwner;
}

/** Counts only — what was left out, never what it said. The debugger and tests read this. */
export interface PromptScopeReport {
	/** The room has live scenes, so the scene perspective applied. */
	sceneScoped: boolean;
	owner: ChatMemoryOwner;
	withheldMessages: number;
	withheldSummary: boolean;
	withheldAutoMemories: number;
	withheldUserMemories: number;
}

/** The perspective a scoped turn takes, or `null` when the room has no live scene. */
export function promptPerspective(
	scenes: PromptScopeInput["scenes"],
): ChatPerspective | null {
	const live = (scenes?.scenes ?? []).filter((s) => s.deletedAt === null);
	return live.length > 0 ? recallPerspective(live) : null;
}

/**
 * Whether one memory may reach this turn. Shared by the memory block and the recall request (which
 * must know which memories the block carries), so the two never disagree.
 */
export function memoryAdmitted(
	memory: Pick<ChatContextMemory, "source" | "audience">,
	context: {
		perspective: ChatPerspective | null;
		owner: ChatMemoryOwner;
	},
): boolean {
	if (memory.source === "auto")
		return context.owner === "v2" && context.perspective === null;
	if (!memory.audience || !context.perspective) return true;
	return perspectiveAdmits(context.perspective, memory.audience);
}

export function scopePromptInput<T extends PromptScopeInput>(
	input: T,
): { input: T; report: PromptScopeReport } {
	const owner = input.memoryOwner ?? "v2";
	const perspective = promptPerspective(input.scenes);
	const report: PromptScopeReport = {
		sceneScoped: perspective !== null,
		owner,
		withheldMessages: 0,
		withheldSummary: false,
		withheldAutoMemories: 0,
		withheldUserMemories: 0,
	};
	if (!perspective && owner === "v2") return { input, report };

	let messages = input.messages;
	if (perspective) {
		const live = (input.scenes?.scenes ?? []).filter(
			(s) => s.deletedAt === null,
		);
		const placed = input.messages.filter(
			(m): m is ChatRuntimeMessage & { id: string; createdAt: string } =>
				!!m.id && !!m.createdAt,
		);
		const audiences = resolveMessageAudiences(placed, live);
		messages = input.messages.filter((m) => {
			/**
			 * A message with no stored position cannot belong to a scene; only non-persisted conversations
			 * (playtests, replays) send those, and they have no scenes.
			 */
			const audience = m.id ? audiences.get(m.id) : undefined;
			return !audience || perspectiveAdmits(perspective, audience);
		});
		report.withheldMessages = input.messages.length - messages.length;
	}

	const memories = (input.memories ?? []).filter((memory) => {
		const admitted = memoryAdmitted(memory, { perspective, owner });
		if (!admitted) {
			if (memory.source === "auto") report.withheldAutoMemories++;
			else report.withheldUserMemories++;
		}
		return admitted;
	});

	const dropSummary = perspective !== null || owner === "afterstate";
	report.withheldSummary = dropSummary && !!input.summary?.trim();

	const scoped = { ...input, messages };
	if (input.memories !== undefined) scoped.memories = memories;
	if (dropSummary) delete scoped.summary;
	return { input: scoped, report };
}
