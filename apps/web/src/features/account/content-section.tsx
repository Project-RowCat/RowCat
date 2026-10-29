import { adultVisibilityState, type Viewer } from "@rowcat/domain";
import { showAdultMutationOptions } from "@rowcat/query";
import { Switch } from "@rowcat/ui-web/components/switch";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import { translator } from "#/lib/i18n/current.ts";
import { feedbackEnter, feedbackExit } from "#/lib/motion/feedback.ts";
import { accountErrorMessage } from "./account-error.ts";
import { AccountSection } from "./account-shell.tsx";
import { AdultVerification } from "./adult-verification.tsx";
import { adultVerificationOffer } from "./adult-verification-state.ts";

/**
 * Content display — **a setting for showing adult content, not adult verification.**
 *
 * This distinction governs the whole copy. The moment the switch is called "adult verification",
 * users read that turning it on verifies them, but nothing happens (without eligibility the server
 * refuses). The switch here decides only **whether adult-rated works are shown to someone who is
 * already eligible**.
 *
 * So this section has **two** actions that do different things. The identity verification above
 * creates eligibility (it goes out to the verification authority and returns); the switch below
 * turns on display for someone already eligible. Binding them as one action would create the
 * expectation that verifying turns adult content on, but the server does not do that: verification
 * does not touch `show_adult`.
 *
 * The order says the same: for people who are not eligible only the verification action is shown,
 * and once eligibility exists the switch appears in that place. The two are not drawn at the same
 * time, because a switch that cannot yet be turned on is noise, not guidance.
 *
 * **One exception: yearly re-verification.** When the last adult verification is over a year old
 * (the server's `adultRecheckRequired`), eligibility remains, so the switch stays and the
 * verification action appears below it. That switch is not one that cannot be turned on but one
 * whose effect **arrives late if turned on now**; hiding it would leave someone who already turned
 * it on unable to turn it off.
 */
export function ContentSection({ viewer }: { viewer: Viewer }) {
	const { t } = useTranslation(["account", "common"]);
	const queryClient = useQueryClient();
	const switchId = useId();
	const labelId = `${switchId}-label`;
	const descriptionId = `${switchId}-description`;
	const errorId = `${switchId}-error`;
	const [error, setError] = useState<string | null>(null);

	// Policy belongs to @rowcat/query. The factory is called once and callbacks are chained:
	// overwriting them with a spread would silently drop the failure rollback and the gallery reset.
	const policy = showAdultMutationOptions(getRowCatClient(), queryClient);
	const mutation = useMutation({
		...policy,
		onError: (...args) => {
			policy.onError?.(...args);
			setError(accountErrorMessage(args[0]));
		},
		onSuccess: async (...args) => {
			await policy.onSuccess?.(...args);
			setError(null);
		},
	});

	const state = adultVisibilityState(viewer);
	const offer = adultVerificationOffer(state);

	return (
		<AccountSection title={t("contentSection.contentDisplay")}>
			{state.kind === "eligible" ? (
				<div className="flex flex-col gap-2">
					<div className="flex items-start justify-between gap-4">
						<div className="min-w-0">
							{/*
							 * Attach **both** `htmlFor` and `aria-labelledby`, since one is not enough.
							 *
							 * Base UI's switch puts the passed `id` on a hidden checkbox, and the visible
							 * `role="switch"` element uses an id it creates itself. So `htmlFor` only provides
							 * click forwarding (pressing the text also toggles), while the element that actually
							 * receives focus has no name, and assistive tech does not hear what the switch
							 * controls. The name is attached directly with `aria-labelledby`.
							 */}
							<label
								id={labelId}
								htmlFor={switchId}
								className="text-sm font-medium"
							>
								{t("contentSection.showAdultContent")}
							</label>
							<p
								id={descriptionId}
								className="mt-1 text-sm text-muted-foreground"
							>
								{t("contentSection.whenOffAdultStoriesDon")}
							</p>
						</div>
						<Switch
							id={switchId}
							checked={state.showAdult}
							disabled={mutation.isPending}
							aria-labelledby={labelId}
							aria-describedby={error ? errorId : descriptionId}
							/*
							 * Not locked by membership state (suspended or blocked). The server allows **turning off**
							 * requests even on restricted accounts; if the screen were stricter than the server, a
							 * suspended person could not even reduce the adult content they see.
							 */
							onCheckedChange={(checked) => {
								setError(null);
								mutation.mutate({ showAdult: checked });
							}}
						/>
					</div>
					{/*
					 * A save failure appears and disappears **right below** the switch just pressed
					 * (`lib/motion/feedback.ts`). The only route to failure in this section is one (the switch
					 * just flipped could not reach the server), so showing that causal link is useful.
					 *
					 * The `id` and `role="alert"` are unchanged. The switch's `aria-describedby` points at this
					 * sentence, and announcement happens the moment the sentence attaches to the DOM; it does not
					 * wait for the animation.
					 */}
					<AnimatePresence initial={false}>
						{error && (
							<m.p
								key="show-adult-error"
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
					{/*
					 * One-year re-verification: an action only for eligible people, so it sits inside this branch.
					 * **Mounted only when there is an offer.** This component consumes the marker returned from
					 * the verification authority to submit completion, so attaching it to someone with nothing to
					 * offer would let a stale marker trigger a useless paid re-check.
					 */}
					{offer === "renew" && <AdultVerification offer={offer} />}
				</div>
			) : (
				<div className="flex flex-col gap-1">
					<p className="text-sm">{unavailableTitle()[state.kind]}</p>
					<p className="text-sm text-muted-foreground">
						{unavailableNote()[state.kind]}
					</p>
					{/*
					 * Whether to draw the action is decided by **a pure function**. Writing
					 * `state.kind !== "child"` here would create that decision in two places, and a mistake
					 * drawing an identity-verification button for a child would not show in review (the server
					 * blocks it, so no error occurs; the person just walks through a procedure that does not
					 * exist for them).
					 */}
					<AdultVerification offer={offer} />
				</div>
			)}
		</AccountSection>
	);
}

/**
 * The two ineligible cases are stated **separately**.
 *
 * Folding them into one ("adult content cannot be viewed") would give a minor who has verified the
 * false impression that changing their age fixes it, and give an unverified adult no guidance at
 * all. The conclusion "nothing you can do" is the same, but if the reasons differ, the sentences
 * must differ too.
 */
const unavailableTitle = () =>
	({
		child: translator("account")("contentSection.thisAccountIsUnder14"),
		unverified: translator("account")(
			"contentSection.thisAccountHasnTCompleted",
		),
		minor: translator("account")("contentSection.thisAccountIsUnder19"),
	}) as const;

const unavailableNote = () =>
	({
		/**
		 * **Does not write "after completing identity verification".** For someone under 14 that sentence
		 * is false, and anyone who follows that guidance searches for a procedure that does not exist.
		 * Instead it states what works now: a locked section does not mean the product is unusable.
		 */
		child: translator("account")("contentSection.adultStoriesArenTShown"),
		unverified: translator("account")(
			"contentSection.adultContentDisplayCanOnly",
		),
		/**
		 * **Written so it does not read as "change your age".** What a person under 19 can do now is wait;
		 * the re-verification path is quietly pointed to by the action below.
		 */
		minor: translator("account")("contentSection.adultContentIsnTShown"),
	}) as const;
