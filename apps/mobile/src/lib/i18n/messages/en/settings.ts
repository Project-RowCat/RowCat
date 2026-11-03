/**
 * The settings screens: the shell, the category list and the `General` category. The AI and
 * persona categories, the account theme and push are later slices and still carry their own copy.
 */
export const settings = {
	title: "Settings",
	navLabel: "Settings categories",
	category: {
		general: "General",
		ai: "AI",
		persona: "Persona",
	},
	categoryDescription: {
		general:
			"Manage how this app looks and this device's language, notifications and stored data.",
		ai: "Generation settings applied to new conversations by default. Applies only to this device.",
		persona:
			"Save the roles you play in conversations and pick them again across conversations.",
	},
	account: {
		label: "Manage account",
		hint: "Goes to the account screen",
	},
	/**
	 * A guest is **not bounced to sign-in**: the screen first says why nothing can be seen here. The
	 * sentence differs from the web's because this app has no "browser".
	 */
	guest: {
		title: "Sign-in required",
		description:
			"Theme colors, generation defaults and personas are stored on your account and this device. Screen brightness and language can be changed from the header even without signing in.",
	},
	/**
	 * The session could not be checked — **not a sign-out.** The stored session is unchanged; we simply
	 * could not ask, so the only action offered is asking again.
	 */
	unavailable: "Couldn't check your session. Please try again in a moment.",
	appearance: {
		sectionTitle: "Display",
		fieldLabel: "Screen brightness",
		fieldDescription:
			"Follow the system setting or pick the brightness yourself. Applies only to this device.",
		value: {
			system: "Follow system setting",
			light: "Light",
			dark: "Dark",
		},
	},
	language: {
		fieldLabel: "Language",
		fieldDescription:
			"The language RowCat is shown in. Follows your phone's language unless you pick one. Applies only to this device.",
		system: "Follow system setting",
	},
	localData: {
		sectionTitle: "This device's data",
		sectionDescription:
			"Conversations and drafts in progress are saved on this device.",
		rowLabel: "Clear stored data",
		rowDescription:
			"Clears the conversations and drafts stored on this device. Your account and other devices' data stay as they are.",
		action: "Clear data",
		pending: "Clearing…",
		confirmTitle: "Clear this device's data?",
		confirmDescription:
			"Only what's stored on this device is cleared, and it can't be undone.",
		removed:
			"Conversations and messages, memories, personas, drafts in progress, this device's generation settings, the remembered sync key and the connected AI provider API keys are cleared together.",
		kept: "Your account stays. Published stories and comments and other devices' data don't disappear with this. The API keys on your AI provider accounts aren't revoked either.",
		syncNote:
			"If you use sync across devices, the encrypted copy kept on the server remains. Enter the key on this device again and that copy comes back down.",
		afterNote:
			"After clearing you stay signed in, and this device's data starts over empty.",
		failure: "Couldn't clear the data. Please try again in a moment.",
	},
};
