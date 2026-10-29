import type { DraftConflictRecovery, StoryDraft } from "@rowcat/authoring";
import {
	draftRecoveryDifferences,
	restoreDraftConflict,
} from "@rowcat/authoring";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { useState } from "react";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import { useAuthoringScope } from "#/lib/local-authoring/scope.ts";
import {
	useDraftRecoveries,
	useDraftRecoveryScope,
} from "#/lib/local-recovery/hooks.ts";
import {
	draftRecoveryCopy,
	draftRecoveryFieldLabel,
	draftRecoveryGroupLabel,
	draftRecoveryObservedText,
	draftRecoveryRestoreConfirm,
	draftRecoveryValueText,
} from "./recovery-copy.ts";

/**
 * The notice never blocks editing. Three easy mistakes are ruled out: a forced modal that demands a
 * decision, an automatic restore that writes values the user did not pick, and an auto-open after
 * sync that moves the screen and intercepts typing.
 *
 * So this is one line and one `OK` button. Nothing happens until it is pressed, and merely reading
 * the kept copy does not change any draft text.
 *
 * If no copy exists, nothing is rendered, not even a placeholder slot. Most edits have no conflict,
 * and an always-present empty slot becomes background that is missed when it matters.
 */
export function DraftRecoveryNotice({ draft }: { draft: StoryDraft }) {
	const { items } = useDraftRecoveries(draft.id);
	const [open, setOpen] = useState(false);

	if (items.length === 0) return null;

	return (
		<>
			<div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
				{/*
				 * `<output>` is implicitly `role="status"`, not `alert`, on purpose. This is not something the
				 * user did, and it does not justify interrupting their work, unlike an auto-save failure. It stays
				 * non-intrusive while still reaching assistive technology.
				 */}
				<output className="text-sm text-muted-foreground">
					{draftRecoveryCopy().notice}
				</output>
				<Button size="sm" variant="outline" onClick={() => setOpen(true)}>
					{draftRecoveryCopy().open}
				</Button>
			</div>
			{open ? (
				<DraftRecoveryDialog
					draft={draft}
					items={items}
					onClose={() => setOpen(false)}
				/>
			) : null}
		</>
	);
}

/**
 * Shows each kept copy with the kept value and the current value side by side. No character-level
 * diff: the question is what differed, not where, and character diffs make long prompts harder to
 * read. Only differing fields are shown, and both values are shown in full.
 */
function DraftRecoveryDialog({
	draft,
	items,
	onClose,
}: {
	draft: StoryDraft;
	items: DraftConflictRecovery[];
	onClose: () => void;
}) {
	const [pending, setPending] = useState(false);

	return (
		<Dialog
			open
			onOpenChange={(next, details) => {
				if (!next && shouldCloseDialog(details.reason, pending)) onClose();
			}}
		>
			<DialogContent
				closeButtonDisabled={pending}
				className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-2xl`}
			>
				<DialogHeader className="min-w-0">
					<DialogTitle>{draftRecoveryCopy().title}</DialogTitle>
					<DialogDescription>
						{draftRecoveryCopy().description}
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-4">
					{items.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							{draftRecoveryCopy().empty}
						</p>
					) : (
						items.map((recovery) => (
							<RecoveryCard
								key={recovery.id}
								recovery={recovery}
								draft={draft}
								onPending={setPending}
							/>
						))
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Confirmation is attached only to restore. Restore overwrites the currently saved value, so the
 * user must see what will change before pressing. Delete removes only one local copy and does not
 * carry the same weight. Confirming every button would make the confirmations go unread, including
 * the one that matters.
 *
 * Delete is also irreversible, so its warning text is placed beside the button up front.
 */
function RecoveryCard({
	recovery,
	draft,
	onPending,
}: {
	recovery: DraftConflictRecovery;
	draft: StoryDraft;
	onPending: (pending: boolean) => void;
}) {
	const authoring = useAuthoringScope();
	const recoveryScope = useDraftRecoveryScope();
	const [confirming, setConfirming] = useState(false);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);

	const groupLabel = draftRecoveryGroupLabel(recovery.group);
	const differing = draftRecoveryDifferences(recovery, draft);
	/**
	 * If no field differs, all fields of the group are shown. That means the values already match (the
	 * same value was written from another device, or the user reverted by hand). An empty card would
	 * not show what was kept.
	 */
	const fields =
		differing.length > 0
			? differing
			: (Object.keys(recovery.values) as typeof differing);

	async function run(
		action: () => Promise<string | null>,
		fallback: string,
	): Promise<void> {
		setBusy(true);
		onPending(true);
		setFailure(null);
		try {
			setFailure(await action());
		} catch {
			setFailure(fallback);
		} finally {
			setBusy(false);
			onPending(false);
		}
	}

	return (
		<section className="rounded-lg border p-4">
			<header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
				<h3 className="text-sm font-semibold">{groupLabel}</h3>
				<span className="text-xs text-muted-foreground">
					{draftRecoveryObservedText(recovery.observedAt)}
				</span>
			</header>

			<dl className="flex flex-col gap-3">
				{fields.map((field) => (
					<div key={field} className="min-w-0">
						<dt className="text-xs font-medium text-muted-foreground">
							{draftRecoveryFieldLabel(field)}
						</dt>
						<dd className="mt-1 grid gap-2 sm:grid-cols-2">
							<ValueBlock
								label={draftRecoveryCopy().preservedColumn}
								text={draftRecoveryValueText(field, recovery.values[field])}
								emphasized
							/>
							<ValueBlock
								label={draftRecoveryCopy().currentColumn}
								text={draftRecoveryValueText(field, draft[field])}
							/>
						</dd>
					</div>
				))}
			</dl>

			{failure ? (
				<p role="alert" className="mt-3 text-xs text-destructive">
					{failure}
				</p>
			) : null}

			{confirming ? (
				<div className="mt-3 rounded-md border border-border bg-muted/40 p-3">
					<p className="text-xs text-muted-foreground">
						{draftRecoveryRestoreConfirm(recovery.group)}
					</p>
					<div className="mt-2 flex gap-2">
						<Button
							size="sm"
							disabled={busy}
							onClick={() =>
								void run(async () => {
									const store = await authoring.ensureStore();
									const recoveryStore = await recoveryScope.ensureStore();
									if (!store || !recoveryStore)
										return draftRecoveryCopy().restoreFailed;
									/**
									 * Restore is a normal edit: it passes through `updateDraft` once, so it receives a new
									 * revision, becomes dirty, and auto-sync runs as usual. No path rewinds the old `rev` or
									 * `fieldRev`.
									 */
									const outcome = await restoreDraftConflict(
										{ authoring: store, recovery: recoveryStore },
										recovery,
									);
									if (outcome.status === "missing")
										return draftRecoveryCopy().restoreMissing;
									setConfirming(false);
									return null;
								}, draftRecoveryCopy().restoreFailed)
							}
						>
							{draftRecoveryCopy().restore}
						</Button>
						<Button
							size="sm"
							variant="ghost"
							disabled={busy}
							onClick={() => setConfirming(false)}
						>
							{draftRecoveryCopy().cancel}
						</Button>
					</div>
				</div>
			) : (
				<div className="mt-3 flex flex-wrap items-center gap-2">
					<Button size="sm" disabled={busy} onClick={() => setConfirming(true)}>
						{draftRecoveryCopy().restore}
					</Button>
					<Button
						size="sm"
						variant="ghost"
						disabled={busy}
						onClick={() =>
							void run(async () => {
								const store = await recoveryScope.ensureStore();
								if (!store) return draftRecoveryCopy().discardFailed;
								await store.discard(recovery.id);
								return null;
							}, draftRecoveryCopy().discardFailed)
						}
					>
						{draftRecoveryCopy().discard}
					</Button>
					<span className="text-xs text-muted-foreground">
						{draftRecoveryCopy().discardConfirm}
					</span>
				</div>
			)}
		</section>
	);
}

/**
 * One value cell. Long prompts end up here, so scrolling is contained within the cell's own box.
 */
function ValueBlock({
	label,
	text,
	emphasized,
}: {
	label: string;
	text: string;
	emphasized?: boolean;
}) {
	return (
		<div
			className={`min-w-0 rounded-md border p-2 ${emphasized ? "border-primary/40 bg-primary/5" : "bg-muted/30"}`}
		>
			<p className="text-[11px] uppercase tracking-wide text-muted-foreground">
				{label}
			</p>
			<p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-sm">
				{text}
			</p>
		</div>
	);
}
