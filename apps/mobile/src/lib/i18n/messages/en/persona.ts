/**
 * Personas (features/persona): the library in settings, the form, and the three states a room's role
 * can be in — read by the story start dialog and the room settings too.
 */
export const persona = {
	copy: {
		add: "New persona",
		deleteTitle: "Delete this persona?",
		deleteConfirm: "Delete",
		deleteNotice:
			"Conversations already started with this persona stay as they are.",
		guest:
			"Personas are stored on your account and this device. Sign in to see the roles you saved.",
		unavailable: "Couldn't check your session. Please try again in a moment.",
		storageError: "Couldn't open this device's data. Personas can't be loaded.",
		readError: "Couldn't load personas. Please try again in a moment.",
		saveFailed: "Couldn't save the persona. Please try again.",
		deleteFailed: "Couldn't delete the persona. Please try again.",
		applyFailed:
			"Couldn't change this conversation's persona. Please try again.",
		storyDefault: "Story's default persona",
		none: "Not set",
		storyDefaultHint: "Uses the role the story suggests",
		emptyTitle: "No saved personas",
		emptyBody:
			"A persona is the role you play in a conversation. Save the names and settings you use often to pick them again in any conversation.",
		name: "Name",
		description: "Description",
		save: "Save",
		editTitle: "Edit persona",
		newTitle: "New persona",
		deleteThis: "Delete this persona",
	},
	edit: "Edit {{name}}",
	delete: "Delete {{name}}",
	deleteDescription: "The {{name}} persona disappears from your library.",
	nameEmpty: "Please enter a name.",
	nameTooLong: "Names can be up to {{max}} characters.",
	descriptionTooLong: "Descriptions can be up to {{max}} characters.",
	storySummary: "{{name}} · {{label}}",
};
