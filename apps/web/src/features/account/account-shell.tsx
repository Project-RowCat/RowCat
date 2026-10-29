import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Canvas } from "#/components/app-shell/canvas.tsx";

/**
 * Account screen skeleton: width and title.
 *
 * The app's default width (`max-w-6xl`) is not used. What lives here is prose and forms rather than
 * lists; on a 1440px screen, labels and values pushed to opposite edges make a single line hard to
 * follow. The same reason rules out a two-column dashboard: settings is a screen you read once from
 * top to bottom.
 *
 * The title lives here because it belongs to the **frame, not the body.** Whatever the state
 * (placeholder, error, account info), this screen is "account", and if each state drew that line
 * separately the title would move again when the values arrived. The discovery screen's shell holds
 * its own title for the same reason.
 */
export function AccountShell({ children }: { children: ReactNode }) {
	const { t } = useTranslation(["account", "common"]);
	return (
		<Canvas>
			<div className="mx-auto w-full max-w-2xl">
				<h1 className="text-2xl font-bold tracking-tight">
					{t("accountShell.account")}
				</h1>
				{children}
			</div>
		</Canvas>
	);
}

/**
 * One section of the account screen.
 *
 * Not wrapped in cards. A card means "these are separate blocks", but the four sections here are
 * already separated by their titles, and nested borders only lower the density. What lives here is
 * just the vertical rhythm of title, description and body.
 */
export function AccountSection({
	title,
	description,
	children,
}: {
	title: string;
	/** One line stating what this section decides. Omitted when absent, so no empty space is left. */
	description?: string;
	children: ReactNode;
}) {
	return (
		<section className="border-t py-6 first:border-t-0 first:pt-0">
			<h2 className="text-base font-semibold">{title}</h2>
			{description && (
				<p className="mt-1 text-sm text-muted-foreground">{description}</p>
			)}
			<div className="mt-4">{children}</div>
		</section>
	);
}

/**
 * A label and value on one line: the read-only item in the security section.
 *
 * On narrow screens they stack vertically. An email can be long, and pinned to one line it would
 * overflow or get cut at 390px. On the screen where someone comes to check their own email, that
 * value must not be cut.
 */
export function AccountRow({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-baseline sm:gap-4">
			<dt className="shrink-0 text-sm text-muted-foreground sm:w-28">
				{label}
			</dt>
			{/* Without `min-w-0`, a long email pushes the flex cell wider and overflows instead of wrapping. */}
			<dd className="min-w-0 text-sm break-words">{children}</dd>
		</div>
	);
}
