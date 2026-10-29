import type { ColorName } from "@rowcat/design";
import { lineHeight, radiusScale, space } from "@rowcat/design";
import {
	type ChatMarkdownNodeType,
	type Nodes,
	parseChatMarkdown,
	type Root,
	type RootContent,
	safeImageUrl,
	safeLinkUrl,
} from "@rowcat/markdown";
import {
	Icon,
	RemoteImage,
	Text,
	type TextVariant,
	useTheme,
} from "@rowcat/ui-native";
import { Fragment, memo, type ReactNode, useMemo } from "react";
import { Linking, Platform, ScrollView, StyleSheet, View } from "react-native";

/**
 * Markdown renderer for conversation bodies. It shares meaning with the web renderer but not render
 * code: the web lets `react-markdown` turn the tree into DOM, while here the same tree becomes
 * native views. The parser, safety rules, normalization and node vocabulary all come from
 * `@rowcat/markdown`; this file owns presentation only.
 *
 * ```text
 * shared        grammar · the folding rule for unsafe URLs · raw HTML handling · node vocabulary
 * not shared    render code · colors and dimensions · scrolling · image loading
 * ```
 *
 * Parity means the same manuscript arrives with the same meaning on both screens (headings as
 * headings, lists as lists), not identical markup. That is checked through the vocabulary:
 * `RENDERERS` is `Record<ChatMarkdownNodeType, …>`, so a node kind added to the shared vocabulary
 * breaks compilation here. `markdown-view.test.ts` checks the same fact by value.
 *
 * ## Tone is an argument
 *
 * User bubbles are filled with the accent color and assistant responses sit on the background. The
 * same renderer runs in both places, so text color cannot be chosen here: the caller passes `tone`
 * and every `Text` in this file uses it. The web solves the same problem with `currentColor`.
 *
 * Surfaces and borders follow the same axis. A `colors.muted` surface on a filled bubble becomes a
 * gray patch the text blends into, so they are derived from the text color with alpha applied
 * (`useTheme().alpha`).
 *
 * ## Sizes are not written by hand
 *
 * A nested `Text` that sets its own size shrinks an emphasized heading to body size in place.
 * Inline renderers therefore pass their block's `variant` down unchanged. The absence of `fontSize`
 * in this file is not only for the static scan.
 */

/** Gap between blocks; the same decision as the web's `PROSE_BLOCK_GAP` (one line of prose). */
const BLOCK_GAP = lineHeight.reading;

/**
 * Heading sizes, folded to three steps. The web makes the same call (1.125em → 1.0625em → 1em).
 * This is a conversation, not a document: if a response starting with `# Chapter 1` drew the largest glyph
 * on screen, the conversation's rhythm would be dragged by that line. Level 4 and below carry no
 * meaning in roleplay manuscripts.
 */
const HEADING_VARIANT = ["title", "title", "body"] as const;

/**
 * Code font: the platform's own. As with `Text`, no font file is bundled (it would add bytes to the
 * first screen and a frame of late-loaded text). The names differ because the two OSes do not share
 * a font; both already ship with the system.
 */
const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

interface Context {
	/** Text color, chosen by the caller (`primary-foreground` inside a bubble). */
	tone: ColorName;
	/** Text size of the current block. Inline renderers inherit it unchanged. */
	variant: TextVariant;
	/** Text color with alpha applied; surfaces and borders are built from it. */
	alpha: (name: ColorName, value: number) => string;
	/** List item marker, created by `list` and passed to `listItem`. */
	marker?: ReactNode;
	/**
	 * Column alignment of the table. It belongs to the table axis (mdast's `table.align`), so `table`
	 * reads it and passes it down through each row to the cells. Dropping it would turn right-aligned
	 * columns left, and that shift reads as the table's intended shape rather than an error.
	 */
	columnAlign?: readonly (string | null)[];
	/** Alignment of this cell, chosen by its row. */
	align?: "left" | "center" | "right";
	/** Whether this row is the table header. GFM tables always have one header row. */
	head?: boolean;
	/**
	 * The streaming caret, appended to the **end** of the last block.
	 *
	 * As a sibling, a `View` block would push the caret onto the next line: an empty line sits below
	 * the response for the whole stream and vanishes on commit, so the conversation jumps. The web
	 * moves the caret into the last block's `::after` for the same reason; RN has no such syntax, so
	 * the value is passed down instead.
	 *
	 * Containers clear it when passing through (`children` does), otherwise every paragraph inside a
	 * quote would get its own caret.
	 */
	trailing?: ReactNode;
}

type NodeOfType<T extends string> = Extract<Nodes, { type: T }>;

type Renderer<T extends ChatMarkdownNodeType> = (
	node: NodeOfType<T>,
	ctx: Context,
	key: string,
) => ReactNode;

/**
 * One renderer per node kind. It must be a `Record`: with `Partial`, a missing kind would still
 * compile and that syntax would silently vanish in this app alone (no error or warning, the text
 * just never draws). Container kinds (`list`, `table`) do not draw their children directly but call
 * back into this table for the same reason: every entry in the table must actually be used, or the
 * coverage claim is a lie.
 */
type Renderers = { [T in ChatMarkdownNodeType]: Renderer<T> };

const children = (
	nodes: readonly RootContent[],
	ctx: Context,
	prefix: string,
): ReactNode[] => {
	/* The caret is attached **once** only; it must not be copied onto every child as it passes through a container. */
	const inner =
		ctx.trailing === undefined ? ctx : { ...ctx, trailing: undefined };
	return nodes.map((node, index) => render(node, inner, `${prefix}.${index}`));
};

function render(node: RootContent, ctx: Context, key: string): ReactNode {
	const renderer = RENDERERS[node.type as ChatMarkdownNodeType] as
		| Renderer<ChatMarkdownNodeType>
		| undefined;
	/*
	 * Unknown kinds draw **nothing.** A folded tree never contains a kind outside the vocabulary (the
	 * shared package's tests check this), so this branch does not actually run. Throwing here would
	 * turn one unknown syntax into a blank conversation.
	 */
	return renderer ? renderer(node as never, ctx, key) : null;
}

/**
 * Opens a link on press.
 *
 * The address already passed the shared policy, but it is checked once more here: two layers
 * stating the same rule is itself the defence.
 *
 * The nested `Text`'s `onPress` is used because the link sits **inside a sentence**. Wrapping it in
 * a `Pressable` would pull that fragment out of the flow onto its own line and break the sentence
 * at the link.
 */
const openLink = (url: string): void => {
	const safe = safeLinkUrl(url);
	if (!safe) return;
	Linking.openURL(safe).catch(() => {
		/* An address that cannot be opened does nothing; this is not an error to show on the conversation screen. */
	});
};

const RENDERERS: Renderers = {
	paragraph: (node, ctx, key) => (
		<Text
			key={key}
			variant={ctx.variant}
			tone={ctx.tone}
			leading="reading"
			selectable
		>
			{children(node.children, ctx, key)}
			{ctx.trailing}
		</Text>
	),

	heading: (node, ctx, key) => {
		const variant = HEADING_VARIANT[Math.min(node.depth, 3) - 1];
		return (
			<Text
				key={key}
				variant={variant}
				tone={ctx.tone}
				weight="semibold"
				selectable
				accessibilityRole="header"
			>
				{children(node.children, { ...ctx, variant }, key)}
				{ctx.trailing}
			</Text>
		);
	},

	/*
	 * The quote rule is a **sibling**, not a child. Passing it as `borderLeftColor` cannot take alpha
	 * (RN draws border colors as-is), so the line would jump out on a filled bubble. Not laying a
	 * surface behind it matches the web's decision: on this screen a colored block is already the
	 * vocabulary of a user bubble, so a gray box inside a response would read as someone else's
	 * speech.
	 */
	blockquote: (node, ctx, key) => (
		<View key={key} style={block.quote}>
			<View
				style={[
					block.quoteRule,
					{ backgroundColor: ctx.alpha(ctx.tone, 0.25) },
				]}
			/>
			<View style={block.quoteBody}>{children(node.children, ctx, key)}</View>
		</View>
	),

	list: (node, ctx, key) => (
		<View key={key} style={block.list}>
			{node.children.map((item, index) => {
				const ordinal = (node.start ?? 1) + index;
				return render(
					item,
					{
						...ctx,
						/*
						 * The start number is **the author's value** (a list starting at `5.` begins with the fifth
						 * item). Counting again from 1 would mean we changed the text.
						 */
						marker: node.ordered ? `${ordinal}.` : "•",
					},
					`${key}.${index}`,
				);
			})}
		</View>
	),

	listItem: (node, ctx, key) => (
		<View key={key} style={block.listItem}>
			{node.checked === null || node.checked === undefined ? (
				<Text variant={ctx.variant} tone={ctx.tone} style={block.marker}>
					{ctx.marker}
				</Text>
			) : (
				<TaskBox checked={node.checked} ctx={ctx} />
			)}
			<View style={block.listBody}>{children(node.children, ctx, key)}</View>
		</View>
	),

	code: (node, ctx, key) => (
		<View
			key={key}
			style={[block.code, { backgroundColor: ctx.alpha(ctx.tone, 0.1) }]}
		>
			{/*
			 * Code scrolls horizontally **only inside its own box**. Without this, a long line either wraps
			 * (destroying the code's shape, since indentation stops meaning anything) or pushes the whole
			 * conversation sideways. This does not conflict with the rule against a `FlatList` inside a
			 * `ScrollView`: what goes in here is one block of text, not a list.
			 */}
			<ScrollView horizontal showsHorizontalScrollIndicator={false}>
				<Text
					variant={ctx.variant}
					tone={ctx.tone}
					selectable
					style={block.mono}
				>
					{node.value}
				</Text>
			</ScrollView>
		</View>
	),

	thematicBreak: (_node, ctx, key) => (
		<View
			key={key}
			style={[block.rule, { backgroundColor: ctx.alpha(ctx.tone, 0.2) }]}
		/>
	),

	/*
	 * Images **always stand on their own line.** Folding guarantees it: every drawable image is lifted
	 * out of its paragraph and the rest fold to alt text (`safety.ts` in `@rowcat/markdown`), so this
	 * renderer is never called inside a `Text`. If it were, RN would silently drop an `Image` with no
	 * size.
	 */
	image: (node, ctx, key) => <MarkdownImage key={key} node={node} ctx={ctx} />,

	/*
	 * The table also scrolls inside its own box. Column widths are not fixed, so the content sets
	 * them: on a narrow device a four-column table forced into screen width would break words letter
	 * by letter.
	 */
	table: (node, ctx, key) => (
		<View key={key} style={block.tableFrame}>
			<ScrollView horizontal showsHorizontalScrollIndicator={false}>
				<View style={[block.table, { borderColor: ctx.alpha(ctx.tone, 0.2) }]}>
					{node.children.map((row, index) =>
						render(
							row,
							{ ...ctx, columnAlign: node.align ?? [], head: index === 0 },
							`${key}.${index}`,
						),
					)}
				</View>
			</ScrollView>
		</View>
	),

	tableRow: (node, ctx, key) => (
		<View key={key} style={block.tableRow}>
			{node.children.map((cell, index) =>
				render(
					cell,
					{
						...ctx,
						align: (ctx.columnAlign?.[index] as Context["align"]) ?? "left",
					},
					`${key}.${index}`,
				),
			)}
		</View>
	),

	tableCell: (node, ctx, key) => (
		<View
			key={key}
			style={[block.tableCell, { borderColor: ctx.alpha(ctx.tone, 0.2) }]}
		>
			<Text
				variant={ctx.variant}
				tone={ctx.tone}
				weight={ctx.head ? "semibold" : undefined}
				selectable
				style={{ textAlign: ctx.align ?? "left" }}
			>
				{children(node.children, ctx, key)}
			</Text>
		</View>
	),

	text: (node, _ctx, key) => <Fragment key={key}>{node.value}</Fragment>,

	/**
	 * Emphasis is drawn as a **dimmed layer**, the same value and reason as the web (`markdown.tsx`).
	 *
	 * In a conversation, asterisks mark what is not speech (action, description, aside). Korean has no
	 * true italic face, so slant alone is barely distinguishable from body text, and weight alone
	 * reads as emphasis rather than as a separate layer. Dimming is shared; the two markers differ by
	 * weight and slant.
	 */
	strong: (node, ctx, key) => (
		<Text
			key={key}
			variant={ctx.variant}
			tone={ctx.tone}
			weight="semibold"
			style={block.dim}
		>
			{children(node.children, ctx, key)}
		</Text>
	),

	emphasis: (node, ctx, key) => (
		<Text
			key={key}
			variant={ctx.variant}
			tone={ctx.tone}
			style={[block.italic, block.dim]}
		>
			{children(node.children, ctx, key)}
		</Text>
	),

	delete: (node, ctx, key) => (
		<Text key={key} variant={ctx.variant} tone={ctx.tone} style={block.strike}>
			{children(node.children, ctx, key)}
		</Text>
	),

	inlineCode: (node, ctx, key) => (
		<Text
			key={key}
			variant={ctx.variant}
			tone={ctx.tone}
			style={[block.mono, { backgroundColor: ctx.alpha(ctx.tone, 0.1) }]}
		>
			{node.value}
		</Text>
	),

	link: (node, ctx, key) => (
		<Text
			key={key}
			variant={ctx.variant}
			tone={ctx.tone}
			style={block.link}
			accessibilityRole="link"
			onPress={() => openLink(node.url)}
		>
			{children(node.children, ctx, key)}
		</Text>
	),

	/*
	 * A line break is a single glyph. Building it as a `View` makes Android push the line height or
	 * drop the node entirely inside a nested `Text` (the streaming caret is a glyph for the same
	 * reason).
	 */
	break: (_node, _ctx, key) => <Fragment key={key}>{"\n"}</Fragment>,
};

/**
 * One markdown image. Drawing belongs to the shared capability; this component holds only policy.
 *
 * Aspect ratio, failure folding, radius and resetting the state of a reused row all belong to
 * `RemoteImage`. Scene images use **the same capability**, so two images in one conversation never
 * draw by different rules.
 *
 * Three things remain here: checking the address once more (two layers stating the same rule is the
 * defence, as with links), passing alt text as the label, and leaving that text in place when
 * loading fails. This is where it differs from scene images, which leave nothing: the value's
 * nature decides it. A scene trigger is a matching keyword rather than a description, so a screen
 * reader would read an internal identifier.
 */
function MarkdownImage({
	node,
	ctx,
}: {
	node: NodeOfType<"image">;
	ctx: Context;
}) {
	const caption = node.alt?.trim() ?? "";
	const label = caption === "" ? undefined : caption;

	return (
		<RemoteImage
			uri={safeImageUrl(node.url)}
			accessibilityLabel={label}
			fallback={
				label === undefined ? null : (
					<Text
						variant={ctx.variant}
						tone={ctx.tone}
						leading="reading"
						selectable
					>
						{label}
					</Text>
				)
			}
		/>
	);
}

/**
 * A task-list checkbox — **cannot be toggled.**
 *
 * The stored value is the original text and this box is a picture of it. Making it look pressable
 * would promise a change we cannot keep: there is nowhere to store a toggled state (saving would
 * mean editing the source, which is a message edit). So it is a picture, not a `Pressable`, and its
 * state is stated by the accessibility role.
 */
function TaskBox({ checked, ctx }: { checked: boolean; ctx: Context }) {
	return (
		<View
			accessibilityRole="checkbox"
			accessibilityState={{ checked, disabled: true }}
			style={[
				block.taskBox,
				{
					borderColor: ctx.alpha(ctx.tone, 0.4),
					backgroundColor: checked ? ctx.alpha(ctx.tone, 0.12) : undefined,
				},
			]}
		>
			{checked ? <Icon name="check" size="sm" tone={ctx.tone} /> : null}
		</View>
	);
}

/**
 * Draws one conversation body.
 *
 * ## `memo` is the whole of performance
 *
 * While streaming, the flowing line changes every frame and the list re-renders with it. A settled
 * message's source does not change, so blocking re-render here means **only the one flowing line is
 * re-parsed**. Without it, every arriving token re-parses the markdown of every line on screen.
 *
 * `useMemo` is its partner: when the same line re-renders for another reason (theme switch, search
 * display) and the source is unchanged, the tree is not rebuilt.
 */
export const MarkdownView = memo(function MarkdownView({
	source,
	tone = "foreground",
	caret,
}: {
	source: string;
	/** Text color; `primary-foreground` inside a bubble. */
	tone?: ColorName;
	/**
	 * The streaming caret. If the last block holds text it attaches at that block's **end**; otherwise
	 * (code block, table, image) it stands on its own line, because there is no text to attach to.
	 */
	caret?: ReactNode;
}) {
	const { alpha } = useTheme();
	const tree: Root = useMemo(() => parseChatMarkdown(source), [source]);
	const ctx: Context = { tone, variant: "body", alpha };
	const blocks = tree.children;
	const last = blocks.at(-1);
	const inline =
		caret !== undefined &&
		(last?.type === "paragraph" || last?.type === "heading");

	return (
		<View style={block.root}>
			{blocks.map((node, index) =>
				render(
					node,
					inline && index === blocks.length - 1
						? { ...ctx, trailing: caret }
						: ctx,
					`md.${index}`,
				),
			)}
			{/*
			 * Stands on its own line when there was nowhere to attach. This branch also covers the moment
			 * before any text has arrived, when there are no blocks at all.
			 */}
			{caret !== undefined && !inline ? (
				<Text variant="body" tone={tone}>
					{caret}
				</Text>
			) : null}
		</View>
	);
});

const block = StyleSheet.create({
	/** Rhythm between blocks; the same value as the web's paragraph gap (one line of prose). */
	root: { gap: BLOCK_GAP, width: "100%" },
	italic: { fontStyle: "italic" },
	/** The layer emphasis sits on; the same value as the web's `opacity-75`. */
	dim: { opacity: 0.75 },
	strike: { textDecorationLine: "line-through", opacity: 0.6 },
	link: { textDecorationLine: "underline" },
	mono: { fontFamily: MONO },
	list: { gap: space.xs, width: "100%" },
	listItem: { flexDirection: "row", gap: space.sm, width: "100%" },
	/** The marker takes only its own width; the body takes the remaining width. */
	marker: { minWidth: space.lg },
	listBody: { flex: 1, gap: space.xs },
	quote: { flexDirection: "row", gap: space.md, width: "100%" },
	quoteRule: { borderRadius: radiusScale.sm, width: 2 },
	quoteBody: { flex: 1, gap: space.sm, opacity: 0.9 },
	code: {
		borderRadius: radiusScale.lg,
		padding: space.md,
		width: "100%",
	},
	rule: { borderRadius: radiusScale.sm, height: 1, width: "100%" },
	tableFrame: { width: "100%" },
	table: {
		borderTopWidth: 1,
		borderLeftWidth: 1,
		borderRadius: radiusScale.sm,
	},
	tableRow: { flexDirection: "row" },
	tableCell: {
		borderBottomWidth: 1,
		borderRightWidth: 1,
		minWidth: 96,
		paddingHorizontal: space.sm,
		paddingVertical: space.xs,
	},
	/** Not a 44pt target: the box is not pressable, so it only needs a size that sits beside text. */
	taskBox: {
		alignItems: "center",
		borderRadius: radiusScale.sm,
		borderWidth: 1,
		height: 18,
		justifyContent: "center",
		marginTop: 3,
		width: 18,
	},
});
