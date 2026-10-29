/**
 * The persona library and its dialogs (features/persona).
 */
export const persona = {
	nameEmpty: "Please enter a name.",
	nameTooLong: "A name can be up to {{max}} characters.",
	descriptionTooLong: "A description can be up to {{max}} characters.",
	saveFailed: "Couldn't save the persona. Please try again.",
	deleteFailed: "Couldn't delete the persona. Please try again.",
	applyFailed: "Couldn't change this conversation's persona. Please try again.",
	deleteNotice:
		"Conversations already started with this persona stay as they are.",
	storyDefault: "Story's default persona",
	none: "Not set",
	storyDefaultHint: "Uses the role the story suggests",
	emptyTitle: "No saved personas",
	emptyBody:
		"A persona is the role you play in a conversation. Save the names and settings you use often to pick them again in any conversation.",
	editor: {
		name: "Name",
		namePlaceholder: "Alex",
		description: "Description",
		descriptionPlaceholder:
			"A college student. Quiet, and loves mystery novels.",
		saving: "Saving…",
	},
	dialog: {
		editTitle: "Edit persona",
		newTitle: "New persona",
		description:
			"The role you play in a conversation. The name is used for the speaker and `{{userToken}}`; the description goes into the setting the model reads.",
		save: "Save",
		create: "Create",
		deleteTitle: "Delete this persona?",
		deleteBody:
			"<name>{{name}}</name> will be removed from your library. {{notice}}",
		deleting: "Deleting…",
	},
	library: {
		unavailableTitle: "Can't open personas",
		unavailableBody:
			"Personas are saved on this device per account. They'll be there when you sign in again.",
		signIn: "Sign in",
		create: "New persona",
		createFirst: "Create your first persona",
		manage: "Manage persona {{name}}",
		edit: "Edit",
		loading: "Loading personas",
	},
	page: {
		title: "Personas",
		description:
			"Manage the roles you play in conversations. Saved here, they can be picked again in any conversation.",
	},
};
