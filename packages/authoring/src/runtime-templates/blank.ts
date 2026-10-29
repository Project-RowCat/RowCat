import type { RuntimeTemplate } from "./types.ts";

/**
 * `Blank`: one entry file. This template deliberately gives little. An author who wants their own
 * structure from the start is not handed someone else's folder layout. Instead it shows the minimum
 * that makes one screen work in this runtime. The entry file's default export is the app, and the
 * app starts from `Screen`.
 *
 * A counter used to sit here, a screen whose number went up on press. Its rationale was that the
 * first screen a new user sees should show that pressing changes something. That job moved to the
 * gallery: interaction demos now live in the featured templates. This slot keeps the promise its
 * name makes, an empty project.
 */
export const BLANK_TEMPLATE: RuntimeTemplate = {
	id: "blank",
	name: "Blank",
	description:
		"Start with a single entry file, for when you want to shape the structure yourself.",
	category: "basic",
	complexity: "beginner",
	demonstrates: ["The entry file", "Screen layout", "Text styles"],
	entry: "src/main.tsx",
	files: [
		{
			path: "src/main.tsx",
			content: `import { Screen, Stack, Text, color } from "@rowcat/runtime";

/**
 * The entry file's default export is this story's screen.
 * Make more files and import them here, and they become components as they are.
 */
export default function App() {
	return (
		<Screen background={color("#0b0d12")}>
			<Stack gap={8} style={{ padding: 24 }}>
				<Text
					style={{
						color: color("#f5f7fa"),
						fontSize: 22,
						fontWeight: "bold",
					}}
				>
					Hello, RowCat!
				</Text>
				<Text style={{ color: color("#8b93a7"), fontSize: 14 }}>
					Edit src/main.tsx to make a screen of your own for this story.
				</Text>
			</Stack>
		</Screen>
	);
}
`,
		},
	],
};
