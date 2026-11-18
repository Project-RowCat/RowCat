/**
 * The page where a person approves `rowcat-mcp` signing in (features/device-approval).
 */
export const deviceApproval = {
	title: "Connect RowCat MCP",
	checking: "Checking the request…",
	review: {
		lead: "RowCat MCP on a computer is asking to sign in to your account.",
		codeLabel: "Check that this matches the code in your terminal.",
		grants:
			"Approving signs that computer in as you: the tool can do in RowCat what you can do while signed in.",
		drafts:
			"Your drafts stay encrypted. The sync key is handed over separately, from a connected device or with your recovery code.",
		disconnect:
			"To disconnect it later, sign it out under Account → Security → Active sessions.",
		warning:
			"Approve only if you just ran rowcat-mcp setup yourself. If someone sent you this link, deny it.",
		approve: "Approve",
		approving: "Approving…",
		deny: "Deny",
		denying: "Denying…",
	},
	approved: {
		title: "Approved",
		body: "Go back to your terminal. RowCat MCP finishes signing in there within a few seconds.",
	},
	denied: {
		title: "Denied",
		body: "Nothing was signed in. You can close this page.",
	},
	answered:
		"This request has already been answered. To connect again, run rowcat-mcp setup in your terminal.",
	otherAccount:
		"Another account opened this request first. Run rowcat-mcp setup again and open the new link while signed in to the account you want to connect.",
	invalid:
		"This code is unknown or has expired. Run rowcat-mcp setup again in your terminal for a new one.",
	recentLogin: {
		body: "For security, approving needs a recent sign-in. Sign in again and you'll come back here with the same code.",
		action: "Sign out and sign in again",
		working: "Signing out…",
	},
	failed: {
		network: "Couldn't reach RowCat. Check your connection and try again.",
		rateLimited: "Too many attempts. Wait a few minutes, then try again.",
		unknown: "Something went wrong. Please try again.",
		retry: "Try again",
	},
	enterCode: {
		body: "Enter the code your terminal shows after rowcat-mcp setup.",
		label: "Code",
		invalid: "Enter the 8-character code from your terminal.",
		continue: "Continue",
	},
};
