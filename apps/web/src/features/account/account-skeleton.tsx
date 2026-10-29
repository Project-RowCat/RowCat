import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { useTranslation } from "react-i18next";
import { translator } from "#/lib/i18n/current.ts";
import { AccountSection } from "./account-shell.tsx";

/**
 * Account loading placeholder. It draws the final screen's geometry with the same `AccountSection`
 * shell as the body, so sections do not shift when values arrive.
 *
 * Section titles and descriptions are real copy, not gray bars: they are static structure, and the
 * only text a user can read while waiting. Their wording can drift from the real screen (it already
 * did once), so update this file whenever a section's copy changes.
 *
 * It is the router's `pendingComponent`, so it shows for only a few hundred milliseconds and no
 * test covers it. Drift appears only as a section jumping when values arrive. Three had drifted:
 * profile (one input row vs. avatar, nickname, bio and profile link), security (one read-only row
 * vs. creation date plus five subsections) and the danger zone (absent vs. always rendered).
 *
 * Only the first screen (title, profile, content display) is sized exactly. Below that only each
 * section's presence and rough weight is kept; mimicking the hidden content would add height for
 * nothing. Conditional sections (sanction notice, my reports, operations tools) are omitted because
 * most accounts never show them, and reserving their space would shrink the page on arrival.
 *
 * Screen readers get one status line instead of each section.
 */
export function AccountSkeleton() {
	const { t } = useTranslation(["account", "common"]);
	return (
		<div className="mt-6">
			{/* <output> is implicitly role="status": the update is read once, politely. */}
			<output className="sr-only">
				{t("accountSkeleton.loadingAccountDetails")}
			</output>

			<div aria-hidden="true">
				<AccountSection
					title={t("profileSection.profile")}
					description={t("profileSection.yourNicknameAndBioAppear")}
				>
					{/* Three fields and one link. Spacing matches the real section (`gap-6`). */}
					<div className="flex flex-col gap-6">
						{/* Photo: the avatar (`size-20`) beside a button row and one hint line. */}
						<div className="flex flex-col gap-2">
							<Skeleton className="h-5 w-20" />
							<div className="flex items-center gap-4">
								<Skeleton className="size-20 shrink-0 rounded-full" />
								<div className="flex min-w-0 flex-col gap-2">
									<Skeleton className="h-8 w-24" />
									<Skeleton className="h-4 w-52 max-w-full" />
								</div>
							</div>
						</div>

						{/*
						 * Nickname: stacks on narrow screens; input and save sit side by side from `sm`.
						 *
						 * The label is `h-3.5` because `Label` uses `leading-none` (14px). The `h-5` of
						 * the other labels would add 6px per field, and that error stacks three times in
						 * this section.
						 */}
						<div className="flex flex-col gap-2">
							<Skeleton className="h-3.5 w-14" />
							<div className="flex flex-col gap-2 sm:flex-row">
								<Skeleton className="h-9 w-full sm:flex-1" />
								<Skeleton className="h-9 w-full sm:w-24" />
							</div>
						</div>

						{/*
						 * Bio: a three-row textarea (`rows={3}`) and the save row below it. The textarea
						 * grows with its content (`field-sizing-content`), so only its **initial height**
						 * is reserved here. Predicting the length of text the user already wrote would make
						 * accounts without a bio jump upward.
						 */}
						<div className="flex flex-col gap-2">
							<Skeleton className="h-3.5 w-10" />
							{/* Textarea with `rows={3}`; height measured in the browser. */}
							<Skeleton className="h-16 w-full" />
							<Skeleton className="h-9 w-full sm:w-24" />
						</div>

						{/* Link to the public profile (`size="sm"` = `h-8`). */}
						<Skeleton className="h-8 w-32" />
					</div>
				</AccountSection>

				<AccountSection title={t("contentSection.contentDisplay")}>
					<div className="flex items-start justify-between gap-4">
						<div className="min-w-0">
							{/*
							 * The label is `h-6` because it is an **inline `<label>`**: the wrapper has no font
							 * size, so the line box is 24px. `h-5` would make this section 4px shorter.
							 */}
							<Skeleton className="h-6 w-32" />
							<Skeleton className="mt-1 h-5 w-full max-w-80" />
						</div>
						{/*
						 * The switch takes its exact space so the right edge does not move on arrival. The
						 * component owns the dimensions (`h-[18.4px] w-[32px]`); this is the only place
						 * that copies them. An earlier `h-6 w-11` predates the smaller switch.
						 */}
						<Skeleton className="h-[18.4px] w-[32px] shrink-0 rounded-full" />
					</div>
				</AccountSection>

				<AccountSection title={t("securitySection.security")}>
					{/* Creation date row and five subsections. Spacing matches the real section (`gap-6`). */}
					<div className="flex flex-col gap-6">
						<div className="divide-y">
							<AccountSkeletonRow width="w-32" />
						</div>
						{securitySubsections().map((subsection) => (
							<SecuritySubsectionSkeleton
								key={subsection.title}
								{...subsection}
							/>
						))}
					</div>
				</AccountSection>

				<AccountSection title={t("dataSection.data")}>
					{/* Intro paragraph and sync box. Subsections are separated by `gap-6`, not rules. */}
					<div className="flex flex-col gap-6">
						<div className="flex flex-col gap-2">
							<Skeleton className="h-5 w-3/5" />
							<Skeleton className="h-5 w-full" />
						</div>
						<div className="flex flex-col gap-3">
							<div>
								<Skeleton className="h-5 w-28" />
								{/* The description is two lines (`mt-1`). */}
								<Skeleton className="mt-1 h-5 w-full" />
								<Skeleton className="h-5 w-3/5" />
							</div>
							{/* Sync status box; height measured in the browser. */}
							<Skeleton className="h-24 w-full" />
						</div>
					</div>
				</AccountSection>

				{/*
				 * The danger zone is **always rendered**. Leaving it out shortens the document, and the
				 * scrollbar grows once when values arrive.
				 *
				 * The border is not a gray bar: the red border is the first thing this section should
				 * read, so the real border stays and only the inside is filled.
				 */}
				<AccountSection title={t("deleteAccountSection.dangerZone")}>
					<div className="flex flex-col gap-4 rounded-lg border border-destructive/40 p-4">
						<div className="flex flex-col gap-1.5">
							<Skeleton className="h-5 w-20" />
							{/*
							 * Four lines listing what gets deleted. The copy is static, so the count is known
							 * and the placeholder is exact.
							 */}
							<div className="flex flex-col gap-1">
								<Skeleton className="h-5 w-full" />
								<Skeleton className="h-5 w-full" />
								<Skeleton className="h-5 w-11/12" />
								<Skeleton className="h-5 w-2/3" />
							</div>
							{/* The `See what gets deleted` link. */}
							<Skeleton className="h-5 w-40" />
						</div>
						<Skeleton className="h-9 w-28" />
					</div>
				</AccountSection>
			</div>
		</div>
	);
}

/**
 * The five security subsections. Their count and which ones have a description are the point of
 * this array: adding a subsection means adding an entry here. The password entry has no
 * description, because drawing that 18px line would push the three below it up on arrival.
 *
 * Titles are real copy: the structure is static, and they are the only text a user can read while
 * waiting for the server. A function, so the titles are read in the render's locale.
 */
const securitySubsections = (): {
	title: string;
	description: string | null;
	/**
	 * The **floor** of the content: the subsection's height when it is empty.
	 *
	 * List length is unknown until the server answers, so it is not predicted. Only the login method
	 * list is much taller in practice (about 80px per provider row). Inventing that number would make
	 * the screen shrink on arrival for accounts with one method; guessing too high is the safer error.
	 */
	body: string;
}[] => [
	{
		title: translator("account")("securitySection.email"),
		description: "w-64",
		body: "h-16",
	},
	{
		title: translator("account")("securitySection.password"),
		description: null,
		body: "h-16",
	},
	/** One status sentence and one button row; when enabled there are two buttons, on the same row. */
	{
		title: translator("account")("securitySection.twoFactorAuthentication"),
		description: "w-72",
		body: "h-16",
	},
	/**
	 * The only subsection whose row count is **fixed** (credentials, Google, Apple, Kakao). It lists
	 * the methods this deployment supports, not data, so its size can be reserved exactly. Linking
	 * changes the content of a row, not the number of rows.
	 */
	{
		title: translator("account")("securitySection.signInMethods"),
		description: "w-56",
		body: "h-60",
	},
	{
		title: translator("account")("securitySection.passkeys"),
		description: "w-72",
		body: "h-8",
	},
	{
		title: translator("account")("securitySection.activeSessions"),
		description: "w-60",
		body: "h-8",
	},
];

/**
 * One subsection, with the **same rhythm** as `SecuritySubsection`.
 *
 * The title and description are separated by `mt-0.5` and the content follows directly (no wrapping
 * `gap`). Using `gap-2` in the placeholder would add 40px across five subsections, so the section
 * would shrink on arrival.
 */
function SecuritySubsectionSkeleton({
	title,
	description,
	body,
}: {
	title: string;
	description: string | null;
	body: string;
}) {
	return (
		<div>
			<h3 className="text-sm font-semibold">{title}</h3>
			{description && <Skeleton className={`mt-0.5 h-4 ${description}`} />}
			<Skeleton className={`mt-2 w-full ${body}`} />
		</div>
	);
}

/** Same rhythm as `AccountRow`: stacked on narrow screens, name and value side by side from `sm`. */
function AccountSkeletonRow({ width }: { width: string }) {
	return (
		<div className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-baseline sm:gap-4">
			<Skeleton className="h-4 w-16 shrink-0 sm:w-28" />
			<Skeleton className={`h-4 ${width}`} />
		</div>
	);
}
