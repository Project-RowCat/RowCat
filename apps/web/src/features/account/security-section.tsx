import type { AccountDetails } from "@rowcat/domain";
import { ACCOUNT_QUERY_KEY, accountQueryOptions } from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import { formatDate } from "#/lib/format/date-time.ts";
import { usePanelRetry } from "#/lib/query/panel-retry.ts";
import { AccountRow, AccountSection } from "./account-shell.tsx";
import { EmailSection } from "./email-section.tsx";
import { LoginMethodsSection } from "./login-methods-section.tsx";
import { PasskeysSection } from "./passkeys-section.tsx";
import { PasswordSection } from "./password-section.tsx";
import { SessionsSection } from "./sessions-section.tsx";
import { TwoFactorSection } from "./two-factor-section.tsx";

/**
 * Security: the account's **locks and keys** screen.
 *
 * It was once read-only, then held sign-in methods, password and sessions. It now has five
 * subsections. The two added (email and passkeys) are promises that became keepable once a sending
 * channel existed.
 *
 * Apple joining the sign-in method list follows the same axis. It was absent before not by taste
 * but because there was **no provider adapter**. When that reason disappeared, the vocabulary,
 * server configuration and this row arrived together in one commit, rather than being drawn ahead
 * of the wiring.
 *
 * **Still not drawn:**
 *
 * ```text
 * Two-step verification (TOTP)   needs the full enrollment and recovery ritual. It is a different slice
 * Recovery codes          same. Enabling two-step without them would make it a feature that locks the account
 * Kakao             no provider adapter
 * ```
 *
 * Password reset is not here: it is the path for someone who could **not** sign in, so it starts
 * from the sign-in screen (`routes/reset-password.tsx`). Someone who is signed in changes their
 * password in the password subsection above.
 *
 * ## Five subsections inside the section
 *
 * No second address such as `/security-center` is created. Account management lives at `/account`,
 * the single destination (app navigation keeps its three sidebar and three header items), and only
 * this section's contents grew.
 *
 * The axis of division is **what the operation acts on**, and the order runs top to bottom as one
 * line:
 *
 * ```text
 * email          this account's identity and contact channel   — verify and move it
 * password       the key to one route                          — change or create it
 * sign-in methods   the routes into this account                 — add and remove them
 * passkeys        the **list** of routes in                      — register, rename, delete
 * active sessions   what is already inside                         — end them
 * ```
 *
 * **Passkeys not sitting inside the sign-in methods subsection** is the most important decision in
 * this layout. That subsection's rows are one provider **record** each (one per provider per
 * member), and passkeys are a list. Merging them would put "3 passkeys" beside "Google", and that
 * row's unlink button could not say what it deletes.
 *
 * ## Failures end in their own place
 *
 * If this section's account lookup fails, the account screen as a whole does not become an error,
 * and **the session list and passkey list failures stay isolated even within this section**: each
 * has its own lookup and reports its failure in its own place. Merging the lookups would mean
 * someone signed in for a long time (the session list asks them to sign in again) could not even
 * see their own email.
 */
export function SecuritySection() {
	const { t } = useTranslation(["account", "common"]);
	/**
	 * Not `useSuspenseQuery`. If the account screen **as a whole** turned into an error when this
	 * lookup failed, someone who came to fix a nickname, or to turn off adult display, could do
	 * nothing. Only this section failed. The loader fills it during SSR, so on the normal path the
	 * value exists from the first render.
	 */
	const query = useQuery(accountQueryOptions(getRowCatClient()));
	const { data, isPaused, isError, isFetching } = query;

	/**
	 * `Try again` (retry): on a paused query, `refetch()` does nothing. The rule lives in one place,
	 * `lib/query/panel-retry.ts`.
	 */
	const retry = usePanelRetry(ACCOUNT_QUERY_KEY, query);

	/**
	 * **The held value comes first.** For a while `isError` stood ahead of the data, so one background
	 * refresh failing turned all five subsections (email, password, sign-in methods, passkeys,
	 * sessions) into an error box, even though the values on screen were still the server-confirmed
	 * account information. A held value is drawn as is (`notifications-state.ts` records the same rule
	 * ). Pausing also precedes failure in this table: a paused query is still pending, so placing
	 * failure first would show an offline user a placeholder that never ends.
	 */
	return (
		<AccountSection title={t("securitySection.security")}>
			{data !== undefined ? (
				<SecurityDetails account={data} />
			) : isPaused ? (
				<SecurityOffline onRetry={retry} retrying={isFetching} />
			) : isError ? (
				<SecurityError onRetry={retry} retrying={isFetching} />
			) : (
				<SecurityPlaceholder />
			)}
		</AccountSection>
	);
}

/**
 * No connection and no held value: it states that this is waiting, not an error. That is why there
 * is no `role="alert"`: it resumes on its own when the connection returns.
 */
function SecurityOffline({
	onRetry,
	retrying,
}: {
	onRetry: () => void;
	retrying: boolean;
}) {
	const { t } = useTranslation(["account", "common"]);
	return (
		<div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-4">
			<p className="text-sm text-muted-foreground">
				{t("securitySection.youReNotConnectedRight")}
			</p>
			<Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
				{retrying
					? t("securitySection.loading")
					: t("securitySection.tryAgain")}
			</Button>
		</div>
	);
}

/**
 * A failure is **not drawn as an empty value.**
 *
 * Silently leaving this section empty would make the screen claim an "account with no sign-in
 * methods at all". That falsehood would lead the user to misjudge their own account state, so a
 * failure is labelled as one and given a way to retry.
 */
function SecurityError({
	onRetry,
	retrying,
}: {
	onRetry: () => void;
	retrying: boolean;
}) {
	const { t } = useTranslation(["account", "common"]);
	return (
		<div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-4">
			{/* A failure that stands in for the placeholder must be read as an alert (this is where it differs from the paused state). */}
			<p role="alert" className="text-sm text-muted-foreground">
				{t("securitySection.couldnTLoadAccountDetails")}
			</p>
			<Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
				{retrying
					? t("securitySection.loading")
					: t("securitySection.tryAgain")}
			</Button>
		</div>
	);
}

/**
 * Placeholder. Its height matches the value, so the sections below do not shift when the value
 * arrives. It is an `<output>` for the same reason as the sr-only notices of the skeleton
 * subsections: loading is a quiet status message, not an alarm.
 */
function SecurityPlaceholder() {
	const { t } = useTranslation(["account", "common"]);
	return (
		<output className="block py-2.5 text-sm text-muted-foreground">
			{t("securitySection.loadingAccountDetails")}
		</output>
	);
}

function SecurityDetails({ account }: { account: AccountDetails }) {
	const { t } = useTranslation(["account", "common"]);
	return (
		<div className="flex flex-col gap-6">
			<dl className="divide-y">
				<AccountRow label={t("securitySection.accountCreated")}>
					{/*
					 * Not the "sign-up date". This value is when the **auth account** was created, and the member row is created
					 * late, on the first request, so the two can differ. Using the wording that the creator profile's sign-up date will carry
					 * once it exists would silently mix the two values.
					 */}
					{formatDate(account.createdAt)}
				</AccountRow>
			</dl>

			{/*
			 * The order is the rule (see the table in the header). Email is at the top because it is this account's
			 * **identity and contact channel**, and every operation below notifies that address.
			 *
			 * For the same reason, email is no longer in the read-only list above: a value that carries operations
			 * left as a row inside the `dl` would have that row alone read with a different weight.
			 */}
			<SecuritySubsection
				title={t("securitySection.email")}
				description={t("securitySection.yourSignInIdentifierAnd")}
			>
				<EmailSection account={account} />
			</SecuritySubsection>

			<SecuritySubsection title={t("securitySection.password")}>
				<PasswordSection account={account} />
			</SecuritySubsection>

			{/*
			 * Directly **below the password**, because this subsection guards that one door. Placed after sign-in methods or passkeys,
			 * it would read as locking those methods too (neither of them is challenged).
			 */}
			<SecuritySubsection
				title={t("securitySection.twoFactorAuthentication")}
				description={t("securitySection.evenIfYourPasswordLeaks")}
			>
				<TwoFactorSection account={account} />
			</SecuritySubsection>

			<SecuritySubsection
				title={t("securitySection.signInMethods")}
				description={t("securitySection.waysYouCanSignIn")}
			>
				<LoginMethodsSection account={account} />
			</SecuritySubsection>

			<SecuritySubsection
				title={t("securitySection.passkeys")}
				description={t("securitySection.signInWithYourDevice")}
			>
				<PasskeysSection />
			</SecuritySubsection>

			<SecuritySubsection
				title={t("securitySection.activeSessions")}
				description={t("securitySection.devicesSignedInToThis")}
			>
				<SessionsSection />
			</SecuritySubsection>
		</div>
	);
}

/**
 * One cell inside the security section.
 *
 * `AccountSection` is not nested here because that one is **a section of the screen**: its title is
 * an `h2` and a top border divides it. What is needed here is one level below that, and the
 * difference must show in the heading level (`h3`), so the outline is not flattened for screen
 * readers.
 */
function SecuritySubsection({
	title,
	description,
	children,
}: {
	title: string;
	description?: string;
	children: ReactNode;
}) {
	return (
		<section>
			<h3 className="text-sm font-semibold">{title}</h3>
			{description && (
				<p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
			)}
			{children}
		</section>
	);
}
