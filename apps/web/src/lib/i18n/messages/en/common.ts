/**
 * Words many screens share: actions on buttons and states every list has. A word belongs here only
 * when it means the same thing everywhere it appears; a `Close` that closes a dialog and one that ends
 * a session are different keys in their own namespaces.
 */
export const common = {
	actions: {
		cancel: "Cancel",
		close: "Close",
		confirm: "OK",
		copy: "Copy",
		copied: "Copied",
		retry: "Try again",
		save: "Save",
		delete: "Delete",
	},
	time: {
		justNow: "Just now",
	},
	state: {
		loading: "Loading…",
		checking: "Checking…",
	},
};
