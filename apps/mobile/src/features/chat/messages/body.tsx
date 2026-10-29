import type { ChatPlaceholderNames } from "@rowcat/chat";
import {
	parseChatContent,
	resolveChatPlaceholders,
	resolveSceneImage,
	splitChatTrackingBlocks,
	visibleChatTrackingBlocks,
} from "@rowcat/chat";
import type { ChatSeedSceneImageDto } from "@rowcat/contracts/chat";
import type { ColorName } from "@rowcat/design";
import { space } from "@rowcat/design";
import { RemoteImage } from "@rowcat/ui-native";
import { Fragment, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../../lib/api.ts";
import { MarkdownView } from "../../markdown/markdown-view.tsx";
import { TrackingPanel } from "./tracking-panel.tsx";

/**
 * Message body: draws text and scene images in order. Same job as web's `chat-body.tsx`, with the
 * piece-splitting rule shared (`parseChatContent` in `@rowcat/chat`); only the drawing code
 * differs.
 *
 * - The `[img:night]` token is not markdown: through the parser it reads as a link reference or
 *   literal text. Split into pieces first and hand only text pieces to markdown.
 * - The caret attaches to the last text piece, since an image piece has no glyph to attach to. It
 *   disappears while a response ends on an image, which is accurate; the next character creates a
 *   new text piece and the caret returns.
 */

/**
 * One scene image. Drawing is the shared `RemoteImage`'s job (ratio, failure folding, radius), the
 * same capability markdown images use (`features/markdown/markdown-view.tsx`), so two images in one
 * conversation do not differ; only trigger resolution is here. An unknown trigger, a deleted asset
 * and a load failure all fold to nothing. No name is passed because the trigger is a matching word,
 * not a description, and a screen reader would read an internal identifier.
 */
function SceneImage({
	trigger,
	sceneImages,
}: {
	trigger: string;
	sceneImages: readonly ChatSeedSceneImageDto[];
}) {
	const found = resolveSceneImage(sceneImages, trigger);
	if (!found) return null;

	return (
		<View style={body.image}>
			<RemoteImage uri={getRowCatClient().media.url(found.assetId)} />
		</View>
	);
}

export function MessageBody({
	content,
	sceneImages,
	names,
	tone,
	caret,
}: {
	content: string;
	/** This room's scene images; without them the token draws nothing. */
	sceneImages?: readonly ChatSeedSceneImageDto[];
	/**
	 * What `{{char}}` and `{{user}}` are; used only when drawing, as on web. The stored body is
	 * untouched: copy takes the stored original and the edit form receives it.
	 */
	names?: ChatPlaceholderNames;
	tone: ColorName;
	/** Streaming marker; when present, incomplete tokens are hidden. */
	caret?: ReactNode;
}) {
	// Substitution comes first: after splitting, every piece would need the same line and a missed one
	// would leave the placeholder in that piece only (same order as web).
	const source = names ? resolveChatPlaceholders(content, names) : content;
	// Tracking blocks are split off before markdown, as on web: passing the pack's `<details>` block
	// through would print its tags and internal state as text at the end of every response (markdown
	// folds raw HTML to characters). Without a pack this is one regex and the body is returned as is.
	const { body: text, blocks } = splitChatTrackingBlocks(source, {
		streaming: caret !== undefined,
	});
	const nodes = parseChatContent(text, { streaming: caret !== undefined });
	const lastText = nodes.reduce(
		(found, node, index) => (node.type === "text" ? index : found),
		-1,
	);

	return (
		<>
			{nodes.map((node, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: pieces have no stable identity (same as web).
				<Fragment key={index}>
					{node.type === "text" ? (
						<MarkdownView
							source={node.text}
							tone={tone}
							caret={index === lastText ? caret : undefined}
						/>
					) : (
						<SceneImage
							trigger={node.trigger}
							sceneImages={sceneImages ?? []}
						/>
					)}
				</Fragment>
			))}
			{/* Only drawable blocks stand, via the same function as web (`visibleChatTrackingBlocks`). */}
			{visibleChatTrackingBlocks(blocks).map((block, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: same as above; blocks have no stable identity.
				<TrackingPanel key={index} block={block} />
			))}
		</>
	);
}

const body = StyleSheet.create({
	// Margin only; radius and clipping belong to `RemoteImage`. Markdown images omit it because
	// paragraph spacing already covers their place.
	image: { marginTop: space.md, width: "100%" },
});
