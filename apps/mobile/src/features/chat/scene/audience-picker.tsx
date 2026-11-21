import {
	CHAT_SCENE_MAX_MEMBERS,
	type ChatSceneAudience,
	type SceneCastMember,
} from "@rowcat/chat";
import { space } from "@rowcat/design";
import {
	Button,
	ChoiceGroup,
	ChoiceOption,
	Switch,
	Text,
} from "@rowcat/ui-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { SCENE_COPY } from "./copy.ts";

type Kind = ChatSceneAudience["kind"];

/**
 * Picks who is present (a scene) or who knows (a memory): one switch per member of `sceneCast`,
 * and, when `kinds` is on, the two audiences that are not a list (everyone, no character) — a
 * correction of a past scene may need either. Web's `scene/audience-picker.tsx` is the pair.
 *
 * It writes nothing. It hands the audience it built to the caller, which validates it through the
 * shared rules (`planStartScene` / `planCorrectScene` / `requireSceneAudience`) and writes. The
 * limits drawn here (at least one, at most `CHAT_SCENE_MAX_MEMBERS`) only disable the button early.
 *
 * Refs in `initial` that are no longer in the cast (a deleted character) are dropped from the
 * selection: they cannot be shown, so keeping them would write a member nobody can see or remove.
 */
export function AudiencePicker({
	cast,
	initial,
	kinds = false,
	label,
	note,
	submitLabel,
	busy,
	onCancel,
	onSubmit,
}: {
	cast: readonly SceneCastMember[];
	initial: ChatSceneAudience;
	kinds?: boolean;
	label: string;
	note?: string;
	submitLabel: string;
	busy: boolean;
	onCancel: () => void;
	onSubmit: (audience: ChatSceneAudience) => void;
}) {
	const [kind, setKind] = useState<Kind>(kinds ? initial.kind : "participants");
	const [selected, setSelected] = useState<ReadonlySet<string>>(() => {
		const refs = new Set(cast.map((member) => member.ref));
		return new Set(
			initial.kind === "participants"
				? initial.members.filter((ref) => refs.has(ref))
				: [],
		);
	});
	const count = selected.size;
	const invalid =
		kind === "participants" && (count === 0 || count > CHAT_SCENE_MAX_MEMBERS);

	const submit = () => {
		if (invalid || busy) return;
		onSubmit(
			kind === "participants"
				? {
						kind: "participants",
						members: cast
							.map((member) => member.ref)
							.filter((ref) => selected.has(ref)),
					}
				: { kind },
		);
	};

	return (
		<View style={picker.root}>
			<Text variant="label">{label}</Text>
			{note ? (
				<Text variant="caption" tone="muted-foreground">
					{note}
				</Text>
			) : null}
			{kinds ? (
				<ChoiceGroup value={kind} onValueChange={setKind}>
					<ChoiceOption
						value="room"
						label={SCENE_COPY.kindEveryone}
						selected={kind === "room"}
						disabled={busy}
					/>
					<ChoiceOption
						value="participants"
						label={SCENE_COPY.kindParticipants}
						selected={kind === "participants"}
						disabled={busy}
					/>
					<ChoiceOption
						value="narrator"
						label={SCENE_COPY.kindNarrator}
						selected={kind === "narrator"}
						disabled={busy}
					/>
				</ChoiceGroup>
			) : null}
			{kind === "participants" ? (
				<View style={picker.list}>
					{cast.map((member) => {
						const name =
							member.kind === "user"
								? SCENE_COPY.you(member.name)
								: member.name;
						return (
							<View key={member.ref} style={picker.row}>
								<Text variant="body" style={picker.name} numberOfLines={1}>
									{name}
								</Text>
								<Switch
									label={name}
									value={selected.has(member.ref)}
									disabled={busy}
									onValueChange={(on) =>
										setSelected((current) => {
											const next = new Set(current);
											if (on) next.add(member.ref);
											else next.delete(member.ref);
											return next;
										})
									}
								/>
							</View>
						);
					})}
				</View>
			) : null}
			{kind === "participants" && count > CHAT_SCENE_MAX_MEMBERS ? (
				<Text variant="caption" tone="destructive">
					{SCENE_COPY.pickTooMany(CHAT_SCENE_MAX_MEMBERS)}
				</Text>
			) : kind === "participants" && count === 0 ? (
				<Text variant="caption" tone="muted-foreground">
					{SCENE_COPY.pickEmpty}
				</Text>
			) : null}
			<View style={picker.actions}>
				<Button
					label={SCENE_COPY.cancel}
					variant="outline"
					size="sm"
					disabled={busy}
					onPress={onCancel}
				/>
				<Button
					label={submitLabel}
					size="sm"
					busy={busy}
					disabled={invalid}
					onPress={submit}
				/>
			</View>
		</View>
	);
}

const picker = StyleSheet.create({
	root: { gap: space.sm },
	list: { gap: space.xs },
	row: {
		alignItems: "center",
		flexDirection: "row",
		gap: space.md,
		justifyContent: "space-between",
	},
	name: { flexShrink: 1 },
	actions: {
		flexDirection: "row",
		flexWrap: "wrap",
		gap: space.sm,
		justifyContent: "flex-end",
	},
});
