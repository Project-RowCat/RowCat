import { CHAT_ROOM_TITLE_MAX_LENGTH } from "@rowcat/chat";
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
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import { AnimatedCount } from "#/lib/motion/animated-count.tsx";
import type { ManagedRoom } from "./management.tsx";
import {
	COUNTER_THRESHOLD,
	planRename,
	renameFailureMessage,
	titleLength,
} from "./rename.ts";

/**
 * Rename a conversation.
 *
 * The rules are not here. What makes a valid title is decided by checkRoomTitle in
 * @rowcat/chat; this file only turns that verdict into a sentence. Rules in the form would
 * give mobile its own copy, and the two apps' title-length messages would drift apart.
 *
 * The dialog does not close until the save finishes. IndexedDB writes can fail (quota, or a
 * connection closed during an account switch). Closing first and then failing would make the user
 * read an unchanged name as changed.
 */

export function RenameRoomDialog({
	room,
	onClose,
	onRename,
}: {
	/** The room as it was when the menu was opened: its identity and the current title. */
	room: ManagedRoom;
	onClose: () => void;
	/** Resolves on success. A failure propagates and becomes the message shown below. */
	onRename: (title: string) => Promise<void>;
}) {
	const { t } = useTranslation(["chat", "common"]);
	/**
	 * One id per dialog instance. A module constant ("rename-room-error") would be wrong while a
	 * closing and a newly opened dialog are mounted together (the primitive keeps content during its
	 * exit animation). The same id would exist twice, and aria-describedby would read the first one
	 * found: the failure of the room just closed.
	 */
	const errorId = useId();
	const [title, setTitle] = useState(room.title);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	/**
	 * Blocks a second submit in the same tick: Enter and click can overlap, or the button can be
	 * pressed twice. setState is too late for this check, so both calls would see pending === false
	 * and pass. Hence a ref.
	 */
	const pendingRef = useRef(false);

	/**
	 * On open, the current name is selected. Renaming usually means typing a whole new name; leaving
	 * only the caret in place would force the user to delete first.
	 */
	useEffect(() => {
		const frame = requestAnimationFrame(() => inputRef.current?.select());
		return () => cancelAnimationFrame(frame);
	}, []);

	const length = titleLength(title);

	const submit = async (): Promise<void> => {
		if (pendingRef.current) return;
		/**
		 * What to do is decided by a pure function (rename-room.ts): invalid, unchanged, or save. Writing
		 * the three branches inside the form would make them impossible to check without rendering.
		 */
		const plan = planRename(title, room.title);
		if (plan.kind === "invalid") {
			setError(plan.message);
			inputRef.current?.focus();
			return;
		}
		if (plan.kind === "unchanged") {
			onClose();
			return;
		}

		pendingRef.current = true;
		setPending(true);
		setError(null);
		try {
			await onRename(plan.title);
		} catch (failure) {
			// The dialog stays open on failure. Closing after a failure would make the user read an
			// unchanged name as changed.
			console.error("[chat] couldn't rename the conversation", failure);
			setError(renameFailureMessage());
		} finally {
			pendingRef.current = false;
			setPending(false);
		}
	};

	return (
		<Dialog
			open
			/**
			 * Checks why it is closing. A dialog opened from a menu item would close immediately: when the
			 * menu returns focus to its trigger, that looks like an outside press (lib/dialog/dismiss.ts).
			 */
			onOpenChange={(next, details) => {
				if (!next && shouldCloseDialog(details.reason, pending)) onClose();
			}}
		>
			<DialogContent
				closeButtonDisabled={pending}
				className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-md`}
			>
				<DialogHeader>
					<DialogTitle>{t("renameDialog.rename")}</DialogTitle>
					<DialogDescription>
						{t("renameDialog.theNameOfTheConversation")}
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-1.5">
					<Input
						ref={inputRef}
						value={title}
						onChange={(event) => {
							setTitle(event.target.value);
							// Editing again clears the previous failure message, which no longer describes the current
							// state.
							if (error) setError(null);
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								void submit();
							}
						}}
						aria-label={t("renameDialog.conversationName")}
						aria-invalid={error !== null}
						aria-describedby={error ? errorId : undefined}
						disabled={pending}
					/>
					<div className="flex items-start justify-between gap-3">
						{error ? (
							<p id={errorId} role="alert" className="text-sm text-destructive">
								{error}
							</p>
						) : (
							<span />
						)}
						{/* The character count appears only when the limit is near (rename-room.ts). */}
						{length > COUNTER_THRESHOLD && (
							<span
								className={`shrink-0 text-xs tabular-nums ${
									length > CHAT_ROOM_TITLE_MAX_LENGTH
										? "text-destructive"
										: "text-muted-foreground"
								}`}
							>
								{/* Only the current count updates live; the limit is a fixed fact. */}
								<AnimatedCount value={String(length)} cadence="continuous" />/
								{CHAT_ROOM_TITLE_MAX_LENGTH}
							</span>
						)}
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={pending}>
						{t("common:actions.cancel")}
					</Button>
					<Button onClick={() => void submit()} disabled={pending}>
						{pending ? t("saving") : t("common:actions.save")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
