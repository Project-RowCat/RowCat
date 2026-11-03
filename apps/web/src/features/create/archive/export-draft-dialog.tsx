import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { FileDown } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DraftAutosave } from "#/features/create/editor/use-autosave.ts";
import { getRowCatClient } from "#/lib/api.ts";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import { useDraftCoverScope } from "#/lib/local-authoring/draft-cover-hooks.ts";
import { useAuthoringScope } from "#/lib/local-authoring/scope.ts";
import { DraftArchiveError, exportDraftArchive } from "./draft-archive.ts";
import { archiveFailureMessage } from "./failure.ts";

/**
 * The editor's `Export file`. It is a dialog, not a one-press download, because the file is the
 * whole manuscript in plaintext: prompt protection is a display policy on this product's screens and
 * says nothing about a file on someone's disk. That sentence has to be read before the file exists.
 *
 * Unsaved typing is flushed first — exporting the version without the sentence just written would
 * hand the person a file that is not what they see. If the flush fails, nothing is exported.
 */
export function ExportDraftDialogButton({
	draftId,
	autosave,
}: {
	draftId: string;
	autosave: DraftAutosave;
}) {
	const { t } = useTranslation(["create", "common"]);
	const authoring = useAuthoringScope();
	const covers = useDraftCoverScope();
	const [open, setOpen] = useState(false);
	const [pending, setPending] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const runningRef = useRef(false);

	const run = async () => {
		if (runningRef.current) return;
		runningRef.current = true;
		setPending(true);
		setFailure(null);
		try {
			if (!(await autosave.flush())) {
				setFailure(t("archive.failure.unsaved"));
				return;
			}
			const store = await authoring.ensureStore();
			const coverStore = await covers.ensureStore();
			if (!store || !coverStore) {
				setFailure(t("archive.failure.not_found"));
				return;
			}
			const client = getRowCatClient();
			const { file, fileName } = await exportDraftArchive(draftId, {
				store,
				covers: coverStore,
				fetchMedia: async (assetId, signal) => {
					const response = await fetch(client.media.url(assetId), {
						credentials: "include",
						signal,
					});
					if (!response.ok) throw new Error(`media ${response.status}`);
					return response.blob();
				},
				origin: window.location.origin,
				now: () => new Date().toISOString(),
			});
			downloadFile(file, fileName);
			setOpen(false);
		} catch (error) {
			console.error("[create] couldn't export the draft", error);
			setFailure(
				archiveFailureMessage(
					error instanceof DraftArchiveError ? error.reason : null,
				),
			);
		} finally {
			runningRef.current = false;
			setPending(false);
		}
	};

	return (
		<>
			<Button
				variant="outline"
				size="sm"
				onClick={() => {
					setFailure(null);
					setOpen(true);
				}}
			>
				<FileDown aria-hidden="true" />
				{t("archive.export.button")}
			</Button>
			{open && (
				<Dialog
					open
					onOpenChange={(next, details) => {
						if (!next && shouldCloseDialog(details.reason, pending)) {
							setOpen(false);
						}
					}}
				>
					<DialogContent
						closeButtonDisabled={pending}
						className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-md`}
					>
						<DialogHeader>
							<DialogTitle>{t("archive.export.title")}</DialogTitle>
							<DialogDescription>
								{t("archive.export.description")}
							</DialogDescription>
						</DialogHeader>
						<div className="flex flex-col gap-3 text-sm">
							<p>{t("archive.export.plaintext")}</p>
							<p className="text-muted-foreground">
								{t("archive.export.noAccount")}
							</p>
							{failure && (
								<p role="alert" className="text-destructive">
									{failure}
								</p>
							)}
						</div>
						<DialogFooter>
							<Button
								variant="outline"
								onClick={() => setOpen(false)}
								disabled={pending}
							>
								{t("common:actions.cancel")}
							</Button>
							<Button onClick={() => void run()} disabled={pending}>
								{pending
									? t("archive.export.exporting")
									: t("archive.export.confirm")}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
		</>
	);
}

/** A download the browser saves under our name; the object URL is released once the click has been handed off. */
function downloadFile(file: Blob, fileName: string) {
	const url = URL.createObjectURL(file);
	const link = document.createElement("a");
	link.href = url;
	link.download = fileName;
	link.rel = "noopener";
	document.body.append(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
