import type { ChatMessage, ChatPlaceholderNames } from "@rowcat/chat";
import type { ChatSeedSceneImageDto } from "@rowcat/contracts/chat";
import { cn } from "@rowcat/ui-web/lib/utils";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ASSISTANT_PROSE, MESSAGE_STACK_GAP } from "../chat-geometry.ts";
import { ChatBody } from "./body.tsx";
import { STREAM_CARET } from "./markdown.tsx";

/**
 * One message line.
 *
 * The body is drawn as markdown (`chat-markdown.tsx`), and `dangerouslySetInnerHTML` is still not
 * used. These texts are other people's works and model output, and none has a reason to run as HTML
 * on our page. Even when a renderer exists, what matters is whether it reads the syntax, not
 * whether it executes markup (react-markdown renders raw HTML as literal text by default).
 *
 * Line breaks are preserved, but that rule has left this file. Roleplay responses divide scenes by
 * paragraphs and line breaks, so collapsing them erases the structure of the text. In markdown
 * output it is the block that actually holds the prose, not the outer box, that must preserve them
 * (`PROSE_SOFT_BREAKS` in `chat-geometry.ts`).
 *
 * ## Both roles pass through the same renderer
 *
 * Bubbles are markdown too. Typing `*opens the door*` in roleplay is actually more common on the user side,
 * and splitting by role would draw the same text differently depending on who wrote it. What
 * differs is color and width, not syntax.
 *
 * ## The two roles are not symmetric; that is the layout of this screen
 *
 * Only user utterances are bubbles. Assistant responses use the full reading width with no bubble.
 *
 * Copying a messenger as-is (filled bubbles on both sides) reads badly in this product. Roleplay
 * responses are multi-paragraph prose, and inside a gray filled box most of the screen becomes
 * color and the paragraph structure gets buried. User utterances are usually a line or two, which
 * fits a bubble well, and above all a bubble tells **who spoke** from color and alignment alone.
 *
 * This pass widened that asymmetry. The bubble's maximum width dropped from 85%/75% to 86%/64%
 * (only desktop narrows it; on narrow screens 64% would wrap an utterance line into three), and
 * prose grew. Do not force the two roles into a mirrored half-and-half grid: one is text to read
 * and the other is an utterance that breaks the flow, so they have no reason to carry the same
 * weight.
 *
 * The bubble's silhouette is part of that judgment too. The asymmetric corner (`rounded-br-md`, the
 * bottom-right) says this utterance is **anchored to the right edge**. No tail is added because a
 * tail is decoration; what is needed here is direction, not an imitation of a speech bubble.
 */
export function MessageRow({
	message,
	/** Whether this is the temporary bubble being streamed. It is drawn with the same shape as a stored message. */
	pending = false,
	/**
	 * Whether this row was just jumped to from a search result. **This is screen state, not a
	 * record.**
	 *
	 * `highlighted` is not written to storage. It would become a value synced to other devices, and a
	 * search result pressed on one device would glow on this screen the next day.
	 */
	highlighted = false,
	/**
	 * This message's action row: copy, edit, regenerate, delete-from-here.
	 *
	 * It is passed as a node because this component draws **saved messages and the temporary streaming
	 * row together**. The temporary row has no identity yet (it is not a record), so actions cannot
	 * stand there. Deciding that condition here would record the fact in two places (the list and this
	 * file), so the list passes this node only to saved rows.
	 */
	actions,
	/**
	 * The room's scene images, which the `[img:…]` tokens in the body point to.
	 *
	 * It is a room value, not a row value, so the list passes it down. The room is not re-queried here
	 * because this component also draws the temporary streaming row and story-test rows, and two of
	 * those have no room to query.
	 */
	sceneImages,
	/** Names for `{{char}}` and `{{user}}`. The list passes them down for the same reason as scene images. */
	names,
}: {
	message: Pick<ChatMessage, "role" | "speaker" | "content" | "incomplete">;
	pending?: boolean;
	highlighted?: boolean;
	actions?: ReactNode;
	sceneImages?: readonly ChatSeedSceneImageDto[];
	names?: ChatPlaceholderNames;
}) {
	const { t } = useTranslation(["chat", "common"]);
	const isUser = message.role === "user";

	return (
		<div
			className={cn(
				/*
				 * `group/message` is what the action row reads hover and focus from. It is named because the
				 * list may one day have its own group; an anonymous group cannot tell which one reacts once
				 * they nest.
				 *
				 * Vertical spacing is a constant (`MESSAGE_STACK_GAP`). The space that grows when actions
				 * attach is estimated as `this gap + the action row's height` (`MESSAGE_ACTIONS_RESERVE_PX`),
				 * so writing `gap-1.5` here would silently make the estimate and the real layout diverge.
				 *
				 * Without `actions` the gap is not produced either: with one child, flex adds no gap. The
				 * estimate taking `hasActions` as an argument is the other half of that fact.
				 */
				"group/message flex min-w-0 flex-col",
				MESSAGE_STACK_GAP,
				isUser ? "items-end" : "items-start",
			)}
		>
			{/*
			 * The speaker name is attached only on the user side. Several characters can appear in one
			 * assistant response, so a single name there would be wrong information.
			 *
			 * It is small with wide letter spacing. This line is a **name tag on the bubble**, not text
			 * to read; flowing at the body's rhythm would make it read like the first line of the utterance.
			 */}
			{isUser && message.speaker && (
				<span className="pr-1.5 text-[0.6875rem] font-medium tracking-wide text-muted-foreground/80">
					{message.speaker}
				</span>
			)}
			<div
				className={cn(
					/*
					 * The mark on a row just jumped to: **only the color changes.**
					 *
					 * Size and position are left alone for two reasons. One is the virtualizer: if this row's
					 * height briefly changes, the scroll just set is off by that amount. The other is reduced
					 * motion: a flashing or growing effect must vanish entirely under that setting, but a color
					 * that fades in and out reads the same under any setting.
					 *
					 * The outline is a shadow (`ring`). A real border would enlarge the box.
					 */
					"min-w-0 transition-colors duration-500",
					/*
					 * The streaming caret attaches to this box's **own last block**. As a sibling, the last child
					 * is a block element, so the caret drops to the next line; a blank line sits below for the
					 * whole response and vanishes when committed, making the conversation jump one line. See
					 * `STREAM_CARET` in `chat-markdown.tsx`.
					 */
					pending && STREAM_CARET,
					/*
					 * The user bubble is already filled with the accent color, so a background change alone does
					 * nothing (`bg-primary` wins in the rule below). The mark is therefore an **outline**, and a
					 * gap the width of the background color lets it read even on a filled bubble. `ring` and
					 * `ring-offset` are both shadows, so the box size stays the same.
					 */
					highlighted &&
						"rounded-2xl bg-primary/10 ring-2 ring-primary ring-offset-4 ring-offset-background",
					isUser
						? /*
							 * Utterance — the point where it cuts into the narrative.
							 *
							 * Line-break rules match prose: keep words intact (`word-break: keep-all`) and fold only a
							 * long token with no break point (`break-words`). Without that, one address would push the
							 * bubble wide and the whole conversation would scroll sideways. Preserving line breaks is
							 * absent here for the same reason as in prose (the markdown block holds it). Writing the
							 * keep-all rule as `break-keep` makes tailwind-merge treat both as one group and drop one
							 * (see the `ASSISTANT_PROSE` comment in `chat-geometry.ts`).
							 */
							"max-w-[86%] rounded-[1.375rem] rounded-br-md bg-primary px-4 py-3 text-[0.9375rem] leading-[1.7] font-medium [word-break:keep-all] break-words text-primary-foreground shadow-sm sm:max-w-[64%]"
						: /*
							 * Prose: size, line height and line-break rules all live in `chat-geometry.ts`.
							 * The line height must be the **same value** as the virtualizer's one-line estimate.
							 */
							ASSISTANT_PROSE,
				)}
			>
				<ChatBody
					content={message.content}
					sceneImages={sceneImages}
					names={names}
					streaming={pending}
				/>
			</div>
			{/*
			 * A marker that the response was cut off. The content is not erased; instead it says where it
			 * stopped. Without a marker, the user assumes the model ended there on purpose.
			 *
			 * The short line in front marks this as **a note in the margin, not body text**. It is not made
			 * into a warning box: the response did arrive, just not to its end, so it has no reason to be
			 * the largest element on screen.
			 */}
			{message.incomplete && !pending && (
				<span className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
					<span aria-hidden="true" className="h-px w-5 bg-border" />
					{t("row.theReplyWasCutOff")}
				</span>
			)}
			{/*
			 * The action row sits **below the body**. Placing it above or beside would cover the line being
			 * read over the paragraph, and a placement that takes no space (absolute positioning) would overlap
			 * the neighbouring messages.
			 */}
			{actions}
		</div>
	);
}
