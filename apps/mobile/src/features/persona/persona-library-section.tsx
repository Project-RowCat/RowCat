import type { ChatPersona } from "@rowcat/chat";
import { radiusScale, space } from "@rowcat/design";
import {
	AlertDialog,
	Button,
	EmptyState,
	Icon,
	Notice,
	Spinner,
	Text,
	touchTarget,
	useTheme,
} from "@rowcat/ui-native";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useMobileIdentity } from "../../lib/identity.tsx";
import { useMobileLocalScope } from "../../lib/local-data/scope.tsx";
import { MotionRow } from "../../lib/motion/list-motion.tsx";
import { resolveAppPhase } from "../../lib/session-state.ts";
import {
	PERSONA_DELETE_FAILURE_MESSAGE,
	PERSONA_EMPTY_BODY,
	PERSONA_EMPTY_TITLE,
} from "./persona-form.ts";
import { PersonaFormDialog } from "./persona-form-dialog.tsx";
import {
	PERSONA_ADD_LABEL,
	PERSONA_DELETE_CONFIRM_LABEL,
	PERSONA_DELETE_TITLE,
	PERSONA_GUEST_NOTE,
	PERSONA_LIBRARY_READ_ERROR,
	PERSONA_LIBRARY_STORAGE_ERROR,
	PERSONA_UNAVAILABLE_NOTE,
	personaDeleteDescription,
	personaRowActionsLabel,
} from "./persona-library-copy.ts";
import { resolvePersonaLibraryState } from "./persona-library-state.ts";
import { usePersonaLibrary } from "./use-persona-library.ts";

/**
 * The persona library: **an account asset, not a child of any conversation.**
 *
 * For that reason this screen takes no room id (the same fact as `useLocalPersonas` having no such
 * argument). The picker on room settings stays as it is; what that picker decides is **which copy
 * to pin to this conversation**, not the list itself.
 *
 * ## Deleting does not touch conversations already started
 *
 * A room holds a **copy of the value**, not the library id (`personaSnapshotOf`). A conversation
 * that was running on a role deleted here continues with its own copy, and this file has no line
 * that scans rooms. The confirmation dialog says so **before** the user presses delete.
 *
 * ## No server calls
 *
 * Personas are local-first records, so the server has no list endpoint and none is built. Sync is
 * woken by the write signal on its own, so this screen has no `syncNow()`-style call.
 */
export function PersonaLibrarySection() {
	const router = useRouter();
	const identity = useMobileIdentity();
	const scope = useMobileLocalScope();
	const library = usePersonaLibrary();
	const [editing, setEditing] = useState<ChatPersona | "new" | null>(null);
	const [deleting, setDeleting] = useState<ChatPersona | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);

	const state = resolvePersonaLibraryState({
		phase: resolveAppPhase(identity.session, scope.status),
		personas: { status: library.status, total: library.personas.length },
	});

	const remove = (persona: ChatPersona): void => {
		setDeleteError(null);
		void library.remove(persona.id).then(
			(outcome) => {
				/**
				 * **`foreign` is not a failure**: the viewer changed and nothing happened. Drawing it as an
				 * error would show "try again", and pressing again would get the same answer (this tree is
				 * about to unmount).
				 */
				setDeleting(null);
				if (outcome === "done" || outcome === "foreign") return;
			},
			() => {
				setDeleteError(PERSONA_DELETE_FAILURE_MESSAGE);
			},
		);
	};

	if (state.kind === "booting")
		return (
			<View style={library_.center}>
				<Spinner />
			</View>
		);

	if (state.kind === "guest")
		return (
			<EmptyState
				icon="account"
				title={PERSONA_EMPTY_TITLE}
				description={PERSONA_GUEST_NOTE}
				actionLabel="Sign in"
				onAction={() => {
					identity.clearFailure();
					router.push({
						pathname: "/login",
						params: { redirect: "/settings/personas" },
					});
				}}
			/>
		);

	/** **Not signed out.** Asking again is all that can be done here. */
	if (state.kind === "unavailable")
		return (
			<Notice
				message={PERSONA_UNAVAILABLE_NOTE}
				actionLabel="Try again"
				onAction={identity.retry}
			/>
		);

	if (state.kind === "storage-error")
		return (
			<Notice
				tone="destructive"
				message={PERSONA_LIBRARY_STORAGE_ERROR}
				actionLabel="Try again"
				onAction={scope.retry}
			/>
		);

	if (state.kind === "read-error")
		return <Notice tone="destructive" message={PERSONA_LIBRARY_READ_ERROR} />;

	if (state.kind === "loading")
		return (
			<View style={library_.center}>
				<Spinner />
			</View>
		);

	return (
		<View style={library_.root}>
			{state.kind === "empty" ? (
				/**
				 * The empty state **says first what this feature is for.** With a single "none" line, the user
				 * would close the screen without knowing what they could create.
				 */
				<View style={library_.empty}>
					<Text variant="body" weight="medium">
						{PERSONA_EMPTY_TITLE}
					</Text>
					<Text variant="label" tone="muted-foreground">
						{PERSONA_EMPTY_BODY}
					</Text>
				</View>
			) : (
				/**
				 * Rows **appear, disappear and move**: creating a role adds a row, deleting one removes it, and
				 * when an edit from another device arrives through sync the list re-sorts (the web's
				 * `persona-library-content.tsx` uses the same rhythm).
				 *
				 * Entrance is not turned off. This list has no manual reordering, so moving a row and adding
				 * one never mix (this is where it differs from the child cards in the editor).
				 */
				library.personas.map((persona) => (
					<MotionRow
						key={persona.id}
						/**
						 * The last row disappears **without an exit**: the empty state takes over its place.
						 *
						 * Keeping the exit would overlap the leaving row with the incoming copy in the same spot
						 * (verified frame by frame on device). On web the list and the empty state are two branches
						 * of one presence, so the overlap cannot happen there (`lib/motion/list-motion.tsx`).
						 */
						exit={library.personas.length > 1}
					>
						<PersonaRow
							persona={persona}
							onEdit={() => setEditing(persona)}
							onDelete={() => {
								setDeleteError(null);
								setDeleting(persona);
							}}
						/>
					</MotionRow>
				))
			)}

			<Button
				label={PERSONA_ADD_LABEL}
				variant="outline"
				icon="add"
				fullWidth
				onPress={() => setEditing("new")}
			/>

			{editing ? (
				<PersonaFormDialog
					persona={editing === "new" ? null : editing}
					pending={library.pending}
					onCancel={() => setEditing(null)}
					onSave={async (input) => {
						const outcome =
							editing === "new"
								? await library.create(input)
								: await library.update(editing.id, input);
						/**
						 * **Closes on `foreign` too.** Nothing happened, and drawing that fact as a save failure
						 * would make the user resend the same value — and the viewer has already changed, so this
						 * tree is about to unmount.
						 *
						 * **Failures do not arrive here.** If the store throws, this line is never reached and the
						 * rejection goes straight up to the dialog, which draws the message itself.
						 */
						setEditing(null);
						return outcome;
					}}
				/>
			) : null}

			{/**
			 * This is an irreversible confirmation, so it is an `AlertDialog`. The copy says **what
			 * disappears and what remains**: without this line, the user would not delete for fear that
			 * their conversation's speaker disappears, and a user who deletes and sees the conversation
			 * intact would read the deletion as having failed.
			 */}
			<AlertDialog
				open={deleting !== null}
				title={PERSONA_DELETE_TITLE}
				description={personaDeleteDescription(deleting?.name ?? "")}
				confirmLabel={PERSONA_DELETE_CONFIRM_LABEL}
				destructive
				busy={library.pending}
				error={deleteError}
				onConfirm={() => {
					if (deleting) remove(deleting);
				}}
				onCancel={() => {
					setDeleting(null);
					setDeleteError(null);
				}}
			/>
		</View>
	);
}

/**
 * One row of the library: name, description and two actions.
 *
 * The actions are **siblings of the row**. A button inside the row would make two targets that a
 * screen reader cannot tell apart (the picker row on room settings reached the same decision).
 *
 * Neither swipe-to-delete nor long-press-only actions are built. Fingers have no hover, so the
 * triggers are always visible; an action only reachable by a gesture is an action that does not
 * exist for people who do not know the gesture.
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
	const { colors } = useTheme();
	return (
		<View style={library_.row}>
			<View style={library_.rowText}>
				<Text variant="body" weight="medium" numberOfLines={1}>
					{persona.name}
				</Text>
				{persona.description ? (
					<Text variant="label" tone="muted-foreground" numberOfLines={2}>
						{persona.description}
					</Text>
				) : null}
			</View>
			<Pressable
				accessibilityRole="button"
				/** Says which **persona** the name is for: the same icon appears several times in the list. */
				accessibilityLabel={personaRowActionsLabel(persona.name, "edit")}
				onPress={onEdit}
				style={({ pressed }) => [
					library_.action,
					pressed && { backgroundColor: colors.muted },
				]}
			>
				<Icon name="edit" size="sm" tone="muted-foreground" />
			</Pressable>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={personaRowActionsLabel(persona.name, "delete")}
				onPress={onDelete}
				style={({ pressed }) => [
					library_.action,
					pressed && { backgroundColor: colors.muted },
				]}
			>
				<Icon name="delete" size="sm" tone="destructive" />
			</Pressable>
		</View>
	);
}

const library_ = StyleSheet.create({
	root: { gap: space.md },
	center: { alignItems: "center", paddingVertical: space.xl },
	empty: { gap: space.xs, paddingVertical: space.sm },
	row: { alignItems: "center", flexDirection: "row", gap: space.xs },
	rowText: { flex: 1, gap: space.px, minWidth: 0 },
	action: {
		alignItems: "center",
		borderRadius: radiusScale.md,
		height: touchTarget,
		justifyContent: "center",
		width: touchTarget,
	},
});
