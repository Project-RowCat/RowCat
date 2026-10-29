/**
 * runtimeTemplates copy.
 */
export const runtimeTemplates = {
	template: {
		blank: {
			name: "Blank",
			description:
				"Start with a single entry file, for when you want to shape the structure yourself.",
			demonstrates1: "The entry file",
			demonstrates2: "Screen layout",
			demonstrates3: "Text styles",
		},
		investigation: {
			name: "Investigation",
			description:
				"A screen where investigating gathers clues and opens a case. Progress is saved.",
			demonstrates1: "Clues and investigation records kept with useStoryState",
			demonstrates2: "Progress rules that can't express duplicates",
			demonstrates3: "Separating static content from saved ids",
			demonstrates4: "A completion state derived from saved values",
		},
		messenger: {
			name: "Messenger",
			description:
				"A conversation screen where the AI replies to messages you type. The conversation is saved.",
			demonstrates1: "Free input received with TextInput",
			demonstrates2: "RowCat AI called with useGeneration()",
			demonstrates3: "Screen useState and progress useStoryState",
			demonstrates4: "Your message stays on failure, with retry",
		},
		"relationship-profile": {
			name: "Relationship Profile",
			description:
				"A character screen where the relationship grows through activities. Progress is saved.",
			demonstrates1:
				"Relationship and activity records kept with useStoryState",
			demonstrates2: "Derived stages built with useMemo",
			demonstrates3: "An activity log drawn from saved ids",
			demonstrates4: "Activities that can be done only once",
		},
		"visual-novel": {
			name: "Visual Novel",
			description:
				"Scenes that branch on choices, with affection that carries on. Progress is saved.",
			demonstrates1: "Playthrough progress carried with useStoryState",
			demonstrates2: "Separating branching scene data from the screen",
			demonstrates3: "Endings derived from saved values",
			demonstrates4: "Screen useState and progress useStoryState",
		},
		"idol-debut": {
			name: "Eight Weeks to Debut",
			description:
				"Eight weeks until the debut evaluation. As the manager of five trainees, you plan each week and stay behind with one of them every evening to talk in your own words. What you say decides what you learn, and what you learn stays with the next debut group too.",
			demonstrates1: "Evenings where your own words decide what you learn",
			demonstrates2: "Pure rules that judge the player's sentence by its words",
			demonstrates3:
				"Putting an opened story into the instructions so the character answers in their own voice",
			demonstrates4:
				"Deterministic weekly rules that settle the three slots you plan",
			demonstrates5:
				"Five members' vocal, dance and expression, with condition and trust",
			demonstrates6:
				"Weekly events that branch on choices, and two midpoint reviews",
			demonstrates7:
				"Eight weeks in useStoryState and lasting stories in usePersistentState",
			demonstrates8: "Four endings decided by a single resolveEnding",
			demonstrates9: "A screen whose transitions say the scene changed",
		},
	},
	gallery: {
		fileCount_one: "{{count}} file",
		fileCount_other: "{{count}} files",
		confirm: "Start with {{name}}",
		title: "Create a runtime",
		description:
			"Start from a template or an empty project. Every file it creates can be edited.",
		all: "All",
		filterLabel: "Category filter",
		listLabel: "Templates",
		demonstrates: "What this template shows",
		files: "Files it creates",
		featured: "Featured",
		cancel: "Cancel",
		creating: "Creating the runtime…",
		failed: "Couldn't create the runtime. Please try again in a moment.",
		retry: "Try again",
	},
	category: {
		basic: "Basic",
		story: "Story",
		social: "Social",
		game: "Game",
	},
	complexity: {
		beginner: "Beginner",
		intermediate: "Intermediate",
		advanced: "In-depth example",
	},
};
