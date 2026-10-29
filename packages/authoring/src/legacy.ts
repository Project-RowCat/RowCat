/**
 * Folds a v1 authoring body into one v2 prompt. Three callers need the same result: the web Dexie
 * v9 upgrade, the mobile SQLite migration, and the sync decoder for v1 payloads from devices that
 * have not updated yet. The function is pure: no time, randomness or locale input. Otherwise the
 * same draft could differ per device and overwrite itself on the next merge. Folding cannot be
 * undone, so it errs toward keeping text. Content the old mode did not publish stays in the body.
 * Users can delete duplicates, but lost text cannot be recovered.
 */

/** Body part of a v1 character card. The record's sync metadata does not matter for folding. */
export interface LegacyDraftCharacterBody {
	name: string;
	mode: "structured" | "prompt";
	description: string;
	personality: string;
	speechStyle: string;
	exampleDialogue: string;
	prompt: string;
}

/**
 * One v1 draft's authoring body. Only character children are passed in; lore and scenes are not
 * folded.
 */
export interface LegacyDraftBody {
	bodyMode: "structured" | "prompt";
	prompt: string;
	scenario: string;
	playGuide: string;
	suggestedPersona: { name: string; description: string } | null;
	/**
	 * Only live cards, already in position order. This function does not filter or sort again, because
	 * each caller sorts differently (Dexie by index, SQLite by ORDER BY, and sync payloads carry no
	 * cards). Sorting here would weaken the guarantee that the three callers agree.
	 */
	characters: LegacyDraftCharacterBody[];
}

/** Trims only the outer whitespace. Line breaks inside creative text carry meaning. */
const trim = (value: string | null | undefined): string => (value ?? "").trim();

function block(heading: string, body: string): string | null {
	const text = trim(body);
	return text ? `${heading}\n${text}` : null;
}

/**
 * One card becomes one section. A card with only a name is still kept, since the creator wrote that
 * name.
 */
function characterBlock(character: LegacyDraftCharacterBody): string | null {
	const name = trim(character.name) || "이름없음";
	const parts: string[] = [];
	if (character.mode === "prompt") {
		const body = trim(character.prompt);
		if (body) parts.push(body);
	} else {
		const labelled: [string, string][] = [
			["소개", character.description],
			["성격", character.personality],
			["말투", character.speechStyle],
			["예시 대사", character.exampleDialogue],
		];
		for (const [label, value] of labelled) {
			const body = trim(value);
			if (body) parts.push(`${label}:\n${body}`);
		}
	}
	return parts.length ? `### ${name}\n${parts.join("\n\n")}` : `### ${name}`;
}

/**
 * Folds a v1 body into one prompt. The primary source comes first: the free-prompt text in prompt
 * mode, otherwise the scenario. This matches what the draft last published, so the creator sees it
 * first. The unselected source stays below its own heading. A mode switch can bring it back, so it
 * is not deleted. If the result is empty, return an empty string. A title-only skeleton would pass
 * publish validation instead of showing `Please enter a prompt.`.
 */
export function foldLegacyDraftBody(source: LegacyDraftBody): string {
	const freeform = source.bodyMode === "prompt";
	const primary = trim(freeform ? source.prompt : source.scenario);
	const alternate = freeform
		? block("## 항목별로 쓴 세계관", source.scenario)
		: block("## 이전에 쓴 자유 프롬프트", source.prompt);

	const characters = source.characters
		.map(characterBlock)
		.filter((entry): entry is string => entry !== null);

	const persona = source.suggestedPersona;
	const personaName = trim(persona?.name);
	const personaBody = trim(persona?.description);

	const blocks: (string | null)[] = [
		primary || null,
		alternate,
		block("## 진행 지침", source.playGuide),
		characters.length ? `## 등장인물\n${characters.join("\n\n")}` : null,
		persona && (personaName || personaBody)
			? `## 상대역\n${[personaName ? `### ${personaName}` : null, personaBody]
					.filter(Boolean)
					.join("\n")}`
			: null,
	];

	return blocks.filter((entry): entry is string => Boolean(entry)).join("\n\n");
}
