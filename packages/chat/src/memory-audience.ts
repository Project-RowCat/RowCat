import type { ChatCharacter } from "./character.ts";
import { type ChatMemory, isAutoMemory } from "./memory.ts";
import type { ChatRoom } from "./model.ts";
import { hasRestrictedScene } from "./prompt-scope.ts";
import type { ChatScene, ChatSceneAudience } from "./scene.ts";
import { orderScenes, sceneMemberNames } from "./scene.ts";
import { sceneCast } from "./scene-controls.ts";

/**
 * Who may know a memory a person wrote — its visibility, and the one place both apps' memory screens
 * read it from (`ChatMemory.audience`, `docs/chat/SCENES.md` §6).
 *
 * **Absent is unresolved, not shared.** Before scenes existed every memory reached every turn, and a
 * secret written then would reach a private scene's characters if absence were read as "everyone".
 * So a memory with no audience is unresolved:
 *
 * - in a room with no scene narrower than the room, nothing can be singled out and it is used as
 *   before (no change for anyone who never marks a scene);
 * - in a room with such a scene, it is **withheld from the request** (`prompt-scope.ts`) until the
 *   person classifies it here. It is never deleted, rewritten or hidden from the list: the screen
 *   counts it and offers the choices.
 *
 * Classifying writes an explicit audience through the ordinary update path (E2EE-synced; the merge
 * keeps a present audience over a device that never knew the field). The memory's text, id, pin and
 * provenance are untouched. Automatic memories (memory V2, historical) have no control: they never
 * reach the memory block.
 */
export type MemoryVisibility =
	/** A room without scenes: everything is shared history; there is nothing to decide. */
	| { state: "not-applicable" }
	/** No audience. `blocking` when the room has a narrower scene (then it is withheld until classified). */
	| { state: "unresolved"; blocking: boolean }
	/** Explicitly shared with every character. */
	| { state: "shared" }
	/** Only these characters (display names; refs no longer in the cast read as absent). */
	| { state: "restricted"; names: string[] }
	/** No character knows it; only a narrator perspective (narration of hidden events) may draw on it. */
	| { state: "narrator" };

export interface MemoryAudienceCast {
	room: Pick<ChatRoom, "seed" | "persona">;
	characters: readonly Pick<ChatCharacter, "id" | "name" | "deletedAt">[];
}

export function memoryVisibility(
	memory: Pick<ChatMemory, "source" | "audience">,
	scenes: readonly ChatScene[],
	cast: MemoryAudienceCast,
): MemoryVisibility {
	if (isAutoMemory(memory) || orderScenes(scenes).length === 0)
		return { state: "not-applicable" };
	const audience = memory.audience;
	if (!audience)
		return { state: "unresolved", blocking: hasRestrictedScene(scenes) };
	if (audience.kind === "room") return { state: "shared" };
	if (audience.kind === "narrator") return { state: "narrator" };
	return {
		state: "restricted",
		names: sceneMemberNames(audience.members, {
			seed: cast.room.seed,
			characters: cast.characters.filter((c) => c.deletedAt === null),
			userName:
				sceneCast(cast.room, []).find((m) => m.ref === "user")?.name ?? "",
		}),
	};
}

/** One choice the memory screen offers. The UI draws its own copy from `kind`. */
export type MemoryVisibilityOption =
	| { kind: "share"; audience: { kind: "room" } }
	| { kind: "current-scene"; audience: ChatSceneAudience; names: string[] }
	| { kind: "choose" }
	| { kind: "narrator"; audience: { kind: "narrator" } };

/**
 * The choices for one memory, in display order. Each writes an explicit audience; none rewrites
 * the text. `choose` opens a picker over `sceneCast` and writes `{ kind: "participants" }` with the
 * picked refs (`requireSceneAudience` validates it). A choice equal to the current value is not
 * offered (pressing it would write a revision that changes nothing).
 */
export function memoryVisibilityOptions(
	memory: Pick<ChatMemory, "source" | "audience">,
	scenes: readonly ChatScene[],
	cast: MemoryAudienceCast,
): MemoryVisibilityOption[] {
	const visibility = memoryVisibility(memory, scenes, cast);
	if (visibility.state === "not-applicable") return [];
	const ordered = orderScenes(scenes);
	const current = ordered[ordered.length - 1]?.audience;
	const out: MemoryVisibilityOption[] = [];
	if (visibility.state !== "shared")
		out.push({ kind: "share", audience: { kind: "room" } });
	if (
		current?.kind === "participants" &&
		!(
			memory.audience?.kind === "participants" &&
			memory.audience.members.join(",") === current.members.join(",")
		)
	)
		out.push({
			kind: "current-scene",
			audience: current,
			names: sceneMemberNames(current.members, {
				seed: cast.room.seed,
				characters: cast.characters.filter((c) => c.deletedAt === null),
				userName:
					sceneCast(cast.room, []).find((m) => m.ref === "user")?.name ?? "",
			}),
		});
	out.push({ kind: "choose" });
	if (visibility.state !== "narrator")
		out.push({ kind: "narrator", audience: { kind: "narrator" } });
	return out;
}

/**
 * How many human-written memories need classifying before they can be used in this room: those
 * with no audience, counted only when the room has a scene narrower than the room (otherwise they
 * are used and there is nothing to decide). The screen states this number and lists them first.
 */
export function unresolvedMemoryCount(
	memories: readonly Pick<ChatMemory, "source" | "audience">[],
	scenes: readonly ChatScene[],
): number {
	if (!hasRestrictedScene(scenes)) return 0;
	return memories.filter((m) => !isAutoMemory(m) && !m.audience).length;
}
