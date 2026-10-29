import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { Input } from "@rowcat/ui-web/components/input";
import { Label } from "@rowcat/ui-web/components/label";
import { Spinner } from "@rowcat/ui-web/components/spinner";
import { toDataURL } from "qrcode";
import { type ReactNode, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	AUTHENTICATOR_CODE_LENGTH,
	canAdvanceTwoFactorSetup,
	manualEntryKey,
	type TwoFactorSetupStep,
} from "#/features/auth/two-factor.ts";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import { translator } from "#/lib/i18n/current.ts";

/**
 * The three two-factor dialogs: enable, regenerate backup codes, and disable.
 *
 * None of them performs an action. They collect input and lift it up; the parent
 * (`two-factor-section.tsx`) decides the step and the result and draws them. The password lives in
 * local component state and is discarded on close. It never enters the query cache
 * (`security-boundaries.test.ts`).
 *
 * ## Secrets stay in these dialogs
 *
 * The TOTP URI (which contains the secret) and the plaintext backup codes are returned by the
 * server once, in the issuing response, and cannot be fetched again
 * (`apps/api/src/auth/two-factor-policy.ts`). So they flow only through props here, never into
 * storage, logs or URLs. The QR code is rendered **in this browser**: sending the URI to an
 * external QR service would leave the secret in someone else's server logs.
 */

/* Enable */

export function TwoFactorSetupDialog({
	step,
	totpURI,
	backupCodes,
	pending,
	error,
	onPassword,
	onBackupSaved,
	onVerify,
	onClose,
}: {
	step: TwoFactorSetupStep;
	totpURI: string | null;
	backupCodes: readonly string[];
	pending: boolean;
	error: string | null;
	onPassword: (password: string) => void;
	onBackupSaved: () => void;
	onVerify: (code: string) => void;
	onClose: () => void;
}) {
	const { t } = useTranslation(["account", "common"]);
	const id = useId();
	const [password, setPassword] = useState("");
	const [saved, setSaved] = useState(false);
	const [code, setCode] = useState("");
	const ready = canAdvanceTwoFactorSetup(step, {
		password,
		savedBackupCodes: saved,
		code,
	});

	const submit = () => {
		if (!ready || pending) return;
		if (step === "password") onPassword(password);
		else if (step === "backup") onBackupSaved();
		else if (step === "scan") onVerify(code);
	};

	return (
		<ManageDialog
			title={
				step === "done"
					? t("twoFactorDialogs.twoFactorAuthenticationIsOn")
					: t("twoFactorDialogs.turnOnTwoFactorAuthentication")
			}
			description={setupDescription(step)}
			pending={pending}
			onClose={onClose}
			onSubmit={submit}
			error={error}
			footer={
				step === "done" ? (
					<Button type="button" onClick={onClose}>
						{t("twoFactorDialogs.close")}
					</Button>
				) : (
					<>
						<Button
							type="button"
							variant="outline"
							disabled={pending}
							onClick={onClose}
						>
							{t("twoFactorDialogs.cancel")}
						</Button>
						<Button type="submit" disabled={!ready || pending}>
							{pending && <Spinner />}
							{setupSubmit(step)}
						</Button>
					</>
				)
			}
		>
			{step === "password" && (
				<PasswordField
					id={`${id}-password`}
					value={password}
					disabled={pending}
					onChange={setPassword}
				/>
			)}

			{step === "backup" && (
				<>
					<BackupCodeList codes={backupCodes} />
					<label className="flex items-start gap-2 text-sm">
						<input
							type="checkbox"
							className="mt-0.5 size-4 shrink-0"
							checked={saved}
							onChange={(event) => setSaved(event.target.checked)}
						/>
						<span>{t("twoFactorDialogs.iVeWrittenTheBackup")}</span>
					</label>
				</>
			)}

			{step === "scan" && totpURI !== null && (
				<>
					<AuthenticatorQr totpURI={totpURI} />
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={`${id}-code`}>
							{t("twoFactorDialogs.codeFromYourAuthenticatorApp")}
						</Label>
						<Input
							id={`${id}-code`}
							value={code}
							autoFocus
							inputMode="numeric"
							autoComplete="one-time-code"
							spellCheck={false}
							maxLength={AUTHENTICATOR_CODE_LENGTH + 2}
							disabled={pending}
							onChange={(event) => setCode(event.target.value)}
						/>
					</div>
				</>
			)}

			{step === "done" && (
				<p className="text-sm text-muted-foreground">
					{t("twoFactorDialogs.signingInWithAPassword")}
				</p>
			)}
		</ManageDialog>
	);
}

function setupDescription(step: TwoFactorSetupStep): string {
	const t = translator("account");
	if (step === "password") return t("twoFactorDialogs.signingInWithAPassword2");
	if (step === "backup") return t("twoFactorDialogs.oneTimeCodesForSigning");
	if (step === "scan") return t("twoFactorDialogs.scanTheQrCodeWith");
	return "";
}

function setupSubmit(step: TwoFactorSetupStep): string {
	const t = translator("account");
	if (step === "scan") return t("twoFactorDialogs.turnOn");
	if (step === "done") return t("twoFactorDialogs.close");
	return t("twoFactorDialogs.next");
}

/**
 * QR code and manual entry key. The QR is generated **in this browser** (see the header).
 *
 * While it renders, or if it fails, only the key is shown. The key is the source of truth; the QR
 * is a picture of that key.
 */
function AuthenticatorQr({ totpURI }: { totpURI: string }) {
	const { t } = useTranslation(["account", "common"]);
	const [image, setImage] = useState<string | null>(null);
	const key = manualEntryKey(totpURI);
	useEffect(() => {
		let live = true;
		toDataURL(totpURI, { margin: 1, width: 192, errorCorrectionLevel: "M" })
			.then((url) => {
				if (live) setImage(url);
			})
			.catch(() => {
				if (live) setImage(null);
			});
		return () => {
			live = false;
		};
	}, [totpURI]);

	return (
		<div className="flex flex-col items-center gap-3">
			{image !== null ? (
				<img
					src={image}
					alt={t("twoFactorDialogs.qrCodeToScanWith")}
					width={192}
					height={192}
					className="rounded-md bg-white p-1"
				/>
			) : (
				<div aria-hidden="true" className="size-48 rounded-md bg-muted" />
			)}
			{key !== null && (
				<div className="flex flex-col items-center gap-1">
					<span className="text-xs text-muted-foreground">
						{t("twoFactorDialogs.ifYouCanTScan")}
					</span>
					<code className="rounded-md border bg-muted/40 px-2 py-1 font-mono text-sm tracking-wider break-all select-all">
						{key}
					</code>
				</div>
			)}
		</div>
	);
}

/* Regenerate backup codes */

export function TwoFactorRegenerateDialog({
	codes,
	pending,
	error,
	onPassword,
	onClose,
}: {
	/** Newly issued codes. `null` until they have been generated. */
	codes: readonly string[] | null;
	pending: boolean;
	error: string | null;
	onPassword: (password: string) => void;
	onClose: () => void;
}) {
	const { t } = useTranslation(["account", "common"]);
	const id = useId();
	const [password, setPassword] = useState("");
	return (
		<ManageDialog
			title={t("twoFactorDialogs.getNewBackupCodes")}
			description={
				codes === null
					? t("twoFactorDialogs.gettingTenNewCodesMakes")
					: t("twoFactorDialogs.theseAreYourNewBackup")
			}
			pending={pending}
			error={error}
			onClose={onClose}
			onSubmit={() => {
				if (codes === null && password.length > 0 && !pending)
					onPassword(password);
			}}
			footer={
				codes === null ? (
					<>
						<Button
							type="button"
							variant="outline"
							disabled={pending}
							onClick={onClose}
						>
							{t("twoFactorDialogs.cancel")}
						</Button>
						<Button type="submit" disabled={password.length === 0 || pending}>
							{pending && <Spinner />}
							{t("twoFactorDialogs.getNewCodes")}
						</Button>
					</>
				) : (
					<Button type="button" onClick={onClose}>
						{t("twoFactorDialogs.iVeWrittenThemDown")}
					</Button>
				)
			}
		>
			{codes === null ? (
				<PasswordField
					id={`${id}-password`}
					value={password}
					disabled={pending}
					onChange={setPassword}
				/>
			) : (
				<BackupCodeList codes={codes} />
			)}
		</ManageDialog>
	);
}

/* Disable */

export function TwoFactorDisableDialog({
	pending,
	error,
	onPassword,
	onClose,
}: {
	pending: boolean;
	error: string | null;
	onPassword: (password: string) => void;
	onClose: () => void;
}) {
	const { t } = useTranslation(["account", "common"]);
	const id = useId();
	const [password, setPassword] = useState("");
	return (
		<ManageDialog
			title={t("twoFactorDialogs.turnOffTwoFactorAuthentication")}
			description={t("twoFactorDialogs.turningItOffLetsYou")}
			pending={pending}
			error={error}
			onClose={onClose}
			onSubmit={() => {
				if (password.length > 0 && !pending) onPassword(password);
			}}
			footer={
				<>
					<Button
						type="button"
						variant="outline"
						disabled={pending}
						onClick={onClose}
					>
						{t("twoFactorDialogs.cancel")}
					</Button>
					<Button
						type="submit"
						variant="destructive"
						disabled={password.length === 0 || pending}
					>
						{pending && <Spinner />}
						{t("twoFactorDialogs.turnOff")}
					</Button>
				</>
			}
		>
			<PasswordField
				id={`${id}-password`}
				value={password}
				disabled={pending}
				onChange={setPassword}
			/>
		</ManageDialog>
	);
}

/* Shared pieces */

/**
 * The shell shared by all three dialogs, so the geometry and dismissal rules are written once.
 *
 * It is a real `<form>`, so password managers recognize the field. While a request is pending, an
 * outside press or `Escape` does not close it (`shouldCloseDialog`).
 */
function ManageDialog({
	title,
	description,
	pending,
	error,
	onClose,
	onSubmit,
	footer,
	children,
}: {
	title: string;
	description: string;
	pending: boolean;
	error: string | null;
	onClose: () => void;
	onSubmit: () => void;
	footer: ReactNode;
	children: ReactNode;
}) {
	const errorId = useId();
	return (
		<Dialog
			open
			onOpenChange={(next, details) => {
				if (!next && shouldCloseDialog(details.reason, pending)) onClose();
			}}
		>
			<DialogContent
				closeButtonDisabled={pending}
				className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-md`}
			>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					{description.length > 0 && (
						<DialogDescription>{description}</DialogDescription>
					)}
				</DialogHeader>
				<form
					noValidate
					className="flex flex-col gap-4 text-sm"
					aria-describedby={error !== null ? errorId : undefined}
					onSubmit={(event) => {
						event.preventDefault();
						onSubmit();
					}}
				>
					{children}
					{error !== null && (
						<p id={errorId} role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}
					<DialogFooter>{footer}</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

/** One password field. Not trimmed (there is no `trim`). `current-password` so password managers can fill it. */
function PasswordField({
	id,
	value,
	disabled,
	onChange,
}: {
	id: string;
	value: string;
	disabled: boolean;
	onChange: (value: string) => void;
}) {
	const { t } = useTranslation(["account", "common"]);
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={id}>{t("twoFactorDialogs.currentPassword")}</Label>
			<Input
				id={id}
				type="password"
				value={value}
				autoFocus
				autoComplete="current-password"
				disabled={disabled}
				onChange={(event) => onChange(event.target.value)}
			/>
		</div>
	);
}

/**
 * Backup code list: a fixed-width two-column grid and a copy-all button.
 *
 * Copying goes only to the clipboard. If it fails the codes stay on screen so they can still be
 * written down, which is why there is no separate failure sentence; only the button label changes.
 */
function BackupCodeList({ codes }: { codes: readonly string[] }) {
	const { t } = useTranslation(["account", "common"]);
	const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
	return (
		<div className="flex flex-col gap-2">
			<ol className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm">
				{codes.map((code) => (
					<li key={code} className="select-all">
						{code}
					</li>
				))}
			</ol>
			<div>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => {
						void navigator.clipboard
							.writeText(codes.join("\n"))
							.then(() => setCopied("copied"))
							.catch(() => setCopied("failed"));
					}}
				>
					{copied === "copied"
						? t("twoFactorDialogs.copied")
						: copied === "failed"
							? t("twoFactorDialogs.couldnTCopy")
							: t("twoFactorDialogs.copyAll")}
				</Button>
			</div>
		</div>
	);
}
