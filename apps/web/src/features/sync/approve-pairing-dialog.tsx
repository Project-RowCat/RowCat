import { SYNC_ERROR_CODE } from "@rowcat/contracts";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { Label } from "@rowcat/ui-web/components/label";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import { translator } from "#/lib/i18n/current.ts";
import { PairingCodeField } from "./pairing-code-field.tsx";

/**
 * Trusted device: approves the code a new device displays.
 *
 * Approval cannot be undone. The approved device receives the current DEK, and deleting the
 * server's relay row later does not take back what that device already knows. A real cancel
 * (rotating the DEK and re-uploading every server ciphertext) is outside this slice. So the copy
 * states this before approval. Saying 'you can revoke it later' after approval would be false, and
 * users would rely on it.
 *
 * No automatic approval path exists. A person copying the code and pressing the button is the only
 * place this protocol expresses 'trust this device'.
 */
export function ApprovePairingDialog({
	open,
	onClose,
	onApprove,
}: {
	open: boolean;
	onClose: () => void;
	/**
	 * Resolves on success and rejects on failure. The dialog, not the caller, chooses the failure
	 * wording.
	 */
	onApprove: (code: string) => Promise<void>;
}) {
	const fieldId = useId();
	/** One id per dialog instance. The reason is noted on the same line in `unlock-dialog.tsx`. */
	const errorId = `${fieldId}-error`;
	const { t } = useTranslation(["sync", "common"]);
	const [code, setCode] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [done, setDone] = useState(false);

	const close = (): void => {
		setCode("");
		setError(null);
		setDone(false);
		onClose();
	};

	const submit = async (): Promise<void> => {
		setBusy(true);
		setError(null);
		try {
			await onApprove(code);
			setDone(true);
		} catch (failure) {
			setError(messageFor(failure));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next && !busy) close();
			}}
		>
			<DialogContent className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-md`}>
				<DialogHeader>
					<DialogTitle>{t("approve.title")}</DialogTitle>
					<DialogDescription>{t("approve.description")}</DialogDescription>
				</DialogHeader>

				{done ? (
					<div className="flex flex-col gap-1">
						<p className="text-sm">{t("approve.approvedTitle")}</p>
						<p className="text-sm text-muted-foreground">
							{t("approve.approvedBody")}
						</p>
					</div>
				) : (
					<>
						{/*
						 * The field's name comes from its visible label. The placeholder (`XXXX-XXXX-…`) shows the format
						 * only and is not a name. It disappears once typing starts, and assistive technology would
						 * otherwise read the field as unlabeled.
						 */}
						<div className="flex flex-col gap-1.5">
							<Label htmlFor={fieldId}>{t("approve.label")}</Label>
							<PairingCodeField
								id={fieldId}
								value={code}
								onValueChange={setCode}
								onKeyDown={(event) => {
									if (event.key === "Enter" && !busy) void submit();
								}}
								placeholder="XXXX-XXXX-XXXX-XXXX"
								/*
								 * Case and hyphens are normalized by the receiving side anyway. The field still keeps the
								 * typed formatting so the user can compare it by eye. It must look like the code on the new
								 * device for the copied value to be checked.
								 */
								className="font-mono tracking-wider"
								aria-invalid={error !== null}
								aria-describedby={error ? errorId : undefined}
							/>
							{error && (
								<p
									id={errorId}
									className="text-sm text-destructive"
									role="alert"
								>
									{error}
								</p>
							)}
						</div>
						{/*
						 * The paragraph states what approval hands over, before the button is pressed. Without it, users
						 * read approval as 'adds a device to a list'.
						 */}
						<p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
							{t("approve.warning")}
						</p>
					</>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={close} disabled={busy}>
						{done ? t("common:actions.close") : t("common:actions.cancel")}
					</Button>
					{!done && (
						<Button
							onClick={() => void submit()}
							disabled={busy || code.length === 0}
						>
							{busy ? t("approve.submitting") : t("approve.submit")}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Maps a failure to a readable sentence. The key distinction is between a typo (`SyncCodecError`)
 * and a missing session (404). A typo is fixed by typing again. A missing session needs the new
 * device to generate a new code. One shared sentence would send both users to different screens
 * while they repeat the same mistake.
 */
function messageFor(failure: unknown): string {
	const t = translator("sync");
	const row = failure as { name?: string; code?: string; message?: string };
	if (row?.name === "SyncCodecError") return t("approve.malformed");
	if (row?.code === SYNC_ERROR_CODE.pairingNotFound)
		return t("approve.notFound");
	if (row?.code === SYNC_ERROR_CODE.pairingAlreadyApproved)
		return t("approve.alreadyApproved");
	if (row?.code === "account_restricted") return t("approve.restricted");
	if (row?.message === SYNC_ERROR_CODE.locked) return t("approve.locked");
	return t("approve.failed");
}
