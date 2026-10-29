import type {
	ChatVisibleTrackingBlockKind,
	VisibleChatTrackingBlock,
} from "@rowcat/chat";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { translator } from "#/lib/i18n/current.ts";

/**
 * One **tracking block** the narration pack appends to the end of a response, drawn as a collapsed
 * panel.
 *
 * ## Why here and not as markdown
 *
 * The pack tells every response to end with a `<details>` block. This repository's markdown folds
 * raw HTML to characters (`safety.ts` in `@rowcat/markdown`; the `rehype-raw` ban has never
 * relaxed). Under that rule the block would show its tags and a dozen lines of internal state. So
 * it is split out of the body (`splitChatTrackingBlocks`) and drawn here as native UI, the same
 * route image tokens take.
 *
 * ## Only the character card reaches here
 *
 * The pack appends two blocks but this draws one. The progress log (`logic`) is the pack's internal
 * adjudication with no axis to turn it off, so drawing it would open a panel nobody chose on every
 * response (rationale in the header of `visibleChatTrackingBlocks` in `@rowcat/chat`). Filtering
 * happens on the body side and this component receives only the result. The type is already narrow,
 * so code passing the progress log here does not compile.
 *
 * **It is still collapsed.** The character card is a value the user reads, but it is appended on
 * every response. Left open, the conversation becomes a run of tables. The latest response's value
 * is the most accurate, and older ones pile up the further up you scroll.
 *
 * ## The content is drawn verbatim
 *
 * It is not parsed as a table. The format inside the block is free-form, chosen by the pack, and
 * claiming to know its syntax breaks on every pack update. The failure is not an error but a table
 * that looks empty, which nobody notices. Markdown does not apply either: `**` or `#` in the
 * internal state would become formatting.
 */
export function ChatTrackingPanel({
	block,
}: {
	block: VisibleChatTrackingBlock;
}) {
	const [open, setOpen] = useState(false);
	if (!block.content) return null;

	return (
		<div className="mt-3 rounded-md border text-xs">
			{/*
			 * `<details>` is not used because React must know the open state: the arrow direction and
			 * spacing depend on it. If the DOM held that state separately, the two would diverge when
			 * streaming re-renders this component.
			 */}
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((previous) => !previous)}
				className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-muted-foreground transition-colors hover:text-foreground"
			>
				<ChevronRight
					className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
					aria-hidden
				/>
				{trackingPanelLabel(block.kind)}
			</button>
			{open ? (
				/*
				 * `overflow-x-auto` is the whole layout of this panel. The internal state is long
				 * pipe-separated lines that always overflow on narrow screens; without the collapse, **the
				 * whole conversation would scroll horizontally** (body text never flows sideways).
				 */
				<pre className="overflow-x-auto border-t px-2.5 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
					{block.content}
				</pre>
			) : null}
		</div>
	);
}

/**
 * Panel names. **The source work's English names are not used as-is.**
 *
 * `Character Database` is the word the pack body gives the model as an instruction; the copy on
 * screen is ours. This is a `Record` over the vocabulary the table draws, so adding a kind without
 * deciding its copy does not compile. A block drawn for the first time cannot appear with an
 * English name.
 */
const trackingPanelLabel = (key: ChatVisibleTrackingBlockKind): string =>
	translator("chat")(`trackingPanel.${key}`);
