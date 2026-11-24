import type { ChatRoom } from "@rowcat/chat";
import { CHAT_ATTACHMENT_MAX_PER_ROOM } from "@rowcat/chat";
import { Button } from "@rowcat/ui-web/components/button";
import { FileText, Paperclip, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalAttachments } from "#/lib/local-chat/hooks.ts";
import { useChatScope } from "#/lib/local-chat/scope.ts";
import { ATTACHMENT_ACCEPT, attachFiles } from "../attachments/attach-files.ts";
import {
	attachmentLengthLabel,
	attachmentSupportedNote,
	attachmentUsage,
} from "../attachments/attachment-copy.ts";

/**
 * The **attachments** surface of room settings: the files this conversation's model reads on every
 * turn (`attachment.ts` in `@rowcat/chat`).
 *
 * - **The list is what the model reads.** Storage refuses what would not fit, so nothing here is
 *   silently cut; the usage line counts against the same cap the store checks.
 * - **No editor.** A file is replaced by removing it and attaching the new version. Editing a
 *   20,000-character document in a settings pane is a different screen.
 * - **Failures are inline.** The pane is open and is the place the person acted on, so a toast would
 *   say it somewhere else (`lib/toast.ts`). The composer's paperclip, which has no such place, uses a
 *   toast for the same sentences.
 * - **Removal has no confirmation.** It removes reference, not conversation: attaching the file again
 *   restores exactly what the model read, and the next turn simply reads without it.
 */
export function RoomSettingsAttachments({ room }: { room: ChatRoom }) {
	const { t } = useTranslation(["chat", "common"]);
	const { store } = useChatScope();
	const { items: attachments, loading } = useLocalAttachments(room.id);
	const [errors, setErrors] = useState<string[]>([]);
	const [busy, setBusy] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const full = attachments.length >= CHAT_ATTACHMENT_MAX_PER_ROOM;

	return (
		<div className="flex flex-col gap-3">
			<p className="text-sm text-muted-foreground">
				{t("attachments.description")}
			</p>
			<p className="text-xs text-muted-foreground">
				{attachmentSupportedNote()}
			</p>

			{errors.length > 0 ? (
				<ul className="flex flex-col gap-1" role="alert">
					{errors.map((message) => (
						<li key={message} className="text-sm text-destructive">
							{message}
						</li>
					))}
				</ul>
			) : null}

			{loading ? (
				<p className="text-sm text-muted-foreground">
					{t("common:state.loading")}
				</p>
			) : attachments.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t("attachments.empty")}
				</p>
			) : (
				<>
					<ul className="flex flex-col">
						{attachments.map((attachment) => (
							<li
								key={attachment.id}
								className="-mx-2 flex items-center gap-2 rounded-md px-2 py-2 hover:bg-accent"
							>
								<FileText
									className="size-4 shrink-0 text-muted-foreground"
									aria-hidden="true"
								/>
								<div className="min-w-0 flex-1">
									<p
										className="truncate text-sm font-medium"
										title={attachment.name}
									>
										{attachment.name}
									</p>
									<p className="text-xs text-muted-foreground">
										{attachmentLengthLabel(attachment)}
									</p>
								</div>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									aria-label={t("attachments.remove", {
										name: attachment.name,
									})}
									onClick={() => {
										if (!store) return;
										setErrors([]);
										store.deleteAttachment(attachment.id).catch((failure) => {
											console.error("[chat] couldn't remove the file", failure);
											setErrors([t("attachments.removeFailed")]);
										});
									}}
								>
									<Trash2 className="size-4" />
								</Button>
							</li>
						))}
					</ul>
					<p className="text-xs text-muted-foreground">
						{attachmentUsage(attachments)}
					</p>
				</>
			)}

			{/*
			 * The input is hidden and the button opens it: a native file input's own label is the
			 * browser's and cannot be translated. `multiple` because a setting document often comes in
			 * several files; each is checked on its own (`attachFiles`).
			 */}
			<input
				ref={inputRef}
				type="file"
				multiple
				accept={ATTACHMENT_ACCEPT}
				className="hidden"
				tabIndex={-1}
				aria-hidden="true"
				onChange={(event) => {
					const files = [...(event.target.files ?? [])];
					// Cleared at once so picking the same file again (after removing it) still fires.
					event.target.value = "";
					if (!store || files.length === 0) return;
					setErrors([]);
					setBusy(true);
					void attachFiles(store, room.id, files)
						.then((result) => setErrors(result.failures))
						.finally(() => setBusy(false));
				}}
			/>
			<Button
				type="button"
				variant="outline"
				className="self-start"
				disabled={full || busy || !store}
				onClick={() => inputRef.current?.click()}
			>
				<Paperclip className="size-4" /> {t("attachments.attach")}
			</Button>
			{full ? (
				<p className="text-sm text-muted-foreground">
					{t("attachments.limitCount", { max: CHAT_ATTACHMENT_MAX_PER_ROOM })}
				</p>
			) : null}
		</div>
	);
}
