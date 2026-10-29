import {
	STORY_COMMENT_LIMITS,
	StoryCommentCreateRequest,
} from "@rowcat/contracts";
import type { StoryComment } from "@rowcat/domain";
import {
	createCommentMutationOptions,
	createCommentReplyMutationOptions,
} from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import { Textarea } from "@rowcat/ui-web/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import { AnimatedCount } from "#/lib/motion/animated-count.tsx";
import { commentErrorMessage } from "./comment-error.ts";

/**
 * When to start showing the character counter. Counting from the first character would put a limit
 * in view even on a short one-line reaction.
 */
const COUNTER_FROM = Math.floor(STORY_COMMENT_LIMITS.body * 0.8);

/**
 * Validity is decided by the contract (`StoryCommentCreateRequest`). Re-coding a `trim().length >
 * 0` check here would create two definitions of a valid body that drift apart. If the server
 * tightens the rule, the screen would pass the old one and users would learn of the failure only on
 * submit.
 *
 * The DOM `maxLength` is deliberately not set. It silently truncates pasted text and discards the
 * end of what the user wrote. Telling them they are over the limit is better.
 *
 * Enter inserts a newline and ⌘/Ctrl+Enter submits (§47). This is deliberately the opposite of the
 * chat input: the common mistake here is sending by accident, and there is no edit to undo.
 *
 * Replies use this same component: same limit, normalization, IME handling, synchronous
 * double-submit lock, and error copy. A second form would lose one of these, usually IME or the
 * lock, on one side. Only the mutation and the copy vary, and `parentId` decides both.
 */
export function CommentComposer({
	storyId,
	parentId = null,
	autoFocus = false,
	onCreated,
	onCancel,
}: {
	storyId: string;
	parentId?: string | null;
	/**
	 * Focus moves into the input on open, for replies only. A reply box appears right after the user
	 * presses `Reply`, so keyboard-only users would not know it appeared if focus did not follow. The
	 * top-level input is already on screen at load, so stealing focus there would jump a reader's
	 * scroll position.
	 */
	autoFocus?: boolean;
	/**
	 * Called only after the save is confirmed. The cache update has already been applied by the
	 * mutation.
	 */
	onCreated: (comment: StoryComment) => void;
	/** Only the reply form has a cancel. The top-level input cannot be dismissed. */
	onCancel?: () => void;
}) {
	const { t } = useTranslation("comments");
	const [text, setText] = useState("");
	const queryClient = useQueryClient();
	const client = getRowCatClient();
	/**
	 * Both hooks are always called, since conditional hook calls break the rules of hooks. The unused
	 * one sends no request, so it costs nothing. Picking options with a ternary would give the same
	 * hook a different scope when the parent changes, mismatching in-flight request pairs.
	 */
	const createTop = useMutation(
		createCommentMutationOptions(client, queryClient, storyId),
	);
	const createReply = useMutation(
		createCommentReplyMutationOptions(
			client,
			queryClient,
			storyId,
			parentId ?? "",
		),
	);
	const mutation = parentId ? createReply : createTop;

	const fieldId = useId();
	const inputRef = useRef<HTMLTextAreaElement>(null);
	/**
	 * A ref, not state, because the value is never used in render. State would re-render on every
	 * keystroke and make long text input lag.
	 */
	const composingRef = useRef(false);
	/**
	 * A synchronous double-submit lock. `isPending` only becomes true after a re-render, so two clicks
	 * in the same frame (double-click, Enter mashing) would both pass and the same post would be saved
	 * twice. The server's rate limit only starts blocking at the fifth attempt, so both copies remain.
	 */
	const submittingRef = useRef(false);

	/**
	 * Focus moves to the input when the reply form opens. The `autoFocus` attribute is not used
	 * because on server-rendered documents it touches browser focus rules before hydration. This form
	 * mounts in the same frame as the user's click, so an effect gives a clearer order.
	 */
	useEffect(() => {
		if (autoFocus) inputRef.current?.focus();
	}, [autoFocus]);

	const parsed = StoryCommentCreateRequest.safeParse({ body: text });
	const overflow = text.trim().length - STORY_COMMENT_LIMITS.body;
	const canSubmit = parsed.success && !mutation.isPending;

	const submit = (): void => {
		if (!canSubmit || submittingRef.current || !parsed.success) return;
		submittingRef.current = true;
		const body = parsed.data.body;
		const settle = () => {
			submittingRef.current = false;
		};
		const accept = (comment: StoryComment) => {
			// Clear the text only after a successful save. Wiping rejected input would throw away what the
			// user wrote.
			setText("");
			onCreated(comment);
			inputRef.current?.focus();
		};

		if (parentId)
			createReply.mutate(body, {
				/** Reply forms pass on the confirmed reply. The parent has already applied the cache policy. */
				onSuccess: ({ reply }) => accept(reply),
				onSettled: settle,
			});
		else createTop.mutate(body, { onSuccess: accept, onSettled: settle });
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
		/**
		 * Escape closes the reply form. If the mouse were the only way to close a just-opened box,
		 * keyboard users would have to Tab many times to get back to the list. The top-level input has
		 * nothing to close, so this branch does not apply there.
		 */
		if (event.key === "Escape" && onCancel) {
			event.preventDefault();
			onCancel();
			return;
		}
		if (event.key !== "Enter") return;
		if (!(event.metaKey || event.ctrlKey)) return;
		// IME composition Enter is not treated as send. Otherwise the last character still being composed
		// would go out incomplete.
		if (composingRef.current || event.nativeEvent.isComposing) return;
		event.preventDefault();
		submit();
	};

	return (
		<form
			/**
			 * Setting `method` to post keeps a pre-hydration submit from putting the body into the URL. The
			 * same line exists in the login form (`features/auth/credentials-form.tsx`). This page is also
			 * server-rendered, and what would leak is the user's own text.
			 */
			method="post"
			className="flex flex-col gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			{/*
			 * Showing the label would add an empty line above the input. The name stays for assistive tech but
			 * is visually hidden.
			 */}
			<label htmlFor={fieldId} className="sr-only">
				{parentId ? t("replyInput") : t("commentInput")}
			</label>
			<Textarea
				id={fieldId}
				ref={inputRef}
				value={text}
				onChange={(event) => setText(event.target.value)}
				onKeyDown={onKeyDown}
				onCompositionStart={() => {
					composingRef.current = true;
				}}
				onCompositionEnd={() => {
					composingRef.current = false;
				}}
				placeholder={parentId ? t("replyPlaceholder") : t("commentPlaceholder")}
				rows={parentId ? 2 : 3}
				aria-invalid={overflow > 0 || undefined}
				aria-describedby={`${fieldId}-status`}
				/*
				 * Height is left to CSS (`field-sizing-content` in the primitive). Measuring and fitting by
				 * hand would need re-running whenever the font loads late or the width changes, and that
				 * measuring loop shows up as input lag.
				 */
				className={parentId ? "max-h-48 min-h-16" : "max-h-64 min-h-20"}
			/>

			<div className="flex flex-wrap items-center justify-between gap-2">
				{/*
				 * The status line: failure, character count and hints share one slot. It is a live region, so text
				 * is read as soon as it changes. A single slot keeps messages from stacking and pushing the button
				 * down.
				 *
				 * Role differs by content: failures and overflow use `alert` (interrupts), routine counts and hints
				 * use `status` (polite).
				 */}
				<p
					id={`${fieldId}-status`}
					role={mutation.isError || overflow > 0 ? "alert" : "status"}
					className={
						mutation.isError || overflow > 0
							? "text-sm text-destructive"
							: "text-xs text-muted-foreground"
					}
				>
					{overflow > 0 ? (
						t("overLimit", { limit: STORY_COMMENT_LIMITS.body, over: overflow })
					) : mutation.isError ? (
						commentErrorMessage(mutation.error)
					) : text.trim().length >= COUNTER_FROM ? (
						<>
							<AnimatedCount
								value={String(text.trim().length)}
								cadence="continuous"
							/>{" "}
							/ {STORY_COMMENT_LIMITS.body}
						</>
					) : (
						t("submitHint")
					)}
				</p>

				<div className="flex items-center gap-2">
					{onCancel && (
						<Button
							type="button"
							variant="ghost"
							size={parentId ? "sm" : undefined}
							onClick={onCancel}
						>
							{t("cancel")}
						</Button>
					)}
					{/*
					 * Top-level uses the default 36px size. `sm` (32px) is small for a thumb, and this is the only
					 * submit point in the section even on narrow screens. Replies are one step smaller, since the whole
					 * box is a secondary layer under its parent.
					 */}
					<Button
						type="submit"
						size={parentId ? "sm" : undefined}
						disabled={!canSubmit}
					>
						{mutation.isPending
							? t("posting")
							: parentId
								? t("postReply")
								: t("postComment")}
					</Button>
				</div>
			</div>
		</form>
	);
}
