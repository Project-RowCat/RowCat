import type { StoryChatSeedDto } from "@rowcat/contracts/chat";

/**
 * The seed for prompt-protected rooms: the version that goes down to the device. Previously
 * protection only hid fields from the screen. The creative prompt still arrived as plaintext in the
 * `/play` response and sat in the device's room record, visible to anyone with developer tools. Now
 * the protected scenario, play guide, character card descriptions and lore never leave the server.
 * Generation is assembled by the server from the currently published seed, and the device receives
 * only what the screen draws.
 *
 * Cleared: scenario, play guide, character description fields, lore. Kept: title, tagline, rating,
 * first scene, start scenes, persona, scene images, character names.
 *
 * The test for keeping a field is whether the screen already draws it. The opening and start scenes
 * are drawn as the first messages; the suggested partner is drawn in the role setup; situation
 * images are drawn after responses. Hiding those would break the screen without protecting
 * anything. Character names stay because the screen's `{{char}}` substitution reads them.
 *
 * The shape is unchanged (`StoryChatSeedDto`) so deployed clients read the same response. Every
 * content field has a default, so empty is a valid value. If the seed is not protected, it is
 * returned as is. That work's rooms keep the copy taken at acquisition.
 */
export function projectProtectedSeed(seed: StoryChatSeedDto): StoryChatSeedDto {
	if (!seed.promptProtected) return seed;
	return {
		...seed,
		scenario: "",
		playGuide: "",
		characters: seed.characters.map((character) => ({
			name: character.name,
			description: "",
			personality: "",
			speechStyle: "",
			exampleDialogue: "",
			prompt: "",
		})),
		lore: [],
	};
}
