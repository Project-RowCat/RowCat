import type { RuntimeTemplate } from "./types.ts";

/**
 * Relationship Profile covers a relationship that grows and leaves a record. It teaches the
 * distinction between stored and derived values. Stored: trust, completed activities, and dates.
 * The stage labels `Strangers`, `Friends`, and `Trusted` are derived from trust, so they are not stored.
 * Storing both would allow the two to disagree, and the mismatch would be silent. Activity records
 * follow the same rule: only the activity id is stored, and the text lives in activities.ts.
 */
export const RELATIONSHIP_PROFILE_TEMPLATE: RuntimeTemplate = {
	id: "relationship-profile",
	name: "Relationship Profile",
	description:
		"A character screen where the relationship grows through activities. Progress is saved.",
	category: "story",
	complexity: "intermediate",
	demonstrates: [
		"Relationship and activity records kept with useStoryState",
		"Derived stages built with useMemo",
		"An activity log drawn from saved ids",
		"Activities that can be done only once",
	],
	entry: "src/main.tsx",
	files: [
		{
			path: "src/activities.ts",
			content: `/**
 * The character, stage and activity tables: **static content** the screen only reads.
 * Saved state holds only activity ids, not the sentences here (state.ts).
 */

export const CHARACTER = {
	name: "Sena",
	role: "Same club · library assistant",
	intro: "Quiet, but once she starts a story she finishes it.",
};

export interface RelationshipStage {
	id: string;
	label: string;
	/** The trust value where this stage begins. */
	from: number;
	description: string;
}

/** Higher stages come later. The decision relies on that order. */
export const STAGES: readonly RelationshipStage[] = [
	{
		id: "stranger",
		label: "Strangers",
		from: 0,
		description: "You say hello but know nothing beyond each other's names.",
	},
	{
		id: "acquaintance",
		label: "Acquaintances",
		from: 30,
		description: "Sometimes she talks to you first. You know a few of her tastes.",
	},
	{
		id: "friend",
		label: "Friends",
		from: 50,
		description: "You meet without making plans and pick up where you left off.",
	},
	{
		id: "close",
		label: "Close friends",
		from: 70,
		description: "She notices what you don't say. She reaches out first.",
	},
	{
		id: "trusted",
		label: "Trusted",
		from: 85,
		description: "What she used to carry alone, you now talk about together.",
	},
];

export interface Activity {
	id: string;
	label: string;
	/** What this activity adds to trust. */
	delta: number;
	/** The sentence left in the log. */
	log: string;
}

export const ACTIVITIES: readonly Activity[] = [
	{
		id: "club",
		label: "Help with club work",
		delta: 14,
		log: "Sorted the returned books together.",
	},
	{
		id: "walk",
		label: "Walk home together",
		delta: 12,
		log: "Walked together from the school gate to the bus stop.",
	},
	{
		id: "lunch",
		label: "Have lunch together",
		delta: 10,
		log: "Ate lunch together on the rooftop stairs.",
	},
	{
		id: "message",
		label: "Reach out first",
		delta: 8,
		log: "Reached out first, even with nothing in particular to say.",
	},
];

export function activityOf(id: string): Activity | null {
	return ACTIVITIES.find((activity) => activity.id === id) ?? null;
}

/** One value decides the stage. The last one it reaches in the list is the answer. */
export function stageOf(trust: number): RelationshipStage {
	let current = STAGES[0];
	for (const stage of STAGES) if (trust >= stage.from) current = stage;
	return current;
}
`,
		},
		{
			path: "src/state.ts",
			content: `import { defineStoryState } from "@rowcat/runtime";
import { activityOf } from "./activities";

/**
 * Saved state **belongs to this playthrough**. It is only trust, finished activities and the day;
 * the stage is **not** here: it derives from trust, and saving it could let the two values diverge.
 */

export interface RelationshipProgress {
	trust: number;
	/** Ids of finished activities. Their order is the log's order. */
	activities: string[];
	day: number;
}

const START: RelationshipProgress = {
	trust: 40,
	activities: [],
	day: 1,
};

export const relationshipProgress = defineStoryState<RelationshipProgress>({
	key: "relationship",
	version: 1,
	initial: START,
});

const clamp = (value: number): number => Math.min(100, Math.max(0, value));

/**
 * Does one activity: **the same activity happens only once.**
 *
 * The rule lives here rather than in the screen because there, every new place that opens the same
 * activity would need the check written again, and one place would eventually miss it.
 */
export function doActivity(
	progress: RelationshipProgress,
	activityId: string,
): RelationshipProgress {
	if (progress.activities.includes(activityId)) return progress;
	const activity = activityOf(activityId);
	if (activity === null) return progress;
	return {
		trust: clamp(progress.trust + activity.delta),
		activities: [...progress.activities, activity.id],
		day: progress.day + 1,
	};
}

export const isDone = (
	progress: RelationshipProgress,
	activityId: string,
): boolean => progress.activities.includes(activityId);
`,
		},
		{
			path: "src/components/character-header.tsx",
			content: `import { Row, Stack, Text, View, color } from "@rowcat/runtime";

export interface CharacterHeaderProps {
	name: string;
	role: string;
	intro: string;
	day: number;
}

export function CharacterHeader({
	name,
	role,
	intro,
	day,
}: CharacterHeaderProps) {
	return (
		<View
			style={{
				padding: 20,
				borderRadius: 18,
				backgroundColor: color("#171420"),
			}}
		>
			<Stack gap={12}>
				<Row gap={14} style={{ align: "center" }}>
					{/* Until an asset host is attached, the face slot holds one initial. */}
					<View
						style={{
							width: 52,
							height: 52,
							borderRadius: 26,
							justify: "center",
							align: "center",
							backgroundColor: color("#c2705a"),
						}}
					>
						<Text
							style={{
								color: color("#ffffff"),
								fontSize: 20,
								fontWeight: "bold",
							}}
						>
							{name.slice(0, 1)}
						</Text>
					</View>
					<Stack gap={4}>
						<Text
							style={{
								color: color("#f7f2ee"),
								fontSize: 18,
								fontWeight: "bold",
							}}
						>
							{name}
						</Text>
						<Text style={{ color: color("#9b8f88"), fontSize: 12 }}>
							{role}
						</Text>
					</Stack>
				</Row>
				<Text style={{ color: color("#cbbfb7"), fontSize: 14 }}>{intro}</Text>
				<Text style={{ color: color("#9b8f88"), fontSize: 12 }}>
					{"Day " + String(day)}
				</Text>
			</Stack>
		</View>
	);
}
`,
		},
		{
			path: "src/components/relationship-meter.tsx",
			content: `import { Progress, Row, Stack, Text, color } from "@rowcat/runtime";

export interface RelationshipMeterProps {
	trust: number;
	stageLabel: string;
	stageDescription: string;
}

/** The stage comes down derived from the value: this component does not recompute it. */
export function RelationshipMeter({
	trust,
	stageLabel,
	stageDescription,
}: RelationshipMeterProps) {
	return (
		<Stack gap={10}>
			<Row style={{ justify: "between", align: "center" }}>
				<Text
					style={{
						color: color("#f7f2ee"),
						fontSize: 15,
						fontWeight: "bold",
					}}
				>
					{stageLabel}
				</Text>
				<Text style={{ color: color("#e0a488"), fontSize: 13 }}>
					{String(trust) + "%"}
				</Text>
			</Row>
			<Progress
				value={Math.min(1, Math.max(0, trust / 100))}
				style={{ width: "100%" }}
			/>
			<Text style={{ color: color("#9b8f88"), fontSize: 12 }}>
				{stageDescription}
			</Text>
		</Stack>
	);
}
`,
		},
		{
			path: "src/components/activity-button.tsx",
			content: `import { Pressable, Row, Text, View, color } from "@rowcat/runtime";

export interface ActivityButtonProps {
	label: string;
	delta: number;
	done: boolean;
	onDo: () => void;
}

/**
 * A finished activity becomes a box that cannot be pressed: there is no place to press the same activity twice.
 * The whole row is the control because a separate button on the right would make as many same-named
 * buttons as there are activities, and screen readers could not tell them apart.
 */
export function ActivityButton({
	label,
	delta,
	done,
	onDo,
}: ActivityButtonProps) {
	if (done)
		return (
			<View
				style={{
					padding: 14,
					borderRadius: 14,
					backgroundColor: color("#1d1822"),
				}}
			>
				<Row gap={12} style={{ justify: "between", align: "center" }}>
					<Text style={{ color: color("#8a7f7a"), fontSize: 14 }}>{label}</Text>
					<Text style={{ color: color("#8a7f7a"), fontSize: 12 }}>Done</Text>
				</Row>
			</View>
		);
	return (
		<Pressable
			onPress={onDo}
			style={{
				padding: 14,
				borderRadius: 14,
				backgroundColor: color("#231b28"),
			}}
		>
			<Row gap={12} style={{ justify: "between", align: "center" }}>
				<Text style={{ color: color("#f2e8e2"), fontSize: 14 }}>{label}</Text>
				<Text style={{ color: color("#7fd3a0"), fontSize: 12 }}>
					{"+" + String(delta)}
				</Text>
			</Row>
		</Pressable>
	);
}
`,
		},
		{
			path: "src/main.tsx",
			content: `import {
	Screen,
	ScrollView,
	Stack,
	Text,
	color,
	useMemo,
	useStoryState,
} from "@rowcat/runtime";
import {
	ACTIVITIES,
	type Activity,
	CHARACTER,
	activityOf,
	stageOf,
} from "./activities";
import { ActivityButton } from "./components/activity-button";
import { CharacterHeader } from "./components/character-header";
import { RelationshipMeter } from "./components/relationship-meter";
import { doActivity, isDone, relationshipProgress } from "./state";

export default function App() {
	/** Relationship progress belongs to the playthrough: it continues after a restart. */
	const [progress, setProgress] = useStoryState(relationshipProgress);

	/** The stage is not saved: it derives from trust. */
	const stage = useMemo(() => stageOf(progress.trust), [progress.trust]);

	/** The log is derived too: only ids are saved and the sentences come from the table. */
	const history = useMemo(() => {
		const items: Activity[] = [];
		for (let index = progress.activities.length - 1; index >= 0; index -= 1) {
			const activity = activityOf(progress.activities[index]);
			if (activity !== null) items.push(activity);
		}
		return items;
	}, [progress.activities]);

	return (
		<Screen background={color("#0f0c13")}>
			<ScrollView style={{ padding: 20 }}>
				<Stack gap={20}>
					<CharacterHeader
						name={CHARACTER.name}
						role={CHARACTER.role}
						intro={CHARACTER.intro}
						day={progress.day}
					/>

					<RelationshipMeter
						trust={progress.trust}
						stageLabel={stage.label}
						stageDescription={stage.description}
					/>

					<Stack gap={10}>
						<Text
							style={{
								color: color("#9b8f88"),
								fontSize: 12,
								fontWeight: "medium",
							}}
						>
							Things to do today
						</Text>
						{ACTIVITIES.map((activity) => (
							<ActivityButton
								key={activity.id}
								label={activity.label}
								delta={activity.delta}
								done={isDone(progress, activity.id)}
								onDo={() => {
									setProgress((current) => doActivity(current, activity.id));
								}}
							/>
						))}
					</Stack>

					<Stack gap={8}>
						<Text
							style={{
								color: color("#9b8f88"),
								fontSize: 12,
								fontWeight: "medium",
							}}
						>
							Log
						</Text>
						{history.length === 0 ? (
							<Text style={{ color: color("#6b615c"), fontSize: 13 }}>
								Nothing done together yet.
							</Text>
						) : (
							history.map((activity) => (
								<Text
									key={activity.id}
									style={{ color: color("#cbbfb7"), fontSize: 13 }}
								>
									{"+ " + activity.log}
								</Text>
							))
						)}
					</Stack>
				</Stack>
			</ScrollView>
		</Screen>
	);
}
`,
		},
	],
};
