import type { RuntimeTemplateFile } from "../types.ts";

/** Screens. Each step of the progression is one file. */
export const SCREEN_FILES: readonly RuntimeTemplateFile[] = [
	{
		path: "src/screens/opening.tsx",
		content: `import { Row, Stack, Text, View } from "@rowcat/runtime";
import { ActionButton } from "../components/action-button";
import { MemberAvatar } from "../components/member-avatar";
import { Panel } from "../components/panel";
import { Pill } from "../components/pill";
import { Reveal } from "../components/reveal";
import { Section } from "../components/section";
import { WeekRail } from "../components/week-rail";
import { MEMBER_ORDER, MEMBERS } from "../members";
import { AGENCY, OPENING } from "../story/agency";
import { ENDING_IDS, endingLabel } from "../story/endings";
import { NOTE_IDS } from "../systems/notes";
import { SPACE, THEME, TYPE } from "../theme";
import type { Career } from "../types";

export interface OpeningScreenProps {
	career: Career;
	onStart: () => void;
}

/**
 * The first screen: **shows different things to first-time and returning players.**
 *
 * On the first run the lower section is absent. Showing an empty display case to someone who has collected
 * nothing is a burden, not guidance, and above all it first gives the impression that this story is a collectible.
 *
 * ## Show the eight weeks first
 *
 * **The same rail** as the header stands under the title (\`components/week-rail.tsx\`). That row, with not
 * one cell filled and just three dots at the review spots, says *this story is eight weeks long with two
 * reviews midway* before any three sentences do. Once started, the same row keeps following in the header,
 * so the shape learned on the first screen becomes the progress indicator as is.
 */
export function OpeningScreen({ career, onStart }: OpeningScreenProps) {
	/**
	 * Whether to show the previous debut group section: **asks whether anything remains, not the run count.**
	 *
	 * Someone who quit without finishing the eight weeks still learned stories. Going by run count, that person
	 * would next open a screen where what they learned is nowhere.
	 */
	const returning = career.runs > 0 || career.notes.length > 0;
	return (
		<Reveal rise={14}>
			<Stack gap={SPACE.section}>
				<Stack gap={SPACE.block}>
					<Stack gap={SPACE.tight}>
						<Text
							style={{
								color: THEME.gold,
								fontSize: TYPE.label,
								fontWeight: "bold",
							}}
						>
							{OPENING.subtitle}
						</Text>
						<Text
							style={{
								color: THEME.text,
								fontSize: TYPE.display,
								fontWeight: "bold",
							}}
						>
							{OPENING.title}
						</Text>
					</Stack>

					<Stack gap={SPACE.tight}>
						<WeekRail week={0} total={AGENCY.weeks} />
						<Row style={{ justify: "between", align: "center" }}>
							<Text style={{ color: THEME.faint, fontSize: TYPE.label }}>
								{\`\${AGENCY.weeks} weeks\`}
							</Text>
							<Text style={{ color: THEME.faint, fontSize: TYPE.label }}>
								Two reviews · one debut evaluation
							</Text>
						</Row>
					</Stack>
				</Stack>

				<Stack gap={SPACE.row}>
					{OPENING.lines.map((line, index) => (
						<Text
							key={\`opening-\${index}\`}
							style={{ color: THEME.textSoft, fontSize: TYPE.body }}
						>
							{line}
						</Text>
					))}
				</Stack>

				<Rule text={OPENING.hint} />

				{/*
				  * The five faces stand on the first screen, with no names or stats yet. The one fact that you'll be
				  * responsible for five people arrives before any sentence.
				  */}
				<Row gap={SPACE.tight} style={{ align: "center" }}>
					{MEMBER_ORDER.map((id) => (
						<MemberAvatar key={id} member={MEMBERS[id]} size={34} />
					))}
					<View style={{ grow: 1 }} />
					<Text style={{ color: THEME.faint, fontSize: TYPE.label }}>
						{AGENCY.team}
					</Text>
				</Row>

				{returning && (
					<Section
						label="What's left from previous debut groups"
						trailing={
							<Pill
								label={career.runs === 0 ? "In progress" : \`Managed \${career.runs} times\`}
								color={THEME.gold}
								fill={THEME.goldSoft}
							/>
						}
					>
						<Panel padding={16}>
							<Stack gap={SPACE.block}>
								<Row gap={SPACE.row}>
									<Tally
										label="Stories learned"
										value={\`\${career.notes.length}\`}
										total={\`/ \${NOTE_IDS.length}\`}
									/>
									<Tally
										label="Endings seen"
										value={\`\${career.unlockedEndings.length}\`}
										total={\`/ \${ENDING_IDS.length}\`}
									/>
								</Row>
								<Row gap={6}>
									{ENDING_IDS.map((id) => {
										const seen = career.unlockedEndings.includes(id);
										return (
											<Pill
												key={id}
												label={endingLabel(id, seen)}
												color={seen ? THEME.gold : THEME.faint}
												fill={seen ? THEME.goldSoft : THEME.sunken}
											/>
										);
									})}
								</Row>
								<Text style={{ color: THEME.faint, fontSize: TYPE.small }}>
									Skill and trust are built up again from the start. Only what you learned about
									the five remains, and it changes what opens up in these eight weeks.
								</Text>
							</Stack>
						</Panel>
					</Section>
				)}

				{!returning && (
					<Text style={{ color: THEME.faint, fontSize: TYPE.small }}>
						What you learn here stays after this debut group ends. You can't learn all
						five at once.
					</Text>
				)}

				<ActionButton
					label={returning ? "Take on a new debut group" : "Start"}
					onPress={onStart}
				/>
			</Stack>
		</Reveal>
	);
}

/**
 * One line of rules: the most important sentence in this story, so it gets its own surface.
 *
 * The stripe on the left says *this is a rule, not a quote*. The same shape stands on the director's memo in
 * the briefing, with a different stripe color (the company's color and the rules' color are different things).
 */
function Rule({ text }: { text: string }) {
	return (
		<Panel fill={THEME.raised} line={THEME.goldSoft} padding={14}>
			<Row gap={SPACE.row} style={{ align: "stretch" }}>
				<View
					style={{ width: 3, borderRadius: 3, backgroundColor: THEME.gold }}
				/>
				<View style={{ grow: 1 }}>
					<Text style={{ color: THEME.textSoft, fontSize: TYPE.body }}>
						{text}
					</Text>
				</View>
			</Row>
		</Panel>
	);
}

function Tally({
	label,
	value,
	total,
}: {
	label: string;
	value: string;
	total: string;
}) {
	return (
		<Stack gap={5} style={{ grow: 1 }}>
			<Text style={{ color: THEME.muted, fontSize: TYPE.label }}>{label}</Text>
			<Row gap={5} style={{ align: "end" }}>
				<Text
					style={{ color: THEME.text, fontSize: TYPE.title, fontWeight: "bold" }}
				>
					{value}
				</Text>
				<Text style={{ color: THEME.faint, fontSize: TYPE.small }}>{total}</Text>
			</Row>
		</Stack>
	);
}
`,
	},
	{
		path: "src/screens/briefing.tsx",
		content: `import { Row, Stack, Text, View } from "@rowcat/runtime";
import { ActionButton } from "../components/action-button";
import { MemberAvatar } from "../components/member-avatar";
import { Panel } from "../components/panel";
import { Reveal } from "../components/reveal";
import { ScreenTitle } from "../components/screen-title";
import { Section } from "../components/section";
import { MEMBERS } from "../members";
import { AGENCY } from "../story/agency";
import { weekOf } from "../story/weeks";
import { mostDistant } from "../systems/relationships";
import { CONDITION_LABEL, mostTired, weakestMember } from "../systems/stats";
import { SPACE, THEME, TYPE } from "../theme";
import type { MemberId, Run } from "../types";

export interface BriefingScreenProps {
	run: Run;
	onPlan: () => void;
}

/**
 * The start of the week: what is happening this week and **what the problem is now.**
 *
 * The three lines below derive from state. The sentences are not saved because the moment they were, plays
 * in progress would keep getting old advice after the manuscript changed.
 */
export function BriefingScreen({ run, onPlan }: BriefingScreenProps) {
	const week = weekOf(run.week);
	/**
	 * Three that stand out: **the same person never stands twice.**
	 *
	 * The tired one, the lagging one and the distant one are often the same person, and three of the same face
	 * side by side reads as a broken screen. Only the first reason that matched remains.
	 */
	const notes: { memberId: MemberId; tag: string; line: string }[] = [];
	const add = (memberId: MemberId, tag: string, line: string): void => {
		if (notes.some((note) => note.memberId === memberId)) return;
		notes.push({ memberId, tag, line });
	};
	const tired = mostTired(run);
	add(
		tired,
		"Condition",
		\`\${CONDITION_LABEL(run.condition[tired])} · \${run.condition[tired]}. At this rate they learn only half.\`,
	);
	add(
		weakestMember(run),
		"Skill",
		"Lags furthest behind the five in skill. Individual coaching can help.",
	);
	add(
		mostDistant(run),
		"Distance",
		"Still distant. You can stay behind in the evening and hear their story.",
	);

	return (
		<Reveal>
			<Stack gap={SPACE.section}>
				<ScreenTitle
					eyebrow={\`Week \${run.week} / \${AGENCY.weeks}\`}
					title={week.title}
					lead={week.brief}
				/>

				{/*
				  * The director's words: the company's color. The same shape as the first screen's rule line, with only the
				  * stripe color different: one is this story's rule and the other is what the company said this week.
				  */}
				<Panel fill={THEME.raised} line={THEME.stageSoft} padding={14}>
					<Row gap={SPACE.row} style={{ align: "stretch" }}>
						<View
							style={{ width: 3, borderRadius: 3, backgroundColor: THEME.stage }}
						/>
						<Stack gap={5} style={{ grow: 1 }}>
							<Text
								style={{
									color: THEME.stage,
									fontSize: TYPE.label,
									fontWeight: "bold",
								}}
							>
								{AGENCY.manager}
							</Text>
							<Text style={{ color: THEME.textSoft, fontSize: TYPE.body }}>
								{week.memo}
							</Text>
						</Stack>
					</Row>
				</Panel>

				<Section label="What stands out now">
					<Stack gap={SPACE.tight}>
						{notes.map((note) => (
							<Note
								key={note.memberId}
								memberId={note.memberId}
								tag={note.tag}
								line={note.line}
							/>
						))}
					</Stack>
				</Section>

				<ActionButton
					label="Plan this week"
					note="Pick three slots and they settle as is"
					onPress={onPlan}
				/>
			</Stack>
		</Reveal>
	);
}

function Note({
	memberId,
	tag,
	line,
}: {
	memberId: MemberId;
	tag: string;
	line: string;
}) {
	const member = MEMBERS[memberId];
	return (
		<View
			style={{ backgroundColor: THEME.line, borderRadius: 14, padding: 1 }}
		>
			<Row style={{ align: "stretch" }} gap={0}>
				<View style={{ width: 3, backgroundColor: member.accent }} />
				<View
					style={{
						grow: 1,
						backgroundColor: THEME.surface,
						borderRadius: 13,
						padding: 12,
					}}
				>
					<Row gap={SPACE.row} style={{ align: "center" }}>
						<MemberAvatar member={member} size={30} />
						<Stack gap={3} style={{ grow: 1 }}>
							<Row gap={6} style={{ align: "center" }}>
								<Text
									style={{
										color: member.accent,
										fontSize: TYPE.small,
										fontWeight: "bold",
									}}
								>
									{member.shortName}
								</Text>
								<Text style={{ color: THEME.faint, fontSize: TYPE.label }}>
									{tag}
								</Text>
							</Row>
							<Text style={{ color: THEME.muted, fontSize: TYPE.small }}>
								{line}
							</Text>
						</Stack>
					</Row>
				</View>
			</Row>
		</View>
	);
}
`,
	},
	{
		path: "src/screens/planner.tsx",
		content: `import {
	Pressable,
	Row,
	Stack,
	Text,
	useMemo,
	useState,
	View,
} from "@rowcat/runtime";
import { ActionButton } from "../components/action-button";
import { MemberAvatar } from "../components/member-avatar";
import { Panel } from "../components/panel";
import { Pill } from "../components/pill";
import { Reveal } from "../components/reveal";
import { ScreenTitle } from "../components/screen-title";
import { Section } from "../components/section";
import { MEMBER_ORDER, MEMBERS } from "../members";
import {
	ACTIVITIES,
	ACTIVITY_IDS,
	SLOTS_PER_WEEK,
	scheduleReady,
	settleWeek,
	weakestSkill,
} from "../systems/schedule";
import { SKILL_LABEL, stageScore } from "../systems/stats";
import { SPACE, THEME, TYPE } from "../theme";
import type { ActivityId, MemberId, Run, Slot } from "../types";

export interface PlannerScreenProps {
	run: Run;
	onSlots: (slots: readonly (Slot | null)[]) => void;
	onConfirm: () => void;
}

/**
 * Plan this week: **where this story is a game.**
 *
 * \`\`\`text
 * press a slot       → choose an activity → (for individual coaching) choose a target → it goes in the slot
 * three slots full   → the expected result stands → confirm
 * \`\`\`
 *
 * ## The plan is saved state; the slot being edited is not
 *
 * The three planned slots live in \`run.slots\` (they continue after a restart). Which slot is being edited
 * and whether a target is awaited are **the screen's business**, so \`useState\`: saved, the list that was
 * open would still be floating when the app reopened, and that is not progress.
 *
 * ## The preview runs the real settlement once
 *
 * The rules are pure and there is no randomness, so the same plan always gives the same result. So the
 * preview and the real thing cannot diverge: estimating the numbers separately would let them diverge,
 * and the player would see it as a lie.
 *
 * That section **stands even before three slots are filled.** Appearing only after filling would push the
 * screen once at that spot, and above all you couldn't know *what planning tells you* before planning.
 */
export function PlannerScreen({ run, onSlots, onConfirm }: PlannerScreenProps) {
	const [editing, setEditing] = useState<number | null>(null);
	const [pending, setPending] = useState<ActivityId | null>(null);

	const slots = run.slots;
	const ready = scheduleReady(slots);
	const preview = useMemo(
		() => (ready ? stageScore(settleWeek(run, slots).run) : null),
		[ready, run, slots],
	);
	const now = stageScore(run);
	const filled = slots.filter((slot) => slot !== null).length;

	const place = (index: number, activity: ActivityId, target: MemberId | null): void => {
		const next: (Slot | null)[] = [];
		for (let i = 0; i < SLOTS_PER_WEEK; i += 1) next.push(slots[i] ?? null);
		next[index] = { activity, target };
		onSlots(next);
		setEditing(null);
		setPending(null);
	};

	const pick = (index: number, activity: ActivityId): void => {
		if (ACTIVITIES[activity].personal) {
			setPending(activity);
			return;
		}
		place(index, activity, null);
	};

	return (
		<Stack gap={SPACE.section}>
			<ScreenTitle
				eyebrow="Planning"
				eyebrowColor={THEME.gold}
				title="This week's three slots"
				lead="Press a slot to choose what to do. Putting the same activity in twice gains less from the second on."
			/>

			<Stack gap={SPACE.row}>
				<Row gap={SPACE.tight}>
					{[0, 1, 2].map((index) => (
						<SlotBox
							key={\`slot-\${index}\`}
							index={index}
							slot={slots[index] ?? null}
							active={editing === index}
							onPress={() => {
								setPending(null);
								setEditing(editing === index ? null : index);
							}}
						/>
					))}
				</Row>

				{/*
				  * The preview: **always stands.** Before filling, the right side is empty, and the moment three slots
				  * fill, the numbers come into that spot.
				  */}
				<Panel
					fill={THEME.raised}
					line={ready ? THEME.goldSoft : THEME.lineSoft}
					padding={14}
				>
					<Row style={{ justify: "between", align: "center" }} gap={SPACE.row}>
						<Stack gap={3} style={{ grow: 1 }}>
							<Text style={{ color: THEME.muted, fontSize: TYPE.label }}>
								Spending the week with this plan
							</Text>
							<Text style={{ color: THEME.faint, fontSize: TYPE.label }}>
								{ready
									? "There's no randomness, so these numbers are the result"
									: \`\${filled} / \${SLOTS_PER_WEEK} slots filled\`}
							</Text>
						</Stack>
						<Row gap={SPACE.tight} style={{ align: "center" }}>
							<Text style={{ color: THEME.faint, fontSize: TYPE.head }}>
								{\`\${now}\`}
							</Text>
							<Text style={{ color: THEME.muted, fontSize: TYPE.small }}>→</Text>
							{preview === null ? (
								/* Can't be counted yet: left as **an empty spot**, not text. A glyph in the
								   spot would read as a value. */
								<View
									style={{
										width: 38,
										height: 22,
										borderRadius: 8,
										backgroundColor: THEME.track,
									}}
								/>
							) : (
								<Text
									style={{
										color: preview >= now ? THEME.gold : THEME.fall,
										fontSize: TYPE.figure,
										fontWeight: "bold",
									}}
								>
									{\`\${preview}\`}
								</Text>
							)}
						</Row>
					</Row>
				</Panel>
			</Stack>

			{editing !== null && pending === null && (
				<Reveal rise={8}>
					<Section
						label={\`What goes in slot \${editing + 1}\`}
						trailing={
							<Pill
								label="Eight options"
								color={THEME.muted}
								fill={THEME.sunken}
							/>
						}
					>
						<Stack gap={SPACE.tight}>
							{ACTIVITY_IDS.map((id) => (
								<ActivityRow
									key={id}
									activity={id}
									onPress={() => pick(editing, id)}
								/>
							))}
						</Stack>
					</Section>
				</Reveal>
			)}

			{editing !== null && pending !== null && (
				<Reveal rise={8}>
					<Section label="Who to hold back">
						<Stack gap={SPACE.tight}>
							{MEMBER_ORDER.map((id) => (
								<Pressable
									key={id}
									onPress={() => place(editing, pending, id)}
								>
									<Panel padding={12} radius={14}>
										<Row gap={SPACE.row} style={{ align: "center" }}>
											<MemberAvatar member={MEMBERS[id]} size={32} />
											<Stack gap={2} style={{ grow: 1 }}>
												<Text
													style={{
														color: THEME.text,
														fontSize: TYPE.body,
														fontWeight: "medium",
													}}
												>
													{MEMBERS[id].shortName}
												</Text>
												<Text style={{ color: THEME.muted, fontSize: TYPE.small }}>
													{\`Their lowest axis is \${SKILL_LABEL[weakestSkill(run, id)]}\`}
												</Text>
											</Stack>
											<Text style={{ color: THEME.faint, fontSize: TYPE.small }}>
												{\`Condition \${run.condition[id]}\`}
											</Text>
										</Row>
									</Panel>
								</Pressable>
							))}
						</Stack>
					</Section>
				</Reveal>
			)}

			<ActionButton
				label={ready ? "Spend the week" : "Fill all three slots"}
				disabled={!ready}
				onPress={onConfirm}
			/>
		</Stack>
	);
}

/**
 * One slot: when empty only its number and place stand.
 *
 * Three stand side by side, so **their heights must match.** With one-line and two-line activity names
 * mixed, the three cards' bottoms misalign, and the misalignment changes whenever the content does.
 */
function SlotBox({
	index,
	slot,
	active,
	onPress,
}: {
	index: number;
	slot: Slot | null;
	active: boolean;
	onPress: () => void;
}) {
	const activity = slot === null ? null : ACTIVITIES[slot.activity];
	const empty = activity === null;
	return (
		<Pressable onPress={onPress} style={{ grow: 1 }}>
			<Panel
				line={active ? THEME.gold : empty ? THEME.lineSoft : THEME.line}
				fill={empty ? THEME.sunken : THEME.surface}
				padding={12}
				radius={14}
			>
				<Stack gap={SPACE.tight} style={{ height: 74 }}>
					<Row style={{ justify: "between", align: "center" }}>
						<Text style={{ color: THEME.faint, fontSize: TYPE.label }}>
							{\`Slot \${index + 1}\`}
						</Text>
						<View
							style={{
								width: 6,
								height: 6,
								borderRadius: 6,
								backgroundColor: empty ? THEME.track : THEME.gold,
							}}
						/>
					</Row>
					{activity === null ? (
						<Text style={{ color: THEME.faint, fontSize: TYPE.body }}>
							Empty
						</Text>
					) : (
						<Stack gap={3}>
							<Text
								style={{
									color: THEME.text,
									fontSize: TYPE.body,
									fontWeight: "bold",
									lines: 2,
								}}
							>
								{activity.name}
							</Text>
							{slot !== null && slot.target !== null && (
								<Text
									style={{
										color: MEMBERS[slot.target].accent,
										fontSize: TYPE.label,
									}}
								>
									{MEMBERS[slot.target].shortName}
								</Text>
							)}
						</Stack>
					)}
				</Stack>
			</Panel>
		</Pressable>
	);
}

function ActivityRow({
	activity,
	onPress,
}: {
	activity: ActivityId;
	onPress: () => void;
}) {
	const value = ACTIVITIES[activity];
	return (
		<Pressable onPress={onPress}>
			<Panel padding={13} radius={14}>
				<Stack gap={SPACE.tight}>
					<Row style={{ justify: "between", align: "center" }} gap={SPACE.tight}>
						<Text
							style={{
								color: THEME.text,
								fontSize: TYPE.body,
								fontWeight: "medium",
							}}
						>
							{value.name}
						</Text>
						{value.personal ? (
							<Pill label="One person" color={THEME.stage} fill={THEME.stageSoft} />
						) : (
							<Pill label="Everyone" color={THEME.faint} fill={THEME.sunken} />
						)}
					</Row>
					<Text style={{ color: THEME.muted, fontSize: TYPE.small }}>
						{value.summary}
					</Text>
					<Row gap={SPACE.tight} style={{ align: "stretch" }}>
						<View
							style={{ width: 2, borderRadius: 2, backgroundColor: THEME.track }}
						/>
						<View style={{ grow: 1 }}>
							<Text style={{ color: THEME.textSoft, fontSize: TYPE.label }}>
								{value.effect}
							</Text>
						</View>
					</Row>
				</Stack>
			</Panel>
		</Pressable>
	);
}
`,
	},
	{
		path: "src/screens/result.tsx",
		content: `import { Row, Stack, Text, View } from "@rowcat/runtime";
import { ActionButton } from "../components/action-button";
import { ChoiceList } from "../components/choice-list";
import { Divider } from "../components/divider";
import { Panel } from "../components/panel";
import { Reveal } from "../components/reveal";
import { ScreenTitle } from "../components/screen-title";
import { Section } from "../components/section";
import { eventFor } from "../story/events";
import { weekOf } from "../story/weeks";
import type { Choice } from "../systems/progression";
import { SPACE, THEME, TYPE } from "../theme";
import type { Career, Run } from "../types";

export interface ResultScreenProps {
	run: Run;
	career: Career;
	onChoose: (choice: Choice) => void;
	onNext: () => void;
}

/**
 * A week has passed: **what moved and by how much**, and what happened this week.
 *
 * The settlement lines draw the saved value (\`run.lastResult\`) as is. Recomputing on screen would make
 * room for the planner's preview, the settlement and this screen's numbers to diverge.
 *
 * ## Rows are not striped
 *
 * For a while odd and even rows had different surface colors, and then this list read as a table. What
 * stands here is not a table but **four things that happened this week**, separated only by hairlines on one surface.
 */
export function ResultScreen({ run, career, onChoose, onNext }: ResultScreenProps) {
	const week = weekOf(run.week);
	const event = eventFor(run.week);
	const chosen =
		event === null || run.event === null
			? null
			: (event.choices.find((choice) => choice.id === run.event) ?? null);
	const waiting = event !== null && chosen === null;

	return (
		<Stack gap={SPACE.section}>
			<Reveal>
				<Stack gap={SPACE.section}>
					<ScreenTitle
						eyebrow="A week has passed"
						eyebrowColor={THEME.gold}
						title={\`\${week.title} results\`}
					/>

					<Panel padding={0} radius={16}>
						<Stack gap={0}>
							{run.lastResult.length === 0 && (
								<View style={{ padding: 16 }}>
									<Text style={{ color: THEME.faint, fontSize: TYPE.small }}>
										Nothing rose this week.
									</Text>
								</View>
							)}
							{run.lastResult.map((line, index) => (
								<Reveal key={\`line-\${index}\`} rise={6}>
									<Stack gap={0}>
										{index > 0 && <Divider color={THEME.lineSoft} />}
										<View style={{ padding: 14 }}>
											<Row style={{ justify: "between", align: "center" }} gap={SPACE.row}>
												<Stack gap={3} style={{ grow: 1 }}>
													<Text
														style={{
															color: THEME.text,
															fontSize: TYPE.small,
															fontWeight: "medium",
														}}
													>
														{line.label}
													</Text>
													<Text style={{ color: THEME.muted, fontSize: TYPE.small }}>
														{line.detail}
													</Text>
												</Stack>
												<View
													style={{
														backgroundColor:
															line.delta >= 0 ? THEME.riseSoft : THEME.fallSoft,
														borderRadius: 8,
														padding: 6,
													}}
												>
													<Text
														style={{
															color: line.delta >= 0 ? THEME.rise : THEME.fall,
															fontSize: TYPE.small,
															fontWeight: "bold",
														}}
													>
														{line.delta >= 0 ? \`+\${line.delta}\` : \`\${line.delta}\`}
													</Text>
												</View>
											</Row>
										</View>
									</Stack>
								</Reveal>
							))}
						</Stack>
					</Panel>
				</Stack>
			</Reveal>

			{event !== null && (
				<Reveal rise={12}>
					<Section label="What happened this week">
						<Stack gap={SPACE.row}>
							<Panel fill={THEME.raised} line={THEME.line} padding={16}>
								<Stack gap={SPACE.tight}>
									<Text
										style={{
											color: THEME.gold,
											fontSize: TYPE.label,
											fontWeight: "bold",
										}}
									>
										{event.title}
									</Text>
									<Text style={{ color: THEME.textSoft, fontSize: TYPE.body }}>
										{event.body}
									</Text>
								</Stack>
							</Panel>

							{waiting ? (
								<ChoiceList
									choices={event.choices}
									run={run}
									career={career}
									onChoose={onChoose}
								/>
							) : (
								chosen !== null && (
									<Reveal rise={8}>
										<Panel line={THEME.goldSoft} padding={16}>
											<Stack gap={SPACE.tight}>
												<Text
													style={{
														color: THEME.muted,
														fontSize: TYPE.label,
														fontWeight: "bold",
													}}
												>
													{chosen.label}
												</Text>
												<Text style={{ color: THEME.text, fontSize: TYPE.body }}>
													{chosen.outcome}
												</Text>
											</Stack>
										</Panel>
									</Reveal>
								)
							)}
						</Stack>
					</Section>
				</Reveal>
			)}

			<ActionButton
				label={waiting ? "Decide first" : "Evening"}
				note={waiting ? undefined : "Stay behind with one person"}
				disabled={waiting}
				onPress={onNext}
			/>
		</Stack>
	);
}
`,
	},
	{
		path: "src/screens/evening.tsx",
		content: `import {
	Pressable,
	Row,
	ScrollView,
	Stack,
	Text,
	useEffect,
	useScrollController,
	useState,
	View,
} from "@rowcat/runtime";
import { ActionButton } from "../components/action-button";
import { Composer } from "../components/composer";
import { DialogueCard } from "../components/dialogue-card";
import { MemberAvatar } from "../components/member-avatar";
import { MemberCard } from "../components/member-card";
import { Panel } from "../components/panel";
import { Reveal } from "../components/reveal";
import { ScreenTitle } from "../components/screen-title";
import { Section } from "../components/section";
import { StatBar } from "../components/stat-bar";
import { MEMBER_ORDER, MEMBERS } from "../members";
import { conversationWith } from "../systems/dialogue";
import { NOTES, knownDepth } from "../systems/notes";
import { TRUST_BAND_LABEL, TRUST_MAX, trustBand } from "../systems/relationships";
import { hasMoreToTell, visibleHints } from "../systems/topics";
import { SPACE, THEME, TYPE } from "../theme";
import type { Career, MemberId, Run } from "../types";
import type { ReplyHandle } from "../use-member-reply";

export interface EveningScreenProps {
	run: Run;
	career: Career;
	reply: ReplyHandle;
	onPick: (memberId: MemberId) => void;
	onDone: () => void;
}

/** The round trips left on screen. Everything is saved; only the recent part is drawn here. */
const SHOWN_TURNS = 10;

/**
 * The evening: **one person a day, and one entrance.**
 *
 * There are no prepared question buttons. The player decides what to ask in their own words, and code
 * decides what that sentence touched (\`systems/topics.ts\`). The screen only says *what can be
 * seen*, never the questions: the moment it did, they would become buttons again.
 *
 * \`\`\`text
 * what you see       observations of topics whose conditions are met and not yet known
 * input row          the only entrance. Both progress and mood come from here
 * what you learned   the fragment just opened. It stays with the next debut group
 * \`\`\`
 */
export function EveningScreen({
	run,
	career,
	reply,
	onPick,
	onDone,
}: EveningScreenProps) {
	if (run.eveningStep === "pick" || run.tonight === null)
		return (
			<Reveal>
				<Stack gap={SPACE.section}>
					<ScreenTitle
						eyebrow="Evening"
						title="Who to stay with"
						lead="Stay behind with one person. What you say decides what you learn."
					/>
					<Stack gap={SPACE.row}>
						{MEMBER_ORDER.map((id) => (
							<MemberCard
								key={id}
								memberId={id}
								run={run}
								known={knownDepth(run, career, id)}
								compact
								onPress={() => onPick(id)}
							/>
						))}
					</Stack>
				</Stack>
			</Reveal>
		);

	return (
		<TalkView
			run={run}
			career={career}
			memberId={run.tonight}
			reply={reply}
			onDone={onDone}
		/>
	);
}

function TalkView({
	run,
	career,
	memberId,
	reply,
	onDone,
}: {
	run: Run;
	career: Career;
	memberId: MemberId;
	reply: ReplyHandle;
	onDone: () => void;
}) {
	const [draft, setDraft] = useState("");
	const scroll = useScrollController();
	const member = MEMBERS[memberId];
	const messages = conversationWith(run, memberId).slice(-SHOWN_TURNS);
	const hints = visibleHints(run, career, memberId);
	const revealed = run.revealed === null ? null : NOTES[run.revealed];

	/** To the end when a new line arrives. Commands flow after this commit, so it sees the end after growing. */
	useEffect(() => {
		scroll.scrollToEnd();
	}, [messages.length]);

	const send = (): void => {
		const text = draft;
		setDraft("");
		reply.send(memberId, text);
	};

	return (
		<Stack gap={SPACE.section}>
			<Reveal>
				<View
					style={{
						backgroundColor: member.accentSoft,
						borderRadius: 18,
						padding: 1,
					}}
				>
					<View
						style={{
							backgroundColor: THEME.raised,
							borderRadius: 17,
							padding: 16,
						}}
					>
						<Stack gap={SPACE.block}>
							<Row gap={SPACE.row} style={{ align: "center" }}>
								<MemberAvatar member={member} size={46} active />
								<Stack gap={3} style={{ grow: 1 }}>
									<Text
										style={{
											color: THEME.text,
											fontSize: TYPE.title,
											fontWeight: "bold",
										}}
									>
										{member.name}
									</Text>
									<Text style={{ color: member.accent, fontSize: TYPE.small }}>
										{\`\${member.position} · \${TRUST_BAND_LABEL[trustBand(run.trust[memberId])]}\`}
									</Text>
								</Stack>
								<Stack gap={0} style={{ align: "end" }}>
									<Row gap={4} style={{ align: "end" }}>
										<Text
											style={{
												color: THEME.text,
												fontSize: TYPE.title,
												fontWeight: "bold",
											}}
										>
											{\`\${knownDepth(run, career, memberId)}\`}
										</Text>
										<Text style={{ color: THEME.faint, fontSize: TYPE.small }}>
											/ 3
										</Text>
									</Row>
									<Text style={{ color: THEME.faint, fontSize: TYPE.label }}>
										Stories known
									</Text>
								</Stack>
							</Row>
							<StatBar
								label="Trust"
								value={run.trust[memberId]}
								max={TRUST_MAX}
								color={member.accent}
							/>
						</Stack>
					</View>
				</View>
			</Reveal>

			{/*
			  * **Observations, not questions.** Writing down what to ask would turn that line into a button,
			  * and then this screen would become a list again.
			  */}
			<Section label="What you see">
				{hints.length === 0 ? (
					<Panel padding={14} fill={THEME.background} radius={14}>
						<Text style={{ color: THEME.faint, fontSize: TYPE.small }}>
							{hasMoreToTell(run, career, memberId)
								? \`\${member.shortName} still has stories left to tell. You need to be closer before they come out.\`
								: \`You've learned everything about \${member.shortName}.\`}
						</Text>
					</Panel>
				) : (
					<Stack gap={SPACE.tight}>
						{hints.map((hint) => (
							<View
								key={hint}
								style={{
									backgroundColor: THEME.line,
									borderRadius: 14,
									padding: 1,
								}}
							>
								<Row style={{ align: "stretch" }} gap={0}>
									<View
										style={{ width: 3, backgroundColor: member.accent }}
									/>
									<View
										style={{
											grow: 1,
											backgroundColor: THEME.surface,
											borderRadius: 13,
											padding: 13,
										}}
									>
										<Text style={{ color: THEME.textSoft, fontSize: TYPE.small }}>
											{hint}
										</Text>
									</View>
								</Row>
							</View>
						))}
					</Stack>
				)}
			</Section>

			<Section label="Talk">
				<Stack gap={SPACE.row}>
					{/*
					  * When the conversation is empty **no surface stands.** One hint sentence in an empty box would make
					  * that box look just like the input row right below it, reading as one more input that can't be
					  * pressed.
					  */}
					{messages.length === 0 ? (
						<Text style={{ color: THEME.faint, fontSize: TYPE.small }}>
							{\`Talk to \${member.shortName} in your own words. What you say decides what you learn.\`}
						</Text>
					) : (
					<Panel padding={12} fill={THEME.background} line={THEME.lineSoft}>
						<ScrollView controller={scroll} style={{ height: 260 }}>
							<Stack gap={SPACE.row}>
								{messages.map((message, index) => (
									<DialogueCard
										key={String(message.id)}
										speaker={message.role === "user" ? null : member.shortName}
										accent={member.accent}
										text={message.content}
										enter={index === messages.length - 1}
									/>
								))}
								{reply.pendingFor === memberId && (
									<Text style={{ color: THEME.muted, fontSize: TYPE.small }}>
										{\`\${member.shortName} is thinking…\`}
									</Text>
								)}
							</Stack>
						</ScrollView>
					</Panel>
					)}

					{reply.failure !== null && (
						<Row gap={SPACE.tight} style={{ align: "center" }}>
							<View style={{ grow: 1 }}>
								<Text style={{ color: THEME.fall, fontSize: TYPE.small }}>
									{reply.failure}
								</Text>
							</View>
							{reply.canRetry(memberId) && (
								<Pressable
									onPress={() => reply.retry(memberId)}
									style={{
										backgroundColor: THEME.high,
										borderRadius: 10,
										padding: 9,
									}}
								>
									<Text style={{ color: THEME.textSoft, fontSize: TYPE.small }}>
										Retry
									</Text>
								</Pressable>
							)}
						</Row>
					)}

					<Composer
						value={draft}
						placeholder={\`To \${member.shortName}…\`}
						pending={reply.pending}
						onChange={setDraft}
						onSend={send}
					/>
				</Stack>
			</Section>

			{/*
			  * This card stands even without an answer: what you learn comes from asking, not from the model
			  * answering (the order in \`use-member-reply.ts\`).
			  */}
			{revealed !== null && revealed.memberId === memberId && (
				<Reveal rise={8}>
					<Panel line={member.accent} fill={THEME.raised} padding={16}>
						<Stack gap={SPACE.tight}>
							<Text
								style={{
									color: member.accent,
									fontSize: TYPE.label,
									fontWeight: "bold",
								}}
							>
								{\`Story learned · \${revealed.title}\`}
							</Text>
							<Text style={{ color: THEME.text, fontSize: TYPE.body }}>
								{revealed.body}
							</Text>
							<Text style={{ color: THEME.faint, fontSize: TYPE.small }}>
								This story stays with the next debut group too.
							</Text>
						</Stack>
					</Panel>
				</Reveal>
			)}

			<ActionButton
				label="End the day"
				disabled={reply.pending}
				onPress={onDone}
			/>
		</Stack>
	);
}
`,
	},
	{
		path: "src/screens/evaluation.tsx",
		content: `import { Row, Stack, Text, View } from "@rowcat/runtime";
import { ActionButton } from "../components/action-button";
import { Divider } from "../components/divider";
import { MemberAvatar } from "../components/member-avatar";
import { Panel } from "../components/panel";
import { Pill } from "../components/pill";
import { Reveal } from "../components/reveal";
import { ScreenTitle } from "../components/screen-title";
import { Section } from "../components/section";
import { StatBar } from "../components/stat-bar";
import { MEMBERS } from "../members";
import { type Evaluation, judge, memberGrades } from "../story/evaluations";
import { SPACE, THEME, TYPE } from "../theme";
import type { Run } from "../types";

export interface EvaluationScreenProps {
	run: Run;
	evaluation: Evaluation;
	onNext: () => void;
}

/**
 * Reviews and the evaluation: **the same screen stands three times.**
 *
 * Only the last ends the run. That difference is \`evaluation.decisive\` alone, and the screen changes only
 * the button's words by it: built as separate screens, midpoint reviews and the debut evaluation would be scored by different rules.
 */
export function EvaluationScreen({
	run,
	evaluation,
	onNext,
}: EvaluationScreenProps) {
	const verdict = judge(run, evaluation);
	const grades = memberGrades(run);
	const tone = verdict.passed ? THEME.gold : THEME.fall;

	return (
		<Reveal rise={14}>
			<Stack gap={SPACE.section}>
				<ScreenTitle
					eyebrow={evaluation.title}
					title={verdict.headline}
					lead={evaluation.intro}
				/>

				<Panel
					fill={THEME.raised}
					line={verdict.passed ? THEME.goldSoft : THEME.fallSoft}
					padding={16}
				>
					<Stack gap={SPACE.block}>
						<Row style={{ justify: "between", align: "end" }}>
							<Stack gap={3}>
								<Text style={{ color: THEME.muted, fontSize: TYPE.label }}>
									Score this time
								</Text>
								<Row gap={SPACE.tight} style={{ align: "end" }}>
									<Text
										style={{
											color: tone,
											fontSize: TYPE.figure,
											fontWeight: "bold",
										}}
									>
										{\`\${verdict.score}\`}
									</Text>
									<Text style={{ color: THEME.faint, fontSize: TYPE.body }}>
										{\`/ \${verdict.threshold}\`}
									</Text>
								</Row>
							</Stack>
							<Pill
								label={verdict.passed ? "Passed the bar" : "Below the bar"}
								color={tone}
								fill={verdict.passed ? THEME.goldSoft : THEME.fallSoft}
							/>
						</Row>
						<StatBar
							label="Overall"
							value={verdict.score}
							color={tone}
							readout={\`Bar \${verdict.threshold}\`}
							height={8}
						/>
					</Stack>
				</Panel>

				<Section label="Judges' comments">
					<Stack gap={SPACE.tight}>
						{verdict.comments.map((comment, index) => (
							<Reveal key={\`comment-\${index}\`} rise={6}>
								<Row gap={SPACE.row} style={{ align: "stretch" }}>
									<View
										style={{
											width: 3,
											borderRadius: 3,
											backgroundColor: THEME.stage,
										}}
									/>
									<View style={{ grow: 1 }}>
										<Text style={{ color: THEME.textSoft, fontSize: TYPE.body }}>
											{comment}
										</Text>
									</View>
								</Row>
							</Reveal>
						))}
					</Stack>
				</Section>

				<Section label="Individual evaluation">
					<Panel padding={0} radius={16}>
						<Stack gap={0}>
							{grades.map((entry, index) => (
								<Stack key={entry.id} gap={0}>
									{index > 0 && <Divider color={THEME.lineSoft} />}
									<View style={{ padding: 12 }}>
										<Row gap={SPACE.row} style={{ align: "center" }}>
											<MemberAvatar member={MEMBERS[entry.id]} size={28} />
											<View style={{ grow: 1 }}>
												<Text style={{ color: THEME.text, fontSize: TYPE.small }}>
													{MEMBERS[entry.id].shortName}
												</Text>
											</View>
											<Text style={{ color: THEME.faint, fontSize: TYPE.small }}>
												{\`\${entry.score}\`}
											</Text>
											<Pill
												label={entry.grade}
												color={MEMBERS[entry.id].accent}
												fill={THEME.sunken}
											/>
										</Row>
									</View>
								</Stack>
							))}
						</Stack>
					</Panel>
				</Section>

				<ActionButton
					label={evaluation.decisive ? "See the result" : "Next week"}
					onPress={onNext}
				/>
			</Stack>
		</Reveal>
	);
}
`,
	},
	{
		path: "src/screens/ending.tsx",
		content: `import { Row, Stack, Text, View } from "@rowcat/runtime";
import { ActionButton } from "../components/action-button";
import { MemberAvatar } from "../components/member-avatar";
import { Panel } from "../components/panel";
import { Pill } from "../components/pill";
import { Reveal } from "../components/reveal";
import { Section } from "../components/section";
import { MEMBER_ORDER, MEMBERS } from "../members";
import { ENDING_IDS, ENDINGS, endingLabel } from "../story/endings";
import { NOTE_IDS, completedMembers, knownDepth } from "../systems/notes";
import { stageScore } from "../systems/stats";
import { SPACE, THEME, TYPE } from "../theme";
import type { Career, EndingId, Run } from "../types";

export interface EndingScreenProps {
	ending: EndingId;
	run: Run;
	career: Career;
	onRestart: () => void;
}

/**
 * The end of the eight weeks, and **what remains.**
 *
 * The section below is this story's point. Neither skill, trust nor condition remains. Only what you learned
 * about the five remains, and the last line writes that fact out, so someone starting the next run doesn't
 * read the vanished stats as a bug.
 */
export function EndingScreen({
	ending,
	run,
	career,
	onRestart,
}: EndingScreenProps) {
	const content = ENDINGS[ending];
	const done = completedMembers(run, career);
	const tone = content.debuted ? THEME.gold : THEME.stage;

	return (
		<Reveal rise={16} duration={320}>
			<Stack gap={SPACE.section}>
				<Stack gap={SPACE.block}>
					<Stack gap={SPACE.tight}>
						<Text
							style={{ color: tone, fontSize: TYPE.label, fontWeight: "bold" }}
						>
							{content.subtitle}
						</Text>
						<Text
							style={{
								color: THEME.text,
								fontSize: TYPE.display,
								fontWeight: "bold",
							}}
						>
							{content.title}
						</Text>
					</Stack>
					<Text style={{ color: THEME.textSoft, fontSize: TYPE.body }}>
						{content.summary}
					</Text>
					<View
						style={{ height: 3, borderRadius: 3, backgroundColor: tone }}
					/>
				</Stack>

				<Row gap={SPACE.tight}>
					<Figure label="Overall" value={\`\${stageScore(run)}\`} />
					<Figure label="Sync" value={\`\${run.sync}\`} />
					<Figure label="New stories" value={\`\${run.opened.length}\`} />
				</Row>

				<Section
					label="What lasts across runs"
					trailing={
						<Pill
							label={\`Debut group #\${career.runs}\`}
							color={THEME.gold}
							fill={THEME.goldSoft}
						/>
					}
				>
					<Panel padding={16}>
						<Stack gap={SPACE.block}>
							<Row style={{ justify: "between", align: "center" }}>
								<Text style={{ color: THEME.textSoft, fontSize: TYPE.small }}>
									Stories learned
								</Text>
								<Row gap={5} style={{ align: "end" }}>
									<Text
										style={{
											color: THEME.gold,
											fontSize: TYPE.title,
											fontWeight: "bold",
										}}
									>
										{\`\${career.notes.length}\`}
									</Text>
									<Text style={{ color: THEME.faint, fontSize: TYPE.small }}>
										{\`/ \${NOTE_IDS.length}\`}
									</Text>
								</Row>
							</Row>

							<Row gap={SPACE.tight}>
								{MEMBER_ORDER.map((id) => (
									<Stack key={id} gap={6} style={{ align: "center", grow: 1 }}>
										<MemberAvatar
											member={MEMBERS[id]}
											size={34}
											dimmed={!done.includes(id)}
										/>
										<Text
											style={{
												color: done.includes(id)
													? MEMBERS[id].accent
													: THEME.faint,
												fontSize: TYPE.label,
											}}
										>
											{\`\${knownDepth(run, career, id)}/3\`}
										</Text>
									</Stack>
								))}
							</Row>

							<Stack gap={6}>
								{ENDING_IDS.map((id) => {
									const seen = career.unlockedEndings.includes(id);
									return (
										<Row key={id} gap={SPACE.tight} style={{ align: "center" }}>
											<View
												style={{
													width: 6,
													height: 6,
													borderRadius: 6,
													backgroundColor: seen ? THEME.gold : THEME.track,
												}}
											/>
											<Text
												style={{
													color: seen ? THEME.text : THEME.muted,
													fontSize: TYPE.small,
												}}
											>
												{endingLabel(id, seen)}
											</Text>
										</Row>
									);
								})}
							</Stack>

							<Text style={{ color: THEME.faint, fontSize: TYPE.small }}>
								The next debut group starts skill and trust from scratch. Only what you learned
								about the five remains, and it changes what opens up in the next eight weeks.
								This section stays as is even after the player's "Reset play".
							</Text>
						</Stack>
					</Panel>
				</Section>

				<ActionButton label="Take on a new debut group" onPress={onRestart} />
			</Stack>
		</Reveal>
	);
}

function Figure({ label, value }: { label: string; value: string }) {
	return (
		<View
			style={{
				grow: 1,
				backgroundColor: THEME.surface,
				borderRadius: 14,
				padding: 14,
			}}
		>
			<Stack gap={5}>
				<Text style={{ color: THEME.muted, fontSize: TYPE.label }}>{label}</Text>
				<Text
					style={{ color: THEME.text, fontSize: TYPE.title, fontWeight: "bold" }}
				>
					{value}
				</Text>
			</Stack>
		</View>
	);
}
`,
	},
	{
		path: "src/screens/roster.tsx",
		content: `import { Row, Stack, Text, View } from "@rowcat/runtime";
import { Panel } from "../components/panel";
import { MemberCard } from "../components/member-card";
import { Pill } from "../components/pill";
import { Reveal } from "../components/reveal";
import { Section } from "../components/section";
import { MEMBER_ORDER, MEMBERS } from "../members";
import { NOTES, NOTE_IDS, knownDepth, knownNotes } from "../systems/notes";
import { SPACE, THEME, TYPE } from "../theme";
import type { Career, Run } from "../types";

export interface RosterScreenProps {
	run: Run;
	career: Career;
}

/**
 * The five right now, and **the stories I know.**
 *
 * The only screen viewable at any time outside progress. Being unable to choose anything here is the
 * point: the moment you could, this screen would become part of progress, and there would be two flows.
 */
export function RosterScreen({ run, career }: RosterScreenProps) {
	const known = knownNotes(run, career);
	const opened = NOTE_IDS.filter((id) => known.includes(id));
	return (
		<Stack gap={SPACE.section}>
			<Section
				label="The five"
				trailing={
					<Pill
						label={\`Stories \${known.length} / \${NOTE_IDS.length}\`}
						color={THEME.gold}
						fill={THEME.goldSoft}
					/>
				}
			>
				<Stack gap={SPACE.row}>
					{MEMBER_ORDER.map((id) => (
						<MemberCard
							key={id}
							memberId={id}
							run={run}
							known={knownDepth(run, career, id)}
						/>
					))}
				</Stack>
			</Section>

			<Section label="Stories learned">
				{opened.length === 0 ? (
					<Panel padding={16} fill={THEME.background}>
						<Text style={{ color: THEME.faint, fontSize: TYPE.small }}>
							None yet. Stay behind with one person in the evening and hear their story, and it collects here and
							stays with the next debut group too.
						</Text>
					</Panel>
				) : (
					<Stack gap={SPACE.tight}>
						{opened.map((id) => {
							const note = NOTES[id];
							const member = MEMBERS[note.memberId];
							const thisRun = run.opened.includes(id);
							return (
								<Reveal key={id} rise={6}>
									<View
										style={{
											backgroundColor: THEME.line,
											borderRadius: 14,
											padding: 1,
										}}
									>
										<Row style={{ align: "stretch" }} gap={0}>
											<View
												style={{ width: 3, backgroundColor: member.accent }}
											/>
											<View
												style={{
													grow: 1,
													backgroundColor: THEME.surface,
													borderRadius: 13,
													padding: 13,
												}}
											>
												<Stack gap={6}>
													<Text
														style={{
															color: member.accent,
															fontSize: TYPE.label,
															fontWeight: "bold",
														}}
													>
														{\`\${member.shortName} · \${note.title}\${thisRun ? " · learned this time" : ""}\`}
													</Text>
													<Text
														style={{ color: THEME.textSoft, fontSize: TYPE.small }}
													>
														{note.body}
													</Text>
												</Stack>
											</View>
										</Row>
									</View>
								</Reveal>
							);
						})}
					</Stack>
				)}
			</Section>
		</Stack>
	);
}
`,
	},
];
