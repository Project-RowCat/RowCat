import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { useTranslation } from "react-i18next";
import {
	ROOM_LIST_CLASS,
	ROOM_ROW_CLASS,
	ROOM_ROW_MENU_CLASS,
	ROOM_ROW_TIME_CLASS,
} from "./room-row-layout.ts";

/**
 * Placeholder for the chat library, and the only body the server renders.
 *
 * The server does not know whether this visitor has any conversations (rooms live only in
 * IndexedDB). So only the geometry of the skeleton is here. No room title, conversation count or
 * timestamp reaches the server HTML: filling the slots with invented values would make the
 * placeholder start asserting facts.
 *
 * Do not put "no conversations" here. Not knowing yet and truly having zero are different states,
 * and merging them would flash the empty state each time someone with conversations opens the page.
 *
 * **Same geometry as the rows that will arrive.** Only the text should change when values arrive.
 * (An earlier placeholder of four cards switched to a row list, and the whole screen was re-laid
 * out on each arrival.) The geometry comes from the same constants as the real rows
 * (`room-row-layout.ts`): writing it separately in two files lets one change without the other, and
 * that mismatch raises no error.
 */

/** Same grid as a real row. Only the inner items are gray boxes. */
function RoomRowSkeleton() {
	return (
		<li className="relative">
			<div className={ROOM_ROW_CLASS}>
				<Skeleton className="h-5 w-48 max-w-full" />
				{/*
				 * The activity-time slot. On narrow screens it sits below the title; from `sm` up it is the
				 * right column. The real row's value uses the same class and lands in the same place.
				 */}
				<span className={ROOM_ROW_TIME_CLASS}>
					{/*
					 * Reserve only the width of the value. Filling the whole column (6rem) in gray would make a
					 * block much larger than the `3 min ago` that will arrive, and the placeholder would read heavier
					 * than the real screen. The right alignment from `sm` is already set by the wrapping cell.
					 */}
					<Skeleton className="inline-block h-4 w-14 align-middle sm:w-12" />
				</span>
			</div>
			{/*
			 * Slot for the manage trigger. The dimensions must match the button in `RoomActionsMenu`
			 * (`size-9 sm:size-8`). That component owns the value; this is the only other place that repeats it.
			 */}
			<Skeleton
				className={`${ROOM_ROW_MENU_CLASS} size-9 rounded-md sm:size-8`}
			/>
		</li>
	);
}

export function ChatLibrarySkeleton() {
	const { t } = useTranslation("chatLibrary");
	return (
		<div>
			{/* <output> is implicitly role="status": updates are read once, quietly. */}
			<output className="sr-only">{t("loading")}</output>

			<div aria-hidden="true">
				<div className="mb-5">
					<Skeleton className="h-9 w-24" />
				</div>
				{/* Search and sort. If this row appeared only when the list arrived, the screen would collapse. */}
				<div className="mb-4 flex flex-col gap-3">
					<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
						<Skeleton className="h-10 flex-1 sm:h-9" />
						<Skeleton className="h-10 w-full shrink-0 sm:h-9 sm:w-40" />
					</div>
					{/* One `N conversations` line. The count is not invented, so only its space is reserved. */}
					<Skeleton className="h-4 w-20" />
				</div>
				<ul className={ROOM_LIST_CLASS}>
					<RoomRowSkeleton />
					<RoomRowSkeleton />
					<RoomRowSkeleton />
					<RoomRowSkeleton />
					<RoomRowSkeleton />
				</ul>
			</div>
		</div>
	);
}
