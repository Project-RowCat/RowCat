import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { Input } from "@rowcat/ui-web/components/input";
import { Label } from "@rowcat/ui-web/components/label";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Unlocks the account with a recovery code. The two failure messages must stay distinct. A checksum
 * mismatch means the code was mistyped, and re-checking fixes it. An AEAD failure means the format
 * is valid but the code belongs to a different account, so the user must find another code. Merging
 * them into one sentence hides which next step applies.
 */
export function UnlockDialog({
	open,
	onClose,
	onUnlock,
}: {
	open: boolean;
	onClose: () => void;
	/**
	 * Resolves on success and rejects on failure. The failure message is chosen by this dialog (see
	 * messageFor).
	 */
	onUnlock: (code: string) => Promise<void>;
}) {
	const { t } = useTranslation(["sync", "common"]);
	const fieldId = useId();
	/**
	 * Each dialog instance needs its own error id. A module-level constant such as 'unlock-error'
	 * would collide while a closing dialog and a newly opened one are mounted together (the primitive
	 * keeps content alive during its exit animation). aria-describedby would then read the error of
	 * the dialog that is closing.
	 */
	const errorId = `${fieldId}-error`;
	const [code, setCode] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const submit = async (): Promise<void> => {
		setBusy(true);
		setError(null);
		try {
			await onUnlock(code);
			setCode("");
			onClose();
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
				if (!next && !busy) onClose();
			}}
		>
			<DialogContent className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-md`}>
				<DialogHeader>
					<DialogTitle>{t("unlock.title")}</DialogTitle>
					<DialogDescription>{t("unlock.description")}</DialogDescription>
				</DialogHeader>

				{/*
				 * The field's accessible name comes from its visible label. The placeholder (`RCAT-XXXX-…`) is
				 * a format example, not a name: it disappears once typing starts, and assistive tech reads the
				 * field as unnamed. The title and description give context but do not name this control.
				 */}
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={fieldId}>{t("unlock.label")}</Label>
					<Input
						id={fieldId}
						value={code}
						onChange={(event) => setCode(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !busy) void submit();
						}}
						placeholder="RCAT-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
						// Case and hyphens are normalized by the receiving side, so the user does not need to match
						// them.
						autoCapitalize="characters"
						spellCheck={false}
						className="font-mono"
						aria-invalid={error !== null}
						aria-describedby={error ? errorId : undefined}
					/>
					{/*
					 * `role="alert"` is required here. The message appears after the `Unlock` button is pressed,
					 * and it is the only thing that changes on screen then. Without the live role, a user who cannot
					 * see the screen gets no feedback, and the button appears to do nothing.
					 */}
					{error && (
						<p id={errorId} role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={busy}>
						{t("common:actions.cancel")}
					</Button>
					<Button
						onClick={() => void submit()}
						disabled={busy || code.length === 0}
					>
						{busy ? t("common:state.checking") : t("unlock.submit")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Maps a failure to a sentence the user can read. Cryptographic terms stay off the screen: 'AES-GCM
 * authentication failed' is accurate but does not say what the user can do.
 */
function messageFor(failure: unknown): string {
	const t = translator("sync");
	const name = failure instanceof Error ? failure.name : "";
	if (name === "SyncCodecError") return t("unlock.mistyped");
	return t("unlock.wrongCode");
}
