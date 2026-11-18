import {
	DEVICE_APPROVAL_PAGE_PATH,
	DEVICE_USER_CODE_PARAM,
	deviceUserCodeFrom,
	formatDeviceUserCode,
} from "@rowcat/contracts";
import { resetViewerState } from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import { Input } from "@rowcat/ui-web/components/input";
import { Label } from "@rowcat/ui-web/components/label";
import { useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Wordmark } from "#/components/wordmark.tsx";
import { signOutFailed } from "#/features/auth/auth-error.ts";
import { authClient } from "#/lib/auth.ts";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { showErrorToast } from "#/lib/toast.ts";
import {
	type DeviceApprovalFace,
	type DeviceFailure,
	faceForFailure,
	faceForRead,
} from "./device-approval.ts";

const route = getRouteApi("/device");

/**
 * Reads the request — which, for an unclaimed one, claims it for the account signed in here. A throw
 * is a request that got no answer (`faceForFailure` reads that as the connection).
 */
async function readRequest(userCode: string): Promise<DeviceApprovalFace> {
	try {
		const { data, error } = await authClient.device({
			query: { user_code: userCode },
		});
		if (error || !data)
			return faceForFailure(userCode, error as DeviceFailure | null);
		return faceForRead(userCode, data);
	} catch {
		return faceForFailure(userCode, null);
	}
}

async function answerRequest(
	userCode: string,
	decision: "approve" | "deny",
): Promise<DeviceApprovalFace> {
	try {
		const { error } =
			decision === "approve"
				? await authClient.device.approve({ userCode })
				: await authClient.device.deny({ userCode });
		if (error) return faceForFailure(userCode, error as DeviceFailure);
		return { kind: decision === "approve" ? "approved" : "denied" };
	} catch {
		return faceForFailure(userCode, null);
	}
}

/** This page's own address for a code: where signing in again returns to. */
const pageFor = (userCode: string): string =>
	`${DEVICE_APPROVAL_PAGE_PATH}?${new URLSearchParams({ [DEVICE_USER_CODE_PARAM]: userCode })}`;

/**
 * Where a person approves `rowcat-mcp` signing in. Same frame as sign-in and password reset: one
 * centred face, no header. The faces and which one shows are `device-approval.ts`'s; this file draws
 * them and makes the three calls.
 *
 * The request is read once per code (`readFor`): reading claims, and the read is rate-limited per
 * address. StrictMode's second effect, a re-render or a refocus must not read again; only the person
 * pressing "try again" does.
 */
export function DeviceApprovalPage() {
	const { t } = useTranslation("deviceApproval");
	const search = route.useSearch();
	const userCode = deviceUserCodeFrom(search.user_code);
	const [face, setFace] = useState<DeviceApprovalFace>(() =>
		userCode ? { kind: "checking", userCode } : { kind: "enter-code" },
	);
	/** The code whose read is current; a late answer for another code is dropped. */
	const readFor = useRef<string | null>(null);

	const read = useCallback((code: string): void => {
		readFor.current = code;
		setFace({ kind: "checking", userCode: code });
		void readRequest(code).then((next) => {
			if (readFor.current === code) setFace(next);
		});
	}, []);

	useEffect(() => {
		if (userCode === null) {
			readFor.current = null;
			setFace({ kind: "enter-code" });
			return;
		}
		if (readFor.current === userCode) return;
		read(userCode);
	}, [userCode, read]);

	return (
		<main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
			<PageEnter className="w-full max-w-sm">
				<div className="flex flex-col items-center gap-1.5 text-center">
					<Link
						to="/"
						search={{}}
						className="text-2xl font-black tracking-tight no-underline"
					>
						<Wordmark size="display" />
					</Link>
					<h1 className="text-lg font-semibold tracking-tight">{t("title")}</h1>
				</div>

				<div className="mt-6 flex flex-col gap-5 rounded-xl border bg-card p-5 sm:p-6">
					<FaceView face={face} onFace={setFace} onRetry={read} />
				</div>
			</PageEnter>
		</main>
	);
}

function FaceView({
	face,
	onFace,
	onRetry,
}: {
	face: DeviceApprovalFace;
	onFace: (next: DeviceApprovalFace) => void;
	onRetry: (userCode: string) => void;
}) {
	const { t } = useTranslation("deviceApproval");
	switch (face.kind) {
		case "enter-code":
			return <EnterCodeForm />;
		case "checking":
			return (
				<output className="block text-sm text-muted-foreground">
					{t("checking")}
				</output>
			);
		case "review":
			return <Review userCode={face.userCode} onAnswered={onFace} />;
		case "approved":
			return <Outcome title={t("approved.title")} body={t("approved.body")} />;
		case "denied":
			return <Outcome title={t("denied.title")} body={t("denied.body")} />;
		case "answered":
			return <Notice message={t("answered")} />;
		case "other-account":
			return <Notice message={t("otherAccount")} />;
		case "invalid":
			return <Notice message={t("invalid")} />;
		case "recent-login":
			return <RecentLogin userCode={face.userCode} />;
		case "failed":
			return (
				<div className="flex flex-col gap-4">
					<p className="text-sm text-destructive" role="alert">
						{face.reason === "network"
							? t("failed.network")
							: face.reason === "rate-limited"
								? t("failed.rateLimited")
								: t("failed.unknown")}
					</p>
					<Button
						type="button"
						variant="outline"
						onClick={() => onRetry(face.userCode)}
					>
						{t("failed.retry")}
					</Button>
				</div>
			);
	}
}

/**
 * The review. The paragraph says what approving gives before either button is pressed — without it
 * people read approval as "adds a row to a list" (the same judgement as the pairing approval dialog).
 * The warning names the one situation in which approving is right, because the shape this grant
 * invites is a link someone else sent.
 */
function Review({
	userCode,
	onAnswered,
}: {
	userCode: string;
	onAnswered: (next: DeviceApprovalFace) => void;
}) {
	const { t } = useTranslation("deviceApproval");
	const [pending, setPending] = useState<"approve" | "deny" | null>(null);
	/** The final guard against a second press; `disabled` takes effect only from the next render. */
	const inFlight = useRef(false);

	const answer = async (decision: "approve" | "deny") => {
		if (inFlight.current) return;
		inFlight.current = true;
		setPending(decision);
		try {
			onAnswered(await answerRequest(userCode, decision));
		} finally {
			inFlight.current = false;
			setPending(null);
		}
	};

	return (
		<div className="flex flex-col gap-4">
			<p className="text-sm">{t("review.lead")}</p>
			<div className="flex flex-col gap-1.5">
				<p className="text-sm text-muted-foreground">{t("review.codeLabel")}</p>
				<p className="select-all rounded-lg border bg-muted/40 p-4 text-center font-mono text-xl tracking-[0.2em]">
					{formatDeviceUserCode(userCode)}
				</p>
			</div>
			<div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
				<p>{t("review.grants")}</p>
				<p>{t("review.drafts")}</p>
				<p>{t("review.disconnect")}</p>
			</div>
			<p className="text-sm font-medium">{t("review.warning")}</p>
			<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
				<Button
					type="button"
					variant="outline"
					disabled={pending !== null}
					onClick={() => void answer("deny")}
				>
					{pending === "deny" ? t("review.denying") : t("review.deny")}
				</Button>
				<Button
					type="button"
					disabled={pending !== null}
					onClick={() => void answer("approve")}
				>
					{pending === "approve" ? t("review.approving") : t("review.approve")}
				</Button>
			</div>
		</div>
	);
}

/**
 * Approving needs a recent sign-in (`apps/api/src/auth/device-authorization.ts`). The account screen
 * only says so; here the next step is one button, because the request expires in minutes and the
 * person must come back to this address with this code. The sign-out recipe is the header's.
 */
function RecentLogin({ userCode }: { userCode: string }) {
	const { t } = useTranslation("deviceApproval");
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const [signingOut, setSigningOut] = useState(false);

	const signInAgain = async () => {
		setSigningOut(true);
		try {
			await authClient.signOut();
			await resetViewerState(queryClient);
			await navigate({
				to: "/login",
				search: { redirect: pageFor(userCode) },
				replace: true,
			});
		} catch {
			/** The button stays; without a sentence a failed sign-out looks like one that worked. */
			showErrorToast(signOutFailed());
		} finally {
			setSigningOut(false);
		}
	};

	return (
		<div className="flex flex-col gap-4">
			<p className="text-sm text-muted-foreground">{t("recentLogin.body")}</p>
			<Button
				type="button"
				disabled={signingOut}
				onClick={() => void signInAgain()}
			>
				{signingOut ? t("recentLogin.working") : t("recentLogin.action")}
			</Button>
		</div>
	);
}

/**
 * For an address that came without a usable code (typed by hand, or cut short). The code becomes the
 * address so the read, a sign-in round trip and a refresh all start from the same place.
 */
function EnterCodeForm() {
	const { t } = useTranslation("deviceApproval");
	const id = useId();
	const navigate = useNavigate();
	const [value, setValue] = useState("");
	const [error, setError] = useState<string | null>(null);

	const submit = () => {
		const code = deviceUserCodeFrom(value);
		if (!code) {
			setError(t("enterCode.invalid"));
			return;
		}
		void navigate({
			to: DEVICE_APPROVAL_PAGE_PATH,
			search: { [DEVICE_USER_CODE_PARAM]: code },
			replace: true,
		});
	};

	return (
		<form
			/** A submit before hydration must not put the code in a GET to some other place. */
			method="post"
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
			className="flex flex-col gap-4"
		>
			<p className="text-sm text-muted-foreground">{t("enterCode.body")}</p>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor={`${id}-code`}>{t("enterCode.label")}</Label>
				<Input
					id={`${id}-code`}
					name="code"
					autoComplete="one-time-code"
					autoCapitalize="characters"
					spellCheck={false}
					placeholder="XXXX-XXXX"
					className="font-mono tracking-wider"
					aria-invalid={error !== null}
					aria-describedby={error ? `${id}-code-error` : undefined}
					value={value}
					onChange={(event) => {
						setValue(event.target.value);
						if (error) setError(null);
					}}
				/>
				{error && (
					<p
						id={`${id}-code-error`}
						className="text-sm text-destructive"
						role="alert"
					>
						{error}
					</p>
				)}
			</div>
			<Button type="submit">{t("enterCode.continue")}</Button>
		</form>
	);
}

/** A finished answer. A heading, so it is announced as where the page now stands. */
function Outcome({ title, body }: { title: string; body: string }) {
	return (
		<div className="flex flex-col gap-2">
			<h2 className="text-base font-semibold">{title}</h2>
			<p className="text-sm text-muted-foreground">{body}</p>
		</div>
	);
}

function Notice({ message }: { message: string }) {
	return <p className="text-sm text-muted-foreground">{message}</p>;
}
