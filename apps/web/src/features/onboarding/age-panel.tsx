import { declareAgeMutationOptions } from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import { Input } from "@rowcat/ui-web/components/input";
import { Label } from "@rowcat/ui-web/components/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { DeletionTerminal } from "#/features/account/deletion-terminal.tsx";
import { useAccountDeletion } from "#/features/account/use-account-deletion.ts";
import { getRowCatClient } from "#/lib/api.ts";
import { feedbackEnter } from "#/lib/motion/feedback.ts";
import { GateExit, GateSurface } from "./gate-shell.tsx";
import { ageDeclarationError } from "./membership-gate-state.ts";

/**
 * Age check. This screen asks once and moves on; it does not block signup.
 *
 * Asking for a date of birth is required by PIPA Article 22-2: guardian consent for under-14 users
 * can only be verified once the user's age is known. An 'I am 14 or older' checkbox declares no age
 * and cannot identify a child.
 *
 * The value is not stored. The server reduces it to 'under 14' and 'the date the user turns 14',
 * then discards it (there is no birthdate column). The screen says so.
 *
 * Reaching under 14 is not a failure. The next screen, guardian consent, is a supported path.
 * Wording that reads as rejection would push children to enter a false age, losing both
 * identification and protection.
 */
export function AgePanel() {
	const { t } = useTranslation("onboarding");
	const queryClient = useQueryClient();
	const fieldId = useId();
	const [birthDate, setBirthDate] = useState("");
	const [localError, setLocalError] = useState<string | null>(null);
	const deletion = useAccountDeletion();

	const declare = useMutation(
		declareAgeMutationOptions(getRowCatClient(), queryClient),
	);
	const busy = declare.isPending || deletion.phase === "deleting";

	/**
	 * After the account is deleted, no age screen is rendered at all. The guardian gate makes the
	 * same decision. The viewer cache is cleared only after server deletion finishes, so renders in between
	 * would still prompt for a birthdate on an account that no longer exists. An irreversible boundary
	 * must hold from the moment it is crossed.
	 */
	if (deletion.terminal)
		return (
			<GateSurface>
				<DeletionTerminal deletion={deletion} />
			</GateSurface>
		);

	const submit = (): void => {
		const value = birthDate.trim();
		/**
		 * Only emptiness is checked here. Age calculation and future-date checks are done by the server
		 * in the product time zone. If the client re-judged with its own clock, devices in different time
		 * zones would disagree, and the disagreement would show up as a minor passing when they should
		 * not.
		 */
		if (!value) {
			setLocalError(t("age.required"));
			return;
		}
		setLocalError(null);
		declare.mutate({ birthDate: value });
	};

	const error = localError ?? ageDeclarationError(declare.error);

	return (
		<GateSurface>
			<h1 className="text-xl font-bold tracking-tight">{t("age.title")}</h1>
			<p className="mt-3 text-sm leading-7 text-muted-foreground">
				{t("age.body")}
			</p>

			<div className="mt-6 flex flex-col gap-1.5">
				<Label htmlFor={fieldId} className="text-sm font-medium">
					{t("age.label")}
				</Label>
				{/*
				 * type='date' lets the browser supply its own calendar and format, while the value is always
				 * YYYY-MM-DD, the shape the contract expects. A hand-built three-field input is avoided because
				 * it would mean reimplementing leap years, digit counts and IME handling, and would lose the
				 * mobile keyboard.
				 */}
				<Input
					id={fieldId}
					type="date"
					value={birthDate}
					disabled={busy}
					onChange={(event) => setBirthDate(event.target.value)}
					aria-describedby={error ? `${fieldId}-error` : undefined}
					aria-invalid={error ? true : undefined}
				/>
			</div>

			{/*
			 * Failure is announced through a live region, so the reason the screen is unchanged after the
			 * button press also reaches assistive technology.
			 */}
			<AnimatePresence initial={false} mode="wait">
				{error && (
					/*
					 * The error message takes over the slot of the `Confirm` button below, so it only enters and has no
					 * exit animation. An exit would delay the button's rise after the user fixes the error and
					 * presses again, and in a hidden tab the wait would be unbounded (see
					 * docs/motion/ARCHITECTURE.md, 'a sentence that claims a slot only enters'). mode='wait' is
					 * avoided so two messages never stand together when the reason changes.
					 */
					<m.p
						key={error}
						id={`${fieldId}-error`}
						role="alert"
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						transition={feedbackEnter.transition}
						className="mt-3 text-sm text-destructive"
					>
						{error}
					</m.p>
				)}
			</AnimatePresence>

			<Button
				className="mt-5 w-full"
				size="lg"
				disabled={busy}
				onClick={submit}
			>
				{declare.isPending ? t("age.checking") : t("age.confirm")}
			</Button>

			<GateExit note={t("age.exitNote")} deletion={deletion} busy={busy} />
		</GateSurface>
	);
}
