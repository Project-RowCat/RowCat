import { deferredTranslator } from "#/lib/i18n/current.ts";

const tr = deferredTranslator("runtimePlayer");

/**
 * Trusted copy for the playback screen: sentences the creator cannot control. They are pure
 * constants because they uphold product promises. The AI notice cannot be replaced by the creator's
 * `Text` (§69), error sentences never include host paths or stack traces, and the reset
 * confirmation states what survives first.
 */

export const RUNTIME_PLAYER_COPY = {
	get loading() {
		return tr("player.loading");
	},
	/**
	 * The save is not on this device and the first sync has not finished. This is not a new game
	 * (§57).
	 */
	get syncing() {
		return tr("player.syncing");
	},
	get starting() {
		return tr("player.starting");
	},
	/**
	 * A creator-code failure. It does not say what went wrong: no component chain or runtime detail
	 * reaches this sentence. That detail belongs to the studio and developer tools.
	 */
	get creatorError() {
		return tr("player.creatorError");
	},
	/** Our own failure. The only thing the user can do is restart. */
	get failed() {
		return tr("player.failed");
	},
	/**
	 * The old session's progress could not be saved, so restart and reset cannot continue. Starting
	 * from the store's old value would silently drop progress the screen already showed, so it does
	 * not start. The save retry continues the transition instead. The user's only action is `Save again`
	 * (save again).
	 */
	get transitionBlocked() {
		return tr("player.transitionBlocked");
	},
	/**
	 * Version mismatch. The screen does not draw messages like `sandbox api 4 host expected 3` (§95),
	 * because that value belongs to developer tools. The user's only action here is to get a new app
	 * build.
	 */
	get incompatible() {
		return tr("player.incompatible");
	},
	get unavailable() {
		return tr("player.unavailable");
	},
	get retry() {
		return tr("player.retry");
	},
	/**
	 * Small link in the header to the story detail page. It is not labeled `Back`: this
	 * screen's product parent is the conversation list (`Conversations` in the sidebar), and using the same word
	 * for a different destination would leave one of the two as a dead control.
	 */
	get storyDetail() {
		return tr("player.storyDetail");
	},
	/**
	 * Link to the story detail page, shown on the screen where no playback response was received.
	 * There the work's current state can be seen.
	 */
	get storyDetailLink() {
		return tr("player.storyDetailLink");
	},
	/**
	 * Word used for the document's `h1` while the story title is still unknown. It is not `Conversations`
	 * (conversation): this is not a chat room, and even briefly, screen-reader users would hear it as
	 * one.
	 */
	get viewportTitle() {
		return tr("player.viewportTitle");
	},
	/**
	 * A save failure is not a runtime failure (§64). The two sentences are the rule here: the first
	 * says what happened, the second says what is true now. The work keeps running, but progress so
	 * far is not yet stored on this device. Without the second line the warning reads as a broken
	 * play, and people leave a screen that is still running fine. The copy does not say which lifetime
	 * failed. `runtimeSaveDurabilityAtRisk` folds that decision into one value, and the user's action
	 * is `Save again` either way. The difference between `defineStoryState` and `definePersistentState` is
	 * creator vocabulary.
	 */
	get saveFailed() {
		return tr("player.saveFailed");
	},
	get saveFailedBody() {
		return tr("player.saveFailedBody");
	},
	get saveRetry() {
		return tr("player.saveRetry");
	},
	get resetPlaythrough() {
		return tr("player.resetPlaythrough");
	},
	/**
	 * The confirmation says what survives first. Reset erases only this playthrough's progress. What
	 * was built up across several runs (unlocks, records) is kept. That split between two lifetimes is
	 * the whole reason the product has them (§61, §63).
	 */
	get resetTitle() {
		return tr("player.resetTitle");
	},
	get resetDescription() {
		return tr("player.resetDescription");
	},
	get resetConfirm() {
		return tr("player.resetConfirm");
	},
	get cancel() {
		return tr("player.cancel");
	},
	/**
	 * The header control that opens this work's generation settings dialog. It is not named `Conversation settings`
	 * (conversation settings): there is no room here, and the dialog handles only this work's single
	 * generation target.
	 */
	get generationSettings() {
		return tr("player.generationSettings");
	},
} as const;

/**
 * The AI notice is trusted RowCat text. Whatever the creator writes on a button, `useGeneration()`
 * builds the request from this user's current AI settings, so creator content cannot be the one to
 * state that fact (§69). The notice appears before the generation capability is handed to the
 * session. It does not claim one destination. Managed requests go to this server, and BYO requests
 * go to the user's provider, where the account may be charged. Which applies depends on the user's
 * settings, so one claim would be false for half of users. The provider name is left out too, since
 * it is this device's setting.
 */
export const RUNTIME_PLAYER_AI_COPY = {
	get title() {
		return tr("ai.title");
	},
	get body() {
		return tr("ai.body");
	},
	get allow() {
		return tr("ai.allow");
	},
	get deny() {
		return tr("ai.deny");
	},
	/**
	 * States that the decision is fixed for the session (§117). The running VM's capability table is
	 * not swapped, so changing the decision requires a restart. Without this line, a user would change
	 * the setting and see nothing happen.
	 */
	get note() {
		return tr("ai.note");
	},
} as const;
