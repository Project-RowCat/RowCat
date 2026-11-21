import {
	type ActiveSceneView,
	CHAT_SCENE_MAX_MEMBERS,
	type ChatCharacter,
	type ChatMessage,
	type ChatRoom,
	type ChatScene,
	type ChatSceneAudience,
	ChatSceneAudienceError,
	type ChatSceneStart,
	type ChatStore,
	compareMessagePosition,
	effectiveChatUserName,
	HISTORY_ADOPTION_CHOICES,
	HISTORY_ADOPTION_DEFAULT,
	type HistoryAdoptionChoice,
	historyAdoptionNeeded,
	orderScenes,
	planCorrectScene,
	planEndScene,
	planHistoryAdoption,
	planStartScene,
	sceneCast,
	sceneMemberNames,
	unclassifiedHistory,
} from "@rowcat/chat";
import { space } from "@rowcat/design";
import {
	Button,
	ChoiceGroup,
	ChoiceOption,
	Dialog,
	Notice,
	Panel,
	Text,
} from "@rowcat/ui-native";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalLive } from "../../../lib/local-data/live.ts";
import { useChatScope } from "../../../lib/local-data/scope.tsx";
import { AudiencePicker } from "./audience-picker.tsx";
import { earliestMessage, messageExcerpt, SCENE_COPY } from "./copy.ts";
import { executeScenePlan } from "./run-plan.ts";

/**
 * The scene controls of one room: who is present now, start / change / end, how earlier history is
 * treated, and the room's past scenes with corrections (`docs/chat/SCENES.md`). Web's
 * `scene/dialog.tsx` is the pair: the same plans from `@rowcat/chat` (`scene-controls.ts`), executed
 * in order (`executeScenePlan`); only the drawing differs.
 *
 * A `Dialog size="full"`: a small management screen with a list, not a single choice, so not a
 * sheet (`docs/design/ARCHITECTURE.md`, presentation). The views swap inside one surface so
 * accessibility focus keeps a single owner.
 *
 * The three controls that move the current scene wait for a reply in flight: a change made then
 * would start after the person's last message and the reply being written would land in the new
 * scene. Corrections of past scenes do not wait.
 */

type Mode =
	| { kind: "home" }
	| { kind: "pick" }
	| { kind: "adopt"; audience: ChatSceneAudience }
	| { kind: "correct"; key: string }
	| { kind: "delete"; key: string };

const startKey = (start: ChatSceneStart) =>
	`${start.createdAt}\u0000${start.messageId}`;

const nowIso = () => new Date().toISOString();

export function SceneDialog({
	room,
	characters,
	scenes,
	active,
	lastMessage,
	generating,
	store,
	onClose,
}: {
	room: ChatRoom;
	characters: readonly ChatCharacter[];
	/** The room's scene records as subscribed by the bar (one subscription for both). */
	scenes: readonly ChatScene[];
	active: ActiveSceneView | null;
	lastMessage: Pick<ChatMessage, "id" | "createdAt"> | null;
	generating: boolean;
	/** The store as of opening; writes check it is still the open member's (`ownsStore`). */
	store: ChatStore;
	onClose: () => void;
}) {
	const { ownsStore } = useChatScope();
	/** The whole room, only while this window is open: adoption needs the first message, the list the heads. */
	const loadHistory = useMemo(
		() => () => store.listAllMessages(room.id),
		[store, room.id],
	);
	const history = useLocalLive<ChatMessage[]>(loadHistory, NO_MESSAGES);
	const historyReady = history.status === "ready";
	const [view, setView] = useState<Mode>({ kind: "home" });
	const [adoption, setAdoption] = useState<HistoryAdoptionChoice>(
		HISTORY_ADOPTION_DEFAULT,
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const cast = useMemo(() => sceneCast(room, characters), [room, characters]);
	const namesOf = (members: readonly string[]): string =>
		sceneMemberNames(members, {
			seed: room.seed,
			characters: characters.filter((c) => c.deletedAt === null),
			userName: effectiveChatUserName(room),
		}).join(", ") || SCENE_COPY.unknownNames;

	const unclassified = historyReady
		? unclassifiedHistory(history.value, scenes)
		: null;

	const entries = useMemo(() => {
		const ordered = orderScenes(scenes);
		const sorted = [...history.value].sort(compareMessagePosition);
		return ordered.map((entry, index) => {
			const start = {
				createdAt: entry.startAt.createdAt,
				id: entry.startAt.messageId,
			};
			const nextStart = ordered[index + 1]?.startAt;
			const next = nextStart
				? { createdAt: nextStart.createdAt, id: nextStart.messageId }
				: null;
			const first =
				sorted.find(
					(m) =>
						compareMessagePosition(m, start) >= 0 &&
						(!next || compareMessagePosition(m, next) < 0),
				) ?? null;
			const key = startKey(entry.startAt);
			const records = scenes.filter(
				(s) => s.deletedAt === null && startKey(s.startAt) === key,
			);
			return {
				key,
				audience: entry.audience,
				first,
				records,
				newest: [...records].sort((a, b) =>
					a.updatedAt < b.updatedAt ? 1 : -1,
				)[0],
			};
		});
	}, [scenes, history.value]);

	const run = async (
		perform: (owner: ChatStore) => Promise<void>,
	): Promise<boolean> => {
		if (!ownsStore(store)) {
			onClose();
			return false;
		}
		setBusy(true);
		setError(null);
		try {
			await perform(store);
			return true;
		} catch (failure) {
			setError(
				failure instanceof ChatSceneAudienceError
					? failure.reason === "too_many"
						? SCENE_COPY.pickTooMany(CHAT_SCENE_MAX_MEMBERS)
						: SCENE_COPY.pickEmpty
					: SCENE_COPY.failed,
			);
			return false;
		} finally {
			setBusy(false);
		}
	};

	const home = () => setView({ kind: "home" });

	const start = async (audience: ChatSceneAudience) => {
		if (historyAdoptionNeeded(history.value, scenes)) {
			setAdoption(HISTORY_ADOPTION_DEFAULT);
			setView({ kind: "adopt", audience });
			return;
		}
		if (
			await run((owner) =>
				executeScenePlan(
					owner,
					planStartScene({
						roomId: room.id,
						scenes,
						lastMessage,
						audience,
						nowIso: nowIso(),
					}),
				),
			)
		)
			home();
	};

	const adoptAndStart = async (audience: ChatSceneAudience) => {
		if (
			await run(async (owner) => {
				await executeScenePlan(
					owner,
					planHistoryAdoption({
						roomId: room.id,
						choice: adoption,
						firstMessage: earliestMessage(history.value),
					}),
				);
				// Re-read: the start plan must see the scene the adoption just wrote.
				const fresh = await owner.listScenes(room.id);
				await executeScenePlan(
					owner,
					planStartScene({
						roomId: room.id,
						scenes: fresh,
						lastMessage,
						audience,
						nowIso: nowIso(),
					}),
				);
			})
		)
			home();
	};

	const classify = (choice: HistoryAdoptionChoice) =>
		void run((owner) =>
			executeScenePlan(
				owner,
				planHistoryAdoption({
					roomId: room.id,
					choice,
					firstMessage: unclassified?.first ?? null,
				}),
			),
		);

	const end = () =>
		void run((owner) =>
			executeScenePlan(
				owner,
				planEndScene({
					roomId: room.id,
					scenes,
					lastMessage,
					nowIso: nowIso(),
				}),
			),
		);

	const nowLine = !active
		? SCENE_COPY.nowNone
		: active.audience.kind === "room"
			? SCENE_COPY.nowEveryone
			: active.audience.kind === "narrator"
				? SCENE_COPY.nowNarrator
				: SCENE_COPY.nowParticipants(
						active.names.join(", ") || SCENE_COPY.unknownNames,
					);
	const narrowed = active !== null && active.audience.kind !== "room";
	const pickInitial: ChatSceneAudience =
		active?.audience.kind === "participants"
			? active.audience
			: { kind: "participants", members: ["user"] };

	return (
		<Dialog
			title={SCENE_COPY.title}
			description={SCENE_COPY.description}
			open
			size="full"
			bodyKey={view.kind}
			onOpenChange={(next) => {
				if (!next && !busy) onClose();
			}}
		>
			<View style={scene.root}>
				{error ? <Notice tone="destructive" message={error} /> : null}

				{view.kind === "pick" ? (
					<AudiencePicker
						cast={cast}
						initial={pickInitial}
						label={SCENE_COPY.pickLabel}
						submitLabel={narrowed ? SCENE_COPY.apply : SCENE_COPY.start}
						busy={busy || generating || !historyReady}
						onCancel={home}
						onSubmit={(audience) => void start(audience)}
					/>
				) : view.kind === "adopt" ? (
					<View style={scene.section}>
						<Text variant="label">{SCENE_COPY.historyQuestion}</Text>
						<ChoiceGroup value={adoption} onValueChange={setAdoption}>
							{HISTORY_ADOPTION_CHOICES.map((choice) => (
								<ChoiceOption
									key={choice}
									value={choice}
									label={SCENE_COPY.history[choice].label}
									note={SCENE_COPY.history[choice].effect}
									selected={adoption === choice}
									disabled={busy}
								/>
							))}
						</ChoiceGroup>
						<View style={scene.actions}>
							<Button
								label={SCENE_COPY.cancel}
								variant="outline"
								size="sm"
								disabled={busy}
								onPress={home}
							/>
							<Button
								label={SCENE_COPY.start}
								size="sm"
								busy={busy}
								disabled={generating}
								onPress={() => void adoptAndStart(view.audience)}
							/>
						</View>
					</View>
				) : (
					<>
						<View style={scene.section}>
							<Text variant="body">{nowLine}</Text>
							<View style={scene.buttons}>
								<Button
									label={narrowed ? SCENE_COPY.change : SCENE_COPY.start}
									variant={narrowed ? "outline" : "primary"}
									size="sm"
									disabled={busy || generating}
									onPress={() => {
										setError(null);
										setView({ kind: "pick" });
									}}
								/>
								{narrowed ? (
									<Button
										label={SCENE_COPY.end}
										variant="outline"
										size="sm"
										disabled={busy || generating}
										onPress={end}
									/>
								) : null}
							</View>
							{generating || narrowed ? (
								<Text variant="caption" tone="muted-foreground">
									{generating ? SCENE_COPY.waitForReply : SCENE_COPY.endHint}
								</Text>
							) : null}
						</View>

						{unclassified && unclassified.count > 0 ? (
							<Panel style={scene.section}>
								<Text variant="label">
									{SCENE_COPY.unclassified(unclassified.count)}
								</Text>
								<Text variant="caption" tone="muted-foreground">
									{`${SCENE_COPY.history.shared.label} · ${SCENE_COPY.history.shared.effect}`}
								</Text>
								<Text variant="caption" tone="muted-foreground">
									{`${SCENE_COPY.history.private.label} · ${SCENE_COPY.history.private.effect}`}
								</Text>
								<View style={scene.buttons}>
									<Button
										label={SCENE_COPY.history.shared.label}
										variant="outline"
										size="sm"
										disabled={busy}
										onPress={() => classify("shared")}
									/>
									<Button
										label={SCENE_COPY.history.private.label}
										variant="outline"
										size="sm"
										disabled={busy}
										onPress={() => classify("private")}
									/>
								</View>
							</Panel>
						) : null}

						{entries.length > 0 ? (
							<View style={scene.section}>
								<Text variant="caption" tone="muted-foreground">
									{SCENE_COPY.listTitle}
								</Text>
								{entries.map((entry) => {
									const excerpt = entry.first
										? messageExcerpt(entry.first.content)
										: SCENE_COPY.listNoMessages;
									return (
										<Panel key={entry.key} style={scene.entry}>
											<Text
												variant="caption"
												tone="muted-foreground"
												numberOfLines={1}
											>
												{excerpt}
											</Text>
											<Text variant="label">
												{entry.audience.kind === "room"
													? SCENE_COPY.listEveryone
													: entry.audience.kind === "narrator"
														? SCENE_COPY.listNarrator
														: namesOf(entry.audience.members)}
											</Text>
											{view.kind === "correct" &&
											view.key === entry.key &&
											entry.newest ? (
												<AudiencePicker
													cast={cast}
													initial={entry.audience}
													kinds
													label={SCENE_COPY.pickLabel}
													note={SCENE_COPY.correctNote}
													submitLabel={SCENE_COPY.apply}
													busy={busy}
													onCancel={home}
													onSubmit={(audience) => {
														const record = entry.newest;
														if (!record) return;
														void run((owner) =>
															executeScenePlan(
																owner,
																planCorrectScene(record, audience),
															),
														).then((ok) => {
															if (ok) home();
														});
													}}
												/>
											) : view.kind === "delete" && view.key === entry.key ? (
												<View style={scene.section}>
													<Text
														accessibilityRole="alert"
														variant="caption"
														tone="muted-foreground"
													>
														{SCENE_COPY.deleteWarning}
													</Text>
													<View style={scene.actions}>
														<Button
															label={SCENE_COPY.cancel}
															variant="outline"
															size="sm"
															disabled={busy}
															onPress={home}
														/>
														<Button
															label={SCENE_COPY.delete}
															variant="destructive"
															size="sm"
															busy={busy}
															accessibilityLabel={SCENE_COPY.deleteFor(excerpt)}
															onPress={() =>
																void run((owner) =>
																	executeScenePlan(owner, {
																		set: [],
																		remove: entry.records.map((s) => s.id),
																	}),
																).then((ok) => {
																	if (ok) home();
																})
															}
														/>
													</View>
												</View>
											) : (
												<View style={scene.actions}>
													<Button
														label={SCENE_COPY.correct}
														variant="ghost"
														size="sm"
														accessibilityLabel={SCENE_COPY.correctFor(excerpt)}
														disabled={busy || !entry.newest}
														onPress={() => {
															setError(null);
															setView({ kind: "correct", key: entry.key });
														}}
													/>
													<Button
														label={SCENE_COPY.delete}
														variant="ghost"
														size="sm"
														accessibilityLabel={SCENE_COPY.deleteFor(excerpt)}
														disabled={busy}
														onPress={() => {
															setError(null);
															setView({ kind: "delete", key: entry.key });
														}}
													/>
												</View>
											)}
										</Panel>
									);
								})}
							</View>
						) : null}
					</>
				)}
			</View>
		</Dialog>
	);
}

/** Stable empty array; a fresh one per render would redraw every time. */
const NO_MESSAGES: ChatMessage[] = [];

const scene = StyleSheet.create({
	root: { gap: space.lg },
	section: { gap: space.sm },
	entry: { gap: space.xs },
	buttons: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
	actions: {
		flexDirection: "row",
		flexWrap: "wrap",
		gap: space.sm,
		justifyContent: "flex-end",
	},
});
