import type { ChatAttachment } from "@rowcat/chat";
import { FileText, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useChatScope } from "#/lib/local-chat/scope.ts";
import { showErrorToast } from "#/lib/toast.ts";

/**
 * The files this conversation reads on every turn, drawn right above the composer. **It is the
 * reason the feature reads as "always on"**: a file attached once and then visible nowhere near the
 * conversation would look like it was used for one reply and gone. Standing beside the box where
 * the next message is written, it says the model reads these with that message too.
 *
 * Each chip removes its file (the next turn reads without it). Listing, attaching more and the
 * usage against the cap belong to the settings pane; this strip only answers "what is attached".
 * Nothing is drawn for a room without files.
 */
export function AttachmentStrip({
	attachments,
}: {
	attachments: readonly ChatAttachment[];
}) {
	const { t } = useTranslation("chat");
	const { store } = useChatScope();
	if (attachments.length === 0) return null;
	return (
		<ul
			className="mb-1.5 flex min-w-0 flex-wrap gap-1.5"
			aria-label={t("attachments.readsEveryReply")}
		>
			{attachments.map((attachment) => (
				<li
					key={attachment.id}
					className="flex max-w-60 min-w-0 items-center gap-1 rounded-full border bg-muted/50 py-0.5 pr-0.5 pl-2 text-xs text-muted-foreground"
					title={`${attachment.name} · ${t("attachments.readsEveryReply")}`}
				>
					<FileText className="size-3.5 shrink-0" aria-hidden="true" />
					<span className="truncate">{attachment.name}</span>
					<button
						type="button"
						className="flex size-5 shrink-0 items-center justify-center rounded-full hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
						aria-label={t("attachments.remove", { name: attachment.name })}
						onClick={() => {
							if (!store) return;
							store.deleteAttachment(attachment.id).catch((failure) => {
								console.error("[chat] couldn't remove the file", failure);
								showErrorToast(t("attachments.removeFailed"));
							});
						}}
					>
						<X className="size-3" aria-hidden="true" />
					</button>
				</li>
			))}
		</ul>
	);
}
