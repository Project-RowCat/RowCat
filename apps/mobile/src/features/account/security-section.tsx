import { space } from "@rowcat/design";
import type { AccountDetails } from "@rowcat/domain";
import {
	ACCOUNT_QUERY_KEY,
	accountQueryOptions,
	invalidateAccountDetails,
} from "@rowcat/query";
import { Notice, Separator, Spinner, Text } from "@rowcat/ui-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { formatDate } from "../../lib/format.ts";
import {
	ACCOUNT_INFO_CREATED_LABEL,
	ACCOUNT_RETRY_LABEL,
} from "./account-copy.ts";
import { AccountRow, AccountSection } from "./account-section.tsx";
import { accountDetailsPanelView } from "./account-state.ts";
import { isEmailChangeReturn } from "./email-change.ts";
import { EmailSection } from "./email-section.tsx";
import { LoginMethodsSection } from "./login-methods-section.tsx";
import { PasskeysSection } from "./passkeys-section.tsx";
import { PasswordSection } from "./password-section.tsx";
import {
	SECURITY_LOAD_FAILED,
	SECURITY_OFFLINE,
	SECURITY_SECTION_TITLE,
	SECURITY_STALE,
	SECURITY_SUBSECTION_DESCRIPTION,
	SECURITY_SUBSECTION_TITLE,
} from "./security-copy.ts";
import { SessionsSection } from "./sessions-section.tsx";

/**
 * Security section of the account screen; native counterpart of the web `security-section.tsx`. It
 * replaced the read-only `Account details` section: keeping both would draw the same values (email, login
 * methods) twice with only one of them carrying controls.
 *
 * - Five subsections, in order: email, password, login methods, passkeys, active sessions. No
 *   second address such as `/account/security`; the destination is still `/account`.
 * - This component is the only caller of `accountQueryOptions`; the three subsections that read
 *   account info receive it as a prop, so failure, staleness and retry have one owner. Passkeys and
 *   sessions have their own queries (different freshness, and a failure in one must not take the
 *   other down).
 * - Failures end inside this section; `/me/account` failing leaves profile editing intact. A
 *   failure is never drawn as an empty value ("Email: -" would claim the account has no email); a
 *   held value is kept and marked stale.
 * - The email-return marker is a claim, not a fact: the only response is clearing it and asking
 *   the server again (`isEmailChangeReturn` accepts one value we wrote).
 */
export function SecuritySection() {
	const queryClient = useQueryClient();
	const query = useQuery(accountQueryOptions(getRowCatClient()));

	const view = accountDetailsPanelView({
		isPaused: query.isPaused,
		isError: query.isError,
		isPending: query.isPending,
		hasData: query.data !== undefined,
	});

	// `refetch()` creates no request on a paused query. With no held value, restart the query from
	// scratch (nothing to lose); otherwise an ordinary refetch.
	const retry = useCallback(() => {
		if (query.data === undefined) {
			void queryClient.resetQueries({
				queryKey: ACCOUNT_QUERY_KEY,
				// Session and passkey cells under the prefix belong to their own sections.
				exact: true,
			});
			return;
		}
		void query.refetch();
	}, [query.data, query.refetch, queryClient]);

	useEmailReturn(queryClient);

	return (
		<AccountSection title={SECURITY_SECTION_TITLE}>
			{view.state === "loading" ? (
				<Spinner />
			) : view.state === "offline" ? (
				<Notice
					message={SECURITY_OFFLINE}
					actionLabel={ACCOUNT_RETRY_LABEL}
					onAction={retry}
					busy={query.isFetching}
				/>
			) : view.state === "error" ? (
				<Notice
					tone="destructive"
					message={SECURITY_LOAD_FAILED}
					actionLabel={ACCOUNT_RETRY_LABEL}
					onAction={retry}
					busy={query.isFetching}
				/>
			) : query.data ? (
				<View style={security.stack}>
					{/** Held value is drawn as is; one sentence states staleness. */}
					{view.retryable ? (
						<Notice
							message={SECURITY_STALE}
							actionLabel={ACCOUNT_RETRY_LABEL}
							onAction={retry}
							busy={query.isFetching}
						/>
					) : null}
					<SecurityDetails account={query.data} />
				</View>
			) : null}
		</AccountSection>
	);
}

/**
 * Refetches account info exactly once after returning from the email flow. The marker stays in
 * router params, so without the guard every re-render would query. It is cleared with `setParams`
 * (navigating would push history entries; leaving it re-queries on every reopen). The value is not
 * trusted: the server's response is the only authority on email and verification.
 */
function useEmailReturn(queryClient: ReturnType<typeof useQueryClient>): void {
	const router = useRouter();
	const params = useLocalSearchParams<{ email?: string | string[] }>();
	const raw = params.email;
	const returned = isEmailChangeReturn(Array.isArray(raw) ? raw[0] : raw);
	const consumed = useRef(false);

	useEffect(() => {
		if (!returned || consumed.current) return;
		consumed.current = true;
		// Explicit `undefined`: `setParams` merges, so omitting the key keeps its previous value.
		router.setParams({ email: undefined });
		void invalidateAccountDetails(queryClient);
	}, [returned, router, queryClient]);
}

function SecurityDetails({ account }: { account: AccountDetails }) {
	const created = formatDate(account.createdAt);

	return (
		<View style={security.stack}>
			{/**
			 * Not "join date": this is when the auth account was created, and the member row is
			 * created later on the first request, so they can differ. A control-less fact, so it
			 * stands at the head of the section instead of getting a subsection.
			 */}
			<AccountRow
				label={ACCOUNT_INFO_CREATED_LABEL}
				value={created ?? account.createdAt}
			/>

			<SecuritySubsection
				title={SECURITY_SUBSECTION_TITLE.email}
				description={SECURITY_SUBSECTION_DESCRIPTION.email}
			>
				<EmailSection account={account} />
			</SecuritySubsection>

			<SecuritySubsection title={SECURITY_SUBSECTION_TITLE.password}>
				<PasswordSection account={account} />
			</SecuritySubsection>

			<SecuritySubsection
				title={SECURITY_SUBSECTION_TITLE.loginMethods}
				description={SECURITY_SUBSECTION_DESCRIPTION.loginMethods}
			>
				<LoginMethodsSection account={account} />
			</SecuritySubsection>

			{/** Passkeys and sessions take no account info; their own queries keep failures separate. */}
			<SecuritySubsection
				title={SECURITY_SUBSECTION_TITLE.passkeys}
				description={SECURITY_SUBSECTION_DESCRIPTION.passkeys}
			>
				<PasskeysSection />
			</SecuritySubsection>

			<SecuritySubsection
				title={SECURITY_SUBSECTION_TITLE.sessions}
				description={SECURITY_SUBSECTION_DESCRIPTION.sessions}
			>
				<SessionsSection />
			</SecuritySubsection>
		</View>
	);
}

/**
 * One slot inside the security section. Not a nested `AccountSection` (that is a screen-level
 * section with a top rule; this is one heading level lower, so the screen-reader outline stays
 * hierarchical). Not wrapped in cards: the five are already separated by headings, and nested
 * borders would make the account screen read as a dashboard.
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
		<View style={security.subsection}>
			<Separator />
			<View style={security.head}>
				<Text accessibilityRole="header" variant="body">
					{title}
				</Text>
				{description ? (
					<Text variant="caption" tone="muted-foreground">
						{description}
					</Text>
				) : null}
			</View>
			{children}
		</View>
	);
}

const security = StyleSheet.create({
	stack: { gap: space.lg },
	subsection: { gap: space.sm },
	head: { gap: space.px },
});
