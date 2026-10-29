import {
	type DraftRuntimeAsset,
	type DraftRuntimeAssetKind,
	RUNTIME_PROJECT_LIMITS,
} from "@rowcat/authoring";
import { MEDIA_ACCEPT, RUNTIME_AUDIO_ACCEPT } from "@rowcat/contracts";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@rowcat/ui-web/components/dropdown-menu";
import { Input } from "@rowcat/ui-web/components/input";
import { Label } from "@rowcat/ui-web/components/label";
import { Spinner } from "@rowcat/ui-web/components/spinner";
import { cn } from "@rowcat/ui-web/lib/utils";
import {
	Copy,
	FilePlus2,
	ImagePlus,
	MoreHorizontal,
	Music,
	Pencil,
	Search,
} from "lucide-react";
import {
	type ChangeEvent,
	type FormEvent,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import { AnimatedIconSwap } from "#/lib/motion/animated-icon-swap.tsx";
import {
	RUNTIME_ASSETS,
	runtimeAssetAssembledNotice,
	runtimeAssetMoreReferences,
	runtimeAssetRemoveConfirm,
	runtimeAssetRenameDescription,
} from "../runtime-copy.ts";
import {
	checkRuntimeAudioFile,
	formatRuntimeAudioDuration,
	looksLikeRuntimeAudio,
	runtimeAudioErrorMessage,
	runtimeAudioInputHint,
	runtimeAudioIssueMessage,
} from "./audio-file.ts";
import {
	checkRuntimeImageFile,
	runtimeImageErrorMessage,
	runtimeImageInputHint,
	runtimeImageIssueMessage,
} from "./file.ts";
import {
	countRuntimeAssetsByKind,
	EMPTY_RUNTIME_ASSET_QUERY,
	filterRuntimeAssets,
	isRuntimeAssetQueryActive,
	RUNTIME_ASSET_KIND_FILTERS,
	type RuntimeAssetListQuery,
} from "./list.ts";
import { planRuntimeAssetName, suggestRuntimeAssetName } from "./name.ts";
import {
	findRuntimeAssetReferences,
	type RuntimeAssetReferenceReport,
} from "./source.ts";
import type {
	RuntimeAssetActions,
	RuntimeUploadedAsset,
} from "./use-actions.ts";

/**
 * Managed asset list: a second section in the same column as the file explorer.
 * - Images and sounds share one list because the name space is one. A sound and an image cannot
 *   reuse the same name, and splitting the list would hide that.
 * - The kinds separate only when choosing a file: the dialog accepts both formats, and the chosen
 *   file's kind selects the upload route (`classify` here). The kind then travels with the value.
 * - Not a general asset manager: no folders, tags, or bulk selection, and no 'all uploaded
 *   images' list. A permanent-delete control would be a lie, since a published snapshot may still
 *   reference an image.
 * - Rename and removal only read the source. Their dialogs list direct usages by file and line
 *   plus places that cannot be resolved (`findRuntimeAssetReferences`). Nothing here rewrites
 *   source; auto-rewriting would need the editor's undo semantics settled across unsaved files, and
 *   any mistake would silently change the creator's source.
 * - Counts use the editor's current source, not storage, because autosave is debounced and a
 *   just-typed name may not be stored yet.
 */

/**
 * Thumbnail edge length in list rows. `size-9` fits beside one line of name in the 240px column.
 */
const THUMBNAIL = "size-9";

/**
 * The line under the name states a different fact for each media type.
 *
 * Absent axes are not written as 0. A sound showing `0×0` would read as an error rather than
 * information, and an image showing `0:00` would read as playing.
 */
function assetDetailLine(asset: DraftRuntimeAsset): string {
	/**
	 * The kind word always comes first. Someone who cannot tell symbols (picture or note) apart by
	 * color and shape would see two rows as the same, yet they are different assets usable only in
	 * different slots (`<Image>` or `<Audio>`).
	 */
	const kind = RUNTIME_ASSETS.kindFilter[asset.kind];
	if (asset.kind === "audio")
		return asset.durationMs === null
			? kind
			: `${kind} · ${formatRuntimeAudioDuration(asset.durationMs)}`;
	return asset.width === null || asset.height === null
		? kind
		: `${kind} · ${asset.width}×${asset.height}`;
}

/**
 * Upper bound on reference lines in the dialog. Beyond it, the rest fold into `and N more` so the dialog
 * does not exceed the screen.
 */
const REFERENCE_LIST_LIMIT = 6;

export interface RuntimeAssetsPanelProps {
	assets: readonly DraftRuntimeAsset[];
	actions: RuntimeAssetActions;
	/** Maps media identity to a preview address. The SDK's rule is not restated in this component. */
	mediaUrl: (mediaId: string) => string;
	/**
	 * Clipboard action. The success and failure messages are rendered by the caller, because this
	 * action lives in a menu that disappears.
	 */
	onCopy: (text: string) => void;
	/**
	 * Current editor source, read only. Used as the material for finding direct usages during rename
	 * and removal. It is a snapshot rather than the stored records; the reason is in the file header.
	 */
	sources: readonly { path: string; content: string }[];
}

/** What the sheet currently shows. All three share one slot, so they form a single union. */
type Sheet =
	| { kind: "add"; file: File; media: DraftRuntimeAssetKind; name: string }
	| { kind: "rename"; asset: DraftRuntimeAsset; name: string }
	| { kind: "remove"; asset: DraftRuntimeAsset };

export function RuntimeAssetsPanel({
	assets,
	actions,
	mediaUrl,
	onCopy,
	sources,
}: RuntimeAssetsPanelProps) {
	const { t } = useTranslation(["runtimeStudio", "common"]);
	const addInputRef = useRef<HTMLInputElement>(null);
	const replaceInputRef = useRef<HTMLInputElement>(null);
	/**
	 * The asset that replacement targets. The list can change while the file dialog is open, so it is
	 * held by id.
	 */
	const replacingRef = useRef<{
		id: string;
		kind: DraftRuntimeAssetKind;
	} | null>(null);
	const [sheet, setSheet] = useState<Sheet | null>(null);
	const [pending, setPending] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	/**
	 * Find condition. This is screen state, not stored in the URL or device storage. The studio
	 * remounts by draft id (`remountDeps`), so switching drafts clears the condition too, and a
	 * previous draft's query never filters the next draft's list.
	 */
	const [query, setQuery] = useState<RuntimeAssetListQuery>(
		EMPTY_RUNTIME_ASSET_QUERY,
	);
	const visible = useMemo(
		() => filterRuntimeAssets(assets, query),
		[assets, query],
	);
	const counts = useMemo(() => countRuntimeAssetsByKind(assets), [assets]);
	/**
	 * A synchronous copy that blocks a second submit within the same tick. Render state lags one
	 * frame.
	 */
	const busyRef = useRef(false);

	/**
	 * Whether more can be bound. The limit is the same value for authoring and publishing
	 * (`RUNTIME_PROJECT_LIMITS.assets`, read from the publish contract). If they differed, the creator
	 * would hit the rejection only at publish time, when deciding what to remove is a question asked
	 * after all the work is done.
	 */
	const full = assets.length >= RUNTIME_PROJECT_LIMITS.assets;

	/**
	 * The name the sheet targets: the asset's current name, not the typed input. Counting by input
	 * would rescan the whole project on every keystroke, and what must be counted is how many places
	 * the name has before the change.
	 */
	const target =
		sheet === null || sheet.kind === "add" ? null : sheet.asset.path;
	const references = useMemo(
		() =>
			target === null
				? NO_REFERENCES
				: findRuntimeAssetReferences(sources, target),
		[target, sources],
	);

	/**
	 * Receives one file, decides which pipeline it belongs to, and pre-checks it.
	 *
	 * Deciding the kind once, here, is the point of this function. The kind travels in the value that
	 * flows downstream, so upload, authoring record, and replacement patch never ask again. Asking
	 * again would create four judgments, and the day one disagreed an MP3 would go to the image route.
	 *
	 * Sound is checked first. Browsers attach different MIME types to `.m4a`; if the image check ran
	 * first, that file would be rejected as an unsupported image format. The user picked sound and
	 * would be told about images.
	 *
	 * Replacement fixes the kind. When `expect` is given, a file of another kind is rejected. Silently
	 * slipping sound into an image slot would change what `<Image>` draws into sound with no notice;
	 * the project would learn about it only at the next playback.
	 */
	const accept = (
		event: ChangeEvent<HTMLInputElement>,
		expect?: DraftRuntimeAssetKind,
	): { file: File; kind: DraftRuntimeAssetKind } | null => {
		const file = event.target.files?.[0];
		event.target.value = "";
		// Cancelling the picker yields nothing. It does not mean undoing an earlier choice.
		if (!file) return null;
		const kind: DraftRuntimeAssetKind = looksLikeRuntimeAudio(file)
			? "audio"
			: "image";
		if (expect !== undefined && kind !== expect) {
			setFailure(
				expect === "audio"
					? RUNTIME_ASSETS.replaceKindAudio
					: RUNTIME_ASSETS.replaceKindImage,
			);
			return null;
		}
		if (kind === "audio") {
			const issue = checkRuntimeAudioFile(file);
			if (issue !== null) {
				setFailure(runtimeAudioIssueMessage(issue));
				return null;
			}
			return { file, kind };
		}
		const issue = checkRuntimeImageFile(file);
		if (issue !== null) {
			setFailure(runtimeImageIssueMessage(issue));
			return null;
		}
		return { file, kind };
	};

	const onPickNew = (event: ChangeEvent<HTMLInputElement>): void => {
		const picked = accept(event);
		if (picked === null) return;
		const { file, kind } = picked;
		setFailure(null);
		/**
		 * Asks for the name. The file-derived value is not saved directly, because it would become the
		 * name the code must use. If we chose it silently, the creator would have to find a string in the
		 * source that they never wrote.
		 */
		setSheet({
			kind: "add",
			file,
			media: kind,
			name: suggestRuntimeAssetName(file.name),
		});
	};

	const onPickReplacement = (event: ChangeEvent<HTMLInputElement>): void => {
		const target = replacingRef.current;
		replacingRef.current = null;
		const picked = accept(event, target?.kind);
		if (picked === null || target === null) return;
		void withUpload(picked.file, picked.kind, async (uploaded) => {
			await actions.replace(target.id, uploaded);
		});
	};

	/**
	 * Upload, then store. The order is the rule.
	 *
	 * Upload comes first, so a failure leaves the draft unchanged. During replacement the order
	 * matters one level deeper: if the storage write fails, the old image stays in place, and the only
	 * loss is an unreferenced media file, which is cheaper than the creator's source.
	 */
	const withUpload = async (
		file: File,
		kind: DraftRuntimeAssetKind,
		commit: (uploaded: RuntimeUploadedAsset) => Promise<void>,
	): Promise<boolean> => {
		if (busyRef.current) return false;
		busyRef.current = true;
		setPending(true);
		setFailure(null);
		try {
			await commit(
				kind === "audio"
					? await actions.uploadAudio(file)
					: await actions.uploadImage(file),
			);
			return true;
		} catch (error) {
			/**
			 * Failure messages follow the media type too. A sound's rejection reason (duration exceeded) has
			 * no place in the image vocabulary. Folding that case into `Couldn't upload the image` would hide what the
			 * user needs to fix.
			 */
			setFailure(
				kind === "audio"
					? runtimeAudioErrorMessage(error)
					: runtimeImageErrorMessage(error),
			);
			return false;
		} finally {
			busyRef.current = false;
			setPending(false);
		}
	};

	const closeSheet = (): void => {
		setSheet(null);
		setFailure(null);
	};

	const submitSheet = async (): Promise<void> => {
		if (sheet === null) return;
		if (sheet.kind === "remove") {
			setPending(true);
			const ok = await actions.remove(sheet.asset.id);
			setPending(false);
			if (ok) closeSheet();
			return;
		}
		const checked = planRuntimeAssetName(
			assets,
			sheet.name,
			sheet.kind === "rename" ? { excludeId: sheet.asset.id } : {},
		);
		if (!checked.ok) {
			setFailure(checked.message);
			return;
		}
		if (sheet.kind === "rename") {
			setPending(true);
			const ok = await actions.rename(sheet.asset.id, checked.path);
			setPending(false);
			if (ok) closeSheet();
			return;
		}
		const ok = await withUpload(sheet.file, sheet.media, async (uploaded) => {
			await actions.bind(checked.path, uploaded);
		});
		if (ok) closeSheet();
	};

	return (
		<section
			aria-label={RUNTIME_ASSETS.title}
			className="flex min-h-0 shrink-0 flex-col border-t"
		>
			<header className="flex shrink-0 items-center gap-1 px-2 py-1.5">
				<h2 className="flex-1 truncate text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					{RUNTIME_ASSETS.title}
				</h2>
				{/*
				 * Both formats go through one dialog. Two buttons would force the creator to choose the kind before
				 * picking, and that choice is a question the file already in hand answers. The `accept` function
				 * decides the pipeline by inspecting the file.
				 */}
				<input
					ref={addInputRef}
					type="file"
					accept={`${MEDIA_ACCEPT},${RUNTIME_AUDIO_ACCEPT}`}
					className="hidden"
					onChange={onPickNew}
				/>
				<input
					ref={replaceInputRef}
					type="file"
					accept={`${MEDIA_ACCEPT},${RUNTIME_AUDIO_ACCEPT}`}
					className="hidden"
					onChange={onPickReplacement}
				/>
				<Button
					size="icon"
					variant="ghost"
					className="size-7"
					aria-label={RUNTIME_ASSETS.add}
					title={RUNTIME_ASSETS.add}
					disabled={pending || full}
					onClick={() => addInputRef.current?.click()}
				>
					<AnimatedIconSwap
						stateKey={pending && sheet === null ? "pending" : "idle"}
					>
						{pending && sheet === null ? (
							<Spinner />
						) : (
							<FilePlus2 aria-hidden="true" />
						)}
					</AnimatedIconSwap>
				</Button>
			</header>

			{/*
			 * Failures outside the list: the place used when no sheet is open (a file of the wrong format, a
			 * replacement upload failure). Failures while a sheet is open stay inside that sheet, because the
			 * action is still live there.
			 */}
			{sheet === null && failure !== null && (
				<p className="px-2 pb-1.5 text-xs text-destructive" role="alert">
					{failure}
				</p>
			)}

			{/*
			 * The finder appears only when assets are bound. An empty list with a search box only says there is
			 * nothing to find, in a longer way.
			 */}
			{assets.length > 0 && (
				<RuntimeAssetFinder query={query} counts={counts} onQuery={setQuery} />
			)}

			<div className="min-h-0 max-h-48 overflow-y-auto px-1 pb-2">
				{assets.length === 0 ? (
					<p className="px-1 py-1 text-xs text-muted-foreground">
						{RUNTIME_ASSETS.empty} {runtimeImageInputHint()} ·{" "}
						{runtimeAudioInputHint()}
					</p>
				) : visible.length === 0 ? (
					/**
					 * A filtered empty result is a different sentence from 'no assets', and the way back sits
					 * right beside it. The same sentence would make someone who forgot their search think their
					 * assets had disappeared.
					 */
					<p className="flex items-center gap-2 px-1 py-1 text-xs text-muted-foreground">
						<span>{RUNTIME_ASSETS.noMatch}</span>
						{isRuntimeAssetQueryActive(query) && (
							<button
								type="button"
								className="rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
								onClick={() => setQuery(EMPTY_RUNTIME_ASSET_QUERY)}
							>
								{RUNTIME_ASSETS.clearQuery}
							</button>
						)}
					</p>
				) : (
					<ul className="flex flex-col">
						{visible.map((asset) => (
							<li key={asset.id}>
								<div className="flex items-center gap-2 rounded-sm px-1 py-1 hover:bg-accent">
									{asset.kind === "audio" ? (
										/*
										 * A sound has no picture to draw, so the slot holds a symbol that names the media type.
										 * Leaving it blank would misalign the two rows' left margins, and inventing a picture (a
										 * waveform thumbnail) would make that waveform a decoration unrelated to the actual
										 * bytes.
										 *
										 * Sound is not played in the list. A player on each row would make this list own its
										 * lifecycle (where it stops, what happens when another asset is pressed), which is not
										 * the question this slice answers.
										 */
										<span
											aria-hidden="true"
											className={cn(
												THUMBNAIL,
												"flex shrink-0 items-center justify-center rounded-sm border bg-muted text-muted-foreground",
											)}
										>
											<Music className="size-4" />
										</span>
									) : (
										/*
										 * The thumbnail is not decoration; it is identity. The same name cannot be attached to
										 * two pictures, so telling which is which in the list is this picture's job. That is why
										 * `alt` is non-empty and carries the name itself.
										 */
										<img
											src={mediaUrl(asset.assetId)}
											alt={asset.path}
											loading="lazy"
											decoding="async"
											className={cn(
												THUMBNAIL,
												"shrink-0 rounded-sm border object-cover",
											)}
										/>
									)}
									<span className="min-w-0 flex-1">
										<span className="block truncate text-xs">{asset.path}</span>
										<span className="block truncate text-[0.6875rem] text-muted-foreground">
											{assetDetailLine(asset)}
										</span>
									</span>
									<DropdownMenu>
										<DropdownMenuTrigger
											render={
												<Button
													size="icon"
													variant="ghost"
													className="size-6 shrink-0"
													aria-label={t("assets.actions", { path: asset.path })}
												>
													<MoreHorizontal aria-hidden="true" />
												</Button>
											}
										/>
										<DropdownMenuContent align="end">
											<DropdownMenuItem
												onClick={() =>
													setSheet({
														kind: "rename",
														asset,
														name: asset.path,
													})
												}
											>
												<Pencil aria-hidden="true" />
												{RUNTIME_ASSETS.rename}
											</DropdownMenuItem>
											<DropdownMenuItem
												onClick={() => {
													replacingRef.current = {
														id: asset.id,
														kind: asset.kind,
													};
													replaceInputRef.current?.click();
												}}
											>
												<ImagePlus aria-hidden="true" />
												{RUNTIME_ASSETS.replace}
											</DropdownMenuItem>
											<DropdownMenuSeparator />
											<DropdownMenuItem onClick={() => onCopy(asset.path)}>
												<Copy aria-hidden="true" />
												{RUNTIME_ASSETS.copyName}
											</DropdownMenuItem>
											<DropdownMenuItem
												onClick={() => onCopy(`asset("${asset.path}")`)}
											>
												<Copy aria-hidden="true" />
												{RUNTIME_ASSETS.copyCall}
											</DropdownMenuItem>
											<DropdownMenuSeparator />
											<DropdownMenuItem
												variant="destructive"
												onClick={() => setSheet({ kind: "remove", asset })}
											>
												{RUNTIME_ASSETS.remove}
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
								</div>
							</li>
						))}
					</ul>
				)}
			</div>

			<RuntimeAssetSheet
				sheet={sheet}
				pending={pending}
				failure={failure}
				references={references}
				onName={(name) =>
					setSheet((current) =>
						current === null || current.kind === "remove"
							? current
							: { ...current, name },
					)
				}
				onCancel={closeSheet}
				onSubmit={() => void submitSheet()}
			/>
		</section>
	);
}

/**
 * The name dialog and the removal confirmation share one component. Splitting the three sheets
 * (add, rename, remove) would repeat the same layout and close rules three times, and one copy
 * could end up closing mid-operation.
 */
function RuntimeAssetSheet({
	sheet,
	pending,
	failure,
	references,
	onName,
	onCancel,
	onSubmit,
}: {
	sheet: Sheet | null;
	pending: boolean;
	failure: string | null;
	/**
	 * Direct usages in the current source, and places that cannot be checked. Empty for the sheet that
	 * binds a new asset.
	 */
	references: RuntimeAssetReferenceReport;
	onName: (name: string) => void;
	onCancel: () => void;
	onSubmit: () => void;
}) {
	const nameId = useId();
	if (sheet === null) return null;

	const remove = sheet.kind === "remove";
	const direct = references.sites.length;
	const copy = remove
		? runtimeAssetRemoveConfirm(sheet.asset.path, direct, sheet.asset.kind)
		: null;
	const assembled = runtimeAssetAssembledNotice(references.assembled);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		onSubmit();
	};

	return (
		<Dialog
			open
			onOpenChange={(next, details) => {
				/**
				 * While an operation is in progress, outside clicks and `Escape` do not close the dialog.
				 * `shouldCloseDialog` decides this.
				 */
				if (!next && shouldCloseDialog(details?.reason ?? "", pending))
					onCancel();
			}}
		>
			<DialogContent className={cn(DIALOG_VIEWPORT_BOUND, "sm:max-w-md")}>
				<form onSubmit={submit}>
					<DialogHeader>
						<DialogTitle>
							{copy?.title ??
								(sheet.kind === "rename"
									? RUNTIME_ASSETS.rename
									: RUNTIME_ASSETS.add)}
						</DialogTitle>
						<DialogDescription className="break-words">
							{copy?.description ??
								(sheet.kind === "rename"
									? runtimeAssetRenameDescription(direct)
									: RUNTIME_ASSETS.nameHint)}
						</DialogDescription>
					</DialogHeader>

					{/*
					 * The removal's usage note is a second line under the description. The first line answers 'what
					 * remains'; this line answers 'how the code changes now'. Merging them into one sentence would
					 * leave
					 * one unread. Without usages, the line is absent.
					 */}
					{copy?.references != null && (
						<p className="pb-2 text-sm text-muted-foreground">
							{copy.references}
						</p>
					)}

					{/*
					 * Lists each usage with its location. A count alone would make the creator search for the spot
					 * again, and they would close the dialog while searching. The new-asset sheet has no such list,
					 * because its premise is that no one uses the name yet.
					 */}
					{sheet.kind !== "add" && (
						<RuntimeAssetReferenceList
							report={references}
							assembled={assembled}
						/>
					)}

					{!remove && (
						<div className="flex flex-col gap-1.5 py-2">
							<Label htmlFor={nameId}>{RUNTIME_ASSETS.nameLabel}</Label>
							<Input
								id={nameId}
								value={sheet.name}
								autoFocus
								spellCheck={false}
								placeholder={RUNTIME_ASSETS.namePlaceholder}
								disabled={pending}
								onChange={(event) => onName(event.target.value)}
							/>
							{/*
							 * Nothing changes until publish. Without this line, a creator would believe that binding the image
							 * had already changed their published build.
							 */}
							<p className="text-xs text-muted-foreground">
								{RUNTIME_ASSETS.publishNotice}
							</p>
						</div>
					)}

					{failure !== null && (
						<p className="pb-2 text-sm text-destructive" role="alert">
							{failure}
						</p>
					)}

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							disabled={pending}
							onClick={onCancel}
						>
							{copy?.cancel ?? RUNTIME_ASSETS.cancel}
						</Button>
						<Button
							type="submit"
							variant={remove ? "destructive" : "default"}
							disabled={pending}
						>
							{pending && <Spinner />}
							{copy?.confirm ?? RUNTIME_ASSETS.confirm}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

const NO_REFERENCES: RuntimeAssetReferenceReport = { sites: [], assembled: 0 };

/**
 * Find row: one name field and three kind options.
 *
 * Kind options are toggle buttons whose selected state is announced by `aria-pressed`, so state is
 * not conveyed by color alone. They are not a `radiogroup`, for the same reason the explorer does
 * not use `tree`: those roles require arrow-key navigation and roving tab indexes, and a half-built
 * convention is worse than none.
 */
function RuntimeAssetFinder({
	query,
	counts,
	onQuery,
}: {
	query: RuntimeAssetListQuery;
	counts: Record<RuntimeAssetListQuery["kind"], number>;
	onQuery: (next: RuntimeAssetListQuery) => void;
}) {
	const searchId = useId();
	return (
		<div className="flex shrink-0 flex-col gap-1.5 px-2 pb-1.5">
			<label htmlFor={searchId} className="sr-only">
				{RUNTIME_ASSETS.searchLabel}
			</label>
			<div className="relative">
				<Search
					aria-hidden="true"
					className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					id={searchId}
					type="search"
					value={query.text}
					spellCheck={false}
					autoComplete="off"
					placeholder={RUNTIME_ASSETS.searchPlaceholder}
					className="h-7 pl-7 text-xs"
					onChange={(event) => onQuery({ ...query, text: event.target.value })}
				/>
			</div>
			<fieldset className="flex gap-1">
				<legend className="sr-only">{RUNTIME_ASSETS.kindFilterLabel}</legend>
				{RUNTIME_ASSET_KIND_FILTERS.map((kind) => (
					<Button
						key={kind}
						type="button"
						size="sm"
						variant={query.kind === kind ? "secondary" : "ghost"}
						aria-pressed={query.kind === kind}
						className={cn(
							"h-6 px-2 text-[0.6875rem]",
							query.kind === kind && "font-semibold",
						)}
						onClick={() => onQuery({ ...query, kind })}
					>
						{RUNTIME_ASSETS.kindFilter[kind]}
						<span className="tabular-nums text-muted-foreground">
							{counts[kind]}
						</span>
					</Button>
				))}
			</fieldset>
		</div>
	);
}

/**
 * Lists where the name is written directly, by file and line. Read only.
 *
 * Entries are not links that jump to the line. Jumping would close the dialog and change the
 * editor's selection, and someone trying to rename would wonder why the dialog closed. What is
 * needed here is to know the results in advance.
 */
function RuntimeAssetReferenceList({
	report,
	assembled,
}: {
	report: RuntimeAssetReferenceReport;
	assembled: string | null;
}) {
	if (report.sites.length === 0 && assembled === null) return null;
	const shown = report.sites.slice(0, REFERENCE_LIST_LIMIT);
	const hidden = report.sites.length - shown.length;
	return (
		<div className="flex flex-col gap-1 pb-2 text-sm">
			{shown.length > 0 && (
				<>
					<p className="text-xs font-medium text-muted-foreground">
						{RUNTIME_ASSETS.referencesHeading}
					</p>
					<ul className="flex flex-col gap-0.5 rounded-md border bg-muted/40 px-2 py-1.5 font-mono text-xs">
						{shown.map((site) => (
							<li
								key={`${site.file}:${site.line}:${site.column}`}
								className="truncate"
							>
								{site.file}:{site.line}
							</li>
						))}
						{hidden > 0 && (
							<li className="font-sans text-muted-foreground">
								{runtimeAssetMoreReferences(hidden)}
							</li>
						)}
					</ul>
				</>
			)}
			{assembled !== null && (
				<p className="text-xs text-muted-foreground">{assembled}</p>
			)}
		</div>
	);
}
