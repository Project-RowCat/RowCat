import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";

/**
 * Deleting a tool removes it from every conversation at once, unlike a persona: rooms refer to a
 * tool by id instead of keeping a copy (user-tool.ts). The sentence says both halves of that: it
 * leaves every conversation, and replies already written stay, since a tool result was never part
 * of a stored message.
 */
export function ToolDeleteDialog({
	name,
	onClose,
	onDelete,
}: {
	name: string;
	onClose: () => void;
	onDelete: () => Promise<void>;
}) {
	const { t } = useTranslation(["tools", "common"]);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	/** One confirmation performs one deletion, even on a double press. */
	const pendingRef = useRef(false);

	const confirm = async (): Promise<void> => {
		if (pendingRef.current) return;
		pendingRef.current = true;
		setPending(true);
		setError(null);
		try {
			await onDelete();
			onClose();
		} catch (failure) {
			console.error("[tools] could not delete the tool", failure);
			setError(t("delete.failed"));
		} finally {
			pendingRef.current = false;
			setPending(false);
		}
	};

	return (
		<Dialog
			open
			onOpenChange={(next, details) => {
				if (!next && shouldCloseDialog(details.reason, pending)) onClose();
			}}
		>
			<DialogContent
				closeButtonDisabled={pending}
				className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-md`}
			>
				<DialogHeader className="min-w-0">
					<DialogTitle>{t("delete.title")}</DialogTitle>
					<DialogDescription className="break-words">
						<Trans
							t={t}
							i18nKey="delete.body"
							values={{ name }}
							components={{
								name: (
									<span className="font-medium font-mono text-foreground" />
								),
							}}
						/>
					</DialogDescription>
				</DialogHeader>
				{error && (
					<p role="alert" className="text-destructive text-sm">
						{error}
					</p>
				)}
				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={pending}>
						{t("common:actions.cancel")}
					</Button>
					<Button
						variant="destructive"
						onClick={() => void confirm()}
						disabled={pending}
					>
						{pending ? t("delete.deleting") : t("common:actions.delete")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
