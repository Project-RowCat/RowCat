import { APP_NAME } from "@rowcat/domain";
import { setupStatusQueryOptions, viewerQueryOptions } from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import { Input } from "@rowcat/ui-web/components/input";
import { Label } from "@rowcat/ui-web/components/label";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { getRowCatClient } from "#/lib/api.ts";
import { authClient } from "#/lib/auth.ts";
import { useAdminQuery } from "#/lib/query/use-admin-query.ts";

/**
 * Operator sign-in, the only screen outside the shell.
 *
 * - Inside the shell, the operator gate would stand in front of it and sign-in would require
 *   being signed in.
 * - Email and password only: operator accounts are few and roles come from a seed script, and an
 *   OAuth flow would mean registering this console's origin with provider consoles, widening the
 *   attack surface.
 * - No authorization decision here. Success only means a session exists; the shell checks `/me`
 *   and draws the 403 screen. Deciding here too would make two places, and the looser one becomes
 *   policy.
 */

/**
 * Return address; accepts internal paths only.
 *
 * The value comes from links others build (`/login?redirect=…`); trusting it is an open redirect,
 * which here is a phishing path to a fake console. It never accepts an origin rather than comparing
 * one: only a relative path starting with `/` passes, so no host is expressible (same rule as the
 * web's `safeRedirectPath`, narrower because this app has no legitimate external destination).
 */
export function safeReturnPath(value: unknown): string {
	if (typeof value !== "string" || !value.startsWith("/")) return "/";
	// `//evil.example` and `/\evil.example` are read by browsers as protocol-relative URLs.
	if (value.length > 1 && (value[1] === "/" || value[1] === "\\")) return "/";
	/**
	 * Control characters and backslash, which confuse URL parsers: a value like `/\n/evil` changes
	 * meaning once the parser strips whitespace.
	 *
	 * It must be the control range, not a span. Writing `[ -\\]` covers space (0x20) through backslash
	 * (0x5C), which catches `/`, digits and capitals, so the function rejected every path.
	 */
	// biome-ignore lint/suspicious/noControlCharactersInRegex: blocking parser-confusing characters is the point.
	if (/[\u0000-\u001f\u007f\\]/.test(value)) return "/";
	// The login screen cannot be its own destination; that loops forever.
	if (value === "/login" || value.startsWith("/login?")) return "/";
	return value;
}

export function LoginPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const search = useSearch({ from: "/login" });
	const emailId = useId();
	const passwordId = useId();

	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const setupStatus = useAdminQuery(setupStatusQueryOptions(getRowCatClient()));
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const onSubmit = async (event: FormEvent) => {
		event.preventDefault();
		if (pending) return;
		setPending(true);
		setError(null);

		/**
		 * Failures arrive in two shapes: a response with an error resolves as `{ error }`, and only a
		 * failure with no response throws. Without catching the latter the rejection leaks unhandled and
		 * `pending` stays on, so the button reads `Signing in…` forever (seen on mornings with no API up).
		 */
		const result = await authClient.signIn
			.email({ email, password })
			.catch((): { error: unknown; unreachable: true } => ({
				error: {},
				unreachable: true,
			}));
		if ("unreachable" in result) {
			setPending(false);
			/**
			 * Kept apart from credential failure: nothing was checked yet and the operator should check the
			 * API, not retype the password. The caught exception's text is not shown (it can carry the
			 * request URL).
			 */
			setError("Couldn't reach the server. Check the API's status.");
			return;
		}
		if (result.error) {
			setPending(false);
			/**
			 * Failures are not split: telling "no such email" from "wrong password" makes this response an
			 * account-existence probe, especially for operator accounts.
			 */
			setError("The email or password is incorrect.");
			return;
		}

		/**
		 * Navigate only after the new session's viewer is fetched. A stale guest value in the cache would
		 * make the shell bounce back to login and look like an endless loop. `fetchQuery` rather than
		 * `resetQueries` because the shell needs that value immediately after navigation.
		 */
		queryClient.clear();
		await queryClient
			.fetchQuery(viewerQueryOptions(getRowCatClient()))
			.catch(() => null);

		setPending(false);
		navigate({ to: safeReturnPath(search.redirect), replace: true });
	};

	return (
		<div className="flex min-h-dvh items-center justify-center p-6">
			<form onSubmit={onSubmit} className="w-full max-w-sm space-y-5">
				<div className="space-y-1 text-center">
					<ShieldCheck
						className="mx-auto size-7 text-muted-foreground"
						aria-hidden
					/>
					<h1 className="font-semibold text-lg">
						{APP_NAME} Operations console
					</h1>
					<p className="text-muted-foreground text-sm">
						Sign in with an account that has operator access.
					</p>
				</div>

				<div className="space-y-1.5">
					<Label htmlFor={emailId}>Email</Label>
					<Input
						id={emailId}
						type="email"
						autoComplete="username"
						required
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						disabled={pending}
					/>
				</div>

				<div className="space-y-1.5">
					<Label htmlFor={passwordId}>Password</Label>
					<Input
						id={passwordId}
						type="password"
						autoComplete="current-password"
						required
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						disabled={pending}
					/>
				</div>

				{error ? (
					<p role="alert" className="text-destructive text-sm">
						{error}
					</p>
				) : null}

				<Button type="submit" className="w-full" disabled={pending}>
					{pending ? "Signing in…" : "Sign in"}
				</Button>

				{/**
				 * A fresh deployment has no operator to sign in as. Only the open state draws this line; a
				 * failed or pending status draws nothing, since a login screen that briefly invites setup on a
				 * deployment run for months reads as if it was reset.
				 */}
				{setupStatus.data?.open ? (
					<p className="text-center text-muted-foreground text-sm">
						First run?{" "}
						<Link
							to="/setup"
							className="text-foreground underline underline-offset-4"
						>
							Set up this deployment
						</Link>
					</p>
				) : null}
			</form>
		</div>
	);
}
