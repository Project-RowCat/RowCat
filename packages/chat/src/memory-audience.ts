import type { ChatCharacter } from "./character.ts";
import { type ChatMemory, isAutoMemory } from "./memory.ts";
import type { ChatRoom } from "./model.ts";
import { effectiveChatUserName } from "./persona.ts";
import {
	type ChatScene,
	type ChatSceneAudience,
	orderScenes,
	sceneMemberNames,
} from "./scene.ts";

/**
 * Which audience control one memory row draws (`ChatMemory.audience`, `docs/chat/SCENES.md`).
 *
 * The rules this reads all live in `@rowcat/chat` (`orderScenes`, `sceneMemberNames`); what this
 * decides is only which of three things a row shows. Both apps' memory panels call this one
 * function, so the same memory never offers different controls on web and mobile.
 *
 * - **Nothing** in a room without a live scene (everything is shared history there, and a control
 *   that changes nothing reads as broken), and on an automatic memory (it never reaches a room with
 *   scenes, so a restriction on it would be a value nothing reads).
 * - **Restrict** to the current scene's audience, when the memory is shared (absent or `room`) and
 *   the current scene is narrower than the room. A `room` scene offers nothing: pressing would write
 *   the value it already has.
 * - **Share** when the memory is restricted, naming who may know it. Sharing writes `{ kind: "room" }`,
 *   never absence (`UpdateMemoryPatch.audience`).
 */
export type MemoryAudienceControl =
	| { kind: "restrict"; audience: ChatSceneAudience }
	| {
			kind: "share";
			/** Display names of who may know it; empty for `narrator` (no character). */
			names: string[];
			narrator: boolean;
	  };

export interface MemoryAudienceCast {
	room: Pick<ChatRoom, "seed" | "persona">;
	characters: readonly Pick<ChatCharacter, "id" | "name">[];
}

export function memoryAudienceControl(
	memory: Pick<ChatMemory, "source" | "audience">,
	scenes: readonly ChatScene[],
	cast: MemoryAudienceCast,
): MemoryAudienceControl | null {
	if (isAutoMemory(memory)) return null;
	const ordered = orderScenes(scenes);
	const current = ordered[ordered.length - 1];
	if (!current) return null;
	const audience = memory.audience;
	if (audience && audience.kind !== "room") {
		return audience.kind === "narrator"
			? { kind: "share", names: [], narrator: true }
			: {
					kind: "share",
					names: sceneMemberNames(audience.members, {
						seed: cast.room.seed,
						characters: cast.characters,
						userName: effectiveChatUserName(cast.room),
					}),
					narrator: false,
				};
	}
	if (current.audience.kind === "room") return null;
	return { kind: "restrict", audience: current.audience };
}

/**
 * How many human-written memories in this room nobody has decided an audience for — the number the
 * memory screen states so the user can mark them (`docs/chat/SCENES.md` §6).
 *
 * An unmarked memory is shared (the compatibility policy), which is right for everything written before
 * scenes existed but is also where a secret written then still reaches a private scene's characters.
 * The policy stays; what this adds is that the screen says so instead of leaving it silent.
 *
 * - **0 unless the room has a live scene narrower than the room.** Only then does "shared" withhold
 *   less than it could; in a room whose scenes are all `room`, every character already knows
 *   everything and the sentence would ask the user to decide something that changes nothing.
 * - **An explicit `{ kind: "room" }` is marked.** The user chose to share it; asking again turns a
 *   decision into a nag that never clears.
 * - Automatic memories never count — they never reach a room with scenes (`prompt-scope.ts`).
 */
export function unmarkedMemoryCount(
	memories: readonly Pick<ChatMemory, "source" | "audience">[],
	scenes: readonly ChatScene[],
): number {
	if (!orderScenes(scenes).some((s) => s.audience.kind !== "room")) return 0;
	return memories.filter((m) => !isAutoMemory(m) && !m.audience).length;
}
