import { BIO_LIMITS } from "@rowcat/contracts";
import { space } from "@rowcat/design";
import { canInteract, type Viewer } from "@rowcat/domain";
import {
	bioMutationOptions,
	nicknameMutationOptions,
	publicProfileQueryOptions,
} from "@rowcat/query";
import {
	Button,
	type IconName,
	Input,
	Text,
	Textarea,
} from "@rowcat/ui-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { FeedbackLine } from "../../lib/motion/feedback.tsx";
import { CREATOR_ROUTE } from "../profile/creator-route.ts";
import {
	BIO_LABEL,
	BIO_LOAD_FAILED,
	BIO_PLACEHOLDER,
	NICKNAME_LABEL,
	PROFILE_SECTION_DESCRIPTION,
	PROFILE_SECTION_TITLE,
	PUBLIC_PROFILE_LINK_LABEL,
	restrictionNote,
	SAVE_LABEL,
	SAVED_LABEL,
	SAVING_LABEL,
} from "./account-copy.ts";
import { accountErrorMessage } from "./account-error.ts";
import { AccountSection } from "./account-section.tsx";
import { AvatarField } from "./avatar-field.tsx";
import { PinnedStoriesField } from "./pinned-stories-field.tsx";
import {
	checkBio,
	checkNickname,
	dropStaleSaved,
	type SaveResult,
} from "./profile-form.ts";

/**
 * Profile: the values this screen sends out **publicly**. Same structure as the web
 * `profile-section.tsx`.
 *
 * The three fields (photo, nickname, bio) each save on their own. One `Save settings` at the bottom is not
 * used because no transaction spans different endpoints; that button would report a partial success
 * as success. One field failing does not mean another failed.
 *
 * All editing happens here: the public profile screen stays read-only, and one link to it ends this
 * section. No imitation preview is drawn here; it would drift from the real screen and the user
 * would misjudge how they look to others.
 */
export function ProfileSection({ viewer }: { viewer: Viewer }) {
	const router = useRouter();
	return (
		<AccountSection
			first
			title={PROFILE_SECTION_TITLE}
			description={PROFILE_SECTION_DESCRIPTION}
		>
			<View style={profile.stack}>
				<AvatarField viewer={viewer} />
				<NicknameField viewer={viewer} />
				<BioField viewer={viewer} />
				<PinnedStoriesField viewer={viewer} />
				<View style={profile.linkRow}>
					{/**
					 * Way to my own public profile. The address identity is the member id, not the nickname. `push`
					 * because this is a local trip to look and come back.
					 */}
					<Button
						label={PUBLIC_PROFILE_LINK_LABEL}
						variant="outline"
						size="sm"
						onPress={() =>
							router.push({
								pathname: CREATOR_ROUTE,
								params: { creatorId: viewer.id },
							})
						}
					/>
				</View>
			</View>
		</AccountSection>
	);
}

/** Save button text: `Save → Saving… → Saved`. The result goes stale once editing starts. */
const saveLabel = (pending: boolean, result: SaveResult): string =>
	pending ? SAVING_LABEL : result?.kind === "saved" ? SAVED_LABEL : SAVE_LABEL;

/**
 * The save button's glyph: the same two glyphs as the web `SaveLabel` (`save` → `check`).
 *
 * ⚠️ For a while this app's save button had no glyph. The words matched the web, so no check broke;
 * this is a difference only visible with the two screens side by side.
 *
 * Folding `pending` into `idle`'s glyph also matches the web. Here `busy` draws a spinner in that
 * span so the value goes unused, but the two tables stay the same shape so nobody fixes only one.
 */
const saveIcon = (result: SaveResult): IconName =>
	result?.kind === "saved" ? "check" : "save";

/**
 * The nickname field.
 *
 * Not saved per character: a saved nickname goes to the public work list and profile, so a
 * mid-typing value must not show on anyone's screen even briefly. The draft is screen state and the
 * server value is only the initial value: after a failure the cache rolls back but the typed text
 * must remain, so pressing again is enough.
 */
function NicknameField({ viewer }: { viewer: Viewer }) {
	const queryClient = useQueryClient();
	const [draft, setDraft] = useState(viewer.nickname);
	const [result, setResult] = useState<SaveResult>(null);
	const error = result?.kind === "error" ? result.message : null;

	/**
	 * Cache policy is `@rowcat/query`'s; this adds only the screen's work. Call the factory once and
	 * chain its callbacks; overriding by spread would silently drop the optimistic rollback, gallery
	 * invalidation and public-profile update.
	 */
	const policy = nicknameMutationOptions(getRowCatClient(), queryClient);
	const mutation = useMutation({
		...policy,
		onError: (...args) => {
			policy.onError?.(...args);
			setResult({ kind: "error", message: accountErrorMessage(args[0]) });
		},
		onSuccess: async (...args) => {
			await policy.onSuccess?.(...args);
			/** Align the field to the value the server trimmed, so a string different from the saved one is not kept on screen. */
			setDraft(args[0].nickname);
			setResult({ kind: "saved" });
		},
	});

	const editable = canInteract(viewer);
	const pending = mutation.isPending;
	const check = checkNickname(draft, viewer.nickname);

	const submit = () => {
		if (check.error) {
			setResult({ kind: "error", message: check.error });
			return;
		}
		/** Drop the last answer when a new attempt starts; both the earlier success and failure are stale. */
		setResult(null);
		mutation.mutate({ nickname: check.trimmed });
	};

	return (
		<View style={profile.field}>
			<Input
				label={NICKNAME_LABEL}
				value={draft}
				onChangeText={(next) => {
					setDraft(next);
					setResult(dropStaleSaved);
				}}
				editable={editable && !pending}
				invalid={error !== null}
				autoComplete="nickname"
			/>
			{/**
			 * Fills the row, same shape as the web's narrow screen (field and button stack in `flex-col`, and the
			 * button stretches; side by side from `sm:flex-row`).
			 *
			 * Not wrapped in `actionRow` (a horizontal row): in RN `alignSelf: "stretch"` stretches the cross axis,
			 * so in a horizontal row it grows the height, not the width. `fullWidth` would appear to do nothing
			 * and the code would not show why.
			 */}
			<Button
				label={saveLabel(pending, result)}
				icon={saveIcon(result)}
				fullWidth
				busy={pending}
				/** Locked when nothing changed or the value is empty; there is only an explicit save. */
				disabled={
					!editable || pending || check.unchanged || check.trimmed === ""
				}
				onPress={submit}
			/>
			{/**
			 * The answer to an operation attaches and detaches; the rhythm is in `lib/motion/feedback.tsx` (the
			 * web uses `feedbackEnter` and `feedbackExit` in the same place).
			 *
			 * Only the failure branch is wrapped. This slot also holds a permanent notice (the limit sentence),
			 * and wrapping that too would make a sentence that was always there float up when the screen first
			 * arrives, which the user did not cause.
			 *
			 * This slot is the last in its box, so no sibling below inherits its space (`feedback.tsx`, "the
			 * sentence that decides the seat").
			 */}
			{error ? (
				<FeedbackLine>
					<Text accessibilityRole="alert" variant="label" tone="destructive">
						{error}
					</Text>
				</FeedbackLine>
			) : !editable && viewer.status !== "approved" ? (
				<Text variant="label" tone="muted-foreground">
					{restrictionNote(
						viewer.status === "banned" ? "banned" : "suspended",
						"your nickname",
					)}
				</Text>
			) : null}
		</View>
	);
}

/**
 * The bio field.
 *
 * Reads the current value from the public-profile lookup. `/me` deliberately has no bio
 * (`bioMutationOptions` comment), which leaves one source of truth: the bio I see and the one
 * others see are the same response, so they cannot diverge.
 *
 * Editing does not open until the lookup finishes: starting from an empty field and saving would
 * really erase the written bio. The form is locked on loading and failure, and a failure states the
 * fact.
 */
function BioField({ viewer }: { viewer: Viewer }) {
	const queryClient = useQueryClient();
	const client = getRowCatClient();

	const profileQuery = useQuery(publicProfileQueryOptions(client, viewer.id));
	const saved = profileQuery.data?.bio ?? "";

	/**
	 * `null` means editing has not started; until then the server value is drawn as is. The server
	 * value is not pushed in by an effect because a background refetch would overwrite text being
	 * typed (same judgment as the web); this distinction is also why the draft survives a failed save.
	 */
	const [draft, setDraft] = useState<string | null>(null);
	const [result, setResult] = useState<SaveResult>(null);
	const error = result?.kind === "error" ? result.message : null;

	const policy = bioMutationOptions(client, queryClient, viewer.id);
	const mutation = useMutation({
		...policy,
		onError: (...args) => {
			policy.onError?.(...args);
			setResult({ kind: "error", message: accountErrorMessage(args[0]) });
		},
		onSuccess: (...args) => {
			policy.onSuccess?.(...args);
			/** Drop the edit state; the field now draws the server-confirmed value, exactly what others see. */
			setDraft(null);
			setResult({ kind: "saved" });
		},
	});

	const value = draft ?? saved;
	const restricted = !canInteract(viewer);
	const editable = !restricted && profileQuery.isSuccess;
	const pending = mutation.isPending;
	const check = checkBio(value, saved);

	const submit = () => {
		if (check.error) {
			setResult({ kind: "error", message: check.error });
			return;
		}
		setResult(null);
		mutation.mutate({ bio: check.trimmed });
	};

	return (
		<View style={profile.field}>
			<Textarea
				label={BIO_LABEL}
				value={value}
				onChangeText={(next) => {
					setDraft(next);
					setResult(dropStaleSaved);
				}}
				editable={editable && !pending}
				invalid={error !== null || check.tooLong}
				placeholder={BIO_PLACEHOLDER}
			/>
			<View style={profile.actionRow}>
				{/**
				 * Hug here, as on the web: the character count sits on the same line, and a button filling the row
				 * would push it below. Only the nickname field differs, from the web's `flex-col` vs `flex-wrap`.
				 */}
				<Button
					label={saveLabel(pending, result)}
					icon={saveIcon(result)}
					busy={pending}
					disabled={!editable || pending || check.unchanged || check.tooLong}
					onPress={submit}
				/>
				{/**
				 * Pasting is not silently trimmed (no `maxLength`); the count, the locked save button and the
				 * sentence below state the overflow.
				 */}
				<Text
					variant="caption"
					tone={check.tooLong ? "destructive" : "muted-foreground"}
				>
					{check.count} / {BIO_LIMITS.max}
				</Text>
			</View>
			{/** Only one stands here at a time: save failure, lookup failure or limit notice. */}
			{error ? (
				<FeedbackLine>
					<Text accessibilityRole="alert" variant="label" tone="destructive">
						{error}
					</Text>
				</FeedbackLine>
			) : profileQuery.isError ? (
				/**
				 * A lookup failure is not wrapped. It is not an answer to an operation but the state of what
				 * this field does not know now, and attaching and detaching while it refetches would flash
				 * something the user did not press.
				 */
				<Text accessibilityRole="alert" variant="label" tone="destructive">
					{BIO_LOAD_FAILED}
				</Text>
			) : restricted && viewer.status !== "approved" ? (
				<Text variant="label" tone="muted-foreground">
					{restrictionNote(
						viewer.status === "banned" ? "banned" : "suspended",
						"your bio",
					)}
				</Text>
			) : null}
		</View>
	);
}

const profile = StyleSheet.create({
	stack: { gap: space.lg },
	field: { gap: space.sm },
	actionRow: { alignItems: "center", flexDirection: "row", gap: space.sm },
	linkRow: { flexDirection: "row" },
});
