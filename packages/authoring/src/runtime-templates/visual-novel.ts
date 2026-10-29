import type { RuntimeTemplate } from "./types.ts";

/**
 * Visual Novel covers branching dialogue and progression that carries across playthroughs. It
 * teaches:
 * - Separation of data and screen. Scenes are a plain table in story.ts; the screen reads it.
 * - Progression lifetime. Scene, affection, and choice history live in useStoryState and survive
 *   a preview restart.
 * - The boundary. Whether a panel is open is a screen concern, so it uses useState and is lost
 *   with the session. It was once the recommended template. The recommendation moved to the
 *   flagship because the first impression question changed from what you learn to what you can
 *   make.
 */
export const VISUAL_NOVEL_TEMPLATE: RuntimeTemplate = {
	id: "visual-novel",
	name: "Visual Novel",
	description:
		"Scenes that branch on choices, with affection that carries on. Progress is saved.",
	category: "story",
	complexity: "intermediate",
	demonstrates: [
		"Playthrough progress carried with useStoryState",
		"Separating branching scene data from the screen",
		"Endings derived from saved values",
		"Screen useState and progress useStoryState",
	],
	entry: "src/main.tsx",
	files: [
		{
			path: "src/story.ts",
			content: `/**
 * The scene table: **static content** the screen only reads.
 * What is saved is not these values but only "which scene we are in now" (state.ts).
 */

export const STORY_TITLE = "After School";

export interface SceneChoice {
	id: string;
	label: string;
	/** The scene this choice leads to. A key of SCENES. */
	next: string;
	/** What this choice adds to affection. Can be negative. */
	trust: number;
}

export interface Scene {
	chapter: string;
	/** Written in the stage slot, so a scene stands even without assets. */
	place: string;
	speaker: string;
	line: string;
	/** Empty means the last scene. */
	choices: readonly SceneChoice[];
}

export const FIRST_SCENE = "library";

export const SCENES: Record<string, Scene> = {
	library: {
		chapter: "Chapter 1",
		place: "School library, third floor",
		speaker: "Sena",
		line: "I saw something strange in the library yesterday. In the third-floor reading room, a book lay open at an empty seat.",
		choices: [
			{ id: "ask", label: "What happened?", next: "curious", trust: 6 },
			{ id: "shrug", label: "It's probably nothing.", next: "dismissive", trust: -4 },
		],
	},
	curious: {
		chapter: "Chapter 1",
		place: "School library, third floor",
		speaker: "Sena",
		line: "I knew you'd ask. That book's checkout record has been empty for ten years.",
		choices: [
			{ id: "together", label: "Let's go look together.", next: "stakeout", trust: 9 },
			{
				id: "librarian",
				label: "Let's ask the librarian first.",
				next: "cautious",
				trust: 3,
			},
		],
	},
	dismissive: {
		chapter: "Chapter 1",
		place: "School library, third floor",
		speaker: "Sena",
		line: "…Right. Maybe I'm just being jumpy.",
		choices: [
			{ id: "listen", label: "No, keep telling me.", next: "curious", trust: 5 },
		],
	},
	cautious: {
		chapter: "Chapter 1",
		place: "Hallway outside the library",
		speaker: "Sena",
		line: "I asked. She says that shelf hasn't been used in years. So who left the book open?",
		choices: [
			{ id: "confirm", label: "Then let's check it ourselves.", next: "stakeout", trust: 7 },
		],
	},
	stakeout: {
		chapter: "Chapter 2",
		place: "Twenty minutes before closing",
		speaker: "Sena",
		line: "Let's look right before closing today. That seat will still be the same.",
		choices: [
			{ id: "key", label: "I'll try to get the key.", next: "opened", trust: 8 },
			{ id: "stay", label: "Don't go alone.", next: "opened", trust: 11 },
		],
	},
	opened: {
		chapter: "Chapter 2",
		place: "Outside the locked reading room",
		speaker: "Sena",
		line: "We made it to the door. I think we have to see the rest together.",
		choices: [],
	},
};

/** Unknown scene ids fold to the start, because saved progress outlives the code. */
export function sceneOf(id: string): Scene {
	return SCENES[id] ?? SCENES[FIRST_SCENE];
}

export interface Ending {
	title: string;
	line: string;
}

/**
 * The ending is **not saved**: it is derived from affection.
 * Saving it would give the same progress two values, and the screen could not explain the moment they diverge.
 */
export function endingFor(trust: number): Ending {
	if (trust >= 60)
		return {
			title: "The case opened",
			line: "Sena trusted you with the key. Next is Thursday.",
		};
	if (trust >= 40)
		return {
			title: "You decided to go together",
			line: "Sena decided to wait by the door. The key hasn't come up yet.",
		};
	return {
		title: "You decided to go alone",
		line: "Sena never brought up the key.",
	};
}
`,
		},
		{
			path: "src/state.ts",
			content: `import { defineStoryState } from "@rowcat/runtime";
import { FIRST_SCENE, type SceneChoice } from "./story";

/**
 * Saved state **belongs to this playthrough**. It continues after a runtime restart,
 * while the screen's useState disappears with the session. The definition is made once at the module top level.
 */

export interface StoryProgress {
	/** The current scene's id. story.ts holds the scene's content. */
	scene: string;
	trust: number;
	/** The text of the choices made so far. The screen draws it as is. */
	choices: string[];
}

const OPENING: StoryProgress = {
	scene: FIRST_SCENE,
	trust: 42,
	choices: [],
};

export const storyProgress = defineStoryState<StoryProgress>({
	key: "story",
	version: 1,
	initial: OPENING,
});

/** One initial state: the definition's initial is not written twice. */
export function openingProgress(): StoryProgress {
	return { scene: OPENING.scene, trust: OPENING.trust, choices: [] };
}

const clamp = (value: number): number => Math.min(100, Math.max(0, value));

/**
 * How one choice changes progress: the rule lives here, not in the screen.
 * It **builds a new value** rather than editing the current one. Putting the same object back into
 * saved state does nothing.
 */
export function chooseOption(
	progress: StoryProgress,
	choice: SceneChoice,
): StoryProgress {
	return {
		scene: choice.next,
		trust: clamp(progress.trust + choice.trust),
		choices: [...progress.choices, choice.label],
	};
}
`,
		},
		{
			path: "src/components/choice-button.tsx",
			content: `import { Pressable, Text, color } from "@rowcat/runtime";

export interface ChoiceButtonProps {
	label: string;
	onSelect: () => void;
}

/** One choice row. Pressable instead of Button, to set the surface and text directly. */
export function ChoiceButton({ label, onSelect }: ChoiceButtonProps) {
	return (
		<Pressable
			onPress={onSelect}
			style={{
				padding: 14,
				borderRadius: 12,
				backgroundColor: color("#1b2233"),
			}}
		>
			<Text style={{ color: color("#cdd8ef"), fontSize: 15 }}>{label}</Text>
		</Pressable>
	);
}
`,
		},
		{
			path: "src/components/dialogue-box.tsx",
			content: `import { type RuntimeNode, Stack, Text, color } from "@rowcat/runtime";

export interface DialogueBoxProps {
	speaker: string;
	line: string;
	/** Affection and the choices come in here. */
	children?: RuntimeNode;
}

export function DialogueBox({ speaker, line, children }: DialogueBoxProps) {
	return (
		<Stack
			gap={14}
			style={{
				padding: 20,
				borderRadius: 18,
				backgroundColor: color("#121722"),
			}}
		>
			<Text
				style={{ color: color("#7fb2ff"), fontSize: 13, fontWeight: "bold" }}
			>
				{speaker}
			</Text>
			<Text style={{ color: color("#e8edf7"), fontSize: 16 }}>{line}</Text>
			{children}
		</Stack>
	);
}
`,
		},
		{
			path: "src/components/trust-meter.tsx",
			content: `import { Progress, Row, Stack, Text, color } from "@rowcat/runtime";

export interface TrustMeterProps {
	/** 0 to 100. Folding to 0 to 1 is this component's job. */
	value: number;
}

export function TrustMeter({ value }: TrustMeterProps) {
	return (
		<Stack gap={8}>
			<Row style={{ justify: "between", align: "center" }}>
				<Text
					style={{
						color: color("#8b96ad"),
						fontSize: 12,
						fontWeight: "medium",
					}}
				>
					Affection
				</Text>
				<Text style={{ color: color("#7fb2ff"), fontSize: 12 }}>
					{value + "%"}
				</Text>
			</Row>
			<Progress
				value={Math.min(1, Math.max(0, value / 100))}
				style={{ width: "100%" }}
			/>
		</Stack>
	);
}
`,
		},
		{
			path: "src/main.tsx",
			content: `import {
	Pressable,
	Row,
	Screen,
	ScrollView,
	Stack,
	Text,
	View,
	color,
	useState,
	useStoryState,
} from "@rowcat/runtime";
import { ChoiceButton } from "./components/choice-button";
import { DialogueBox } from "./components/dialogue-box";
import { TrustMeter } from "./components/trust-meter";
import { chooseOption, openingProgress, storyProgress } from "./state";
import { STORY_TITLE, endingFor, sceneOf } from "./story";

export default function App() {
	/** Playthrough progress: continues after a runtime restart. */
	const [progress, setProgress] = useStoryState(storyProgress);
	/** Whether this panel is open is the screen's business, so it disappears with the session. */
	const [historyOpen, setHistoryOpen] = useState(false);

	const scene = sceneOf(progress.scene);
	const ending = scene.choices.length === 0 ? endingFor(progress.trust) : null;

	return (
		<Screen background={color("#0a0e17")}>
			<Stack style={{ height: "100%" }}>
				<Row style={{ padding: 20, justify: "between", align: "center" }}>
					<Text
						style={{
							color: color("#e8edf7"),
							fontSize: 13,
							fontWeight: "bold",
						}}
					>
						{STORY_TITLE}
					</Text>
					<Text style={{ color: color("#5b6884"), fontSize: 12 }}>
						{scene.chapter}
					</Text>
				</Row>

				<ScrollView style={{ grow: 1, padding: 20 }}>
					<Stack gap={18}>
						<View
							style={{
								height: 132,
								borderRadius: 18,
								justify: "center",
								align: "center",
								backgroundColor: color("#111a2b"),
							}}
						>
							<Text
								style={{
									color: color("#4d5f80"),
									fontSize: 12,
									fontWeight: "medium",
								}}
							>
								{scene.place}
							</Text>
						</View>

						<DialogueBox speaker={scene.speaker} line={scene.line}>
							<Stack gap={14}>
								<TrustMeter value={progress.trust} />
								{ending === null ? (
									<Stack gap={10}>
										{scene.choices.map((choice) => (
											<ChoiceButton
												key={choice.id}
												label={choice.label}
												onSelect={() => {
													setProgress((current) =>
														chooseOption(current, choice),
													);
												}}
											/>
										))}
									</Stack>
								) : (
									<Stack gap={12}>
										<Text
											style={{
												color: color("#f2f6ff"),
												fontSize: 15,
												fontWeight: "bold",
											}}
										>
											{ending.title}
										</Text>
										<Text
											style={{ color: color("#9aa8c2"), fontSize: 14 }}
										>
											{ending.line}
										</Text>
										<ChoiceButton
											label="Start over"
											onSelect={() => {
												setProgress(() => openingProgress());
											}}
										/>
									</Stack>
								)}
							</Stack>
						</DialogueBox>

						<Stack gap={10}>
							<Pressable
								onPress={() => {
									setHistoryOpen((open) => !open);
								}}
								style={{
									padding: 12,
									borderRadius: 12,
									backgroundColor: color("#111722"),
								}}
							>
								<Text style={{ color: color("#7f8ba3"), fontSize: 13 }}>
									{historyOpen ? "Hide choice history" : "Show choice history"}
								</Text>
							</Pressable>
							{historyOpen &&
								(progress.choices.length === 0 ? (
									<Text style={{ color: color("#5f6a7e"), fontSize: 13 }}>
										Nothing chosen yet.
									</Text>
								) : (
									<Stack gap={6}>
										{progress.choices.map((label, index) => (
											<Text
												key={String(index) + label}
												style={{
													color: color("#aeb9cc"),
													fontSize: 13,
												}}
											>
												{String(index + 1) + ". " + label}
											</Text>
										))}
									</Stack>
								))}
						</Stack>
					</Stack>
				</ScrollView>
			</Stack>
		</Screen>
	);
}
`,
		},
	],
};
