import { translator } from "#/lib/i18n/current.ts";
/**
 * Copy for the playtest screen. It is kept in one place because these are commitments, and each is
 * a claim that can be checked. The screen says three things, and all must be true:
 * - What leaves: sent to the AI provider chosen for this conversation, along with the draft's
 *   settings (`is sent to the provider`).
 * - What remains: nothing. The conversation is not saved to the regular list (`nothing remains`).
 * - What it is not: not publishing (`it is not publishing`).
 *
 * Do not promise more than this. With a managed model (RowCat-provided), prompts pass through our
 * server, so a sentence like 'no server sees this' would be false.
 *
 * Some words must not appear: `Publish`, `Review`, `Approval`, `Review`. This screen does none of those things and
 * uploads nothing, and an author who reads them leaves thinking their work went somewhere.
 * `playtest-copy.test.ts` enforces this by value.
 */

/**
 * The disclosure is a line that stays visible, not a notice shown once to first-time visitors. A
 * confirmation dialog for every message is not used, because such dialogs go unread. It is not
 * shown once and then dismissed, because this screen is where personal data crosses a boundary: an
 * unpublished manuscript goes to an external provider.
 */
export const playtestDisclosure = (): string =>
	translator("playtest")("copy.disclosure");

/**
 * States that the conversation disappears when the screen is left. Shared by the reset and reload
 * confirmation dialogs.
 */
export const playtestEphemeralNote = (): string =>
	translator("playtest")("copy.ephemeral");

/**
 * The single centered line shown for a conversation with no messages yet.
 *
 * It is a line, not a card, because this spot is about to become the conversation. A large box
 * would vanish when the first response arrives, and the whole screen would appear to redraw. There
 * is no example-prompt list, since this product has none.
 */
export const playtestEmptyConversationHint = (): string =>
	translator("playtest")("copy.emptyConversation");

/** Draft with an empty prompt. Not blocked, but the note explains why results may look odd. */
export const playtestEmptyPromptNote = (): string =>
	translator("playtest")("copy.emptyPrompt");

export const playtestResetConfirm = () => {
	const t = translator("playtest");
	return {
		title: t("copy.resetConfirm.title"),
		description: t("copy.resetConfirm.description"),
		confirmLabel: t("copy.resetConfirm.confirmLabel"),
	} as const;
};

export const playtestReloadConfirm = () => {
	const t = translator("playtest");
	return {
		title: t("copy.reloadConfirm.title"),
		description: t("copy.reloadConfirm.description"),
		confirmLabel: t("copy.reloadConfirm.confirmLabel"),
	} as const;
};

export const playtestSceneConfirm = () => {
	const t = translator("playtest");
	return {
		title: t("copy.sceneConfirm.title"),
		description: t("copy.sceneConfirm.description"),
		confirmLabel: t("copy.sceneConfirm.confirmLabel"),
	} as const;
};

/** The draft could not be re-read. The current test remains as is, and that fact is stated. */
export const playtestReloadFailure = (): string =>
	translator("playtest")("copy.reloadFailure");

/**
 * Copy for a test of a draft with the runtime enabled: code runs, not a conversation.
 *
 * This is kept separate from the sentences above because the promise differs. Conversation tests
 * must always say that the draft's settings go to the provider. In runtime tests, the only way the
 * model is called is `useGeneration()`, and only a session with AI enabled has that ability.
 * Repeating that condition here would make a second copy of the toggle's description, and one of
 * the two would go stale first.
 *
 * What this screen must say is the lifetime of progress. Saved state accumulated here lives in the
 * worker's memory and disappears on refresh. It has nothing to do with progress made in the
 * product's own playthroughs.
 */
export const playtestRuntimeNote = (): string =>
	translator("playtest")("copy.runtimeNote");

/**
 * The runtime is enabled but there are no files yet. This is not a failure; it is a state with a
 * next step.
 */
export const playtestRuntimeEmpty = (): string =>
	translator("playtest")("copy.runtimeEmpty");

export const playtestRuntimeStudioLink = (): string =>
	translator("playtest")("copy.runtimeStudioLink");

/**
 * Action words are surface text.
 *
 * This is why the `Run preview` label from the preview panel is not carried over: this screen has no
 * preview. The whole screen is the work, and what the user wants is to run this draft. The meaning
 * of the actions and their explanations are the same as in preview, though: `Restart` and `Reset play`
 * are different actions. That is a promise of the runtime, not of the surface, so it uses the same
 * copy.
 */
export const playtestRuntimeRun = (): string =>
	translator("playtest")("copy.runtimeRun");

/** The action shown after a failure. Same action, but the wording names the destination. */
export const playtestRuntimeRestartAfterFailure = (): string =>
	translator("playtest")("copy.runtimeRestart");
