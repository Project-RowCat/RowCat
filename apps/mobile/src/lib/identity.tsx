import {
	normalizeTwoFactorCode,
	type TwoFactorCodeMethod,
	twoFactorCodeReady,
} from "@rowcat/domain";
import { viewerQueryOptions } from "@rowcat/query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { getRowCatClient } from "./api.ts";
import { attemptAppleNativeSignIn } from "./apple-auth.ts";
import { authClient, readAuthCookie } from "./auth.ts";
import {
	checkSignIn,
	checkSignUp,
	normalizeEmail,
	type SignInInput,
	type SignUpInput,
} from "./auth-credentials.ts";
import {
	AuthFlowError,
	authFailure,
	isTwoFactorRedirect,
	twoFactorRestartRequired,
} from "./auth-error.ts";
import {
	type IdentityFailure,
	type SocialProvider,
	socialProviderOf,
} from "./auth-social.ts";
import {
	MobileLocalDataProvider,
	useMobileLocalScope,
} from "./local-data/scope.tsx";
import { safeMobileReturnPath } from "./return-path.ts";
import {
	type MobileAppPhase,
	resolveAppPhase,
	resolveSessionState,
	type SessionState,
} from "./session-state.ts";
import {
	completeAuthentication,
	signOutSession,
} from "./session-transition.ts";

/**
 * React wiring for identity. **There are no rules here.**
 *
 * Judgement lives in `session-state.ts` (pure), and transition ordering lives in
 * `session-transition.ts`. This file attaches both to the render tree and runs the authentication
 * procedures. The split matches `activation.ts` ↔ `scope.tsx`, for the same reason: if rules live
 * inside a component, the only way to check them is rendering, and rendering needs a simulator.
 *
 * ## No local copy of the viewer
 *
 * `useState<Viewer>` is deliberately absent. The authority for identity is the single `["viewer"]`
 * query (`@rowcat/query`), and this provider holds only non-identity state: whether storage has
 * been read, whether a procedure is running, and the last failure. A copy would disagree with the
 * query the moment a sign-out fails, a background refresh runs, or another screen invalidates, and
 * there would be no way to know which to trust.
 *
 * Better Auth's `useSession()` is not used either. It answers "is there an auth session", but the
 * screen draws nickname, membership state and the adult gate, and the latter exists only in
 * `/v2/me`.
 */

/**
 * The procedure currently running. One slot rather than several booleans, because "both in
 * progress" must not exist.
 *
 * The social branch is not folded into a single `"social"`. Then two buttons would both show
 * pending together, and the user would read a method they did not press as also running. The
 * vocabulary comes from `SOCIAL_PROVIDERS`, so this type widens when a method is added.
 */
export type IdentityAction =
	| "sign-in"
	| "sign-up"
	| SocialProvider
	| "sign-out"
	/** Answering the two-factor challenge. The password has already been accepted. */
	| "two-factor";

export interface MobileIdentityValue {
	session: SessionState;
	pending: IdentityAction | null;
	/**
	 * The last failure: **the fact and its source**. Screens choose copy from this value
	 * (`authFailureMessage` in `auth-social.ts`).
	 */
	failure: IdentityFailure | null;
	signInWithEmail(input: SignInInput): Promise<boolean>;
	signUpWithEmail(input: SignUpInput): Promise<boolean>;
	/**
	 * Social sign-in. Functions are not created per method.
	 *
	 * A separate `signInWithApple` could drop the callback check or the session check, and the mistake
	 * would be visible only to people using that method. The web keeps its start functions in one
	 * table for the same reason.
	 *
	 * `returnPath` must be an in-app path that has passed validation; otherwise it collapses to the
	 * home screen.
	 */
	signInWithSocial(
		provider: SocialProvider,
		returnPath?: string,
	): Promise<boolean>;
	signOut(): Promise<boolean>;
	/**
	 * Whether the password was correct and **a second factor remains**. There is no session yet.
	 *
	 * This app has no screen to turn two-factor on or off (that is the web's account screen), but
	 * **the challenge must be answerable.** Otherwise someone who enabled two-factor on the web could
	 * never sign in with a password here. The feature would lock out the people who turned it on.
	 */
	twoFactorPending: boolean;
	verifyTwoFactor(input: {
		method: TwoFactorCodeMethod;
		code: string;
	}): Promise<boolean>;
	/** Dismiss the challenge and return to the sign-in form. The server's challenge cookie expires on its own after 10 minutes. */
	cancelTwoFactor(): void;
	/** Retry the session check from `unavailable`. */
	retry(): void;
	clearFailure(): void;
}

const IdentityContext = createContext<MobileIdentityValue | null>(null);

/**
 * Where to return after sign-in. **Only values that have passed `safeMobileReturnPath` arrive
 * here.**
 *
 * While the app had two screens, this was the constant `"/"`. With discovery and story detail, that
 * is not enough: a person who tapped a heart on a story and was sent to log in would land on the
 * home screen and lose what they were doing.
 *
 * So the destination is accepted, but **not the raw value.** Better Auth's Expo client turns this
 * relative path into an app deep link (`Linking.createURL`) and passes it to the OAuth provider. If
 * the raw material arrived unvalidated from outside, that link would become a phishing path. The
 * screen validates it once, and it is validated **again** here. The function is idempotent. The
 * assumption "the boundary already filtered it, so the inside can trust it" breaks silently the day
 * a new call site appears.
 */
const oauthCallbackPath = (returnPath: string | undefined): string =>
	safeMobileReturnPath(returnPath);

/**
 * Where to return when authentication **fails**. This is a constant.
 *
 * Without `errorCallbackURL`, Better Auth sends failures to its own default (`${baseURL}/error`, an
 * English HTML page the library serves). That address is not an app scheme, so **the browser sheet
 * does not close.** The user sees a screen this app never drew inside the sheet and must close it
 * by hand to return.
 *
 * It is a constant because the return destination (`returnPath`) only matters on success. A person
 * who failed needs only one screen where the other methods are shown (the web made the same call,
 * `apps/web/src/lib/auth.ts`). It also needs no validation, because it is a path we wrote, not a
 * value from outside.
 *
 * It starts with `/`, so `@better-auth/expo` turns it into an app deep link (`Linking.createURL`).
 * Failures therefore close the sheet **the same way** success does.
 */
const OAUTH_ERROR_PATH = "/login";

interface HydrationState {
	hydrated: boolean;
	storedSession: boolean;
}

export function MobileIdentityProvider({ children }: { children: ReactNode }) {
	const queryClient = useQueryClient();
	const client = useMemo(() => getRowCatClient(), []);

	const [hydration, setHydration] = useState<HydrationState>({
		hydrated: false,
		storedSession: false,
	});
	const [pending, setPending] = useState<IdentityAction | null>(null);
	const [failure, setFailure] = useState<IdentityFailure | null>(null);
	const [twoFactorPending, setTwoFactorPrompt] = useState(false);

	/**
	 * The final guard against a second submission. The button's `disabled` takes effect only from the
	 * **next render** after state changes, so a very fast double tap fires the second call before it
	 * is blocked. If two sign-up requests went out, the second would become "email already exists",
	 * and the person who just created the account would see a failure.
	 */
	const inFlight = useRef(false);

	/**
	 * Reads native storage once. This is the app's **hydration signal**.
	 *
	 * No identity is drawn until this read completes (the first line of `resolveSessionState`).
	 * `hydrated` is still set when the read fails, because otherwise the app would sit on the wait
	 * screen forever. In that case the `/me` query fails for the same reason and becomes
	 * `unavailable`, and the screen offers a way to retry.
	 */
	const syncHydration = useCallback(async () => {
		try {
			const cookie = await readAuthCookie();
			setHydration({ hydrated: true, storedSession: Boolean(cookie) });
		} catch {
			setHydration({ hydrated: true, storedSession: false });
		}
	}, []);

	useEffect(() => {
		void syncHydration();
	}, [syncHydration]);

	/**
	 * The **only** source of product identity. `enabled` is gated on hydration because querying before
	 * the cookie has loaded makes the server honestly answer "guest". That answer is the right answer
	 * to a wrong question, not a wrong value, but if it sat in the cache it would look like a
	 * sign-out.
	 */
	const viewerQuery = useQuery({
		...viewerQueryOptions(client),
		enabled: hydration.hydrated,
	});

	const session = useMemo(
		() =>
			resolveSessionState({
				hydrated: hydration.hydrated,
				storedSession: hydration.storedSession,
				transition: pending !== null,
				viewer: {
					status: viewerQuery.status,
					data: viewerQuery.data,
					paused: viewerQuery.fetchStatus === "paused",
				},
			}),
		[
			hydration.hydrated,
			hydration.storedSession,
			pending,
			viewerQuery.status,
			viewerQuery.data,
			viewerQuery.fetchStatus,
		],
	);

	const deps = useMemo(
		() => ({
			queryClient,
			client,
			signOut: async () => {
				const { error } = await authClient.signOut();
				if (error)
					throw new AuthFlowError(authFailure(error), { cause: error });
			},
		}),
		[queryClient, client],
	);

	/**
	 * The one point every authentication procedure passes through: locking, failure display and the
	 * hydration re-check happen together.
	 *
	 * Cleanup is not written per method (#49). A defect such as dropping cleanup for Google only
	 * cannot be expressed here.
	 */
	const run = useCallback(
		async (action: IdentityAction, operation: () => Promise<void>) => {
			if (inFlight.current) return false;
			inFlight.current = true;
			setPending(action);
			setFailure(null);
			try {
				await operation();
				return true;
			} catch (error) {
				/**
				 * **The source is attached here.** The procedure name is itself the answer
				 * (`socialProviderOf`), so there is no place for each method to write its own failure handling.
				 * If it were left to each method, the Apple branch alone could miss the source, and that person
				 * would read copy telling them to check Google.
				 */
				setFailure({
					reason:
						error instanceof AuthFlowError ? error.failure : "unreachable",
					provider: socialProviderOf(action),
				});
				return false;
			} finally {
				inFlight.current = false;
				/**
				 * Read storage again after the procedure finishes. Sign-in leaves a cookie and sign-out removes
				 * it. Without refreshing this, the offline judgement (`storedSession`) would keep the value
				 * from the previous run.
				 */
				await syncHydration();
				setPending(null);
			}
		},
		[syncHydration],
	);

	const signInWithEmail = useCallback(
		(input: SignInInput) =>
			run("sign-in", async () => {
				const invalid = checkSignIn(input);
				if (invalid) throw new AuthFlowError(invalid);

				const { data, error } = await authClient.signIn.email({
					email: normalizeEmail(input.email),
					// The password is passed through untouched. See the header of `auth-credentials.ts`.
					password: input.password,
				});
				if (error)
					throw new AuthFlowError(authFailure(error), { cause: error });

				/**
				 * **A challenge is neither a failure nor a success.** There is no session, so the completion
				 * procedure is not called (calling it would make `/me` answer guest). The sign-in form switches
				 * to a code field in place. The challenge arrives only **after** the password is correct, so
				 * existence hiding does not break: a wrong password ends in the same failure above.
				 */
				if (isTwoFactorRedirect(data)) {
					setTwoFactorPrompt(true);
					return;
				}

				await completeAuthentication(deps);
			}),
		[deps, run],
	);

	const signUpWithEmail = useCallback(
		(input: SignUpInput) =>
			run("sign-up", async () => {
				const invalid = checkSignUp(input);
				if (invalid) throw new AuthFlowError(invalid);

				const result = await authClient.signUp.email({
					name: input.name.trim(),
					email: normalizeEmail(input.email),
					password: input.password,
				});
				if (result.error)
					throw new AuthFlowError(authFailure(result.error), {
						cause: result.error,
					});

				/**
				 * **Some deployments do not grant a session on sign-up.**
				 *
				 * When the server requires email ownership verification (a deployment with a sending channel),
				 * Better Auth sets `token` to `null` in the sign-up response and creates no session. If
				 * `completeAuthentication` below ran anyway, `/me` would answer guest, and this app would
				 * **treat an unauthenticated person as signed in**. To the user it looks like "I signed up, but
				 * nothing is mine".
				 *
				 * So the response is read for what it says. This app has no screen that opens the verification
				 * mail (that is the web's job), so the only thing it can do here is **state the fact
				 * precisely**, and the message says where to look.
				 *
				 * Deployments that do not require verification never reach this branch: `autoSignIn: true`
				 * makes sign-up create the session and finish, and the code below becomes the same line as
				 * sign-in.
				 */
				if (!result.data?.token) throw new AuthFlowError("email_not_verified");

				await completeAuthentication(deps);
			}),
		[deps, run],
	);

	/**
	 * Social sign-in. **Only the transport differs; the completion procedure is one.**
	 *
	 * ```text
	 * Apple, usable on this device        OS sheet → id token to server   app handles the token
	 * everything else (Android, Google)   browser round trip → callback   app never sees the token
	 * ```
	 *
	 * The branch lives **inside** this function. A separate `signInWithApple` could drop the cookie
	 * check or the completion step on its own, and that mismatch would be visible only to people who
	 * signed in with that method. The screen would still draw the same button in the same list, and
	 * nothing would know which transport was used.
	 */
	const signInWithSocial = useCallback(
		(provider: SocialProvider, returnPath?: string) =>
			run(provider, async () => {
				/**
				 * Checks whether a session was created, then hands off to the completion procedure. **Both
				 * transports share this.**
				 *
				 * The only way to learn that a round trip ended without a session is whether **a cookie now
				 * exists**. Without this check, the completion procedure would ask `/me` as a guest and show
				 * the wrong "sign-in failed" copy.
				 *
				 * **This cannot tell what caused it.** Closing the sheet by choice and the server rejecting the
				 * request become the same value on this line. On the browser path the reason returns on the
				 * deep link as `?error=`, but the plugin consumes that address internally. So the thrown fact
				 * says no more than that.
				 */
				const finish = async (): Promise<void> => {
					if (!(await readAuthCookie()))
						throw new AuthFlowError("social_without_session");
					// The **same** completion procedure as email. If this forks, the §49 defect comes back.
					await completeAuthentication(deps);
				};

				if (provider === "apple") {
					const attempt = await attemptAppleNativeSignIn();

					/**
					 * The person closed the sheet. **This is not a failure; nothing happened.** The browser path
					 * cannot tell cancel from rejection, so it shows one sentence. The native library reports
					 * cancellation with its own code, so this path ends quietly rather than showing failure copy
					 * for something that did not happen.
					 */
					if (attempt.status === "cancelled") return;

					if (attempt.status === "credential") {
						/**
						 * **There is no callback address.** The browser never leaves, so there is no concept of a
						 * return destination on this path. `returnPath` is unused here, and the screen leaves on its
						 * own after reading the session state.
						 *
						 * For the server to accept this token, the apple provider must have the app's bundle id as
						 * its audience (`appBundleIdentifier` in `apps/api/src/auth/index.ts`). If that value is
						 * missing, the error occurs here, and this failure **does not fall through to the browser
						 * path below**. A silent fallback is the shape this app already rejected for BYO.
						 */
						const { error } = await authClient.signIn.social({
							provider,
							idToken: {
								token: attempt.token,
								// The raw nonce goes to the server. The hash was already sent to Apple.
								nonce: attempt.nonce,
							},
						});
						if (error)
							throw new AuthFlowError(authFailure(error), { cause: error });

						await finish();
						return;
					}
				}

				const { error } = await authClient.signIn.social({
					provider,
					callbackURL: oauthCallbackPath(returnPath),
					errorCallbackURL: OAUTH_ERROR_PATH,
				});
				if (error)
					throw new AuthFlowError(authFailure(error), { cause: error });

				await finish();
			}),
		[deps, run],
	);

	const signOut = useCallback(
		() => run("sign-out", () => signOutSession(deps)),
		[deps, run],
	);

	/**
	 * Answers the challenge. **Same two paths and the same shape rules as the web** (`two-factor.ts`
	 * in `@rowcat/domain`).
	 *
	 * On success it passes through the **same** completion procedure as email sign-in. Expiry and
	 * lockout cannot be fixed by entering the same field again, so the challenge is dismissed and the
	 * user returns to the sign-in form. The failure sentence appears on top of that form.
	 */
	const verifyTwoFactor = useCallback(
		(input: { method: TwoFactorCodeMethod; code: string }) =>
			run("two-factor", async () => {
				if (!twoFactorCodeReady(input.method, input.code))
					throw new AuthFlowError(
						input.method === "backup"
							? "two_factor_invalid_backup_code"
							: "two_factor_invalid_code",
					);
				const code = normalizeTwoFactorCode(input.method, input.code);
				const { error } =
					input.method === "backup"
						? await authClient.twoFactor.verifyBackupCode({ code })
						: await authClient.twoFactor.verifyTotp({ code });
				if (error) {
					const reason = authFailure(error);
					if (twoFactorRestartRequired(reason)) setTwoFactorPrompt(false);
					throw new AuthFlowError(reason, { cause: error });
				}
				setTwoFactorPrompt(false);
				await completeAuthentication(deps);
			}),
		[deps, run],
	);

	const cancelTwoFactor = useCallback(() => {
		setTwoFactorPrompt(false);
		setFailure(null);
	}, []);

	const retry = useCallback(() => {
		setFailure(null);
		void syncHydration();
		void viewerQuery.refetch();
	}, [syncHydration, viewerQuery.refetch]);

	const clearFailure = useCallback(() => setFailure(null), []);

	const value = useMemo(
		(): MobileIdentityValue => ({
			session,
			pending,
			failure,
			signInWithEmail,
			signUpWithEmail,
			signInWithSocial,
			signOut,
			twoFactorPending,
			verifyTwoFactor,
			cancelTwoFactor,
			retry,
			clearFailure,
		}),
		[
			twoFactorPending,
			verifyTwoFactor,
			cancelTwoFactor,
			session,
			pending,
			failure,
			signInWithEmail,
			signUpWithEmail,
			signInWithSocial,
			signOut,
			retry,
			clearFailure,
		],
	);

	return (
		<IdentityContext.Provider value={value}>
			{children}
		</IdentityContext.Provider>
	);
}

export function useMobileIdentity(): MobileIdentityValue {
	const value = useContext(IdentityContext);
	if (!value)
		throw new Error("identity can't be read outside MobileIdentityProvider");
	return value;
}

/**
 * The **one-line bridge** from server identity to local ownership.
 *
 * `Viewer.id` is that bridge. If Better Auth's `session.user.id` arrived here, the database file
 * would be keyed by the auth-account identity, and that identity would **diverge permanently** from
 * the member identity every other RowCat resource uses (stories, favorites, the sync namespace).
 * Adding one more sign-in method someday would then make a person's conversations appear to vanish
 * entirely.
 *
 * This is a component because it must read context between the two providers. The identity provider
 * does not own storage directly (#34); the lifetime of storage still belongs to
 * `MobileLocalDataProvider`.
 */
export function ViewerScopedLocalData({ children }: { children: ReactNode }) {
	/**
	 * While a transition runs, `session.viewer` is `null` (`resolveSessionState`), so the scope
	 * **closes first**. That is intended: from the moment sign-out is pressed until the outcome is
	 * settled, no window remains for writing to the previous member's file. If sign-out fails and
	 * Alice returns, the same member id comes back and the file reopens as it was. Closing controls
	 * access, not data, so nothing is lost.
	 */
	const { session } = useMobileIdentity();
	return (
		<MobileLocalDataProvider viewerId={session.viewer?.id ?? null}>
			{children}
		</MobileLocalDataProvider>
	);
}

/**
 * The value screens actually branch on: session and local storage **combined**.
 *
 * The two axes are not left for each screen to inspect separately. If a conversation list were
 * drawn as soon as the member was confirmed, then on a device whose storage had not yet opened, the
 * list would be empty, and the user would read that as their conversations having disappeared
 * (#67).
 */
export function useMobileAppPhase(): MobileAppPhase {
	const { session } = useMobileIdentity();
	const scope = useMobileLocalScope();
	return resolveAppPhase(session, scope.status);
}
