import type { ChatRoom } from "@rowcat/chat";
import {
	creatorConsentTools,
	roomToolOverrides,
	userToolActiveIn,
} from "@rowcat/chat";
import { space } from "@rowcat/design";
import { Button, Notice, Spinner, Switch, Text } from "@rowcat/ui-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { useLocalUserTools } from "../../../lib/local-data/use-user-tools.ts";

/**
 * Tools pane of room settings: which of the user's own tools are on in **this** conversation.
 *
 * The library is not edited here. It is an account asset with its own screen (`/settings/tools`);
 * this pane writes only the room's override map (`ChatRoom.toolOverrides`), through
 * `useRoomManagement`'s ownership gate like every other room write.
 *
 * Each switch shows the **effective** state (`userToolActiveIn`: the room's choice, else the tool's
 * default), because that is what the next turn declares. A tool the room has set explicitly says so
 * and offers "use default", which clears the key (`null`) instead of writing the default's value:
 * writing it would freeze today's default into this room and silently ignore a later change in
 * settings.
 *
 * Above them, the work's own local web requests (`creatorConsentTools`): they call a program on
 * this device with what the model wrote from this conversation, so they stay off until the reader
 * switches them on here. Off is the absence of the key — `creatorToolActiveIn` has no default-on.
 */
export function RoomSettingsTools({
	room,
	onApply,
	onOpenSettings,
}: {
	room: ChatRoom;
	/** `null` clears the room's choice (follow the tool's default). */
	onApply: (toolId: string, enabled: boolean | null) => Promise<unknown>;
	/** Leaves the window for the library screen. */
	onOpenSettings: () => void;
}) {
	const { t } = useTranslation("tools");
	const { value: tools, status } = useLocalUserTools();
	const [error, setError] = useState<string | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);
	const overrides = roomToolOverrides(room);
	const creatorTools = creatorConsentTools(room.seed);

	const apply = (toolId: string, enabled: boolean | null): void => {
		if (busyId) return;
		setBusyId(toolId);
		setError(null);
		void onApply(toolId, enabled)
			.catch(() => setError(t("room.saveFailed")))
			.finally(() => setBusyId(null));
	};

	if (status === "loading")
		return (
			<View style={styles.center}>
				<Spinner />
			</View>
		);

	return (
		<View style={styles.root}>
			{creatorTools.length > 0 ? (
				<View style={styles.section}>
					<Text variant="label" weight="semibold">
						{t("room.creatorTitle")}
					</Text>
					<Text variant="caption" tone="muted-foreground">
						{t("room.creatorDescription")}
					</Text>
					{creatorTools.map((tool) => (
						<View key={tool.key} style={styles.rowTop}>
							<View style={styles.rowText}>
								<Text variant="body" weight="medium" numberOfLines={1}>
									{tool.name}
								</Text>
								<Text variant="label" tone="muted-foreground" numberOfLines={2}>
									{tool.description}
								</Text>
								<Text variant="caption" tone="muted-foreground">
									{t("room.creatorAddress", { address: tool.address })}
								</Text>
							</View>
							<Switch
								label={t("room.creatorSwitchLabel", {
									name: tool.name,
									address: tool.address,
								})}
								value={overrides[tool.key] === true}
								disabled={busyId !== null}
								onValueChange={(enabled) =>
									apply(tool.key, enabled ? true : null)
								}
							/>
						</View>
					))}
				</View>
			) : null}

			<Text variant="caption" tone="muted-foreground">
				{t("room.description")}
			</Text>

			{status === "error" && tools.length === 0 ? (
				<Notice tone="destructive" message={t("copy.readError")} />
			) : tools.length === 0 ? (
				<Text variant="label" tone="muted-foreground">
					{t("room.empty")}
				</Text>
			) : (
				tools.map((tool) => {
					const name = tool.tool.declaration.name;
					const overridden = tool.id in overrides;
					return (
						<View key={tool.id} style={styles.row}>
							<View style={styles.rowTop}>
								<View style={styles.rowText}>
									<Text variant="body" weight="medium" numberOfLines={1}>
										{name}
									</Text>
									<Text
										variant="label"
										tone="muted-foreground"
										numberOfLines={2}
									>
										{tool.tool.declaration.description}
									</Text>
									<Text variant="caption" tone="muted-foreground">
										{overridden
											? t("room.overridden")
											: t("room.followsDefault")}
									</Text>
								</View>
								<Switch
									label={t("room.switchLabel", { name })}
									value={userToolActiveIn(room, tool)}
									disabled={busyId !== null}
									onValueChange={(enabled) => apply(tool.id, enabled)}
								/>
							</View>
							{overridden ? (
								<View style={styles.reset}>
									<Button
										label={t("room.reset")}
										accessibilityLabel={t("room.resetLabel", { name })}
										variant="ghost"
										size="sm"
										disabled={busyId !== null}
										onPress={() => apply(tool.id, null)}
									/>
								</View>
							) : null}
						</View>
					);
				})
			)}

			{error ? <Notice tone="destructive" message={error} /> : null}

			<Button
				label={t("room.openSettings")}
				variant="outline"
				icon="settings"
				fullWidth
				onPress={onOpenSettings}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	root: { gap: space.md },
	section: { gap: space.sm },
	center: { alignItems: "center", paddingVertical: space.xl },
	row: { gap: space.xs },
	rowTop: { alignItems: "center", flexDirection: "row", gap: space.md },
	rowText: { flex: 1, gap: space.px, minWidth: 0 },
	reset: { alignItems: "flex-start" },
});
