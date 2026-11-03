import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { FileUp } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import { useDraftCoverScope } from "#/lib/local-authoring/draft-cover-hooks.ts";
import { useAuthoringScope } from "#/lib/local-authoring/scope.ts";
import {
	DraftArchiveError,
	type DraftArchiveImportProgress,
	type DraftArchiveUploader,
	importDraftArchive,
} from "./draft-archive.ts";
import { archiveFailureMessage } from "./failure.ts";

type Phase =
	| { kind: "idle" }
	| { kind: "reading" }
	| { kind: "uploading"; progress: DraftArchiveImportProgress }
	| { kind: "saving" };

/**
 * `/create`'s `Import file`. An import always makes a **new** draft — it never looks for one to
 * overwrite, because the file carries no identity this device could match against, and guessing by
 * title would merge two works into one.
 *
 * The images and sounds go up through the same upload doors the studio uses, so they meet the same
 * validation and the same per-member limit. When that limit holds the next file back the dialog says
 * how long; it does not retry sooner. Closing the dialog cancels: nothing is written to the device
 * until every upload has finished.
 */
export function ImportDraftDialogButton() {
	const { t } = useTranslation(["create", "common"]);
	const navigate = useNavigate();
	const authoring = useAuthoringScope();
	const covers = useDraftCoverScope();
	const [open, setOpen] = useState(false);
	const [phase, setPhase] = useState<Phase>({ kind: "idle" });
	const [failure, setFailure] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const pending = phase.kind !== "idle";

	const close = () => {
		abortRef.current?.abort();
		abortRef.current = null;
		setOpen(false);
	};

	const run = async (file: File) => {
		if (abortRef.current) return;
		const controller = new AbortController();
		abortRef.current = controller;
		setFailure(null);
		setPhase({ kind: "reading" });
		try {
			const store = await authoring.ensureStore();
			const coverStore = await covers.ensureStore();
			if (!store || !coverStore) {
				setFailure(t("archive.failure.save_failed"));
				return;
			}
			const draft = await importDraftArchive(
				file,
				{
					store,
					covers: coverStore,
					upload: uploader(),
					stillOwnsStore: () => authoring.ownsStore(store),
					wait,
					onProgress: (progress) =>
						setPhase(
							progress.uploaded === progress.total &&
								progress.waitingMs === null
								? { kind: "saving" }
								: { kind: "uploading", progress },
						),
				},
				controller.signal,
			);
			if (controller.signal.aborted) return;
			setOpen(false);
			void navigate({
				to: "/create/$draftId",
				params: { draftId: draft.id },
			});
		} catch (error) {
			if (controller.signal.aborted) return;
			console.error("[create] couldn't import the story file", error);
			setFailure(
				archiveFailureMessage(
					error instanceof DraftArchiveError ? error.reason : null,
				),
			);
		} finally {
			if (abortRef.current === controller) abortRef.current = null;
			setPhase({ kind: "idle" });
			if (inputRef.current) inputRef.current.value = "";
		}
	};

	return (
		<>
			<Button
				variant="outline"
				onClick={() => {
					setFailure(null);
					setOpen(true);
				}}
			>
				<FileUp aria-hidden="true" />
				{t("archive.import.button")}
			</Button>
			{open && (
				<Dialog
					open
					onOpenChange={(next, details) => {
						// Cancelling is allowed while uploading — it is the way out of a long wait.
						if (!next && shouldCloseDialog(details.reason, false)) close();
					}}
				>
					<DialogContent className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-md`}>
						<DialogHeader>
							<DialogTitle>{t("archive.import.title")}</DialogTitle>
							<DialogDescription>
								{t("archive.import.description")}
							</DialogDescription>
						</DialogHeader>
						<div className="flex flex-col gap-3 text-sm">
							<p className="text-muted-foreground">
								{t("archive.import.rights")}
							</p>
							<input
								ref={inputRef}
								type="file"
								accept=".zip,application/zip"
								className="sr-only"
								tabIndex={-1}
								aria-hidden="true"
								onChange={(event) => {
									const file = event.currentTarget.files?.[0];
									if (file) void run(file);
								}}
							/>
							{pending && (
								<output aria-live="polite">{phaseLabel(phase, t)}</output>
							)}
							{failure && (
								<p role="alert" className="text-destructive">
									{failure}
								</p>
							)}
						</div>
						<DialogFooter>
							<Button variant="outline" onClick={close}>
								{t("common:actions.cancel")}
							</Button>
							<Button
								onClick={() => inputRef.current?.click()}
								disabled={pending}
							>
								{t("archive.import.choose")}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
		</>
	);
}

function phaseLabel(phase: Phase, t: TFunction<["create", "common"]>): string {
	switch (phase.kind) {
		case "reading":
		case "idle":
			return t("archive.import.reading");
		case "saving":
			return t("archive.import.saving");
		case "uploading":
			return phase.progress.waitingMs === null
				? t("archive.import.uploading", {
						uploaded: phase.progress.uploaded,
						total: phase.progress.total,
					})
				: t("archive.import.waiting", {
						seconds: Math.ceil(phase.progress.waitingMs / 1000),
					});
	}
}

/** The three studio upload doors, folded into the one shape the import reads back. */
function uploader(): DraftArchiveUploader {
	const me = getRowCatClient().me;
	return {
		sceneImage: async (file, signal) => {
			const asset = await me.uploadSceneImage(file, { signal });
			return {
				assetId: asset.mediaId,
				mime: "image/webp",
				width: asset.width,
				height: asset.height,
				durationMs: null,
			};
		},
		runtimeImage: async (file, signal) => {
			const asset = await me.uploadRuntimeImage(file, { signal });
			return {
				assetId: asset.mediaId,
				mime: asset.mime,
				width: asset.width,
				height: asset.height,
				durationMs: null,
			};
		},
		runtimeAudio: async (file, signal) => {
			const asset = await me.uploadRuntimeAudio(file, { signal });
			return {
				assetId: asset.mediaId,
				mime: asset.mime,
				width: null,
				height: null,
				durationMs: asset.durationMs,
			};
		},
	};
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason);
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal?.reason);
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
