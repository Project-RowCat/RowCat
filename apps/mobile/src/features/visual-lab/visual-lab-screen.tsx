import { space } from "@rowcat/design";
import {
	VISUAL_LAB_BADGES,
	VISUAL_LAB_TEXT,
	VISUAL_LAB_TYPE_ROWS,
} from "@rowcat/design/visual-lab";
import {
	AppBar,
	Badge,
	Button,
	Card,
	DropdownMenu,
	IconButton,
	Input,
	LinkButton,
	MenuItem,
	Panel,
	Screen,
	Select,
	SelectOption,
	Separator,
	Switch,
	Text,
	Textarea,
} from "@rowcat/ui-native";
import { useRouter } from "expo-router";
import { type ReactNode, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Measured, MeasurementReadout, MeasureProvider } from "./measure.tsx";
import { MotionLab } from "./motion-lab.tsx";
import { OverlayLab } from "./overlay-lab.tsx";

/**
 * Visual QA lab: a surface to place side by side with the same lab on the web.
 *
 * ## What the screen does
 *
 * It mounts the canonical state of the reusable primitives on one screen, so the screenshots of the
 * two apps can be overlaid and one can say "this control is 8pt taller than that one". Until now
 * this repo's parity claims rested mostly on "same tokens + read the source", and those are two
 * different facts:
 *
 * ```text
 * static parity    same tokens · same variant vocabulary · same ownership rules   the source answers
 * runtime parity   the two surfaces as actually drawn look the same                only a device answers
 * ```
 *
 * A real past divergence shows the difference: `Input` had `minHeight: 36` written in its source,
 * matching the web's `h-9`, but measured on a device it was 44 (line height 22 + padding 20 +
 * border 2). No check that reads only the source can catch that.
 *
 * ## Separate from the diagnostics screen (`/dev-tools`)
 *
 * That screen asks whether sessions and storage actually run; this one asks what is drawn and how.
 * Folding them together would attach unrelated diagnostic tables to every screenshot and make
 * overlaying harder.
 *
 * ## No fake components
 *
 * Everything mounted here is a public primitive of `@rowcat/ui-native`. A lab-only copy would make
 * this screen prove the copy rather than the product, and the copy would quietly go stale.
 *
 * ## Not in release UI
 *
 * The route file stays in the bundle (expo-router reads all of `src/app/`), but one line in that
 * file returns this address to the first screen in release builds. It is the same mechanism as
 * `/dev-tools`, and for the same reason product UI has no way in.
 */
export function VisualLabScreen() {
	const router = useRouter();
	return (
		<MeasureProvider>
			{/**
			 * **The header is a sibling of the scrolling content, as in the product (`settings-shell.tsx`).**
			 *
			 * ⚠️ For a while this lab mounted `AppBar` inside the horizontally padded scroll, so only this lab
			 * measured 358 while the web lab measured 390. Those two numbers did not measure the same thing, so
			 * comparing that row proved nothing: the product header fills the screen width on both platforms.
			 * A lab that places a primitive where the product does not keeps a ledger that is quietly wrong.
			 */}
			<Screen>
				<Measured id="app-bar" stretch>
					<AppBar
						onBack={() => router.back()}
						backLabel="Back"
						title={<Text variant="title">Visual Lab</Text>}
						actions={
							<IconButton
								icon="settings"
								label="A sample button that does nothing"
								onPress={() => undefined}
							/>
						}
					/>
				</Measured>

				<ScrollView
					contentContainerStyle={lab.content}
					keyboardShouldPersistTaps="handled"
				>
					<Section title="Measured">
						<MeasurementReadout />
					</Section>

					<Section title="Typography">
						{VISUAL_LAB_TYPE_ROWS.map((row) => (
							<Text key={row} variant={row}>
								{row} · {VISUAL_LAB_TEXT.mixed}
							</Text>
						))}
						<Text variant="body">{VISUAL_LAB_TEXT.latin}</Text>
						<Text variant="body">{VISUAL_LAB_TEXT.hangul}</Text>
						<Text variant="body">{VISUAL_LAB_TEXT.paragraph}</Text>
						<Text variant="body" leading="reading">
							{VISUAL_LAB_TEXT.paragraph}
						</Text>
						<View style={lab.row}>
							<Text variant="body" weight="regular">
								Regular 400
							</Text>
							<Text variant="body" weight="medium">
								Medium 500
							</Text>
						</View>
						<View style={lab.row}>
							<Text variant="body" weight="semibold">
								Semibold 600
							</Text>
							<Text variant="body" weight="bold">
								Bold 700
							</Text>
						</View>
					</Section>

					{/**
					 * **This row is the most important one in this lab.**
					 *
					 * Placing three controls side by side makes height differences show as misalignment within the row,
					 * not as absolute values. Alone, 44 and 36 both look plausible; side by side, the eye answers which
					 * one sticks out first. This row is what exposed the input's 8pt.
					 */}
					<Section title="Adjacency (input · select · button)">
						<View style={lab.adjacent}>
							<View style={lab.grow}>
								<Measured id="input" stretch>
									<Input
										label={VISUAL_LAB_TEXT.fieldLabel}
										labelHidden
										value={VISUAL_LAB_TEXT.fieldValue}
										onChangeText={() => undefined}
									/>
								</Measured>
							</View>
							<Measured id="select-trigger">
								<Select
									label={VISUAL_LAB_TEXT.selectLabel}
									value={VISUAL_LAB_TEXT.actionLatin}
								>
									<SelectOption
										label={VISUAL_LAB_TEXT.actionLatin}
										selected
										onSelect={() => undefined}
									/>
								</Select>
							</Measured>
							<Measured id="button-md">
								<Button
									label={VISUAL_LAB_TEXT.action}
									onPress={() => undefined}
								/>
							</Measured>
						</View>
					</Section>

					<Section title="Buttons">
						<View style={lab.row}>
							<Button
								label={VISUAL_LAB_TEXT.action}
								onPress={() => undefined}
								variant="primary"
							/>
							<Button
								label={VISUAL_LAB_TEXT.secondaryAction}
								onPress={() => undefined}
								variant="secondary"
							/>
							<Button
								label={VISUAL_LAB_TEXT.actionLatin}
								onPress={() => undefined}
								variant="outline"
							/>
						</View>
						<View style={lab.row}>
							<Button
								label={VISUAL_LAB_TEXT.actionLatin}
								onPress={() => undefined}
								variant="ghost"
							/>
							<Button
								label={VISUAL_LAB_TEXT.destructiveAction}
								onPress={() => undefined}
								variant="destructive"
							/>
						</View>
						<View style={lab.row}>
							<Measured id="button-sm">
								<Button
									label={VISUAL_LAB_TEXT.action}
									onPress={() => undefined}
									size="sm"
								/>
							</Measured>
							<Measured id="button-lg">
								<Button
									label={VISUAL_LAB_TEXT.action}
									onPress={() => undefined}
									size="lg"
								/>
							</Measured>
						</View>
						<View style={lab.row}>
							<Button
								label={VISUAL_LAB_TEXT.action}
								onPress={() => undefined}
								icon="check"
							/>
							<Button
								label={VISUAL_LAB_TEXT.action}
								onPress={() => undefined}
								busy
							/>
							<Button
								label={VISUAL_LAB_TEXT.action}
								onPress={() => undefined}
								disabled
							/>
						</View>
						<View style={lab.row}>
							<Measured id="icon-button">
								<IconButton
									icon="more"
									label="A sample button that does nothing"
									onPress={() => undefined}
								/>
							</Measured>
							<LinkButton
								label={VISUAL_LAB_TEXT.actionLatin}
								onPress={() => undefined}
							/>
						</View>
					</Section>

					<Section title="Inputs">
						<Input
							label={VISUAL_LAB_TEXT.fieldLabel}
							placeholder={VISUAL_LAB_TEXT.fieldPlaceholder}
							onChangeText={() => undefined}
						/>
						<Input
							label={VISUAL_LAB_TEXT.fieldLabel}
							value={VISUAL_LAB_TEXT.fieldValue}
							onChangeText={() => undefined}
						/>
						<Input
							label={VISUAL_LAB_TEXT.fieldLabel}
							value={VISUAL_LAB_TEXT.fieldValue}
							invalid
							onChangeText={() => undefined}
						/>
						<Input
							label={VISUAL_LAB_TEXT.fieldLabel}
							value={VISUAL_LAB_TEXT.fieldValue}
							editable={false}
							onChangeText={() => undefined}
						/>
						{/**
						 * **Measured with the label hidden.** `Textarea` draws its label and field together, so measuring it
						 * as-is would compare something other than the web's plain `textarea`. The label (16) plus a gap (4)
						 * were included; it measured 108 on device while the web measured 90.
						 */}
						<Measured id="textarea" stretch>
							<Textarea
								label={VISUAL_LAB_TEXT.fieldLabel}
								labelHidden
								value={VISUAL_LAB_TEXT.multilineValue}
								onChangeText={() => undefined}
							/>
						</Measured>
						<Textarea
							label={VISUAL_LAB_TEXT.fieldLabel}
							value={VISUAL_LAB_TEXT.multilineValue}
							onChangeText={() => undefined}
						/>
					</Section>

					<Section title="Badges">
						<View style={lab.row}>
							{/**
							 * **The variant is stated explicitly.** The two apps' `Badge` defaults differ: native `secondary`,
							 * web `default`. That difference is recorded in the ledger, but if the lab omitted the prop, a grey
							 * pill and a purple pill would sit in the same slot and the geometry comparison would break.
							 */}
							<Measured id="badge">
								<Badge label={VISUAL_LAB_BADGES[0]} variant="default" />
							</Measured>
							<Badge label={VISUAL_LAB_BADGES[1]} variant="secondary" />
							<Badge label={VISUAL_LAB_BADGES[2]} variant="muted" />
							<Badge label={VISUAL_LAB_BADGES[3]} variant="outline" />
							<Badge label={VISUAL_LAB_BADGES[4]} variant="destructive" />
						</View>
					</Section>

					<Section title="Surfaces">
						{/**
						 * **The measured box has no text.** Each platform's text height differs on purpose (body 15/22 vs
						 * 14/20), so the total height of a box holding text would compare the font rather than the container.
						 * With one fixed-height cell inside, the remaining difference is padding, border and radius, which
						 * belong to the container.
						 */}
						<Measured id="card" stretch>
							<Card>
								<View style={lab.gauge} />
							</Card>
						</Measured>
						<Measured id="panel" stretch>
							<Panel>
								<View style={lab.gauge} />
							</Panel>
						</Measured>
						<Card>
							<Text variant="title">{VISUAL_LAB_TEXT.cardTitle}</Text>
							<Text variant="body" tone="muted-foreground">
								{VISUAL_LAB_TEXT.cardBody}
							</Text>
						</Card>
						<Panel>
							<Text variant="title">{VISUAL_LAB_TEXT.cardTitle}</Text>
							<Text variant="body" tone="muted-foreground">
								{VISUAL_LAB_TEXT.cardBody}
							</Text>
						</Panel>
						<Measured id="separator" stretch>
							<Separator />
						</Measured>
					</Section>

					<Section title="Controls">
						<ControlsLab />
					</Section>

					<Section title="Motion">
						<MotionLab />
					</Section>

					<Section title="Overlays">
						<OverlayLab />
					</Section>
				</ScrollView>
			</Screen>
		</MeasureProvider>
	);
}

/**
 * Stateful controls. The point is drawing a switch **both on and off**: native iOS switches have
 * the same width in both states but different weight, and that weight is what shows when comparing
 * with the web's control.
 */
function ControlsLab() {
	const [on, setOn] = useState(true);
	return (
		<>
			<View style={lab.switchRow}>
				<Text variant="body">{VISUAL_LAB_TEXT.switchLabel}</Text>
				<Measured id="switch">
					<Switch
						label={VISUAL_LAB_TEXT.switchLabel}
						value={on}
						onValueChange={setOn}
					/>
				</Measured>
			</View>
			<View style={lab.switchRow}>
				<Text variant="body">{VISUAL_LAB_TEXT.switchLabel}</Text>
				<Switch
					label={VISUAL_LAB_TEXT.switchLabel}
					value={!on}
					onValueChange={() => setOn((value) => !value)}
				/>
			</View>
			<View style={lab.switchRow}>
				<Text variant="body" tone="muted-foreground">
					{VISUAL_LAB_TEXT.switchLabel} (disabled)
				</Text>
				<Switch
					label={VISUAL_LAB_TEXT.switchLabel}
					value={false}
					onValueChange={() => undefined}
					disabled
				/>
			</View>
			<Select
				label={VISUAL_LAB_TEXT.selectLabel}
				value={VISUAL_LAB_TEXT.selectValue}
			>
				<SelectOption
					label={VISUAL_LAB_TEXT.selectValue}
					selected
					onSelect={() => undefined}
				/>
				<SelectOption
					label={VISUAL_LAB_TEXT.actionLatin}
					selected={false}
					onSelect={() => undefined}
				/>
			</Select>
			<Select
				label={VISUAL_LAB_TEXT.selectLabel}
				value={VISUAL_LAB_TEXT.selectValue}
				disabled
			>
				<SelectOption
					label={VISUAL_LAB_TEXT.selectValue}
					selected
					onSelect={() => undefined}
				/>
			</Select>
			<View style={lab.row}>
				{/**
				 * `icon="chevron-down"` means a **trigger without a picture** (`menu.tsx`). Leaving the default
				 * (`more`) would put a `⋯` before the label, comparing a different trigger from the web's. The
				 * product's `Filter` and `Sort` state their own pictures explicitly.
				 */}
				<DropdownMenu
					label="Sample menu"
					icon="chevron-down"
					triggerLabel={VISUAL_LAB_TEXT.action}
				>
					<MenuItem
						icon="check"
						label={VISUAL_LAB_TEXT.action}
						onSelect={() => undefined}
					/>
					<MenuItem
						icon="close"
						label={VISUAL_LAB_TEXT.destructiveAction}
						destructive
						onSelect={() => undefined}
					/>
				</DropdownMenu>
				<DropdownMenu label="Sample overflow menu">
					<MenuItem
						icon="check"
						label={VISUAL_LAB_TEXT.action}
						onSelect={() => undefined}
					/>
				</DropdownMenu>
			</View>
		</>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<View style={lab.section}>
			<Text variant="caption" tone="muted-foreground">
				{title}
			</Text>
			{children}
		</View>
	);
}

const lab = StyleSheet.create({
	content: { gap: space.xl, paddingHorizontal: space.lg },
	section: { gap: space.sm },
	row: {
		alignItems: "center",
		flexDirection: "row",
		flexWrap: "wrap",
		gap: space.sm,
	},
	/** Three controls stand on the same baseline of one row; misalignment shows on that row. */
	adjacent: { alignItems: "center", flexDirection: "row", gap: space.sm },
	grow: { flex: 1 },
	/** Fixed cell used only to measure the surface; both labs use the same 40. */
	gauge: { height: 40 },
	switchRow: {
		alignItems: "center",
		flexDirection: "row",
		justifyContent: "space-between",
	},
});
