import { BIO_LIMITS, NICKNAME_LIMITS } from "@rowcat/contracts";
import { canInteract, type Viewer } from "@rowcat/domain";
import {
	bioMutationOptions,
	nicknameMutationOptions,
	publicProfileQueryOptions,
} from "@rowcat/query";
import { Button, buttonVariants } from "@rowcat/ui-web/components/button";
import { Input } from "@rowcat/ui-web/components/input";
import { Label } from "@rowcat/ui-web/components/label";
import { Textarea } from "@rowcat/ui-web/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import { translator } from "#/lib/i18n/current.ts";
import { AnimatedCount } from "#/lib/motion/animated-count.tsx";
import { feedbackEnter, feedbackExit } from "#/lib/motion/feedback.ts";
import { accountErrorMessage } from "./account-error.ts";
import { AccountSection } from "./account-shell.tsx";
import { AvatarField } from "./avatar-field.tsx";
import { PinnedStoriesField } from "./pinned-stories-field.tsx";
import { restrictionNote } from "./restriction-note.ts";
import { SaveLabel } from "./save-label.tsx";

/**
 * Profile: the values this screen sends **out to the public**.
 *
 * Nickname and bio live here for the same reason: each is an account setting and also a display on
 * the public profile. With two places to edit it would be unclear which is the real one, so the
 * **public profile screen stays read-only** and all editing happens here. The only link from that
 * screen back here is one link (`features/profile/profile-header.tsx`).
 *
 * The avatar came in as the first field of this section. It used to be marked "not yet" because the
 * column existed but nothing filled it: a file picker alone would select a file that never saved.
 * The shared media pipeline now provides that path (`packages/contracts/src/media.ts`). The
 * follower count is still absent: there is no list to open from it, so drawing it now would show a
 * placeholder, not information.
 *
 * Keeping the two forms separate is this file's structure. Grouping them under one save button
 * would report "saved" when only one of two requests succeeded, and no transaction spans different
 * endpoints (the same reason the settings slice rejects a footer `Save settings` button).
 */

/**
 * Validation before submit, restating the server and SDK **rules** in Korean.
 *
 * The contract (`NicknameUpdateDto`) is the final judge, and the SDK filters once more before
 * sending. Those layers' messages are written for developers (zod), so the user-facing answer has
 * to come from here. Length numbers come from the contract's exported constants; hand-written
 * numbers would leave one side stale when the limit changes.
 */
function nicknameError(value: string): string | null {
	const trimmed = value.trim();
	if (trimmed.length < NICKNAME_LIMITS.min)
		return translator("account")("profileSection.pleaseEnterANickname");
	if (trimmed.length > NICKNAME_LIMITS.max)
		return translator("account")("profileSection.nicknameTooLong", {
			max: NICKNAME_LIMITS.max,
		});
	return null;
}

/**
 * The **answer** to one save: success and failure are a single value.
 *
 * Holding them as separate states would allow a "saved" indicator and a failure message to show at
 * the same time. That happens on a real path: after a success, editing and saving again and failing
 * leaves a contradiction on screen if the code clearing the earlier success is missing even in one
 * place. With one value that state is **not representable.**
 *
 * `null` means nothing has been pressed yet, and the value returns to it when a new save starts: a
 * previous result left over a new attempt is a stale fact.
 */
type SaveResult =
	| { kind: "saved" }
	/**
	 * `scope` **separates field problems from form problems.**
	 *
	 * ```text
	 * field  the value currently in the field breaks a rule  → the field is aria-invalid and the message points at it
	 * form   the request was sent and failed                 → the field value is still valid; only the message appears
	 * ```
	 *
	 * Folding them into one axis would make a single dropped connection read the nickname the user
	 * typed as an "invalid value". The appeal dialog made the same decision in its own place
	 * (`features/moderation/appeal-dialog.tsx`, "two failures that belong in different places").
	 */
	| { kind: "error"; scope: "field" | "form"; message: string }
	| null;

export function ProfileSection({ viewer }: { viewer: Viewer }) {
	const { t } = useTranslation(["account", "common"]);
	return (
		<AccountSection
			title={t("profileSection.profile")}
			description={t("profileSection.yourNicknameAndBioAppear")}
		>
			<div className="flex flex-col gap-6">
				{/* The avatar is the first field: the first value noticed on the profile. Unlike the fields below, it is not a form, since choosing a file uploads it immediately, so it does not break the save-button rhythm. */}
				<AvatarField viewer={viewer} />
				<NicknameField viewer={viewer} />
				<BioField viewer={viewer} />
				<PinnedStoriesField viewer={viewer} />
				{/*
				 * The link to the person's own public profile.
				 *
				 * The preview is deliberately not drawn inside this screen: an imitated preview would
				 * eventually diverge from the real one, and the user would misjudge how others see them.
				 * Linking to the real address removes that problem (that screen also does not vary by viewer).
				 */}
				<div>
					<Link
						to="/creators/$creatorId"
						params={{ creatorId: viewer.id }}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						{t("profileSection.viewPublicProfile")}
					</Link>
				</div>
			</div>
		</AccountSection>
	);
}

/**
 * One nickname field.
 *
 * Unlike the drafts screen, this does not save on every keystroke. Drafts are the person's own
 * content kept on the device, so autosave fits there. A nickname is server state that goes out to
 * the public work list and profile the moment it is saved, so intermediate values must never appear
 * on others' screens, even briefly.
 */
function NicknameField({ viewer }: { viewer: Viewer }) {
	const { t } = useTranslation(["account", "common"]);
	const queryClient = useQueryClient();
	const inputId = useId();
	const errorId = `${inputId}-error`;
	const noteId = `${inputId}-note`;

	/**
	 * The input value is screen state. The server value is used only as the initial value and is
	 * deliberately not followed afterward: after a failure the cache rolls back to the old name, but
	 * the text the user just typed must remain so that pressing save again is enough. Pushing the
	 * server value in here would turn a failure into clearing the input.
	 */
	const [draft, setDraft] = useState(viewer.nickname);
	const [result, setResult] = useState<SaveResult>(null);
	const error = result?.kind === "error" ? result.message : null;
	/**
	 * Whether the value **currently** breaks a rule.
	 *
	 * A server rejection does not enter here (that is a form problem), and the verdict on the last
	 * submission is not kept either. The message stays while editing (see `edit` below), but once the
	 * value satisfies the rule the field is no longer invalid. The appeal dialog's `check.tooLong`
	 * looks at the current value for the same reason.
	 */
	const fieldInvalid =
		result?.kind === "error" &&
		result.scope === "field" &&
		nicknameError(draft) !== null;

	/**
	 * The cache policy belongs to @rowcat/query. This screen adds **only its own work** on top.
	 *
	 * The factory is called once and its callbacks are chained directly. Spreading an override over it
	 * would **replace** the policy's callbacks, silently dropping the optimistic rollback, gallery
	 * invalidation and public profile refresh, with nothing on screen to reveal it.
	 */
	const policy = nicknameMutationOptions(getRowCatClient(), queryClient);
	const mutation = useMutation({
		...policy,
		onError: (...args) => {
			policy.onError?.(...args);
			setResult({
				kind: "error",
				scope: "form",
				message: accountErrorMessage(args[0]),
			});
		},
		onSuccess: async (...args) => {
			await policy.onSuccess?.(...args);
			// Align the field with the value the server normalized: someone who saved with surrounding
			// spaces must not keep viewing a string different from the one stored.
			setDraft(args[0].nickname);
			/*
			 * The success indicator turns on **only here**. Inferring success from `isPending` turning off
			 * would draw a failed save as a success, and the two are indistinguishable on screen.
			 */
			setResult({ kind: "saved" });
		},
	});

	const editable = canInteract(viewer);
	const trimmed = draft.trim();
	const unchanged = trimmed === viewer.nickname;
	const pending = mutation.isPending;

	const submit = (event: FormEvent) => {
		event.preventDefault();
		const invalid = nicknameError(draft);
		if (invalid) {
			setResult({ kind: "error", scope: "field", message: invalid });
			return;
		}
		// Drop the previous result the moment a new attempt starts: an earlier success and an earlier
		// failure are both stale facts.
		setResult(null);
		mutation.mutate({ nickname: trimmed });
	};

	/**
	 * Once the value changes, `Saved` is false: that indicator claims the **text currently in the field
	 * is saved**, and editing even one character makes that untrue. It is not cleared by a timer
	 * because time does not change that fact; editing does.
	 *
	 * The failure message is kept, though. It states why the value just sent was rejected, and if it
	 * vanished during editing there would be no way to see what to fix.
	 */
	const edit = (next: string) => {
		setDraft(next);
		setResult((current) => (current?.kind === "saved" ? null : current));
	};

	return (
		/* Enter also submits, since this is a form: a single-field input should not send the hand to the button. */
		<form
			/**
			 * Stops a submission made before hydration from carrying the value in the address. The reasoning
			 * is on the same line in the sign-in form (`features/auth/credentials-form.tsx`).
			 */
			method="post"
			onSubmit={submit}
			className="flex flex-col gap-1.5"
		>
			<Label htmlFor={inputId}>{t("profileSection.nickname")}</Label>
			<div className="flex flex-col gap-2 sm:flex-row">
				<Input
					id={inputId}
					value={draft}
					onChange={(event) => edit(event.target.value)}
					/*
					 * `maxLength` is not set, for the same reason as the bio field. A name pasted past the limit
					 * and silently truncated would mean the user saves a string they did not type, and
					 * `nicknameError` above would lose its chance to say so.
					 */
					disabled={!editable || pending}
					aria-invalid={fieldInvalid}
					aria-describedby={error ? errorId : editable ? undefined : noteId}
					autoComplete="nickname"
					className="sm:flex-1"
				/>
				<Button
					type="submit"
					// Locked even when nothing changed: a round trip that saves the same value looks to the user
					// like nothing happened.
					disabled={!editable || pending || unchanged || draft.trim() === ""}
					className="sm:w-24"
				>
					<SaveLabel
						state={
							pending ? "pending" : result?.kind === "saved" ? "saved" : "idle"
						}
					/>
				</Button>
			</div>
			{/*
			 * `mode="wait"` makes the same judgement as the two neighbouring fields (bio, avatar). If the outgoing
			 * and incoming sentences overlap when `key` changes the reason, two `role="alert"`s would exist
			 * for one frame.
			 */}
			<AnimatePresence initial={false} mode="wait">
				{error && (
					// Not signalled by colour alone: the sentence states the failure, and assistive technology
					// hears it through the role.
					<m.p
						key={error}
						id={errorId}
						role="alert"
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						exit={feedbackExit}
						transition={feedbackEnter.transition}
						className="text-sm text-destructive"
					>
						{error}
					</m.p>
				)}
			</AnimatePresence>
			{!editable && (
				<p id={noteId} className="text-sm text-muted-foreground">
					{restrictionNote(viewer.status, "nickname")}
				</p>
			)}
		</form>
	);
}

/**
 * One bio field.
 *
 * **The current value is read from the public profile query.** The bio is not added to `/me`, and
 * that is intended: `/me` is the hottest read, taken on every root SSR, header and auth guard, so
 * putting a value only this screen uses there would make every route's HTML carry it. It also keeps
 * one source of truth: the bio the owner sees and the bio others see come from the **same
 * response**, so they cannot diverge.
 *
 * A failed lookup is not drawn as an empty field. Otherwise someone who wrote a bio would read it
 * as having disappeared, and saving from that state would really erase it.
 */
function BioField({ viewer }: { viewer: Viewer }) {
	const { t } = useTranslation(["account", "common"]);
	const queryClient = useQueryClient();
	const client = getRowCatClient();
	const fieldId = useId();
	const errorId = `${fieldId}-error`;
	const countId = `${fieldId}-count`;
	const noteId = `${fieldId}-note`;

	const profile = useQuery(publicProfileQueryOptions(client, viewer.id));
	const saved = profile.data?.bio ?? "";

	/**
	 * Editing does not open until the server value has arrived.
	 *
	 * A `useState` initial value freezes at the first render's value, so starting with `""` before the
	 * query finishes would keep a bio that arrives later out of the field. Rather than a separate sync
	 * effect, the field draws the server value **only while editing has not started yet**. An effect
	 * that pushed the value in would overwrite text the user is typing when a refetch completes.
	 */
	const [draft, setDraft] = useState<string | null>(null);
	const [result, setResult] = useState<SaveResult>(null);
	const error = result?.kind === "error" ? result.message : null;

	const policy = bioMutationOptions(client, queryClient, viewer.id);
	const mutation = useMutation({
		...policy,
		onError: (...args) => {
			policy.onError?.(...args);
			setResult({
				kind: "error",
				scope: "form",
				message: accountErrorMessage(args[0]),
			});
		},
		onSuccess: (...args) => {
			policy.onSuccess?.(...args);
			// Release the editing state: the field now draws the value the server confirmed (exactly what
			// others see).
			setDraft(null);
			/* Same rule as the nickname field: the success indicator is switched on only in the mutation's success callback. */
			setResult({ kind: "saved" });
		},
	});

	const value = draft ?? saved;
	const editable = canInteract(viewer) && profile.isSuccess;
	const pending = mutation.isPending;
	const trimmed = value.trim();
	const tooLong = trimmed.length > BIO_LIMITS.max;
	const unchanged = trimmed === saved;
	const restricted = !canInteract(viewer);

	/**
	 * Points at **the one description actually drawn** right now.
	 *
	 * The conditions are counted once here on purpose. Writing `aria-describedby` apart from the JSX
	 * below would point at a non-existent id while the lookup is still running (neither an error nor a
	 * restriction). That shows up only in assistive technology, where the **description disappears
	 * entirely**; visually there is no difference.
	 */
	const describedBy =
		error || profile.isError ? errorId : restricted ? noteId : countId;

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (tooLong) {
			setResult({
				kind: "error",
				scope: "field",
				message: t("profileSection.bioTooLong", { max: BIO_LIMITS.max }),
			});
			return;
		}
		// Drop the previous result the moment a new attempt starts (same rule as the nickname field).
		setResult(null);
		mutation.mutate({ bio: trimmed });
	};

	/** Once the value changes, `Saved` is false: the same judgement as the nickname field. */
	const edit = (next: string) => {
		setDraft(next);
		setResult((current) => (current?.kind === "saved" ? null : current));
	};

	return (
		<form
			/**
			 * Stops a submission made before hydration from carrying the value in the address. The reasoning
			 * is on the same line in the sign-in form (`features/auth/credentials-form.tsx`).
			 */
			method="post"
			onSubmit={submit}
			className="flex flex-col gap-1.5"
		>
			<Label htmlFor={fieldId}>{t("profileSection.bio")}</Label>
			{/*
			 * Enter inserts a newline, so there is no implicit form submission. That is right for a multi-line
			 * input. The save button is therefore the only way to submit, and it is always visible below.
			 */}
			<Textarea
				id={fieldId}
				value={value}
				onChange={(event) => edit(event.target.value)}
				rows={3}
				/*
				 * No `maxLength`. A paste that is silently truncated would leave the user pressing save without
				 * knowing where their text ends. The overflow is stated by the count below, and the save button
				 * locks.
				 */
				disabled={!editable || pending}
				/*
				 * Only the overflow is a field problem. The server's rejection is stated by the sentence below,
				 * and the field value is still valid. See the `scope` comment on `SaveResult`.
				 */
				aria-invalid={tooLong}
				aria-describedby={describedBy}
				placeholder={t("profileSection.writeAShortBio")}
			/>

			<div className="flex flex-wrap items-center gap-2">
				<Button
					type="submit"
					disabled={!editable || pending || unchanged || tooLong}
					className="sm:w-24"
				>
					<SaveLabel
						state={
							pending ? "pending" : result?.kind === "saved" ? "saved" : "idle"
						}
					/>
				</Button>
				{/*
				 * The count only means something near the cap. Showing 0/300 all the time would add a number to an
				 * empty field; when over the cap, the locked save button and the sentence below give the reason,
				 * not the colour.
				 */}
				<span
					id={countId}
					className={`text-xs tabular-nums ${
						tooLong ? "text-destructive" : "text-muted-foreground"
					}`}
				>
					{/*
					 * It changes on every keystroke, so the count is `continuous`. Only **the current character count**
					 * rolls; the `/` and the cap stay fixed, since the cap does not change and has nothing to roll.
					 */}
					<AnimatedCount value={String(trimmed.length)} cadence="continuous" />{" "}
					/ {BIO_LIMITS.max}
				</span>
			</div>

			{/*
			 * At most one of these shows at a time (save failure, lookup failure, restriction notice). The three are
			 * already written to exclude each other, so `mode="wait"` draws exactly that fact. Overlapping them
			 * would make the form two lines longer for 120ms when a failure disappears and the next sentence arrives.
			 *
			 * The rhythm belongs to `feedback.ts`. This field is the **last flow child** of its container, so its
			 * exit delays no one's position. `role="alert"` is read the moment it is attached, regardless of motion.
			 */}
			<AnimatePresence initial={false} mode="wait">
				{error ? (
					<m.p
						key={`save:${error}`}
						id={errorId}
						role="alert"
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						exit={feedbackExit}
						transition={feedbackEnter.transition}
						className="text-sm text-destructive"
					>
						{error}
					</m.p>
				) : profile.isError ? (
					/*
					 * The lookup failed. The field is not left editable as if it were empty; the truth is stated,
					 * because someone with a bio who presses save here would really erase it.
					 */
					<m.p
						key="load"
						id={errorId}
						role="alert"
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						exit={feedbackExit}
						transition={feedbackEnter.transition}
						className="text-sm text-destructive"
					>
						{t("profileSection.couldnTLoadTheBio")}
					</m.p>
				) : restricted ? (
					<m.p
						key="restricted"
						id={noteId}
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						exit={feedbackExit}
						transition={feedbackEnter.transition}
						className="text-sm text-muted-foreground"
					>
						{restrictionNote(viewer.status, "bio")}
					</m.p>
				) : null}
			</AnimatePresence>
		</form>
	);
}
