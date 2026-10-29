import type { RuntimeTemplateFile } from "../types.ts";

/**
 * Components. This template has no borders or shadows, so all depth is created here. The files here
 * mirror the generated project's layout, so review lands where the project's structure does.
 * Backticks and `${` inside the file bodies are pre-escaped, because the registry is a pure package
 * that does not read files.
 */
export const COMPONENT_FILES: readonly RuntimeTemplateFile[] = [
	{
		path: "src/components/action-button.tsx",
		content: `import { Pressable, Stack, Text } from "@rowcat/runtime";
import { SPACE, THEME, TYPE } from "../theme";

export type ActionTone = "primary" | "secondary" | "quiet";

export interface ActionButtonProps {
	label: string;
	/** One line under the button. Used only to add briefly what will happen. */
	note?: string;
	tone?: ActionTone;
	disabled?: boolean;
	onPress: () => void;
}

/**
 * This story's primary action: **does not use \`Button\`.**
 *
 * \`Button\` takes no \`style\`, and its color is decided by **the host's theme**. That is the right default
 * because most stories have no colors of their own, but this one does: if the widest surface on screen
 * stood in RowCat purple instead of stage-light gold, every other carefully chosen color would be pushed
 * aside by that one.
 *
 * So it is built from \`Pressable\`. **No accessibility is lost**: both renderers draw \`Pressable\` as
 * **the same element** as \`Button\` (\`<button type="button">\` on the web), so keyboard activation and
 * the focus ring stay. The only thing lost is the color the host gave.
 *
 * ## Disabled is **a different surface**, not a dimmer one
 *
 * Keeping the saturation and only lowering opacity looks pressable (the screen really did: the planner
 * before filling three slots was one purple bar). A button that cannot be pressed **drops** the accent and
 * stands as dim text on the floor surface.
 */
export function ActionButton({
	label,
	note,
	tone = "primary",
	disabled = false,
	onPress,
}: ActionButtonProps) {
	const fill = disabled
		? THEME.surface
		: tone === "primary"
			? THEME.gold
			: tone === "secondary"
				? THEME.high
				: THEME.surface;
	const ink = disabled
		? THEME.faint
		: tone === "primary"
			? THEME.goldInk
			: THEME.text;
	const sub = disabled
		? THEME.faint
		: tone === "primary"
			? THEME.goldInk
			: THEME.muted;

	return (
		<Pressable
			onPress={onPress}
			disabled={disabled}
			style={{
				backgroundColor: fill,
				borderRadius: 14,
				padding: 15,
				align: "center",
				justify: "center",
			}}
		>
			<Stack gap={3} style={{ align: "center" }}>
				<Text
					style={{ color: ink, fontSize: TYPE.body, fontWeight: "bold" }}
				>
					{label}
				</Text>
				{note !== undefined && (
					<Text
						style={{ color: sub, fontSize: TYPE.label, opacity: 0.8 }}
					>
						{note}
					</Text>
				)}
			</Stack>
		</Pressable>
	);
}

/**
 * The breath above a button at the bottom of the screen. Writing a different value per screen makes the
 * button's height feel different on every screen.
 */
export const ACTION_GAP = SPACE.section;
`,
	},
	{
		path: "src/components/app-shell.tsx",
		content: `import {
	Pressable,
	Row,
	type RuntimeChildren,
	type RuntimeColor,
	Stack,
	Text,
	View,
} from "@rowcat/runtime";
import { AGENCY, OPENING } from "../story/agency";
import { averageCondition, groupSkill, stageScore } from "../systems/stats";
import { CONTENT_WIDTH, SPACE, THEME, TYPE } from "../theme";
import type { Run } from "../types";
import { Divider } from "./divider";
import { WeekRail } from "./week-rail";

export type ShellTab = "flow" | "roster";

export interface AppShellProps extends RuntimeChildren {
	run: Run;
	/** Which debut group this is. Comes from persistent state. */
	runs: number;
	tab: ShellTab;
	onTab: (tab: ShellTab) => void;
	/** The opening and ending screens use no header: the whole screen is the content there. */
	bare?: boolean;
}

/**
 * Header and tabs: **the same things always stand in the same place.**
 *
 * The three here (where in the eight weeks · overall score · four axes) are questions with the same answer
 * on every screen. If each screen drew its own header, the sync visible on the planner would disappear
 * on the results screen, and the player would move between screens to check what just rose.
 *
 * ## The body does not widen
 *
 * This runtime's surface takes the playback screen's width as is: 360 on narrow devices and over 900 on
 * wide screens. Without a cap a line becomes 850px, and a sentence that long reads not as text but as a
 * stretched form. One \`CONTENT_WIDTH\` centers **both** header and body; centering only one would
 * misalign the left edges of the title and the content.
 *
 * Having only two tabs is a rule too. Progress flows in one line (briefing → planning → results → evening),
 * and the one thing that must be viewable outside that flow at any time is **the five's state**.
 */
export function AppShell({
	run,
	runs,
	tab,
	onTab,
	bare = false,
	children,
}: AppShellProps) {
	if (bare)
		return (
			<Column padding={SPACE.section}>
				<Stack gap={SPACE.block}>{children}</Stack>
			</Column>
		);

	const left = Math.max(AGENCY.weeks - run.week, 0);
	return (
		<Stack gap={0}>
			<View style={{ backgroundColor: THEME.surface }}>
				<Column padding={SPACE.block}>
					<Stack gap={SPACE.row}>
						<Row style={{ justify: "between", align: "start" }} gap={SPACE.row}>
							<Stack gap={3} style={{ grow: 1 }}>
								<Text style={{ color: THEME.faint, fontSize: TYPE.label }}>
									{\`\${AGENCY.company} · \${AGENCY.team}\`}
								</Text>
								<Text
									style={{
										color: THEME.text,
										fontSize: TYPE.head,
										fontWeight: "bold",
									}}
								>
									{OPENING.title}
								</Text>
							</Stack>
							{/*
							  * The number stands first and the word below: it is the largest text on this screen,
							  * and with a label in front the eye reads the label first.
							  */}
							<Stack gap={0} style={{ align: "end" }}>
								<Text
									style={{
										color: THEME.gold,
										fontSize: TYPE.figure,
										fontWeight: "bold",
									}}
								>
									{\`\${stageScore(run)}\`}
								</Text>
								<Text style={{ color: THEME.faint, fontSize: TYPE.label }}>
									Overall
								</Text>
							</Stack>
						</Row>

						<Row gap={SPACE.row} style={{ align: "center" }}>
							<View style={{ grow: 1 }}>
								<WeekRail week={run.week} total={AGENCY.weeks} />
							</View>
							<Text style={{ color: THEME.muted, fontSize: TYPE.label }}>
								{left === 0 ? "Evaluation week" : \`\${left} weeks to evaluation\`}
							</Text>
						</Row>

						<Divider color={THEME.lineSoft} />

						{/*
						  * The four are not boxed: four boxes in a narrow space read as a form, not values,
						  * and the labels shrink to 10px. In one line the four become **a sentence**.
						  */}
						<Row gap={SPACE.tight} style={{ align: "center" }}>
							<Figure label="Skill" value={groupSkill(run)} color={THEME.gold} />
							<Dot />
							<Figure label="Sync" value={run.sync} color={THEME.stage} />
							<Dot />
							<Figure label="Buzz" value={run.buzz} color={THEME.rise} />
							<Dot />
							<Figure
								label="Condition"
								value={Math.round(averageCondition(run))}
								color={THEME.warn}
							/>
						</Row>

						<Row style={{ justify: "between", align: "center" }}>
							<Tabs tab={tab} onTab={onTab} />
							<Text style={{ color: THEME.faint, fontSize: TYPE.label }}>
								{runs === 0 ? "First debut group" : \`Debut group #\${runs + 1}\`}
							</Text>
						</Row>
					</Stack>
				</Column>
			</View>
			<Divider color={THEME.line} />
			<Column padding={SPACE.block}>{children}</Column>
		</Stack>
	);
}

/**
 * One centering layer: the header and the body go through **the same function**.
 *
 * Written per screen, only one side's cap changes, and the title's and content's left edges drift a few pixels.
 */
function Column({
	padding,
	children,
}: RuntimeChildren & { padding: number }) {
	return (
		<View style={{ padding, align: "center" }}>
			<View style={{ width: "100%", maxWidth: CONTENT_WIDTH }}>{children}</View>
		</View>
	);
}

function Figure({
	label,
	value,
	color,
}: {
	label: string;
	value: number;
	color: RuntimeColor;
}) {
	return (
		<Row gap={5} style={{ align: "center" }}>
			<Text style={{ color: THEME.muted, fontSize: TYPE.label }}>{label}</Text>
			<Text style={{ color, fontSize: TYPE.small, fontWeight: "bold" }}>
				{\`\${value}\`}
			</Text>
		</Row>
	);
}

/** The dot separating the four. With a line this row would become a table. */
function Dot() {
	return (
		<View
			style={{
				width: 3,
				height: 3,
				borderRadius: 3,
				backgroundColor: THEME.faint,
			}}
		/>
	);
}

/**
 * A two-segment tab: the grooved kind.
 *
 * As two separate pills, the unselected one sinks into the background and looks like *a single button*. With
 * a groove drawn, the unselected side reads as a slot too.
 */
function Tabs({
	tab,
	onTab,
}: {
	tab: ShellTab;
	onTab: (tab: ShellTab) => void;
}) {
	return (
		<View
			style={{ backgroundColor: THEME.sunken, borderRadius: 999, padding: 3 }}
		>
			<Row gap={3}>
				<Tab label="Progress" active={tab === "flow"} onPress={() => onTab("flow")} />
				<Tab
					label="Roster"
					active={tab === "roster"}
					onPress={() => onTab("roster")}
				/>
			</Row>
		</View>
	);
}

function Tab({
	label,
	active,
	onPress,
}: {
	label: string;
	active: boolean;
	onPress: () => void;
}) {
	return (
		<Pressable
			onPress={onPress}
			style={{
				backgroundColor: active ? THEME.high : THEME.sunken,
				borderRadius: 999,
				padding: 8,
			}}
		>
			<Row gap={0} style={{ align: "center" }}>
				<View style={{ width: 6 }} />
				<Text
					style={{
						color: active ? THEME.text : THEME.muted,
						fontSize: TYPE.small,
						fontWeight: active ? "bold" : "regular",
					}}
				>
					{label}
				</Text>
				<View style={{ width: 6 }} />
			</Row>
		</Pressable>
	);
}
`,
	},
	{
		path: "src/components/week-rail.tsx",
		content: `import { Row, Stack, View } from "@rowcat/runtime";
import { evaluationFor } from "../story/evaluations";
import { THEME } from "../theme";

export interface WeekRailProps {
	week: number;
	total: number;
}

/**
 * Eight weeks: **this story's whole tension is this one line.**
 *
 * For a while this fact was one 11px string, \`Week 1 · 7 weeks to evaluation\`. That sentence is accurate
 * but doesn't answer *where are we now* by eye: with three weeks left and six weeks left standing in the
 * same size of type, the urgency isn't on screen.
 *
 * A dot stands on weeks with a review (2 · 5 · 8). The positions are asked of \`story/evaluations.ts\`
 * because the table must be one: writing \`[2, 5, 8]\` here would make moving the deadline an edit to two
 * files, and a screen that missed one would quietly put a dot in the wrong place.
 */
export function WeekRail({ week, total }: WeekRailProps) {
	const weeks: number[] = [];
	for (let index = 1; index <= total; index += 1) weeks.push(index);

	return (
		<Row gap={5} style={{ align: "end" }}>
			{weeks.map((value) => {
				const done = value < week;
				const now = value === week;
				const check = evaluationFor(value) !== null;
				return (
					<Stack key={\`week-\${value}\`} gap={5} style={{ grow: 1, align: "center" }}>
						<View
							style={{
								width: "100%",
								height: now ? 8 : 6,
								borderRadius: 4,
								backgroundColor: now
									? THEME.gold
									: done
										? THEME.goldSoft
										: THEME.track,
							}}
						/>
						{check ? (
							<View
								style={{
									width: 4,
									height: 4,
									borderRadius: 4,
									backgroundColor: value <= week ? THEME.gold : THEME.stage,
								}}
							/>
						) : (
							<View style={{ height: 4 }} />
						)}
					</Stack>
				);
			})}
		</Row>
	);
}
`,
	},
	{
		path: "src/components/screen-title.tsx",
		content: `import { type RuntimeColor, Stack, Text } from "@rowcat/runtime";
import { SPACE, THEME, TYPE } from "../theme";

export interface ScreenTitleProps {
	/** One word above the title: which scene this is. */
	eyebrow?: string;
	eyebrowColor?: RuntimeColor;
	title: string;
	/** One or two lines under the title: what this screen asks. */
	lead?: string;
}

/**
 * A screen's first line: **every screen starts with the same hierarchy.**
 *
 * If each screen set its own title size, the briefing's title would be 12px and the evaluation's 20px,
 * though both are the same rank. Neither looks wrong alone, so the mismatch is invisible until the screens
 * are side by side.
 */
export function ScreenTitle({
	eyebrow,
	eyebrowColor = THEME.stage,
	title,
	lead,
}: ScreenTitleProps) {
	return (
		<Stack gap={SPACE.tight}>
			{eyebrow !== undefined && (
				<Text
					style={{
						color: eyebrowColor,
						fontSize: TYPE.label,
						fontWeight: "bold",
					}}
				>
					{eyebrow}
				</Text>
			)}
			<Text
				style={{ color: THEME.text, fontSize: TYPE.title, fontWeight: "bold" }}
			>
				{title}
			</Text>
			{lead !== undefined && (
				<Text style={{ color: THEME.textSoft, fontSize: TYPE.body }}>
					{lead}
				</Text>
			)}
		</Stack>
	);
}
`,
	},
	{
		path: "src/components/section.tsx",
		content: `import {
	type RuntimeChildren,
	type RuntimeNode,
	Row,
	Stack,
	Text,
	View,
} from "@rowcat/runtime";
import { SPACE, THEME, TYPE } from "../theme";

export interface SectionProps extends RuntimeChildren {
	label: string;
	/** What stands to the right of the label. Usually a number or one tag. */
	trailing?: RuntimeNode;
	gap?: number;
}

/**
 * One label line and what follows: the screen's skeleton.
 *
 * After the label, **a hairline fills the remaining width.** With the label alone that row was just small
 * text, and its relationship to the card below was expressed only by spacing: with the line, it is visible
 * that what follows belongs to this label. This runtime has no borders, so the line is a surface of height 1 too.
 *
 * The label's size, weight and color are decided only here. Written per screen, headings of the same rank
 * would stand at different sizes, and that mismatch is invisible when looking at one screen.
 */
export function Section({
	label,
	trailing,
	gap = SPACE.row,
	children,
}: SectionProps) {
	return (
		<Stack gap={gap}>
			<Row gap={SPACE.row} style={{ align: "center" }}>
				<Text
					style={{
						color: THEME.muted,
						fontSize: TYPE.label,
						fontWeight: "bold",
					}}
				>
					{label}
				</Text>
				<View
					style={{ grow: 1, height: 1, backgroundColor: THEME.lineSoft }}
				/>
				{trailing}
			</Row>
			{children}
		</Stack>
	);
}
`,
	},
	{
		path: "src/components/panel.tsx",
		content: `import { type RuntimeChildren, type RuntimeColor, View } from "@rowcat/runtime";
import { THEME } from "../theme";

export interface PanelProps extends RuntimeChildren {
	/** The border color. A highlighted panel has its own color. */
	line?: RuntimeColor;
	/** The inner surface color. The caller decides how deep it stacks. */
	fill?: RuntimeColor;
	padding?: number;
	radius?: number;
	/** Whether to take the space left over horizontally. Used when placed side by side. */
	grow?: number;
}

/**
 * This runtime **has no borders.** So the border is made from two surfaces.
 *
 * \`\`\`text
 * outer View   border color + padding 1       ← this 1 is the line's width
 * inner View   surface color + real padding
 * \`\`\`
 *
 * There are no shadows either, so depth comes only from **stacking surfaces**. Having this one component
 * keeps the stacking rule (line width · inner radius = outer radius - 1) in one place: written per screen,
 * some cards would get thick lines or misaligned corners.
 *
 * To **remove the line, pass the same color as the surface.** There really are places that need a card
 * without a line (six cards on one screen make six lines read as a grid), and the reason to pass the same
 * color instead of making \`line\` optional is that the outer layer's \`padding: 1\` must **always** be there
 * so the inner radius calculation stays one.
 */
export function Panel({
	line = THEME.line,
	fill = THEME.surface,
	padding = 16,
	radius = 16,
	grow,
	children,
}: PanelProps) {
	return (
		<View
			style={{
				backgroundColor: line,
				borderRadius: radius,
				padding: 1,
				...(grow === undefined ? {} : { grow }),
			}}
		>
			<View
				style={{
					backgroundColor: fill,
					borderRadius: radius - 1,
					padding,
				}}
			>
				{children}
			</View>
		</View>
	);
}
`,
	},
	{
		path: "src/components/pill.tsx",
		content: `import { type RuntimeColor, Row, Text, View } from "@rowcat/runtime";
import { THEME, TYPE } from "../theme";

export interface PillProps {
	label: string;
	color?: RuntimeColor;
	fill?: RuntimeColor;
	/** Border-only form. Used where the surface is already highlighted. */
	outline?: boolean;
}

/**
 * One small tag: says a state in one word.
 *
 * The rule is not to speak by color alone, so **there is always text in it.** On low-contrast screens
 * color fades and text remains.
 *
 * ## Horizontal padding made from two surfaces
 *
 * This runtime's \`padding\` is **one number**, with no per-axis value (\`style.ts\` in \`@rowcat/runtime\`
 * records that decision). With the same value on all four sides the pill becomes nearly square and looks
 * like *a block*, not *a tag*. Standing a width-only surface on each side of the text makes a wide pill.
 */
export function Pill({
	label,
	color = THEME.muted,
	fill = THEME.raised,
	outline = false,
}: PillProps) {
	const body = (
		<Row gap={0} style={{ align: "center" }}>
			<View style={{ width: 5 }} />
			<Text style={{ color, fontSize: TYPE.label, fontWeight: "medium" }}>
				{label}
			</Text>
			<View style={{ width: 5 }} />
		</Row>
	);

	if (outline)
		return (
			<View style={{ backgroundColor: color, borderRadius: 999, padding: 1 }}>
				<View style={{ backgroundColor: fill, borderRadius: 998, padding: 4 }}>
					{body}
				</View>
			</View>
		);
	return (
		<View style={{ backgroundColor: fill, borderRadius: 999, padding: 5 }}>
			{body}
		</View>
	);
}
`,
	},
	{
		path: "src/components/divider.tsx",
		content: `import { type RuntimeColor, View } from "@rowcat/runtime";
import { THEME } from "../theme";

/**
 * One line: a surface of height 1. This runtime has no borders, so separators are surfaces too.
 *
 * It has its own file because the width and color must be in one place. Written per screen, some lines
 * would be 1 and some 2, and that difference doesn't show in review.
 */
export function Divider({ color = THEME.lineSoft }: { color?: RuntimeColor }) {
	return <View style={{ height: 1, width: "100%", backgroundColor: color }} />;
}
`,
	},
	{
		path: "src/components/member-avatar.tsx",
		content: `import { Text, View } from "@rowcat/runtime";
import type { Member } from "../members";
import { THEME } from "../theme";

export interface MemberAvatarProps {
	member: Member;
	size?: number;
	/** Whether this is the person chosen now. The surface takes their color instead of a thicker border. */
	active?: boolean;
	/** Dimmed: someone you're not meeting today. */
	dimmed?: boolean;
}

/**
 * The face slot: one initial for now.
 *
 * When an asset host arrives, this one circle becomes a picture and not one line of the other screens changes.
 * That is why the seam is bundled into one component.
 *
 * ## The chosen person gets a ring
 *
 * Changing only the surface color shows the choice **only to someone who knows that person's color**. One
 * more outer layer makes the difference between chosen and not chosen **a shape** rather than a color, and
 * that difference survives on screens that can't tell colors apart. This runtime has no borders, so the ring is two surfaces too.
 */
export function MemberAvatar({
	member,
	size = 40,
	active = false,
	dimmed = false,
}: MemberAvatarProps) {
	const ring = active ? 2 : 0;
	return (
		<View
			style={{
				width: size + ring * 2,
				height: size + ring * 2,
				borderRadius: size,
				padding: ring,
				backgroundColor: active ? member.accentSoft : THEME.background,
				opacity: dimmed ? 0.4 : 1,
			}}
		>
			<View
				style={{
					width: size,
					height: size,
					borderRadius: size,
					backgroundColor: active ? member.accent : member.accentSoft,
					justify: "center",
					align: "center",
				}}
			>
				<Text
					style={{
						color: active ? THEME.sunken : member.accent,
						fontSize: Math.round(size * 0.42),
						fontWeight: "bold",
					}}
				>
					{member.initial}
				</Text>
			</View>
		</View>
	);
}
`,
	},
	{
		path: "src/components/member-card.tsx",
		content: `import {
	Pressable,
	Row,
	type RuntimeColor,
	Stack,
	Text,
	View,
} from "@rowcat/runtime";
import { MEMBERS } from "../members";
import { notesOf } from "../systems/notes";
import { TRUST_BAND_LABEL, TRUST_MAX, trustBand } from "../systems/relationships";
import { CONDITION_LABEL, grade, memberSkill } from "../systems/stats";
import { SPACE, THEME, TYPE } from "../theme";
import type { MemberId, Run } from "../types";
import { MemberAvatar } from "./member-avatar";
import { Pill } from "./pill";
import { StatBar } from "./stat-bar";

export interface MemberCardProps {
	memberId: MemberId;
	run: Run;
	/** How many fragments are known about that person. Drawn as dots. */
	known: number;
	active?: boolean;
	/** Without it the card cannot be pressed: no disabled button is drawn. */
	onPress?: () => void;
	/** The collapsed form. Collapsed in the list, expanded in the detail. */
	compact?: boolean;
}

/**
 * One person: the list and the detail use **the same card**.
 *
 * Built separately, the list's condition and the detail's condition would be drawn by different rules, and
 * that mismatch is invisible until the two screens are side by side. The only difference is \`compact\`.
 *
 * ## The stripe on the left is this card's identity
 *
 * With five standing vertically, the avatar's color is one 40px circle and doesn't read across the whole list.
 * Standing the card's left edge in that person's color lets the scanning eye know who it is **before reading
 * the name**. This runtime has no borders, so that stripe is one surface and doubles as the card's line;
 * that is why the layers are built here directly instead of with \`Panel\` (a border with only the left side
 * in a different color can't be expressed with one \`padding: 1\` layer).
 */
export function MemberCard({
	memberId,
	run,
	known,
	active = false,
	onPress,
	compact = false,
}: MemberCardProps) {
	const member = MEMBERS[memberId];
	const skill = memberSkill(run.skills[memberId]);
	const condition = run.condition[memberId];
	const trust = run.trust[memberId];
	const total = notesOf(memberId).length;

	const body = (
		<View
			style={{
				backgroundColor: active ? member.accent : THEME.line,
				borderRadius: 16,
				padding: 1,
			}}
		>
			<Row style={{ align: "stretch" }} gap={0}>
				<View
					style={{
						width: 3,
						backgroundColor: member.accent,
						opacity: active ? 1 : 0.7,
					}}
				/>
				<View
					style={{
						grow: 1,
						backgroundColor: active ? THEME.raised : THEME.surface,
						borderRadius: 15,
						padding: 14,
					}}
				>
					<Stack gap={compact ? SPACE.row : SPACE.block}>
						<Row gap={SPACE.row} style={{ align: "center" }}>
							<MemberAvatar member={member} active={active} />
							<Stack gap={3} style={{ grow: 1 }}>
								<Row gap={SPACE.tight} style={{ align: "center" }}>
									<Text
										style={{
											color: THEME.text,
											fontSize: TYPE.head,
											fontWeight: "bold",
										}}
									>
										{member.shortName}
									</Text>
									<Text style={{ color: THEME.faint, fontSize: TYPE.label }}>
										{\`Year \${member.years}\`}
									</Text>
								</Row>
								<Text style={{ color: THEME.muted, fontSize: TYPE.small }}>
									{member.position}
								</Text>
							</Stack>
							<Stack gap={0} style={{ align: "end" }}>
								<Text
									style={{
										color: member.accent,
										fontSize: TYPE.title,
										fontWeight: "bold",
									}}
								>
									{grade(skill)}
								</Text>
								<Text style={{ color: THEME.faint, fontSize: TYPE.label }}>
									{\`\${skill}\`}
								</Text>
							</Stack>
						</Row>

						<Row gap={SPACE.tight} style={{ align: "center" }}>
							<Pill
								label={\`Condition \${CONDITION_LABEL(condition)}\`}
								color={
									condition >= 60
										? THEME.rise
										: condition >= 40
											? THEME.warn
											: THEME.fall
								}
								fill={THEME.sunken}
							/>
							<Pill
								label={TRUST_BAND_LABEL[trustBand(trust)]}
								color={member.accent}
								fill={THEME.sunken}
							/>
							<View style={{ grow: 1 }} />
							<NoteDots known={known} total={total} accent={member.accent} />
						</Row>

						{!compact && (
							<Stack gap={SPACE.row}>
								<StatBar
									label="Vocal"
									value={run.skills[memberId].vocal}
									color={THEME.gold}
								/>
								<StatBar
									label="Dance"
									value={run.skills[memberId].dance}
									color={THEME.stage}
								/>
								<StatBar
									label="Expression"
									value={run.skills[memberId].expression}
									color={THEME.rise}
								/>
								<StatBar
									label="Trust"
									value={trust}
									max={TRUST_MAX}
									color={member.accent}
								/>
							</Stack>
						)}
					</Stack>
				</View>
			</Row>
		</View>
	);

	if (onPress === undefined) return body;
	return <Pressable onPress={onPress}>{body}</Pressable>;
}

/**
 * The number of stories known: **three dots.** A value that lasts across runs, so it is the longest-lived mark on the card.
 */
function NoteDots({
	known,
	total,
	accent,
}: {
	known: number;
	total: number;
	accent: RuntimeColor;
}) {
	const dots: number[] = [];
	for (let index = 0; index < total; index += 1) dots.push(index);
	return (
		<Row gap={4} style={{ align: "center" }}>
			{dots.map((index) => (
				<View
					key={\`dot-\${index}\`}
					style={{
						width: 6,
						height: 6,
						borderRadius: 6,
						backgroundColor: index < known ? accent : THEME.track,
					}}
				/>
			))}
		</Row>
	);
}
`,
	},
	{
		path: "src/components/stat-bar.tsx",
		content: `import { type RuntimeColor, Row, Stack, Text, View } from "@rowcat/runtime";
import { STAT_MAX } from "../systems/stats";
import { THEME, TYPE } from "../theme";

export interface StatBarProps {
	label: string;
	value: number;
	color?: RuntimeColor;
	/** The value written on the right. Without it, \`value\` is used. */
	readout?: string;
	/** Change since last week. \`0\` is not drawn. */
	delta?: number;
	height?: number;
	max?: number;
}

/**
 * One bar: **built with \`grow\`, not \`width: "%"\`.**
 *
 * Two reasons. A percentage needs a new string every time the value changes, and above all this runtime's
 * transitions do not cover the axes that change layout (\`width\`). Drawn as the ratio of two \`grow\` values it
 * splits exactly at any value and doesn't collapse at 0 or 100.
 *
 * It does not speak by color alone: a number always stands beside the bar.
 */
export function StatBar({
	label,
	value,
	color = THEME.stage,
	readout,
	delta = 0,
	height = 5,
	max = STAT_MAX,
}: StatBarProps) {
	const filled = value < 0 ? 0 : value > max ? max : value;
	const rest = max - filled;
	return (
		<Stack gap={6}>
			<Row style={{ justify: "between", align: "center" }}>
				<Row gap={6} style={{ align: "center" }}>
					<Text style={{ color: THEME.textSoft, fontSize: TYPE.small }}>
						{label}
					</Text>
					{delta !== 0 && (
						<Text
							style={{
								color: delta > 0 ? THEME.rise : THEME.fall,
								fontSize: TYPE.label,
								fontWeight: "bold",
							}}
						>
							{delta > 0 ? \`+\${delta}\` : \`\${delta}\`}
						</Text>
					)}
				</Row>
				<Text style={{ color, fontSize: TYPE.small, fontWeight: "medium" }}>
					{readout ?? \`\${filled}\`}
				</Text>
			</Row>
			<Row
				style={{
					height,
					borderRadius: height,
					backgroundColor: THEME.track,
				}}
			>
				<View
					style={{
						grow: filled,
						height,
						borderRadius: height,
						backgroundColor: color,
					}}
				/>
				<View style={{ grow: rest, height }} />
			</Row>
		</Stack>
	);
}
`,
	},
	{
		path: "src/components/choice-list.tsx",
		content: `import { Pressable, Row, Stack, Text, View } from "@rowcat/runtime";
import { type Choice, choiceAvailable, lockReason } from "../systems/progression";
import { SPACE, THEME, TYPE } from "../theme";
import type { Career, Run } from "../types";

export interface ChoiceListProps {
	choices: readonly Choice[];
	run: Run;
	career: Career;
	/** Already chosen ones. They cannot be chosen again. */
	used?: readonly string[];
	/** Nothing is chosen while waiting for an answer. */
	frozen?: boolean;
	onChoose: (choice: Choice) => void;
}

/**
 * The choosable ones: **locked ones are drawn too.**
 *
 * If they disappeared, the player would not even know such a path existed, and the reason to replay would
 * vanish. A locked row says in text what is needed and cannot be pressed.
 *
 * No decision is made here: it only calls \`choiceAvailable\`, and the real enforcement is \`applyChoice\`, which
 * passes through it once more. The screen's disabled state is a kindness, not a rule.
 *
 * ## Open rows get a gold stripe on the left
 *
 * With locked and open rows in the same shape, you know *what can be pressed* only after reading all the text.
 * One stripe lets the scanning eye answer first, and since the signal is **presence**, not color, it survives
 * on screens that can't tell colors apart.
 */
export function ChoiceList({
	choices,
	run,
	career,
	used = [],
	frozen = false,
	onChoose,
}: ChoiceListProps) {
	return (
		<Stack gap={SPACE.tight}>
			{choices.map((choice) => {
				const spent = used.includes(choice.id);
				const open = choiceAvailable(choice, run, career);
				const reason = lockReason(choice, run, career);
				const disabled = spent || !open || frozen;
				const live = open && !spent;

				const inner = (
					<View
						style={{
							backgroundColor: live ? THEME.line : THEME.lineSoft,
							borderRadius: 14,
							padding: 1,
						}}
					>
						<Row style={{ align: "stretch" }} gap={0}>
							<View
								style={{
									width: 3,
									backgroundColor: live ? THEME.gold : THEME.lineSoft,
								}}
							/>
							<View
								style={{
									grow: 1,
									backgroundColor: live ? THEME.surface : THEME.background,
									borderRadius: 13,
									padding: 13,
								}}
							>
								<Stack gap={5}>
									<Row gap={SPACE.tight} style={{ align: "center" }}>
										{!open && (
											<Text style={{ color: THEME.faint, fontSize: TYPE.small }}>
												Locked
											</Text>
										)}
										<View style={{ grow: 1 }}>
											<Text
												style={{
													color: spent
														? THEME.faint
														: open
															? THEME.text
															: THEME.muted,
													fontSize: TYPE.body,
													fontWeight: "medium",
												}}
											>
												{choice.label}
											</Text>
										</View>
									</Row>
									<Text
										style={{
											color: live ? THEME.muted : THEME.faint,
											fontSize: TYPE.small,
										}}
									>
										{spent ? "Already talked about" : (reason ?? choice.detail)}
									</Text>
								</Stack>
							</View>
						</Row>
					</View>
				);

				if (disabled) return <View key={choice.id}>{inner}</View>;
				return (
					<Pressable key={choice.id} onPress={() => onChoose(choice)}>
						{inner}
					</Pressable>
				);
			})}
		</Stack>
	);
}
`,
	},
	{
		path: "src/components/dialogue-card.tsx",
		content: `import { type RuntimeColor, Row, Stack, Text, View } from "@rowcat/runtime";
import { THEME, TYPE } from "../theme";
import { Reveal } from "./reveal";

export interface DialogueCardProps {
	/** The speaker. \`null\` means my line. */
	speaker: string | null;
	accent: RuntimeColor;
	text: string;
	/** Only a line that just arrived comes in. Existing lines don't move again. */
	enter?: boolean;
}

/**
 * One dialogue card. A member's line stands on the left with their name, and mine sticks to the right:
 * one rule, so one component.
 *
 * Only lines with \`enter\` get the entering motion. On every line, conversation already on screen would come
 * alive again on every scroll, and that erases the signal that a new line arrived.
 */
export function DialogueCard({
	speaker,
	accent,
	text,
	enter = false,
}: DialogueCardProps) {
	const mine = speaker === null;
	const bubble = (
		<Row style={{ justify: mine ? "end" : "start" }}>
			{/*
			  * A **cap**, not a width: a short line takes only that much, and a long one stops at
			  * 86%. With a fixed width even "Yes." would take most of the screen.
			  */}
			<View
				style={{
					maxWidth: "86%",
					padding: 12,
					borderRadius: 14,
					backgroundColor: mine ? THEME.mine : THEME.raised,
				}}
			>
				<Stack gap={5}>
					{!mine && (
						<Text
							style={{ color: accent, fontSize: TYPE.label, fontWeight: "bold" }}
						>
							{speaker}
						</Text>
					)}
					<Text style={{ color: THEME.text, fontSize: TYPE.body }}>{text}</Text>
				</Stack>
			</View>
		</Row>
	);
	if (!enter) return bubble;
	return <Reveal rise={6}>{bubble}</Reveal>;
}
`,
	},
	{
		path: "src/components/composer.tsx",
		content: `import {
	Pressable,
	Row,
	Text,
	TextInput,
	useTextEntryController,
	View,
} from "@rowcat/runtime";
import { THEME, TYPE } from "../theme";

export interface ComposerProps {
	value: string;
	placeholder: string;
	pending: boolean;
	onChange: (value: string) => void;
	onSend: () => void;
}

/**
 * One-line input: **a controlled input.** The current value is always in \`value\`.
 *
 * Without \`onChangeText\` the renderer reverts what was typed. So this component takes the value and the
 * update together, so it cannot be passed half from outside.
 *
 * The controller exists for focus alone: after sending, the cursor has to stay so the next line can be
 * typed. **It does not promise the keyboard will come up** (that is the OS's policy).
 *
 * The send button holds its place even when it can't be pressed. If it disappeared, the input row's width
 * would change while typing, and the cursor would jump once.
 */
export function Composer({
	value,
	placeholder,
	pending,
	onChange,
	onSend,
}: ComposerProps) {
	const entry = useTextEntryController();
	const ready = value.trim().length > 0 && !pending;

	const send = (): void => {
		if (!ready) return;
		onSend();
		entry.focus();
	};

	return (
		<Row gap={8} style={{ align: "center" }}>
			<View
				style={{
					grow: 1,
					backgroundColor: ready ? THEME.high : THEME.line,
					borderRadius: 14,
					padding: 1,
				}}
			>
				<TextInput
					controller={entry}
					value={value}
					placeholder={placeholder}
					disabled={pending}
					onChangeText={onChange}
					onSubmit={send}
					style={{
						backgroundColor: THEME.sunken,
						borderRadius: 13,
						padding: 13,
					}}
					textStyle={{ color: THEME.text, fontSize: TYPE.body }}
				/>
			</View>
			<Pressable
				onPress={send}
				disabled={!ready}
				style={{
					backgroundColor: ready ? THEME.gold : THEME.surface,
					borderRadius: 14,
					padding: 14,
				}}
			>
				<Text
					style={{
						color: ready ? THEME.goldInk : THEME.faint,
						fontSize: TYPE.small,
						fontWeight: "bold",
					}}
				>
					Send
				</Text>
			</Pressable>
		</Row>
	);
}
`,
	},
	{
		path: "src/components/reveal.tsx",
		content: `import { type RuntimeChildren, View, useEffect, useState } from "@rowcat/runtime";

export interface RevealProps extends RuntimeChildren {
	/** The distance it rises. 0 changes only brightness. */
	rise?: number;
	duration?: number;
}

/**
 * Entering: **the only way to say "the scene changed" in this asset-less runtime.**
 *
 * \`\`\`text
 * first render   opacity 0 · translateY 10   ← as if not there yet
 * after effect   opacity 1 · translateY 0    ← the renderer fills in between
 * \`\`\`
 *
 * No frames are made here. Write one desired value and the trusted renderer interpolates in its own realm,
 * so this component has no timer or completion callback: even on the screen of someone with reduced motion
 * on, **the moment the state changes is the same.**
 *
 * Changing \`key\` to remount makes it enter again. The screen files do that when a scene changes.
 */
export function Reveal({ rise = 10, duration = 260, children }: RevealProps) {
	const [shown, setShown] = useState(false);
	useEffect(() => {
		setShown(true);
	}, []);
	return (
		<View
			transition={{ duration, easing: "ease-out" }}
			style={{ opacity: shown ? 1 : 0, translateY: shown ? 0 : rise }}
		>
			{children}
		</View>
	);
}
`,
	},
];
