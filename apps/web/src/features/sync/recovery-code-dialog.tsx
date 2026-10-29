import { Button } from "@rowcat/ui-web/components/button";
import { Checkbox } from "@rowcat/ui-web/components/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { Check, Copy } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useId, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import { AnimatedIconSwap } from "#/lib/motion/animated-icon-swap.tsx";
import { feedbackEnter, feedbackExit } from "#/lib/motion/feedback.ts";

/**
 * Shows the recovery code only once. It cannot be shown again: the server does not store it, since
 * storing it would let the server read the data, and the app does not keep it either. The dialog
 * therefore stays open until the user confirms they wrote it down. It is not a dialog that can be
 * dismissed by accident.
 *
 * The copy says plainly that losing the code means the server's data can never be read. 'Store it
 * safely' sounds gentler but does not say what happens. Being exact now is better than support
 * later receiving recovery requests.
 */
export function RecoveryCodeDialog({
	code,
	title,
	onAcknowledge,
}: {
	code: string | null;
	title: string;
	onAcknowledge: () => void;
}) {
	/** No hand-written id is used here. The reason is noted on the same line in `sync-section.tsx`. */
	const { t } = useTranslation(["sync", "common"]);
	const ackId = useId();
	const [confirmed, setConfirmed] = useState(false);
	/**
	 * The copy button's result carries success and failure as one value.
	 *
	 * When it was a boolean, failure was `false`, the same as 'not pressed yet'. The button still read
	 * `Copy`, so the user could not tell whether the press had worked. Copying can really be blocked in
	 * some environments (permissions, insecure contexts).
	 */
	const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
		"idle",
	);

	const close = (): void => {
		setConfirmed(false);
		setCopyState("idle");
		onAcknowledge();
	};

	return (
		<Dialog open={code !== null}>
			<DialogContent
				showCloseButton={false}
				className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-lg`}
			>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{t("recoveryCode.shownOnce")}</DialogDescription>
				</DialogHeader>

				{/*
				 * `select-all` and generous letter spacing are the point of this box. Users either copy the value
				 * by
				 * eye or select all of it, and both must be easy.
				 */}
				<p className="select-all rounded-lg border bg-muted/40 p-4 text-center font-mono text-base tracking-wider break-all">
					{code}
				</p>

				<div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
					<p className="text-sm">
						<Trans
							t={t}
							i18nKey="recoveryCode.serverUnaware"
							components={{ strong: <strong /> }}
						/>
					</p>
					<p className="mt-1 text-sm text-muted-foreground">
						{t("recoveryCode.cannotRecover")}
					</p>
				</div>

				{/*
				 * The label is linked explicitly with `htmlFor`. Wrapping a checkbox in a label would make clicks
				 * work, but this is a custom widget rather than a real `input`, so assistive technology would not
				 * read the relationship.
				 */}
				<label htmlFor={ackId} className="flex items-start gap-2 text-sm">
					<Checkbox
						id={ackId}
						checked={confirmed}
						onCheckedChange={(next) => setConfirmed(next === true)}
					/>
					<span>{t("recoveryCode.acknowledge")}</span>
				</label>

				{/*
				 * Failure stays inside the dialog and says what to do next. It is not a toast: the dialog stays
				 * open
				 * after a failure, and the code is drawn directly above, so the honest instruction is to select and
				 * copy it manually. That instruction only makes sense next to the code.
				 *
				 * `role="alert"` is set because the sentence answers the button just pressed. Screen readers
				 * announce it as soon as it is added to the DOM, without waiting for an animation.
				 *
				 * The timing follows `lib/motion/feedback.ts`, since this sentence is a reply to a button press and
				 * that kind of event should not arrive at a different distance on each screen.
				 *
				 * This element is not the last flow child of its container, since a bottom line sits below it. The
				 * rule against that is that controls below must not stay displaced after the failure message
				 * disappears. Here the message leaves in one way only, a successful `Copy` press, and at that point
				 * the tab holding it is visible by definition. When the dialog closes, the node unmounts entirely,
				 * so there is no exit animation.
				 */}
				<AnimatePresence initial={false}>
					{copyState === "failed" && (
						<m.p
							key="copy-failed"
							role="alert"
							initial={feedbackEnter.initial}
							animate={feedbackEnter.animate}
							exit={feedbackExit}
							transition={feedbackEnter.transition}
							className="text-sm text-destructive"
						>
							{t("recoveryCode.copyFailed")}
						</m.p>
					)}
				</AnimatePresence>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => {
							if (!code) return;
							const clipboard = navigator.clipboard;
							// In an insecure context the clipboard API does not exist. That absence also counts as a
							// failure.
							if (!clipboard) return setCopyState("failed");
							void clipboard.writeText(code).then(
								() => setCopyState("copied"),
								() => setCopyState("failed"),
							);
						}}
					>
						{/*
						 * The glyph swap rhythm matches copying a chat line (`lib/motion/animated-icon-swap.tsx`). The same
						 * action should not arrive at a different rhythm on different screens.
						 *
						 * `failed` shares the `idle` glyph for the same reason as in that place: failure is announced by
						 * the
						 * alert sentence, not by an icon. A third glyph would make users read what went wrong from the icon
						 * rather than what to do.
						 *
						 * There is no `quiet` branch that reverts the glyph. The indicator is not cleared by a timer and
						 * stays until the dialog closes, because this code is shown only once and the fact that it was
						 * copied must stay true for the whole dialog.
						 */}
						<span className="inline-flex items-center gap-1.5">
							<AnimatedIconSwap
								stateKey={copyState === "copied" ? "copied" : "idle"}
								className="size-4"
							>
								{copyState === "copied" ? (
									<Check aria-hidden="true" className="size-4" />
								) : (
									<Copy aria-hidden="true" className="size-4" />
								)}
							</AnimatedIconSwap>
							{copyState === "copied"
								? t("common:actions.copied")
								: t("common:actions.copy")}
						</span>
					</Button>
					{/* The dialog cannot close before the user confirms. Closing it by mistake cannot be undone. */}
					<Button disabled={!confirmed} onClick={close}>
						{t("recoveryCode.done")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
