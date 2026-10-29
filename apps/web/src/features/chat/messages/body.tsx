import type { ChatPlaceholderNames } from "@rowcat/chat";
import {
	parseChatContent,
	resolveChatPlaceholders,
	resolveSceneImage,
	splitChatTrackingBlocks,
	visibleChatTrackingBlocks,
} from "@rowcat/chat";
import type { ChatSeedSceneImageDto } from "@rowcat/contracts/chat";
import { Fragment, useMemo } from "react";
import { getRowCatClient } from "#/lib/api.ts";
import { ChatImage } from "./image.tsx";
import { ChatMarkdown } from "./markdown.tsx";
import { ChatTrackingPanel } from "./tracking-panel.tsx";

/**
 * One body block of a conversation. **It draws text and scene images in order.**
 *
 * This component only lays out the pieces. What counts as a piece is decided by the shared rule
 * (`parseChatContent` in `@rowcat/chat`), drawing text pieces belongs to the markdown renderer
 * (`chat-markdown.tsx`), and the address of an image piece comes from the SDK. None of the three is
 * judged again here. If that judgment lived here, mobile would keep a second copy of it.
 *
 * ## It creates no box
 *
 * It returns a list of block elements, and the box containing them is already provided by
 * `MessageRow`. Wrapping one more level here would make the streaming caret's `> *:last-child`
 * point at that wrapper, so the caret would attach to the end of the box instead of the end of the
 * paragraph (`STREAM_CARET` in `chat-markdown.tsx`).
 *
 * ## Why each piece runs markdown separately
 *
 * The tokens are not handed to markdown. `[img:night]` is **our** syntax, not markdown, so passing
 * it through the parser would read it as a link reference (`[foo]`) or leave it as literal text.
 * Splitting into pieces first and giving only the text pieces to markdown keeps the two syntaxes
 * from having to know each other.
 *
 * The cost is one parse per piece, which is cheap. For a conversation with no tokens (most of them)
 * there is **one** piece, so it is exactly the same single call as before (the performance contract
 * of `parseChatContent`).
 */

/**
 * One scene image. **Drawing is done by `ChatImage`; this only resolves the trigger.**
 *
 * The size cap, referrer, lazy loading and fold-on-failure come from **the same component** as
 * markdown images (`chat-image.tsx`). If each site wrote its own, two images in one conversation
 * would draw with different caps and radii, and the difference only shows when they are seen side
 * by side.
 *
 * It folds away silently in three cases:
 *
 * ```text
 * unknown trigger    nothing is drawn. Also a deleted image, a typo, or body text copied from another work
 * no address         same. This is the case for an old snapshot whose reference is broken
 * failed to load     same. No broken-image icon is left in its place
 * ```
 *
 * The alt text is not invented because we do not know what the image shows. The trigger is a word
 * the creator chose for matching (`night`, `hallway-2`), not a description, and putting it in `alt`
 * would have a screen reader read an internal identifier. `alt=""` means **decorative**, and it is
 * true that the text stands without this picture.
 */
function SceneImage({
	trigger,
	sceneImages,
}: {
	trigger: string;
	sceneImages: readonly ChatSeedSceneImageDto[];
}) {
	const src = useMemo(() => {
		const found = resolveSceneImage(sceneImages, trigger);
		return found ? getRowCatClient().media.url(found.assetId) : "";
	}, [sceneImages, trigger]);

	return <ChatImage src={src} alt="" className="mt-3" />;
}

export function ChatBody({
	content,
	/**
	 * This conversation's scene images. Without them the tokens draw nothing.
	 *
	 * They come down from the room record (a copy of the snapshot). Asking the server again here is
	 * the point: the room is a self-contained copy as of acquisition, so **a conversation already in
	 * progress keeps its scene even if the work later changes its picture.**
	 */
	sceneImages,
	/**
	 * What `{{char}}` and `{{user}}` refer to — a value used **only when drawing**.
	 *
	 * The stored body does not change by a character. Copy takes the stored original, search scans the
	 * stored body, and the edit form receives the original. What happens here is the same kind of step
	 * as markdown normalization, which also happens only on the render path (`normalizeChatMarkdown`).
	 *
	 * If the room has not been opened yet there are no names. The placeholder then shows literally and
	 * turns into the name when the room arrives. That is better than drawing an invented name for a
	 * frame.
	 */
	names,
	/** Whether it is still streaming in. Hides incomplete tokens. */
	streaming = false,
}: {
	content: string;
	sceneImages?: readonly ChatSeedSceneImageDto[];
	names?: ChatPlaceholderNames;
	streaming?: boolean;
}) {
	/*
	 * Substitution happens **first**. Placed later, every piece created by splitting out tracking
	 * blocks and `[img:…]` would need the same line, and missing it in one place would leave the
	 * placeholder only in that piece. This is why the assembler substitutes exactly once
	 * (`buildChatGenerationRequest` in `@rowcat/chat`).
	 *
	 * A body without braces (most of them) comes back as the **same string object**.
	 */
	const text = useMemo(
		() => (names ? resolveChatPlaceholders(content, names) : content),
		[content, names],
	);
	/**
	 * Tracking blocks are removed **before markdown.**
	 *
	 * The order is the rule. This repository's markdown neither executes nor strips raw HTML; it
	 * **folds it into characters** (`safety.ts` in `@rowcat/markdown`). If the `<details>` block the
	 * pack appends were passed through, the tag and a dozen lines of internal state would appear as
	 * literal text at the end of every response, and a conversation with the pack enabled would become
	 * unreadable. The scene image token takes the same path: split into pieces first, then only the
	 * text pieces go to the renderer.
	 *
	 * With no pack in use this is a single regex, and the body string comes back as the **same
	 * object**.
	 */
	const { body, blocks } = useMemo(
		() => splitChatTrackingBlocks(text, { streaming }),
		[text, streaming],
	);
	const nodes = useMemo(
		() => parseChatContent(body, { streaming }),
		[body, streaming],
	);

	return (
		<>
			{nodes.map((node, index) => (
				/**
				 * Index as key, because pieces have no identity.
				 *
				 * This does not conflict with the rule against using an index for message rows
				 * (`message-list.tsx`). That rule prevents the next row from taking the slot of a deleted row,
				 * which makes layout continuity lie. Here one message body is simply re-parsed as a whole, and
				 * no path reorders pieces. While streaming only the last piece grows, and when it settles this
				 * component is replaced by a new row.
				 */
				// biome-ignore lint/suspicious/noArrayIndexKey: pieces have no stable identity (see above).
				<Fragment key={index}>
					{node.type === "text" ? (
						<ChatMarkdown content={node.text} />
					) : (
						<SceneImage
							trigger={node.trigger}
							sceneImages={sceneImages ?? []}
						/>
					)}
				</Fragment>
			))}
			{/*
			 * Only the blocks that are drawn are kept (`visibleChatTrackingBlocks`), not every block that was split out. The
			 * progress record has no axis that turns it off, so nobody has chosen it as a panel, and it is not drawn. It is
			 * not filtered by `kind` here because that one line would then differ silently between the two apps.
			 */}
			{visibleChatTrackingBlocks(blocks).map((block, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: same as above, blocks have no stable identity.
				<ChatTrackingPanel key={index} block={block} />
			))}
		</>
	);
}
