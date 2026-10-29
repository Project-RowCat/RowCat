import { refreshViewerState } from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import { Input } from "@rowcat/ui-web/components/input";
import { Label } from "@rowcat/ui-web/components/label";
import { useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { redirectTargetFrom } from "#/lib/auth.ts";
import { feedbackEnter, feedbackExit } from "#/lib/motion/feedback.ts";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import {
	checkNewPassword,
	checkResetEmail,
	newPasswordIssueMessage,
	RESET_PASSWORD_PATH,
	requestPasswordReset,
	requestResetErrorMessage,
	resetFailureOf,
	resetPassword,
	resetTokenFrom,
} from "./password-reset.ts";

const route = getRouteApi("/reset-password");

/**
 * Which face is showing right now. **It is one slot.**
 *
 * With several booleans (`sent`, `expired`, `hasToken`), the state "sent and at the same time
 * choosing a new password" becomes representable, and what to draw would differ from render to
 * render.
 */
type Face =
	| { kind: "new-password"; token: string }
	| { kind: "request"; expired: boolean; email: string }
	| { kind: "sent"; email: string };

/**
 * The password reset screen. It has the **same frame** as the sign-in screen (one centred face, no
 * header).
 *
 * All the rules live in `password-reset.ts`; this file picks and draws one of three faces. After a
 * successful reset there is only one thing to do: send the user to the sign-in screen to enter with
 * the new password. No session is created here because the library does not create one, and we
 * agree with that decision: the browser that opened the mail link may be a shared PC (the same axis
 * as `autoSignInAfterVerification: false` on the verification mail).
 */
export function ResetPasswordPage() {
	const { t } = useTranslation("auth");
	const search = route.useSearch();
	const redirectTarget = redirectTargetFrom(search.redirect);
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	/**
	 * The address decides the first face; after that this screen decides.
	 *
	 * The point is to **move the token into state**: the effect below strips the value from the
	 * address, but the form keeps submitting with that token. Server rendering and the first hydration
	 * see the same address, so the first face does not differ between the two.
	 */
	const [face, setFace] = useState<Face>(() => {
		const token = resetTokenFrom(search.token);
		if (token) return { kind: "new-password", token };
		return { kind: "request", expired: search.expired === true, email: "" };
	});

	/**
	 * The token is stripped from the address so it does not persist in history or in a copied address.
	 *
	 * It uses `replace`, so going back does not return to the address that carried the token. The
	 * destination (`redirect`) is kept as is: it is where the user continues after signing in
	 * following the reset.
	 */
	useEffect(() => {
		if (!search.token) return;
		void navigate({
			to: RESET_PASSWORD_PATH,
			search: { redirect: redirectTarget },
			replace: true,
		});
	}, [search.token, redirectTarget, navigate]);

	/**
	 * The reset is done.
	 *
	 * The viewer state is cleared **first**. If this browser was signed in, that session was just
	 * revoked by the server (`revokeSessionsOnPasswordReset`), but the cache still holds the viewer;
	 * going straight to the sign-in screen would let its `beforeLoad` see the cached viewer and send
	 * the user to the discovery screen. That would draw a revoked session as if it were signed in.
	 */
	const handleReset = async () => {
		await refreshViewerState(queryClient);
		await navigate({
			to: "/login",
			search: { reset: true, redirect: redirectTarget },
			replace: true,
		});
	};

	return (
		<main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
			<PageEnter className="w-full max-w-sm">
				<div className="flex flex-col items-center gap-1.5 text-center">
					<Link
						to="/"
						search={{}}
						className="text-2xl font-black tracking-tight no-underline"
					>
						RowCat
					</Link>
					<h1 className="text-lg font-semibold tracking-tight">
						{t("reset.title")}
					</h1>
				</div>

				<div className="mt-6 flex flex-col gap-5 rounded-xl border bg-card p-5 sm:p-6">
					{face.kind === "new-password" ? (
						<NewPasswordForm
							token={face.token}
							onDone={handleReset}
							onLinkExpired={() =>
								setFace({ kind: "request", expired: true, email: "" })
							}
						/>
					) : face.kind === "sent" ? (
						<SentNotice
							email={face.email}
							onBack={() =>
								setFace({ kind: "request", expired: false, email: face.email })
							}
						/>
					) : (
						<RequestForm
							/*
							 * When the face changes, the form is re-created so the previous face's error sentence does
							 * not remain.
							 */
							key={face.expired ? "expired" : "request"}
							expired={face.expired}
							initialEmail={face.email}
							returnPath={redirectTarget}
							onSent={(email) => setFace({ kind: "sent", email })}
						/>
					)}
				</div>

				<p className="mt-5 text-center text-sm text-muted-foreground">
					{t("reset.remembered")}{" "}
					<Link
						to="/login"
						search={{ redirect: redirectTarget }}
						className="font-medium text-foreground underline underline-offset-4"
					>
						{t("reset.signIn")}
					</Link>
				</p>
			</PageEnter>
		</main>
	);
}

/**
 * The reset mail request.
 *
 * It does not take the email from the address bar. Passing the address typed on the sign-in screen
 * in the query would leave personal data in the address, browser history and access logs. Retyping
 * it is cheaper than that.
 */
function RequestForm({
	expired,
	initialEmail,
	returnPath,
	onSent,
}: {
	/** Whether the user arrived here because the mail link was dead. This decides the first sentence. */
	expired: boolean;
	initialEmail: string;
	returnPath?: string;
	onSent: (email: string) => void;
}) {
	const { t } = useTranslation("auth");
	const id = useId();
	const [email, setEmail] = useState(initialEmail);
	const [fieldError, setFieldError] = useState<string | null>(null);
	const [submitError, setSubmitError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	/** The final guard against a second submit. `disabled` takes effect only from the next render. */
	const inFlight = useRef(false);

	const submit = async () => {
		if (inFlight.current) return;
		const checked = checkResetEmail(email);
		if (!checked.ok) {
			setFieldError(checked.message);
			return;
		}
		inFlight.current = true;
		setPending(true);
		setSubmitError(null);
		try {
			const failure = await requestPasswordReset(checked.email, returnPath);
			if (failure) {
				setSubmitError(requestResetErrorMessage(failure));
				return;
			}
			onSent(checked.email);
		} finally {
			inFlight.current = false;
			setPending(false);
		}
	};

	return (
		<form
			/*
			 * So that a submit before hydration does not carry the email in the address; same reason as the
			 * sign-in form (`form-submit-safety.test.ts`).
			 */
			method="post"
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
			className="flex flex-col gap-4"
		>
			<div className="flex flex-col gap-2">
				<h2 className="text-base font-semibold">
					{expired ? t("reset.expiredTitle") : t("reset.forgotTitle")}
				</h2>
				<p className="text-sm text-muted-foreground">
					{expired ? t("reset.expiredBody") : t("reset.forgotBody")}
				</p>
			</div>

			<Field
				label={t("reset.email")}
				htmlFor={`${id}-email`}
				error={fieldError}
			>
				<Input
					id={`${id}-email`}
					name="email"
					type="email"
					autoComplete="email"
					autoCapitalize="none"
					spellCheck={false}
					disabled={pending}
					aria-invalid={fieldError !== null}
					aria-describedby={fieldError ? `${id}-email-error` : undefined}
					value={email}
					onChange={(event) => {
						setEmail(event.target.value);
						if (fieldError) setFieldError(null);
					}}
				/>
			</Field>

			<SubmitError id={`${id}-submit-error`} message={submitError} />

			<Button
				type="submit"
				size="lg"
				disabled={pending}
				aria-describedby={submitError ? `${id}-submit-error` : undefined}
			>
				{pending ? t("reset.sending") : t("reset.send")}
			</Button>
		</form>
	);
}

/**
 * Sent — **if the address is registered.**
 *
 * The condition is not removed from the sentence. The server returns the same success for unknown
 * addresses, so stating "we sent the mail" flatly would make someone who mistyped the address wait
 * for a mail that never comes. Showing the address back is for the same reason: the most common
 * cause of a missing mail is a one-letter typo in the address (same judgement as
 * `verification-notice.tsx`).
 */
function SentNotice({ email, onBack }: { email: string; onBack: () => void }) {
	const { t } = useTranslation("auth");
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-2">
				<h2 className="text-base font-semibold">{t("reset.sentTitle")}</h2>
				<p className="text-sm text-muted-foreground">{t("reset.sentBody")}</p>
				<p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm font-medium break-all">
					{email}
				</p>
				<p className="text-sm text-muted-foreground">{t("reset.sentNote")}</p>
			</div>
			<Button type="button" variant="ghost" size="sm" onClick={onBack}>
				{t("reset.wrongAddress")}
			</Button>
		</div>
	);
}

/**
 * New password.
 *
 * A confirmation field is kept: the password typed here is first used again at the next sign-in,
 * and if a typo surfaces only then, the person has to repeat the procedure they just finished.
 */
function NewPasswordForm({
	token,
	onDone,
	onLinkExpired,
}: {
	token: string;
	onDone: () => Promise<void>;
	onLinkExpired: () => void;
}) {
	const { t } = useTranslation("auth");
	const id = useId();
	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [fieldError, setFieldError] = useState<string | null>(null);
	const [submitError, setSubmitError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const inFlight = useRef(false);

	const submit = async () => {
		if (inFlight.current) return;
		const issue = checkNewPassword(password, confirm);
		if (issue) {
			setFieldError(newPasswordIssueMessage(issue));
			return;
		}
		inFlight.current = true;
		setPending(true);
		setSubmitError(null);
		try {
			const failure = await resetPassword(token, password);
			if (!failure) {
				await onDone();
				return;
			}
			const next = resetFailureOf(failure);
			if (next.kind === "link_expired") {
				onLinkExpired();
				return;
			}
			setSubmitError(next.message);
		} finally {
			inFlight.current = false;
			setPending(false);
		}
	};

	const clearFieldError = () => {
		if (fieldError) setFieldError(null);
	};

	return (
		<form
			method="post"
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
			className="flex flex-col gap-4"
		>
			<div className="flex flex-col gap-2">
				<h2 className="text-base font-semibold">{t("reset.newTitle")}</h2>
				<p className="text-sm text-muted-foreground">{t("reset.newBody")}</p>
			</div>

			<Field
				label={t("reset.newPassword")}
				htmlFor={`${id}-password`}
				error={null}
			>
				<Input
					id={`${id}-password`}
					name="newPassword"
					type="password"
					autoComplete="new-password"
					disabled={pending}
					aria-invalid={fieldError !== null}
					aria-describedby={fieldError ? `${id}-confirm-error` : undefined}
					value={password}
					onChange={(event) => {
						setPassword(event.target.value);
						clearFieldError();
					}}
				/>
			</Field>

			{/*
			 * The validation message appears **once below both fields**. Length and match are both statements about this whole
			 * group, and drawing it per field would put two sentences up at the same moment.
			 */}
			<Field
				label={t("reset.confirmNewPassword")}
				htmlFor={`${id}-confirm`}
				error={fieldError}
			>
				<Input
					id={`${id}-confirm`}
					name="confirmPassword"
					type="password"
					autoComplete="new-password"
					disabled={pending}
					aria-invalid={fieldError !== null}
					aria-describedby={fieldError ? `${id}-confirm-error` : undefined}
					value={confirm}
					onChange={(event) => {
						setConfirm(event.target.value);
						clearFieldError();
					}}
				/>
			</Field>

			<SubmitError id={`${id}-submit-error`} message={submitError} />

			<Button
				type="submit"
				size="lg"
				disabled={pending}
				aria-describedby={submitError ? `${id}-submit-error` : undefined}
			>
				{pending ? t("reset.changing") : t("reset.change")}
			</Button>
		</form>
	);
}

/** One unit of label, control and validation message. Its rhythm matches the sign-in form (`feedback.ts`). */
function Field({
	label,
	htmlFor,
	error,
	children,
}: {
	label: string;
	htmlFor: string;
	error: string | null;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={htmlFor}>{label}</Label>
			{children}
			<AnimatePresence initial={false} mode="wait">
				{error && (
					<m.p
						key={error}
						id={`${htmlFor}-error`}
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						exit={feedbackExit}
						transition={feedbackEnter.transition}
						className="text-xs text-destructive"
					>
						{error}
					</m.p>
				)}
			</AnimatePresence>
		</div>
	);
}

/**
 * Submit failure: directly above the button, inside a live region.
 *
 * The region (`output`) stays mounted and only its children come and go. Attaching and detaching
 * the region itself would make assistive technology miss the change.
 */
function SubmitError({ id, message }: { id: string; message: string | null }) {
	return (
		<output aria-live="polite" id={id} className="empty:hidden">
			<AnimatePresence initial={false} mode="wait">
				{message && (
					<m.span
						key={message}
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						exit={feedbackExit}
						transition={feedbackEnter.transition}
						className="block text-sm text-destructive"
					>
						{message}
					</m.span>
				)}
			</AnimatePresence>
		</output>
	);
}
