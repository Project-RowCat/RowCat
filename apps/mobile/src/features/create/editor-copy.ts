import type { ChatLorePosition } from "@rowcat/contracts";
import { ORIENTATION_LABEL, type Orientation } from "@rowcat/domain";

/**
 * Display copy and display rules for the editor. The storage model is not changed here.
 *
 * Every value this file produces is for display only. No code writes a placeholder title into the
 * record. If that boundary lived only in a `||` inside JSX, someone would eventually save the
 * display fallback into the draft, and a title the creator never wrote would be published. (The web
 * keeps `start-scene-fields.ts` separate for the same reason.)
 */

export const EDITOR_BACK_LABEL = "Back to Create";

export const EDITOR_MISSING = {
	title: "Story not found",
	description:
		"It may have been deleted, or a draft made on another device may not have reached this device yet.",
	action: "Back to Create",
} as const;

/** Save indicator. Only failure interrupts; the other states pass several times a second while typing. */
export const AUTOSAVE_LABEL = {
	idle: "",
	pending: "Waiting to save…",
	saving: "Saving…",
	saved: "Saved",
	error: "Couldn't save",
} as const;

export const AUTOSAVE_RETRY_LABEL = "Save again";

/* ── Sections ── */

export const SECTION = {
	basics: {
		title: "Basics",
		description: "This is what shows in the gallery.",
	},
	prompt: {
		title: "Prompt",
		description:
			"Write the world, characters and how it plays in one piece. This is the body the model reads.",
	},
	lore: {
		title: "Lore",
		description:
			"Settings that go into the prompt only when a keyword matches.",
	},
	startScenes: {
		title: "Opening scenes",
		description: "Candidates for the first scene when a conversation starts.",
	},
	sceneImages: {
		title: "Scene images",
		description: "Pictures that `[img:trigger]` in the body calls.",
	},
	/** No description: the section's controls already say what they do. */
	publish: { title: "Publish" },
} as const;

/**
 * One line for a collapsed section: what it holds, and how many.
 *
 * All three collapsible sections add up items, so the question a collapsed line must answer is one:
 * "is anything here?". A count answers it, so this function joins the noun and the count (`Worldbuilding ·
 * 4`).
 *
 * Zero is not hidden. A bare noun would make "empty" and "not counted yet" look the same, and the
 * user would have to open the section to tell them apart. The point of collapsing is to show that
 * without opening.
 *
 * The noun differs from the section title on purpose. The title is already right beside it, and
 * repeating the same word would show it twice on one line.
 */
export const sectionSummary = (noun: string, count: number): string =>
	`${noun} · ${count.toLocaleString("en-US")}`;

/** Noun counted on the summary line; deliberately different from the section title (see above). */
export const SECTION_SUMMARY_NOUN = {
	lore: "World",
	startScenes: "Opening scenes",
	sceneImages: "Scene images",
} as const;

/* ── Basics ── */

export const FIELD = {
	title: "Title",
	tagline: "One-line intro",
	description: "Description",
	tags: "Tags",
	orientation: "Orientation",
	adult: "Adult",
	promptProtected: "Protect prompt",
	prompt: "Prompt",
} as const;

export const FIELD_HINT = {
	adult: "Only members who completed adult verification can publish publicly.",
	/**
	 * A display policy, not encryption, and it promises nothing more. The playback payload is sent to
	 * the client whole (see `promptProtected` in `@rowcat/authoring`).
	 */
	promptProtected: "Doesn't expose the creative prompt on the playback screen.",
} as const;

/* ── Prompt ── */

/**
 * Full-screen editing: the same value, seen in a wider place.
 *
 * The label is neither `Enlarge` nor `Focus mode`, because each would promise
 * something false: the first implies larger text, which does not happen, and the second implies
 * that distractions are turned off, which they are not (autosave and status keep running). The only
 * real difference is the place.
 *
 * The button says `Done`, not `Save`. This view has no save action (autosave keeps
 * running), and closing confirms nothing. `Save` would suggest that closing without it loses work, a
 * promise this editor has never made.
 */
export const PROMPT_EXPAND = {
	open: "Edit full screen",
	title: "Edit full screen",
	description: "Autosave keeps running.",
	close: "Done",
} as const;

/** Unset is a normal state: the value is `null`, not `""`, and the label says so. */
export const ORIENTATION_UNSET_LABEL = "Not set";
export const ORIENTATION_OPTIONS: {
	value: Orientation | null;
	label: string;
}[] = [
	{ value: null, label: ORIENTATION_UNSET_LABEL },
	{ value: "female", label: ORIENTATION_LABEL.female },
	{ value: "male", label: ORIENTATION_LABEL.male },
	{ value: "all", label: ORIENTATION_LABEL.all },
];

export const TAG_INPUT = {
	label: "Add tag",
	placeholder: "Type a tag and add it",
	add: "Add",
	remove: (tag: string) => `Remove tag ${tag}`,
	full: "No more tags can be added.",
	tooLong: "The tag is too long.",
} as const;

/** Over the limit: say so, never cut the text (the user's characters are not removed). */
export const OVER_LIMIT = (used: number, max: number): string =>
	`${used.toLocaleString("en-US")} / ${max.toLocaleString("en-US")} characters — over the limit.`;

/* ── Lore ── */

/**
 * Display labels for injection positions.
 *
 * Only the three positions the playback assembler actually reads can be chosen. The legacy `depth`,
 * `group` and `oneshot` are not revived: the assembler does not read them, so an editor field would
 * silently ignore what the creator set.
 */
export const LORE_POSITION_LABEL: Record<ChatLorePosition, string> = {
	system_top: "Before the system prompt",
	system_bottom: "After the system prompt",
	before_history: "Before the conversation history",
};

/** Choice order matches the order in which the positions appear in the prompt. */
export const LORE_POSITION_OPTIONS: {
	value: ChatLorePosition;
	label: string;
}[] = (["system_top", "system_bottom", "before_history"] as const).map(
	(value) => ({ value, label: LORE_POSITION_LABEL[value] }),
);

export const LORE = {
	add: "Add lore",
	keys: "Keywords",
	keysHint: "Separate with commas.",
	content: "Content",
	constant: "Always include",
	order: "Priority",
	remove: "Delete lore",
	moveUp: "Up",
	moveDown: "Down",
	empty:
		"No lore yet. You can add settings that go in only when a keyword matches.",
	/**
	 * An entry that can never trigger: it is saved, but playback does nothing with it. Left silent,
	 * the creator would assume the setting is applied and would never learn why the result looks
	 * wrong.
	 */
	neverTriggers:
		"Add a keyword or turn on 'Always include'. With the current settings it won't reach the conversation.",
	noKeys: "No keywords",
} as const;

/** Splits a comma-separated keyword line into the stored array. Empty pieces are dropped. */
export const splitLoreKeys = (value: string): string[] =>
	value
		.split(",")
		.map((key) => key.trim())
		.filter(Boolean);

/* ── Start scenes ── */

/**
 * Display name for a scene with no title.
 *
 * The word is chosen to read as "not written yet", not as a finished name like `Untitled`.
 * This slot is usually a scene just created, and the list should show that so the next step is
 * clear.
 */
export const UNTITLED_START_SCENE = "Untitled scene";

export const START_SCENE = {
	add: "Add scene",
	title: "Scene title",
	content: "Scene body",
	remove: "Delete scene",
	moveUp: "Up",
	moveDown: "Down",
	makeDefault: "Make the default opening",
	defaultBadge: "Default opening",
	empty: "No opening scenes. Without one, conversations start with no opening.",
} as const;

/** A title that is only whitespace counts as no title, since the list would show a blank row. */
export const startSceneHeadline = (title: string): string =>
	title.trim() || UNTITLED_START_SCENE;

/* ── Scene images ── */

export const SCENE_IMAGE = {
	add: "Add picture",
	adding: "Uploading…",
	trigger: "Trigger",
	remove: "Delete picture",
	empty:
		"No scene images. You can add pictures that `[img:trigger]` calls in the body.",
	/**
	 * A duplicate is a normal moment while editing. Blocking it on save would rule out swapping the
	 * names of two entries, which passes through a briefly duplicated state. Instead, the screen says
	 * which entry wins, and publication validation states the same fact once more.
	 */
	duplicate:
		"The same trigger is used more than once. Only the first picture appears.",
	missingAsset: "No picture.",
} as const;

/* ── Conversation material of drafts with the runtime on ── */

/**
 * Prompt field of a draft with the runtime on: a notice in place of the editor. Same wording as the
 * web's `PROMPT_RUNTIME_LOCK`.
 *
 * Without the last sentence, the creator would read their text as deleted. The lock stops editing;
 * it does not change the value, and turning the runtime off (in the web studio) brings the value
 * back.
 */
export const PROMPT_RUNTIME_LOCK = {
	title: "Stories with runtime on don't use this prompt.",
	body: "AI requests are built inside the runtime code. The prompt you wrote is kept, and you can edit it again once runtime is off.",
} as const;

/**
 * Lore section of a draft with the runtime on: a notice in place of the editor. Same wording as the
 * web's `LORE_RUNTIME_LOCK`.
 *
 * Lore is injected into the conversation prompt, and the AI requests of a runtime work are built by
 * the creator's code.
 */
export const LORE_RUNTIME_LOCK = {
	title: "Stories with runtime on don't use lore.",
	body: "Lore is inserted into the conversation prompt, but a runtime story's AI requests are built inside the runtime code. The lore you wrote is kept, and you can edit it again once runtime is off.",
} as const;

/**
 * Start scene section of a draft with the runtime on: a notice in place of the editor. Same wording
 * as the web's `START_SCENE_RUNTIME_LOCK`.
 *
 * The opening is read when a conversation room opens, and runtime playback creates no room. It
 * occupies the same position as the prompt, so the copy states the same three facts in the same
 * order: why it is not used, what takes that slot, and that the value has not been lost.
 */
export const START_SCENE_RUNTIME_LOCK = {
	title: "Stories with runtime on don't use opening scenes.",
	body: "Runtime stories don't open a conversation room, so there is no place for an opening. Runtime code draws the first screen. The scenes you wrote are kept, and you can edit them again once runtime is off.",
} as const;

/**
 * Scene image section of a draft with the runtime on: a notice in place of the editor. Same wording
 * as the web's `SCENE_IMAGE_RUNTIME_LOCK`.
 *
 * The last line says uploaded images are kept: the bytes are already on the server and the draft
 * record stays.
 */
export const SCENE_IMAGE_RUNTIME_LOCK = {
	title: "Stories with runtime on don't use scene images.",
	body: "Scene images are pictures attached to conversation replies, but runtime stories don't open a conversation room. Runtime code draws pictures on screen. The pictures you uploaded are kept, and you can edit them again once runtime is off.",
} as const;

/**
 * The runtime project is still loading; sections do not open until it arrives.
 *
 * The name deliberately has no `PROMPT`. Four sections (prompt, lore, start scenes, scene images)
 * pass the same check and wait on the same fact. Per-section wording would show four placeholders
 * saying different things in the same frame.
 */
export const RUNTIME_PENDING_LABEL = "Checking runtime settings…";

/**
 * Copy for the discovery-grid preview section.
 *
 * Kept out of the `SECTION` table because it has more than one description: this section states a
 * different fact depending on whether the draft is published. Forcing it into that table's `{
 * title, description }` shape would push the choice between the two down into the screen.
 */
export const DRAFT_PREVIEW_SECTION = {
	title: "Preview",
	/** Shown when the cover is already on the server: that cover is drawn. */
	description: "This is how it appears in the discover grid once published.",
	/**
	 * Drawing a cover that is not uploaded yet, so the fact is stated here.
	 *
	 * The cover field right above states the same fact, but it is repeated here because this card
	 * claims "once published, it appears like this". The picture shown now is not on the server yet,
	 * which is a condition of that claim.
	 */
	stagedDescription:
		"This is how it appears in the discover grid once published. The cover uploads when you publish.",
} as const;

/**
 * Copy for the cover field before publication.
 *
 * The words differ from `Manage cover` (under Published stories). That one edits the server's cover
 * directly and uses `Upload cover` (upload) and `Replace cover` (replace), while this field uploads nothing yet.
 * The same words here would make the creator think this button sends something to the server.
 */
export const DRAFT_COVER_FIELD = {
	label: "Cover",
	description: "The picture shown in the discover grid and story details.",
	chooseLabel: "Choose cover",
	replaceLabel: "Change cover",
	removeLabel: "Remove cover",
	/**
	 * Two facts in one sentence: it uploads when published, and until then it exists only on this
	 * device. Without the second, someone who opens the same draft on another device would read the
	 * missing cover as a defect (the value does not sync; that is a fact of the schema).
	 */
	stagedNote:
		"It uploads when you publish. Until then it's only on this device and doesn't show on other devices.",
	/**
	 * Failed to move the file. The raw string carrying the device's absolute path is never drawn: it
	 * says nothing about what the user can do, and that string is ours, not the user's.
	 */
	stageFailed: "Couldn't save the cover on this device. Please try again.",
	/**
	 * The work was published but its cover failed to upload. This is not a publish failure. If the
	 * screen does not say so first, the creator assumes the work did not go up and presses publish
	 * again. The server is idempotent, so no second copy is created, but the screen should not
	 * mislead.
	 */
	uploadFailed:
		"The story was published, but the cover couldn't be uploaded. Upload it again from `Manage cover` in `Published`.",
} as const;
