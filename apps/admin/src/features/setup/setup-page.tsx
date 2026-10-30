import { PASSWORD_LENGTH, type SetupClaimResponse } from "@rowcat/contracts";
import { APP_NAME, normalizeSetupCode } from "@rowcat/domain";
import {
	adminDeploymentReadinessQueryOptions,
	resetAdminState,
	SETUP_STATUS_QUERY_KEY,
	setupClaimMutationOptions,
	setupStatusQueryOptions,
	VIEWER_QUERY_KEY,
	viewerQueryOptions,
} from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import { Input } from "@rowcat/ui-web/components/input";
import { Label } from "@rowcat/ui-web/components/label";
import {
	type UseMutationResult,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Rocket } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import {
	ErrorBlock,
	LoadingBlock,
	OfflineBlock,
	QueryState,
} from "#/components/states.tsx";
import { SIGN_OUT_FAILED } from "#/features/auth/auth-error.ts";
import { getRowCatClient } from "#/lib/api.ts";
import { authClient } from "#/lib/auth.ts";
import { useAdminQuery } from "#/lib/query/use-admin-query.ts";
import { showErrorToast } from "#/lib/toast.ts";
import { ReadinessList } from "./readiness-list.tsx";
import {
	isSetupClosedError,
	resolveSetupView,
	setupClaimErrorMessage,
} from "./setup-view.ts";

/**
 * First-run setup: make the first administrator, then show what the deployment has turned on.
 *
 * Outside the shell, like `/login`: the shell's gate is the operator check, and the person here is by
 * definition not an operator yet. Nothing privileged is drawn before the server says so — the code
 * step only sends a code, and the readiness list mounts after the claim succeeded (its request is
 * admin-only and answers 403 to anyone else).
 *
 * The account is made through Better Auth's ordinary sign-up, never by this page or the API's setup
 * route; the setup route only changes the role of an account that already exists.
 */
export function SetupPage() {
	const client = getRowCatClient();
	const statusQuery = useAdminQuery(setupStatusQueryOptions(client));
	const viewerQuery = useAdminQuery(viewerQueryOptions(client));
	/** Owned here, not by the code form: the status refetch its success triggers unmounts that form. */
	const claim = useMutation(
		setupClaimMutationOptions(client, useQueryClient()),
	);

	const view = resolveSetupView({
		status: statusQuery.data,
		statusFailed: statusQuery.isError,
		viewer: viewerQuery.data,
		viewerPending: viewerQuery.isPending,
		viewerFailed: viewerQuery.isError,
		claim: claim.isSuccess ? "succeeded" : claim.isPending ? "pending" : "idle",
	});

	switch (view.step) {
		case "loading":
			return (
				<Frame title={`Set up ${APP_NAME}`}>
					<LoadingBlock rows={2} />
				</Frame>
			);
		case "unavailable": {
			const failed = statusQuery.isError ? statusQuery : viewerQuery;
			return (
				<Frame title={`Set up ${APP_NAME}`}>
					{failed.unreachable ? (
						<OfflineBlock onRetry={failed.retry} />
					) : (
						<ErrorBlock
							title="Couldn't read the setup state"
							error={failed.error}
							onRetry={failed.retry}
						/>
					)}
				</Frame>
			);
		}
		case "closed":
			return <ClosedStep operator={view.operator} />;
		case "account":
			return <AccountStep />;
		case "code":
			return <CodeStep nickname={view.nickname} claim={claim} />;
		case "done":
			return <DoneStep />;
	}
}

function Frame({
	title,
	description,
	step,
	children,
}: {
	title: string;
	description?: string;
	step?: string;
	children: ReactNode;
}) {
	return (
		<div className="flex min-h-dvh items-start justify-center p-6 sm:items-center">
			<div className="w-full max-w-lg space-y-6">
				<div className="space-y-1 text-center">
					<Rocket
						className="mx-auto size-7 text-muted-foreground"
						aria-hidden
					/>
					{step ? (
						<p className="text-muted-foreground text-xs">{step}</p>
					) : null}
					<h1 className="font-semibold text-lg">{title}</h1>
					{description ? (
						<p className="text-muted-foreground text-sm">{description}</p>
					) : null}
				</div>
				{children}
			</div>
		</div>
	);
}

function ClosedStep({ operator }: { operator: boolean }) {
	return (
		<Frame
			title="Setup is complete"
			description={
				operator
					? "This deployment already has an administrator."
					: "This deployment already has an administrator. Sign in with an operator account to use the console."
			}
		>
			<div className="flex justify-center">
				<Button
					nativeButton={false}
					render={<Link to={operator ? "/" : "/login"} />}
				>
					{operator ? "Open the console" : "Sign in"}
				</Button>
			</div>
		</Frame>
	);
}

function AccountStep() {
	const queryClient = useQueryClient();
	return (
		<Frame
			step="Step 1 of 2"
			title={`Set up ${APP_NAME}`}
			description="This deployment has no administrator yet. Create the account that will run it, or sign in with one you already made."
		>
			<CreateAccountForm
				onSignedIn={() =>
					queryClient.invalidateQueries({
						queryKey: VIEWER_QUERY_KEY,
						exact: true,
					})
				}
			/>
			<p className="text-center text-muted-foreground text-sm">
				Already have an account?{" "}
				<Link
					to="/login"
					search={{ redirect: "/setup" }}
					className="text-foreground underline underline-offset-4"
				>
					Sign in
				</Link>
			</p>
		</Frame>
	);
}

/**
 * Better Auth's sign-up, called directly like the web's form. Two outcomes are not failures: with
 * email verification on, sign-up gives no session (`token: null`), and an address that already has an
 * account answers the same way. Both get the same sentence, so this form is not an existence probe.
 */
function CreateAccountForm({
	onSignedIn,
}: {
	onSignedIn: () => Promise<void>;
}) {
	const nameId = useId();
	const emailId = useId();
	const passwordId = useId();
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [awaitingVerification, setAwaitingVerification] = useState(false);

	const onSubmit = async (event: FormEvent) => {
		event.preventDefault();
		if (pending) return;
		setPending(true);
		setError(null);

		/** Only the email is trimmed; whitespace in a password is part of the password. */
		const result = await authClient.signUp
			.email({ name: name.trim(), email: email.trim(), password })
			.catch((): { error: unknown; unreachable: true } => ({
				error: {},
				unreachable: true,
			}));
		if ("unreachable" in result) {
			setPending(false);
			setError("Couldn't reach the API. Check that it is running.");
			return;
		}
		if (result.error) {
			setPending(false);
			setError(
				"Couldn't create the account. If this address already has one, sign in instead.",
			);
			return;
		}
		const token = (result.data as { token?: string | null } | null)?.token;
		if (!token) {
			setPending(false);
			setAwaitingVerification(true);
			return;
		}
		await onSignedIn();
		setPending(false);
	};

	if (awaitingVerification)
		return (
			<output className="block rounded-lg border border-border p-4 text-sm leading-relaxed">
				If the address can receive mail, a confirmation link is on its way to{" "}
				<span className="font-medium">{email.trim()}</span>. Open it, then{" "}
				<Link
					to="/login"
					search={{ redirect: "/setup" }}
					className="underline underline-offset-4"
				>
					sign in
				</Link>{" "}
				to continue setup.
			</output>
		);

	return (
		<form onSubmit={onSubmit} className="space-y-4">
			<div className="space-y-1.5">
				<Label htmlFor={nameId}>Name</Label>
				<Input
					id={nameId}
					autoComplete="nickname"
					required
					value={name}
					onChange={(event) => setName(event.target.value)}
					disabled={pending}
				/>
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
					autoComplete="new-password"
					required
					minLength={PASSWORD_LENGTH.min}
					maxLength={PASSWORD_LENGTH.max}
					value={password}
					onChange={(event) => setPassword(event.target.value)}
					disabled={pending}
				/>
				<p className="text-muted-foreground text-xs">
					At least {PASSWORD_LENGTH.min} characters.
				</p>
			</div>
			{error ? (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			) : null}
			<Button type="submit" className="w-full" disabled={pending}>
				{pending ? "Creating account…" : "Create account"}
			</Button>
		</form>
	);
}

function CodeStep({
	nickname,
	claim,
}: {
	nickname: string;
	claim: UseMutationResult<SetupClaimResponse, Error, string>;
}) {
	const queryClient = useQueryClient();
	const codeId = useId();
	const hintId = useId();
	const [code, setCode] = useState("");

	const ready = normalizeSetupCode(code) !== null;

	const onSubmit = (event: FormEvent) => {
		event.preventDefault();
		if (!ready || claim.isPending) return;
		claim.mutate(code, {
			/**
			 * Someone else finished setup between this page loading and now. The status refetch redraws the
			 * page as closed, which says that better than an error line under the form.
			 */
			onError: (error) => {
				if (isSetupClosedError(error))
					void queryClient.invalidateQueries({
						queryKey: SETUP_STATUS_QUERY_KEY,
					});
			},
		});
	};

	const signOut = async () => {
		try {
			await authClient.signOut();
		} catch {
			showErrorToast(SIGN_OUT_FAILED);
			return;
		}
		await resetAdminState(queryClient);
		await queryClient.invalidateQueries({
			queryKey: VIEWER_QUERY_KEY,
			exact: true,
		});
	};

	const failure =
		claim.error && !isSetupClosedError(claim.error)
			? setupClaimErrorMessage(claim.error)
			: null;

	return (
		<Frame
			step="Step 2 of 2"
			title="Enter the setup code"
			description="The code proves you can read the API server's log. It makes this account the administrator, once."
		>
			<div className="space-y-2 rounded-lg border border-border p-4 text-sm">
				<p>
					The API prints it each time it starts while setup is open. With Docker
					Compose:
				</p>
				<pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
					docker compose logs api | grep "\[setup\]"
				</pre>
				<p className="text-muted-foreground">
					Running the API yourself (
					<code className="font-mono">pnpm dev:api</code>
					)? It is in that terminal.
				</p>
			</div>

			<form onSubmit={onSubmit} className="space-y-4">
				<div className="space-y-1.5">
					<Label htmlFor={codeId}>Setup code</Label>
					<Input
						id={codeId}
						value={code}
						onChange={(event) => setCode(event.target.value)}
						placeholder="XXXX-XXXX-XXXX"
						autoComplete="off"
						autoCapitalize="characters"
						spellCheck={false}
						className="font-mono uppercase tracking-wider"
						aria-describedby={hintId}
						aria-invalid={failure ? true : undefined}
						disabled={claim.isPending}
					/>
					<p id={hintId} className="text-muted-foreground text-xs">
						Signed in as <span className="font-medium">{nickname}</span>.{" "}
						<button
							type="button"
							onClick={signOut}
							className="underline underline-offset-4"
						>
							Use another account
						</button>
					</p>
				</div>
				{failure ? (
					<p role="alert" className="text-destructive text-sm">
						{failure}
					</p>
				) : null}
				<Button
					type="submit"
					className="w-full"
					disabled={!ready || claim.isPending}
				>
					{claim.isPending ? "Checking…" : "Become the administrator"}
				</Button>
			</form>
		</Frame>
	);
}

function DoneStep() {
	const navigate = useNavigate();
	const readinessQuery = useAdminQuery(
		adminDeploymentReadinessQueryOptions(getRowCatClient()),
	);
	return (
		<Frame
			title="You're the administrator"
			description="Here is what this deployment has turned on. Anything marked off works once its variables are set in the API's environment and the API restarts."
		>
			<QueryState query={readinessQuery} loadingRows={6}>
				{(data) => <ReadinessList data={data} />}
			</QueryState>
			<p className="text-muted-foreground text-xs">
				To appoint more operators, run{" "}
				<code className="font-mono">
					docker compose exec api node dist/db/seed-moderator.mjs &lt;email&gt;
					[staff|admin]
				</code>{" "}
				on the server (from a checkout:{" "}
				<code className="font-mono">
					pnpm --filter @rowcat/api db:seed:moderator
				</code>
				). The same list stays under Operations.
			</p>
			<Button className="w-full" onClick={() => navigate({ to: "/" })}>
				Open the console
			</Button>
		</Frame>
	);
}
