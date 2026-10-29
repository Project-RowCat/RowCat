import { deferredTranslator } from "#/lib/i18n/current.ts";

/**
 * The text the runtime shows the user is collected in one place, and tests enforce it. The reason
 * for pulling copy out of components is the promise, not the layout. This slice ships the authoring
 * surface without an execution engine, so any screen text that reads as 'coming soon' or 'running'
 * would be a promise that cannot be kept. As plain constants, those words can be blocked by value.
 *
 * The words themselves live in the `runtimeStudio` dictionary. Each table keeps its exported shape,
 * and each property is a getter, so a value is read in the render's locale at the moment it is used
 * rather than frozen when this module loads.
 */

const tr = deferredTranslator("runtimeStudio");

export const RUNTIME_INTRO = {
	get title() {
		return tr("intro.title");
	},
	get body() {
		return tr("intro.body");
	},
	/**
	 * Four capabilities, described by what they are used for rather than as marketing sentences. This
	 * screen is a section of the editor, not a landing page.
	 */
	get capabilities() {
		return [
			tr("intro.capability1"),
			tr("intro.capability2"),
			tr("intro.capability3"),
			tr("intro.capability4"),
		];
	},
	/**
	 * The button opens the template gallery; it does not create a file. The label used to be `Turn on runtime`,
	 * which was accurate when pressing it created a starter file immediately. The
	 * button now opens a chooser, so the same words would make people think a file already exists.
	 */
	get action() {
		return tr("intro.action");
	},
} as const;

export const RUNTIME_SECTION = {
	get title() {
		return tr("section.title");
	},
	get description() {
		return tr("section.description");
	},
	get enabledBadge() {
		return tr("section.enabledBadge");
	},
	get disabledBadge() {
		return tr("section.disabledBadge");
	},
	get open() {
		return tr("section.open");
	},
	get disable() {
		return tr("section.disable");
	},
	get enable() {
		return tr("section.enable");
	},
	/**
	 * Published runtime code is not a secret store, and authors must be told that. Compiled code runs
	 * on the player's device once authorized, so strings and control flow inside it can be inspected.
	 * `promptProtected` does not change this: it is the axis of conversation-replay snapshots and does
	 * not make client-side code secret. The sentence is deliberately not alarming. It states one thing
	 * not to do (do not put secrets in code). Hinting at nonexistent alternatives such as obfuscation,
	 * server execution or encryption would send authors looking for features that do not exist.
	 */
	get confidentiality() {
		return tr("section.confidentiality");
	},
	/**
	 * Shown while the runtime is on, so authors are not surprised at publish time: publishing ships
	 * the runtime with the work.
	 */
	get publishNotice() {
		return tr("section.publishNotice");
	},
	/**
	 * Structural check of saved code. On a screen with a publish button, it tells whether the studio's
	 * last 'no issues' result is stale. The reason for the term 'structural check' is in the header of
	 * runtime-saved-check.ts.
	 */
	get savedCheckClean() {
		return tr("section.savedCheckClean");
	},
	savedCheckProblems: (errors: number) =>
		tr("section.savedCheckProblems", { errors }),
	get savedCheckFailed() {
		return tr("section.savedCheckFailed");
	},
	get savedCheckOpen() {
		return tr("section.savedCheckOpen");
	},
} as const;

/**
 * The disable confirmation says what remains first. The dialog's purpose is not to scare; it is to
 * say the action is reversible. If it read as code being deleted, users would not turn the runtime
 * off, and the action would effectively not exist.
 */
export const RUNTIME_DISABLE_CONFIRM = {
	get title() {
		return tr("disableConfirm.title");
	},
	get body() {
		return tr("disableConfirm.body");
	},
	get confirm() {
		return tr("disableConfirm.confirm");
	},
	get cancel() {
		return tr("disableConfirm.cancel");
	},
} as const;

export const RUNTIME_STUDIO = {
	get title() {
		return tr("studio.title");
	},
	get back() {
		return tr("studio.back");
	},
	get open() {
		return tr("studio.open");
	},
	get newFile() {
		return tr("studio.newFile");
	},
	get newFolder() {
		return tr("studio.newFolder");
	},
	get rename() {
		return tr("studio.rename");
	},
	get copyPath() {
		return tr("studio.copyPath");
	},
	get collapseAll() {
		return tr("studio.collapseAll");
	},
	get remove() {
		return tr("studio.remove");
	},
	get explorer() {
		return tr("studio.explorer");
	},
	get preview() {
		return tr("studio.preview");
	},
	get showPreview() {
		return tr("studio.showPreview");
	},
	get hidePreview() {
		return tr("studio.hidePreview");
	},
	get panel() {
		return tr("studio.panel");
	},
	get openPanel() {
		return tr("studio.openPanel");
	},
	get closePanel() {
		return tr("studio.closePanel");
	},
	/**
	 * What the header's check-status button does when pressed. Its name includes the destination (`Open problems
	 * panel`).
	 */
	get openProblems() {
		return tr("studio.openProblems");
	},
	/**
	 * Tab strip action. `Close` (close) is used as-is because it is a different word from `Delete` (delete).
	 */
	get closeTab() {
		return tr("studio.closeTab");
	},
	get closeOtherTabs() {
		return tr("studio.closeOtherTabs");
	},
	get closeAllTabs() {
		return tr("studio.closeAllTabs");
	},
	get tabMenu() {
		return tr("studio.tabMenu");
	},
	get revealInExplorer() {
		return tr("studio.revealInExplorer");
	},
	/**
	 * The header's right-hand menu is not named `Layout`. While the menu held only layout
	 * controls, that name was accurate. Now that the command palette is its first entry, the same name
	 * would be false about what is inside, and people looking for the palette would not open it.
	 */
	get studioMenu() {
		return tr("studio.studioMenu");
	},
	/**
	 * Layout actions. Panel sizes and panel visibility are separate axes, so they get separate names.
	 */
	get layout() {
		return tr("studio.layout");
	},
	get showExplorer() {
		return tr("studio.showExplorer");
	},
	get hideExplorer() {
		return tr("studio.hideExplorer");
	},
	get resetLayout() {
		return tr("studio.resetLayout");
	},
	/** Quick open is one way to reach files. It is not the command palette. */
	get quickOpen() {
		return tr("studio.quickOpen");
	},
	get quickOpenPlaceholder() {
		return tr("studio.quickOpenPlaceholder");
	},
	get quickOpenEmpty() {
		return tr("studio.quickOpenEmpty");
	},
	get quickOpenResults() {
		return tr("studio.quickOpenResults");
	},
	/**
	 * The command palette is a different surface from quick open. The name keeps the editor
	 * convention's term. A substitute such as `Find action` would add a name only this screen uses, and
	 * nobody would know it.
	 */
	get commandPalette() {
		return tr("studio.commandPalette");
	},
	get commandPalettePlaceholder() {
		return tr("studio.commandPalettePlaceholder");
	},
	get commandPaletteEmpty() {
		return tr("studio.commandPaletteEmpty");
	},
	get commandPaletteResults() {
		return tr("studio.commandPaletteResults");
	},
	/**
	 * Placeholder above the editor. Tab labels are deliberately short (a prefix is added only when
	 * names collide), so this line supplies the other half: what is being viewed now.
	 */
	get breadcrumb() {
		return tr("studio.breadcrumb");
	},
	get breadcrumbMenu() {
		return tr("studio.breadcrumbMenu");
	},
	/**
	 * The Problems severity filter has three terms and no counts. The error and warning counts already
	 * sit on the panel's tab label. Repeating them here would show the same two numbers a third time
	 * (header, tab label, filter), and repeated numbers stop being read.
	 */
	get problemsFilter() {
		return tr("studio.problemsFilter");
	},
	get problemsFilterAll() {
		return tr("studio.problemsFilterAll");
	},
	get problemsFilterErrors() {
		return tr("studio.problemsFilterErrors");
	},
	get problemsFilterWarnings() {
		return tr("studio.problemsFilterWarnings");
	},
	/**
	 * Shown when the filter leaves nothing. This is a different state from having no problems at all.
	 */
	get problemsFilterEmpty() {
		return tr("studio.problemsFilterEmpty");
	},
	/**
	 * Action that opens the entry file from the Runtime tab. It appears only when that file exists.
	 */
	get openEntry() {
		return tr("studio.openEntry");
	},
} as const;

/**
 * Onboarding copy for a first-time user: four sentences and one way out. The lines state next
 * actions, not marketing. Three are actions (edit, run, view problems) and the fourth is a doc
 * link. These are the places a new user first gets stuck on this screen. No numbering such as '1.'
 * or '2.'. Forcing an order would add reading for people who already know the code, and in practice
 * the three actions are used in any order.
 */
export const RUNTIME_ONBOARDING = {
	get title() {
		return tr("onboarding.title");
	},
	/**
	 * The entry path is inserted here. It is a fact about this project, not an identity of the
	 * template.
	 */
	edit: (entry: string) => tr("onboarding.edit", { entry }),
	get run() {
		return tr("onboarding.run");
	},
	get problems() {
		return tr("onboarding.problems");
	},
	get dismiss() {
		return tr("onboarding.dismiss");
	},
} as const;

/**
 * Confirmation for deleting a file. The action cannot be undone, so the file path appears verbatim
 * in the body.
 */
export const runtimeDeleteConfirm = (path: string) => ({
	title: tr("deleteConfirm.title"),
	body: tr("deleteConfirm.body", { path }),
	confirm: tr("deleteConfirm.confirm"),
	cancel: tr("deleteConfirm.cancel"),
});

/**
 * The explorer's empty state should show what can be done, not just that it is empty. Text alone
 * leaves the next step as finding one of the two header icons. Those icons are visible without
 * hover, but they have no label (they are icon buttons), so a first-time user cannot read them.
 */
export const RUNTIME_EXPLORER_EMPTY = {
	get title() {
		return tr("explorerEmpty.title");
	},
} as const;

/**
 * The editor's empty state has two branches. Writing 'pick a file in the explorer' when no files
 * exist would tell the user to choose something that does not exist. While the two sentences shared
 * one value, a user opening a new project hit a dead end.
 */
export const RUNTIME_EDITOR_EMPTY = {
	get noFiles() {
		return tr("editorEmpty.noFiles");
	},
	get noFilesAction() {
		return tr("editorEmpty.noFilesAction");
	},
	get noSelection() {
		return tr("editorEmpty.noSelection");
	},
	/**
	 * A second large button is not added. There are already two ways to open a file (the explorer rows
	 * and the header magnifier), so all that is needed here is the fact that the shortcut exists. If
	 * the hint looked like a button, users would click it and nothing would happen, because the text
	 * is not clickable.
	 */
	get noSelectionShortcut() {
		return tr("editorEmpty.noSelectionShortcut");
	},
} as const;

/**
 * Copying a path to the clipboard. On success the feedback appears in place. On failure a toast
 * carries it, because the action has no place left to show the message.
 */
/**
 * A single toast line for a failed save, shared by the file and asset action hooks. The cause of
 * the failure is not passed here: path validation runs first in the pure rules at the call site,
 * and storage exceptions are not shown on screen.
 */
export const runtimeActionFailure = (): string => tr("actionFailure");

export const RUNTIME_COPY_PATH = {
	get copied() {
		return tr("copyPath.copied");
	},
	get failed() {
		return tr("copyPath.failed");
	},
} as const;

/**
 * Managed images: pictures referred to by logical name. The copy must answer two things: how code
 * refers to them, and what removal does not do. The second matters most. If 'remove' read as
 * deleting the picture from the world, authors of already-published works would fear breaking them,
 * and nobody would tidy the list.
 */
export const RUNTIME_ASSETS = {
	get title() {
		return tr("assets.title");
	},
	get description() {
		return tr("assets.description");
	},
	get empty() {
		return tr("assets.empty");
	},
	get add() {
		return tr("assets.add");
	},
	/**
	 * The hint under the name field. This is the only place on the screen that shows the code shape.
	 */
	get nameLabel() {
		return tr("assets.nameLabel");
	},
	get namePlaceholder() {
		return tr("assets.namePlaceholder");
	},
	get nameHint() {
		return tr("assets.nameHint");
	},
	get rename() {
		return tr("assets.rename");
	},
	get replace() {
		return tr("assets.replace");
	},
	/**
	 * Replacement does not change kind. Silently allowing it would make a name used by `<Image>`
	 * become a sound without notice, and the project would learn of it only on the next playback.
	 * Changing kind is a remove plus an add, and those two steps amount to confirming this is a
	 * different asset.
	 */
	get replaceKindImage() {
		return tr("assets.replaceKindImage");
	},
	get replaceKindAudio() {
		return tr("assets.replaceKindAudio");
	},
	get remove() {
		return tr("assets.remove");
	},
	get copyName() {
		return tr("assets.copyName");
	},
	get copyCall() {
		return tr("assets.copyCall");
	},
	get copied() {
		return tr("assets.copied");
	},
	get copyFailed() {
		return tr("assets.copyFailed");
	},
	/**
	 * Nothing changes until publishing. Without this line, an author who swaps a picture would believe
	 * the published version already changed. That misbelief delays republishing, the step treated here
	 * as the irreversible one.
	 */
	get publishNotice() {
		return tr("assets.publishNotice");
	},
	/** Renaming leaves the code unchanged. The copy says the source is not edited automatically. */
	get renameNotice() {
		return tr("assets.renameNotice");
	},
	get cancel() {
		return tr("assets.cancel");
	},
	get confirm() {
		return tr("assets.confirm");
	},
	/**
	 * Search is a single field. The name looks like a path, so a prefix works like folder navigation.
	 */
	get searchLabel() {
		return tr("assets.searchLabel");
	},
	get searchPlaceholder() {
		return tr("assets.searchPlaceholder");
	},
	/** Kind filter label. Its words match the row icons (picture and note). */
	get kindFilterLabel() {
		return tr("assets.kindFilterLabel");
	},
	get kindFilter() {
		return {
			all: tr("assets.kindFilter.all"),
			image: tr("assets.kindFilter.image"),
			audio: tr("assets.kindFilter.audio"),
		};
	},
	/** When the filter yields nothing, the message differs from 'no assets at all'. */
	get noMatch() {
		return tr("assets.noMatch");
	},
	get clearQuery() {
		return tr("assets.clearQuery");
	},
	/**
	 * Heading for the list of references. In the rename and remove dialog, it says what those rows
	 * are.
	 */
	get referencesHeading() {
		return tr("assets.referencesHeading");
	},
} as const;

/**
 * The fact that an assembled name exists, where it is unknown whether this name is used. Returns
 * null if there is none. The copy does not say 'may be used in N places': such a call could point
 * to a different name. All that is known is that the place exists.
 */
export const runtimeAssetAssembledNotice = (
	assembled: number,
): string | null =>
	assembled > 0 ? tr("assets.assembled", { count: assembled }) : null;

/** Trailing text when the direct references do not all fit in the dialog: how many more exist. */
export const runtimeAssetMoreReferences = (hidden: number): string =>
	tr("assets.moreReferences", { count: hidden });

/**
 * Remove confirmation: what remains is stated first. Same shape and reason as the disable-runtime
 * dialog. The user's fear is whether the action is an irreversible deletion, so that answer must
 * come first to be read.
 */
export const runtimeAssetRemoveConfirm = (
	path: string,
	references = 0,
	/** The noun follows the medium. A sound's removal dialog must not say 'image'. */
	kind: "image" | "audio" = "image",
) =>
	({
		title:
			kind === "audio"
				? tr("assets.removeConfirm.titleAudio")
				: tr("assets.removeConfirm.titleImage"),
		description:
			kind === "audio"
				? tr("assets.removeConfirm.descriptionAudio", { path })
				: tr("assets.removeConfirm.descriptionImage", { path }),
		/**
		 * If code calls this name, that fact is stated too. If not, the line is omitted entirely. The
		 * line `0 uses` is not drawn: it tells nothing and makes the confirmation a line longer,
		 * and a long confirmation stops being read.
		 */
		references: runtimeAssetReferenceNotice(
			references,
			kind === "audio"
				? tr("assets.removeConfirm.consequenceAudio")
				: tr("assets.removeConfirm.consequenceImage"),
		),
		confirm: tr("assets.removeConfirm.confirm"),
		cancel: tr("assets.removeConfirm.cancel"),
	}) as const;

/**
 * Notice for usages written directly in source; null if there are none. The word 'written directly'
 * is the point of this function. Assembled names (asset(`characters/sena/${face}`)) cannot be
 * counted, so 'used in exactly 3 places' would be a claim we cannot verify. Someone who deleted on
 * that basis could not find the cause of a vanished picture.
 */
export function runtimeAssetReferenceNotice(
	references: number,
	consequence: string,
): string | null {
	if (references <= 0) return null;
	return tr("assets.referenceNotice", { count: references, consequence });
}

/**
 * The sentence the rename dialog shows: when usages exist, that fact comes first. Order matters.
 * 'The code does not change automatically' alone would read as a general disclaimer, while a count
 * placed before it states what this action leaves behind.
 */
export const runtimeAssetRenameDescription = (references: number): string => {
	const notice = runtimeAssetReferenceNotice(
		references,
		RUNTIME_ASSETS.renameNotice,
	);
	return notice ?? RUNTIME_ASSETS.renameNotice;
};
