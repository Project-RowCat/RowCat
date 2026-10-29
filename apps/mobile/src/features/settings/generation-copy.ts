/**
 * Copy for the default-generation section. Contains no decisions.
 *
 * Words for response length, provider and model, and the failure sentences, already live in
 * conversation settings (`features/chat/generation/labels.ts`); they are called from there rather
 * than repeated here. This file holds only the three lines that exist for this section alone.
 */

export const GENERATION_DEFAULTS_TITLE = "Generation defaults";

/**
 * States the **same fact** as the web's section: these are defaults for new conversations, they
 * apply only on this device, and a conversation configured differently keeps its own setting.
 *
 * The last clause is kept because it describes what actually happens: someone who changes the model
 * here and then opens a room that already has an override sees nothing change. Without reading that
 * beforehand, they would conclude the save failed.
 */
export const GENERATION_DEFAULTS_DESCRIPTION =
	"Applies to new conversations by default. When a conversation sets something differently, that conversation's setting wins.";

/**
 * **Do not drop the device axis.** That this value does not sync is what a person opening the same
 * account on another device actually experiences. The conversation settings footnote states the
 * same fact.
 */
export const GENERATION_DEVICE_NOTE =
	"Values chosen here apply only on this device and aren't synced to other devices.";
