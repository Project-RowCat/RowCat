import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { useTranslation } from "react-i18next";

import { CREATE_VIEWS, type CreateView } from "./create-search.ts";
import { DraftListSkeleton } from "./drafts/list.tsx";
import { EditorSectionSkeleton } from "./editor/fields.tsx";

/**
 * The placeholder for create, the only body the server renders. There is one for each of the two
 * screens. They were once shared, because all the server knows is that neither exists, so splitting
 * them looked pointless. That reasoning missed that the placeholder must answer 'where is this
 * going', not 'what is missing'. The list and the editor have entirely different geometry (a row
 * list versus a few cards), so merging them would re-lay out the whole screen when content arrives.
 * Neither exposes its shape to screen readers. Each announces a single status line instead.
 */

/**
 * Tab label widths. The order matches the real row (drafts, published works, analytics), and the
 * widths match the real glyph widths (38, 64, 24, and 24px). On narrow screens these values do not
 * decide placement: the tab's `flex-1` does, and the text centers within it. From `sm` the tabs are
 * content width, so these values become the tab widths. Approximations would make the tabs shift
 * sideways on arrival on that screen. The table is typed as a `Record` over the view vocabulary, so
 * adding a view fails compilation here first. The placeholder cannot keep the old count. Only the
 * first tab is an approximation. Its label carries the draft count, which changes width with the
 * number of digits. One digit is the reference; anyone with more drafts will be a few pixels wider.
 */
const TAB_LABEL_WIDTHS: Record<CreateView, string> = {
	drafts: "w-10",
	published: "w-16",
	analytics: "w-6",
	comments: "w-6",
};

/**
 * The workspace placeholder. It draws the heading (title and `New story`) and the tab row, not just the
 * frame. The shell gives only width and the title sits in the body, so without the heading and tabs
 * the list would drop the full header height when it arrives. The tabs joined the placeholder as
 * part of this change; leaving them out would move the list about 40px down when drafts arrive. It
 * does not distinguish which tab is pending. What it waits for is local storage opening, which is a
 * precondition for both tabs. The published works query draws its own placeholder inside its
 * section, so the drafts tab does not wait for that round trip.
 */
export function CreateHomeSkeleton() {
	const { t } = useTranslation(["create", "common"]);
	return (
		<div>
			{/* `<output>` implicitly has role="status", so updates are announced once, politely. */}
			<output className="sr-only">
				{t("createSkeleton.loadingTheWorkspace")}
			</output>

			<div aria-hidden="true">
				{/*
				 * The spacing between the heading and the navigation row matches the real screen (`mb-3`,
				 * `mt-4`).
				 */}
				<div className="mb-3 flex items-center justify-between gap-3">
					<Skeleton className="h-9 w-32" />
					<Skeleton className="h-9 w-28" />
				</div>
				{/*
				 * There are three tabs (drafts, published works, analytics). A mismatched count would shift the
				 * list on arrival. What is easy to get wrong is not the count but the position. On narrow screens
				 * the real row shares the width evenly across the tabs (`flex-1`), and from `sm` returns to content
				 * width (`sm:flex-none`). If the placeholder pinned everything to the left, the tabs would be
				 * rearranged horizontally when drafts arrive: the height would match, but the labels would slide
				 * sideways.
				 * So the skeleton reuses the structure: the outer bottom line, `-mb-px`, the tab's `flex-1
				 * sm:flex-none`,
				 * the link's margins, and the transparent `border-b-2`. Those five set the row height (38px) and
				 * the
				 * widths of the tabs together. Only the text width inside each tab is approximate. Text centers
				 * within
				 * the tab, so a wrong value does not move the layout.
				 */}
				<div className="border-b">
					<div className="-mb-px flex">
						{CREATE_VIEWS.map((view) => (
							<div key={view} className="flex-1 sm:flex-none">
								<div className="flex items-center justify-center border-b-2 border-transparent px-2.5 py-2 sm:justify-start sm:px-3">
									<Skeleton className={`h-5 ${TAB_LABEL_WIDTHS[view]}`} />
								</div>
							</div>
						))}
					</div>
				</div>
				{/*
				 * Draws the placeholder for the drafts tab. Its geometry belongs to that list (`draft-list.tsx`).
				 * Drawing it here again would leave this file in the old shape the day the list changes.
				 */}
				<div className="mt-4">
					<DraftListSkeleton />
				</div>
			</div>
		</div>
	);
}

/**
 * The editor's placeholder. The editor is a tall screen, so the placeholder draws only what fits in
 * the first view. Filling the lower sections would add scrolling before content arrives, and that
 * scroll would take a different length once content comes in. Only the heading and two sections
 * (`Basics` and `Prompt`) are drawn. The outer shell is real. For a while these were two grey boxes
 * (`h-64` and `h-40`). The comment said they set the rhythm of the section cards, but they had no
 * border, inner padding, or title. Those three appeared only together with the values, so the whole
 * screen re-laid out when the draft arrived. Now it draws the same shell as the real sections
 * (`EditorSectionSkeleton`), and only the interior is grey. The title and description are real text
 * because they are structure, not data. These two are fixed sections of the editor, so they read
 * the same on every draft. This differs from the copy of the three child lists, which comes from
 * constants beside each list and is owned by that section. Here the editor itself owns the copy
 * (`draft-editor-page.tsx`).
 */
export function DraftEditorSkeleton() {
	const { t } = useTranslation(["create", "common"]);
	return (
		<div>
			<output className="sr-only">{t("createSkeleton.loadingTheDraft")}</output>

			<div aria-hidden="true">
				{/* The heading row. Its height is that of the real `h1` (`text-xl`, then `sm:text-2xl`). */}
				<div className="mb-5 flex flex-wrap items-center justify-between gap-3">
					<Skeleton className="h-7 w-56 max-w-full sm:h-8" />
					<Skeleton className="h-4 w-16" />
				</div>
				<div className="flex flex-col gap-4">
					<EditorSectionSkeleton
						title={t("createSkeleton.basics")}
						description={t("createSkeleton.thisIsWhatShowsIn")}
						action={false}
					>
						{/*
						 * Spacing between fields is the section body's (`gap-4`). Only four things are drawn inside: cover,
						 * title, a one-line intro, and description. There is no tag chip row. Most drafts have no tags, so
						 * reserving a row for them would make the layout shrink on arrival for most drafts.
						 */}
						<div className="flex flex-col gap-4">
							<div className="flex flex-col gap-1.5">
								<Skeleton className="h-5 w-10" />
								<div className="flex items-start gap-3">
									<div className="aspect-3/4 w-20 shrink-0 rounded-md border bg-muted" />
									<div className="flex min-w-0 flex-1 flex-col gap-2">
										<Skeleton className="h-8 w-full" />
										<Skeleton className="h-4 w-3/4" />
									</div>
								</div>
							</div>
							<EditorFieldSkeleton label="w-10" control="h-9" />
							<EditorFieldSkeleton label="w-20" control="h-9" />
							<EditorFieldSkeleton label="w-10" control="h-[76px]" />
						</div>
					</EditorSectionSkeleton>

					<EditorSectionSkeleton
						title={t("createSkeleton.prompt")}
						description={t("createSkeleton.theFullStorySetupThe")}
						action={false}
					>
						{/*
						 * One body textarea (`rows={20}`). This section sits at the bottom of the first view, so what
						 * matters
						 * is that something large appears there, more than the exact height.
						 */}
						<EditorFieldSkeleton label="w-16" control="h-64" />
					</EditorSectionSkeleton>
				</div>
			</div>
		</div>
	);
}

/** A label line and one control, with the same rhythm as `FieldFrame` (`gap-1.5`). */
function EditorFieldSkeleton({
	label,
	control,
}: {
	label: string;
	control: string;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<Skeleton className={`h-5 ${label}`} />
			<Skeleton className={`${control} w-full`} />
		</div>
	);
}
