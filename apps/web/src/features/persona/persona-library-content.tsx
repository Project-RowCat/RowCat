import type { ChatPersona } from "@rowcat/chat";
import { Button, buttonVariants } from "@rowcat/ui-web/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@rowcat/ui-web/components/dropdown-menu";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@rowcat/ui-web/components/empty";
import { Link } from "@tanstack/react-router";
import { MoreHorizontal, Plus, UserRound } from "lucide-react";
import { AnimatePresence, LayoutGroup } from "motion/react";
import * as m from "motion/react-m";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalPersonas } from "#/lib/local-chat/hooks.ts";
import { useChatScope } from "#/lib/local-chat/scope.ts";
import { useExitGuard } from "#/lib/motion/exit-guard.ts";
import { rowEnter, rowExit } from "#/lib/motion/list-motion.ts";
import {
	PersonaDeleteDialog,
	type PersonaDialogTarget,
	PersonaFormDialog,
} from "./persona-dialogs.tsx";
import { personaEmptyBody, personaEmptyTitle } from "./persona-form.ts";
import { PersonaLibrarySkeleton } from "./persona-library-skeleton.tsx";
import { usePersonaLibrary } from "./use-persona-library.ts";

/**
 * The private part of the library: list, empty state, create, edit, delete.
 * - Category title and description live in persona-settings-page.tsx. They are constants the same
 *   for every visitor; only role names, descriptions, the count and their operations are private.
 * - Only loaded in the browser. The parent imports it lazily inside ClientOnly, so neither this
 *   file nor Dexie enters the server bundle. Rendering it on the server would embed role names and
 *   descriptions in the server HTML.
 * - PageEnter is not here. The transition is one per category; if the list had its own enter, the
 *   screen would appear twice when the value arrives.
 * - No search, sorting or folders. The library is a short hand-made list; the order is the
 *   storage's most-recently-modified order (sortPersonas).
 */

export function PersonaLibraryContent() {
	const { t } = useTranslation("persona");
	const { status } = useChatScope();
	const { items, loading } = useLocalPersonas();
	const library = usePersonaLibrary();
	const [target, setTarget] = useState<PersonaDialogTarget | null>(null);

	const close = (): void => setTarget(null);

	/*
	 * Identity could not be verified, so no store can be opened. This is different from loading.
	 * Before this branch existed, 'unavailable' folded into 'loading' and a session-expired screen
	 * showed a placeholder forever (the conversation list has the same branch in
	 * chat-library-page.tsx). The message does not mention the network: this is an account fact, not a
	 * connection problem.
	 */
	if (status === "unavailable")
		return (
			<Empty className="border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<UserRound />
					</EmptyMedia>
					<EmptyTitle>{t("library.unavailableTitle")}</EmptyTitle>
					<EmptyDescription>{t("library.unavailableBody")}</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Link
						to="/login"
						search={{ redirect: "/settings/personas" }}
						className={buttonVariants({ variant: "default", size: "sm" })}
					>
						{t("library.signIn")}
					</Link>
				</EmptyContent>
			</Empty>
		);

	/*
	 * Local storage is still opening. This differs from the empty state: merging them would show a
	 * user with a full library 'no personas saved' on every open, which reads as lost data. The
	 * placeholder is the same component the server drew, so nothing changes when hydration hands over.
	 * A different skeleton here would split the screen into server skeleton, this skeleton, and list.
	 */
	if (loading) return <PersonaLibrarySkeleton />;

	return (
		<div className="flex flex-col gap-4">
			{/*
			 * The create action sits on its own row above the list.
			 * SettingsPageHeader does not take an action slot because it only handles layout and hierarchy.
			 * Widening it for one screen would let the next screen reuse that slot with a different meaning.
			 */}
			<div className="flex justify-end">
				<Button
					size="sm"
					onClick={() => setTarget({ kind: "create" })}
					disabled={!library.ready}
				>
					<Plus aria-hidden="true" />
					{t("library.create")}
				</Button>
			</div>

			{/*
			 * List and empty state swap using the same convention as the draft list (create/draft-list.tsx).
			 * Creating the first persona swaps the whole area; deleting the last one reverses it.
			 * Only the incoming opacity is animated. An exit on the empty state would make it wait for the
			 * list's
			 * exit motion, and state should not wait on motion.
			 * The loading branch returns early, outside this presence: the placeholder and the data share the
			 * same geometry, and animating that swap would hold back an already-arrived list
			 * (docs/motion/ARCHITECTURE.md, 'cross-fade from placeholder to data').
			 */}
			<AnimatePresence initial={false}>
				{items.length === 0 ? (
					<m.div
						key="empty"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={rowEnter.transition}
					>
						{/*
						 * The empty state says what the feature does first; a bare 'none' line leaves the user closing the
						 * screen without knowing what they can create.
						 * The container is the same Empty composition as the other list screens (draft, conversation and
						 * gallery lists). While this one was hand-styled, its icon size, spacing and title weight drifted,
						 * visible only side by side.
						 */}
						<Empty className="border">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<UserRound />
								</EmptyMedia>
								<EmptyTitle>{personaEmptyTitle()}</EmptyTitle>
								<EmptyDescription>{personaEmptyBody()}</EmptyDescription>
							</EmptyHeader>
							<EmptyContent>
								<Button
									variant="outline"
									onClick={() => setTarget({ kind: "create" })}
									disabled={!library.ready}
								>
									<Plus aria-hidden="true" />
									{t("library.createFirst")}
								</Button>
							</EmptyContent>
						</Empty>
					</m.div>
				) : (
					<m.div
						key="list"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={rowEnter.transition}
					>
						{/*
						 * This is one group. When a row exits, its siblings fill the gap, but the exit render happens
						 * inside that row, so the siblings do not know they moved. LayoutGroup re-renders the whole group
						 * once the exit finishes, which sets that measurement (the draft list uses the same shape for the
						 * same reason).
						 * Order really does change: the list is most-recently-modified, so editing a lower persona moves it
						 * to the top on return. Remote edits arriving through sync use the same subscription.
						 */}
						<LayoutGroup>
							<ul className="flex flex-col gap-2">
								<AnimatePresence initial={false}>
									{items.map((persona) => (
										<PersonaRow
											key={persona.id}
											persona={persona}
											onEdit={() => setTarget({ kind: "edit", persona })}
											onDelete={() => setTarget({ kind: "delete", persona })}
										/>
									))}
								</AnimatePresence>
							</ul>
						</LayoutGroup>
					</m.div>
				)}
			</AnimatePresence>

			{/*
			 * One dialog for the whole list. Mounting a dialog tree per row would keep that many dialogs alive
			 * as the library grows (useRoomManagement made the same call).
			 */}
			{target?.kind === "create" && (
				<PersonaFormDialog
					persona={null}
					onClose={close}
					onSave={async (value) => {
						await library.create(value);
					}}
				/>
			)}
			{target?.kind === "edit" && (
				<PersonaFormDialog
					persona={target.persona}
					onClose={close}
					onSave={(value) => library.update(target.persona.id, value)}
				/>
			)}
			{target?.kind === "delete" && (
				<PersonaDeleteDialog
					persona={target.persona}
					onClose={close}
					onDelete={() => library.remove(target.persona.id)}
				/>
			)}
		</div>
	);
}

/**
 * The row as a whole is neither a link nor a button, because pressing it has no defined outcome
 * (there is no detail screen). Going straight to edit would turn skimming into editing. All actions
 * live in the overflow menu.
 */
function PersonaRow({
	persona,
	onEdit,
	onDelete,
}: {
	persona: ChatPersona;
	onEdit: () => void;
	onDelete: () => void;
}) {
	const { t } = useTranslation(["persona", "common"]);
	/**
	 * This row has an overflow trigger, so pressing is blocked while the row exits. On a tab where
	 * frames do not arrive, the exit lasts indefinitely instead of 120ms, and the management menu of a
	 * persona that was already deleted would open (lib/motion/exit-guard.ts).
	 */
	const exiting = useExitGuard();

	return (
		<m.li
			/*
			 * layout='position': the row's size does not change, only its position. Projecting size too
			 * would make rows with two-line and one-line descriptions adjust to each other, so the text
			 * would grow and shrink.
			 */
			layout="position"
			initial={rowEnter.initial}
			animate={rowEnter.animate}
			exit={rowExit}
			transition={rowEnter.transition}
			style={exiting}
			className="flex items-start gap-3 rounded-lg border p-4"
		>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<p className="truncate font-medium">{persona.name}</p>
				{persona.description && (
					/*
					 * Descriptions may span several lines: clamp them with line-clamp but keep line breaks. The
					 * full text is stored; the clamp is display only.
					 */
					<p className="line-clamp-2 whitespace-pre-line text-muted-foreground text-sm">
						{persona.description}
					</p>
				)}
			</div>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="ghost"
							size="icon-sm"
							/* An icon-only trigger reads as a bare 'button' to assistive technology without a name. */
							aria-label={t("library.manage", { name: persona.name })}
						>
							<MoreHorizontal aria-hidden="true" />
						</Button>
					}
				/>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onClick={onEdit}>
						{t("library.edit")}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem variant="destructive" onClick={onDelete}>
						{t("common:actions.delete")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</m.li>
	);
}
