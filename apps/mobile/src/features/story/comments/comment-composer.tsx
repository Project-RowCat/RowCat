import {
	STORY_COMMENT_LIMITS,
	StoryCommentCreateRequest,
} from "@rowcat/contracts";
import { space } from "@rowcat/design";
import type { StoryComment } from "@rowcat/domain";
import {
	createCommentMutationOptions,
	createCommentReplyMutationOptions,
} from "@rowcat/query";
import { Button, Notice, Text, Textarea } from "@rowcat/ui-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../../lib/api.ts";
import { AnimatedCount } from "../../../lib/motion/animated-count.tsx";
import type { ViewerAction } from "../../../lib/viewer-action.ts";
import { commentErrorMessage } from "./comment-error.ts";

/** When to start showing the character count. Counting from the start would put a limit on a one-line reaction. */
const COUNTER_FROM = Math.floor(STORY_COMMENT_LIMITS.body * 0.8);

/**
 * Comment composer — **four slots draw different things.**
 *
 * ```text
 * allowed      input box
 * sign-in      "Sign in to …" + `Sign in` button  — carries the return path
 * restricted   states the fact and draws no input box
 * unverified   "Checking your session" — **does not say guest**
 * ```
 *
 * The point is not drawing the input for guests and then blocking it. Letting someone write, and
 * only then telling them to sign in, is the worst order. The fourth slot is not folded into guest,
 * because the person's session may actually be alive; pushing a login button there reads as "you
 * were signed out".
 *
 * **Validity is decided by the contract** (`StoryCommentCreateRequest`). `trim().length > 0` is not
 * written again here, because then "what is a valid body" would exist twice: when the server
 * tightens a rule, the screen would still pass the old one, and the user would learn of the failure
 * only by pressing. No mobile-only limit or banned-word list here.
 *
 * `maxLength` is deliberately not set on the input. That attribute silently cuts a paste, so the
 * tail of what the user wrote disappears without a word. It is better to **say** the input
 * overflowed.
 */
export function CommentComposer({
	storyId,
	parentId = null,
	action,
	returnPath,
	onCreated,
	onCancel,
}: {
	storyId: string;
	/**
	 * If set, writes a reply to that comment. null means a top-level comment.
	 *
	 * A second form is not built, because the rules are the same: the same limit, the same
	 * normalization, the same synchronous double-submit lock, the same failure wording, the same four
	 * slots (`ViewerAction`). Split apart, one of them (usually the fourth slot or the double-submit
	 * lock) would exist on only one side, and the defect would appear only to people writing replies.
	 * Web's same component made the same call.
	 */
	parentId?: string | null;
	/** `viewerAction(session)` — the **same judgment** as the favorite button. */
	action: ViewerAction;
	returnPath: string;
	/** Called only after the save is confirmed — the mutation has already finished the cache update. */
	onCreated: (comment: StoryComment) => void;
	/** Only on the reply form — the top-level input cannot be closed. */
	onCancel?: () => void;
}) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const [text, setText] = useState("");
	const client = getRowCatClient();
	/**
	 * Both hooks are **always** called (a conditional call breaks the rules of hooks). The one not
	 * used sends no request, so it costs nothing.
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
	/**
	 * **Synchronous** double-submit lock.
	 *
	 * `mutation.isPending` becomes true only after a re-render, so two taps in the same frame both
	 * pass. The result is the same text saved twice. The server's rapid-fire check only starts
	 * blocking from the fifth request, so both copies stay.
	 */
	const submitting = useRef(false);

	if (action === "sign-in")
		return (
			<Notice
				message={
					parentId ? "Sign in to write a reply." : "Sign in to write a comment."
				}
				actionLabel="Sign in"
				onAction={() =>
					router.push({ pathname: "/login", params: { redirect: returnPath } })
				}
			/>
		);

	if (action === "restricted")
		return <Notice message="A restricted account can't write comments." />;

	if (action === "unverified")
		return <Notice message="Checking your session." />;

	const parsed = StoryCommentCreateRequest.safeParse({ body: text });
	const overflow = text.trim().length - STORY_COMMENT_LIMITS.body;
	const canSubmit = parsed.success && !mutation.isPending;

	const submit = () => {
		if (!canSubmit || submitting.current || !parsed.success) return;
		submitting.current = true;
		const body = parsed.data.body;
		const settle = () => {
			submitting.current = false;
		};
		const accept = (comment: StoryComment) => {
			// Clear only after the save succeeds — clearing a rejected input would lose what was written.
			setText("");
			onCreated(comment);
		};

		if (parentId)
			createReply.mutate(body, {
				/** A reply passes the confirmed **reply**; the parent was already swapped by the cache policy. */
				onSuccess: ({ reply }) => accept(reply),
				onSettled: settle,
			});
		else createTop.mutate(body, { onSuccess: accept, onSettled: settle });
	};

	return (
		<View style={composer.root}>
			<Textarea
				label={parentId ? "Write a reply" : "Write a comment"}
				labelHidden
				value={text}
				onChangeText={setText}
				placeholder={
					parentId ? "Leave a reply" : "Share what you thought of this story"
				}
				editable={!mutation.isPending}
				/** An overflowing input is a **wrong** input — the box says so with its border too. */
				invalid={overflow > 0 || mutation.isError}
			/>
			<View style={composer.foot}>
				{/**
				 * Status slot — failure, character count and notice share this one spot. A single slot means several
				 * lines never pile up and push the button down.
				 */}
				<View style={composer.status}>
					{overflow > 0 || mutation.isError ? (
						/**
						 * **The count does not roll inside the warning.** That slot is a sentence to be read, not a
						 * value, and if a number in it moves, the sentence becomes decoration. Web's same slot made
						 * the same call.
						 */
						<Text
							accessibilityRole="alert"
							variant="caption"
							tone="destructive"
						>
							{overflow > 0
								? `${overflow} characters over ${STORY_COMMENT_LIMITS.body}`
								: commentErrorMessage(mutation.error)}
						</Text>
					) : text.trim().length >= COUNTER_FROM ? (
						/**
						 * Only the current count rolls — the limit is a fixed fact. The value changes on every
						 * keystroke, so the rhythm is `continuous`, but **the moment it first appears past the
						 * threshold does not roll** (the box is newly mounted then, and mounting changes nothing).
						 */
						<View style={composer.counter}>
							<AnimatedCount
								value={String(text.trim().length)}
								cadence="continuous"
								variant="caption"
								tone="muted-foreground"
							/>
							<Text variant="caption" tone="muted-foreground">
								{` / ${STORY_COMMENT_LIMITS.body}`}
							</Text>
						</View>
					) : null}
				</View>
				{onCancel && (
					<Button
						label="Cancel"
						variant="ghost"
						size="sm"
						onPress={onCancel}
						disabled={mutation.isPending}
					/>
				)}
				<Button
					label={
						mutation.isPending ? "Posting" : parentId ? "Reply" : "Comment"
					}
					size="sm"
					onPress={submit}
					busy={mutation.isPending}
					disabled={!canSubmit}
				/>
			</View>
		</View>
	);
}

const composer = StyleSheet.create({
	root: { gap: space.sm },
	foot: { alignItems: "center", flexDirection: "row", gap: space.md },
	/** The status slot takes the remaining width, so several lines never pile up and push the button. */
	status: { flex: 1 },
	/** The rolling number and the fixed limit sit on one line — they are different kinds of value. */
	counter: { alignItems: "center", flexDirection: "row" },
});
