/**
 * What a turn may carry, decided once for the whole request (`docs/chat/SCENES.md` §5).
 *
 * A note asking the model to ignore text it has already read is not a boundary (and a cheap model
 * reasoned worse with one), so the boundary is the **input**: this function removes every source the
 * turn may not draw on before anything is assembled. Every path that builds a prompt goes through it —
 * the device assembler (`buildChatGenerationRequest`) and the device half of server assembly
 * (`storyChatAssemblyRequest`), so a protected room's server never receives what was withheld.
 *
 * Sources and their rule:
 *
 * - **Window messages.** In a room with scenes, the perspective of the scene in effect now
 *   (`recallPerspective`) and the admission rule recall uses (`perspectiveAdmits`): a message the
 *   present cast did not all witness is left out, and history before the first scene (`unknown`) is
 *   left out too unless the user classified it (`scene-adoption.ts`). Rooms without scenes: unchanged.
 * - **Human-written memories.** One with an `audience` is admitted by that audience. One **without**
 *   is unresolved: admitted where no character can be singled out (a room with no scene narrower
 *   than the room), withheld in a room that has one, until the user classifies it
 *   (`memory-audience.ts`). The record itself is never changed.
 * - **Automatic memories** (written by the removed memory V2) never enter the memory block. They are
 *   historical evidence the afterstate index holds, attributed as model-written, and recall may quote
 *   one only where its unknown audience is admissible (`conversation-memory.ts`).
 * - **Long-term memory** (afterstate recall and consolidated episodes) is authorized where it is
 *   produced: the bridge filters by the perspective inside the search, and the adapter checks every
 *   passage's sources against the store's own scenes again. It reaches this function already scoped.
 * - **Lore** is selected from the scoped window by the assembler, so a withheld scene's words cannot
 *   pull in its lore. Character cards, the scenario and the user note are the story's setup, shared
 *   by construction.
 *
 * There is no V2 summary in the request any more, in any room (`summary.ts`).
 *
 * Idempotent: scoping a scoped input changes nothing. Pure: no clock, no storage.
 */

import type { ChatContextMemory, ChatRuntimeMessage } from "./context.ts";
import {
	type ChatPerspective,
	type ChatScene,
	orderScenes,
	perspectiveAdmits,
	recallPerspective,
	resolveMessageAudiences,
} from "./scene.ts";

/** The parts of the assembly input this policy reads and narrows. */
export interface PromptScopeInput {
	messages: readonly ChatRuntimeMessage[];
	memories?: readonly ChatContextMemory[];
	scenes?: { scenes: readonly ChatScene[] } | null;
}

/** Counts only — what was left out, never what it said. The debugger and tests read this. */
export interface PromptScopeReport {
	/** The room has live scenes, so the scene perspective applied. */
	sceneScoped: boolean;
	withheldMessages: number;
	/** Automatic (V2) memories kept out of the memory block. */
	withheldAutoMemories: number;
	/** Human-written memories whose audience does not admit this perspective. */
	withheldUserMemories: number;
	/** Human-written memories with no audience, withheld until classified. */
	withheldUnresolvedMemories: number;
}

/** The perspective a scoped turn takes, or `null` when the room has no live scene. */
export function promptPerspective(
	scenes: PromptScopeInput["scenes"],
): ChatPerspective | null {
	const live = (scenes?.scenes ?? []).filter((s) => s.deletedAt === null);
	return live.length > 0 ? recallPerspective(live) : null;
}

/**
 * Whether the room has a live scene narrower than the room — the condition under which a memory
 * with no audience could reach a character it was not meant for.
 */
export function hasRestrictedScene(scenes: readonly ChatScene[]): boolean {
	return orderScenes(scenes).some((s) => s.audience.kind !== "room");
}

/** Where one memory stands for this turn. */
export type MemoryAdmission =
	| "admitted"
	| "auto"
	| "outside-audience"
	| "unresolved";

/**
 * Whether one memory may reach this turn, and why not. Shared by the memory block and recall (which
 * must not quote a memory the block withholds), so the two never disagree.
 */
export function memoryAdmission(
	memory: Pick<ChatContextMemory, "source" | "audience">,
	context: { perspective: ChatPerspective | null; restricted: boolean },
): MemoryAdmission {
	if (memory.source === "auto") return "auto";
	if (!context.perspective) return "admitted";
	if (!memory.audience) return context.restricted ? "unresolved" : "admitted";
	return perspectiveAdmits(context.perspective, memory.audience)
		? "admitted"
		: "outside-audience";
}

export const memoryAdmitted = (
	memory: Pick<ChatContextMemory, "source" | "audience">,
	context: { perspective: ChatPerspective | null; restricted: boolean },
): boolean => memoryAdmission(memory, context) === "admitted";

/** The admission context of a room's scenes (computed once per turn). */
export function admissionContext(scenes: readonly ChatScene[] | undefined): {
	perspective: ChatPerspective | null;
	restricted: boolean;
} {
	const live = (scenes ?? []).filter((s) => s.deletedAt === null);
	return {
		perspective: live.length > 0 ? recallPerspective(live) : null,
		restricted: hasRestrictedScene(live),
	};
}

export function scopePromptInput<T extends PromptScopeInput>(
	input: T,
): { input: T; report: PromptScopeReport } {
	const live = (input.scenes?.scenes ?? []).filter((s) => s.deletedAt === null);
	const context = admissionContext(live);
	const { perspective } = context;
	const report: PromptScopeReport = {
		sceneScoped: perspective !== null,
		withheldMessages: 0,
		withheldAutoMemories: 0,
		withheldUserMemories: 0,
		withheldUnresolvedMemories: 0,
	};

	let messages = input.messages;
	if (perspective) {
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
		const admission = memoryAdmission(memory, context);
		if (admission === "auto") report.withheldAutoMemories++;
		else if (admission === "outside-audience") report.withheldUserMemories++;
		else if (admission === "unresolved") report.withheldUnresolvedMemories++;
		return admission === "admitted";
	});

	const unchanged =
		messages === input.messages &&
		memories.length === (input.memories ?? []).length;
	if (unchanged) return { input, report };
	const scoped = { ...input, messages };
	if (input.memories !== undefined) scoped.memories = memories;
	return { input: scoped, report };
}
