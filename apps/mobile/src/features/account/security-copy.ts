/**
 * Copy for the security section, all of it here.
 *
 * Separate from `account-copy.ts` for size (that file already holds the copy of four screens). The
 * rule is the same: this app's tests do not render screens, so copy must be a value for pure tests
 * to check, and a static scan for words that must not promise anything has a single place to look.
 *
 * Only the login-method names (`LOGIN_METHOD_LABEL`) stay in `account-copy.ts`: that vocabulary
 * table may have consumers outside this section, and moving it would read as security-only.
 */

export const SECURITY_SECTION_TITLE = "Security";

/**
 * The five subsections, in order (the order is the rule).
 *
 * ```text
 * email            this account's identity and contact channel   verify and move it
 * password         the key to one way in                         change or create it
 * login methods    the ways into this account                    add and remove
 * passkeys         a **list** of ways in                         rename, delete
 * active sessions  those already inside                          end them
 * ```
 *
 * Email is on top because it is the account's identity and contact channel, and every operation
 * below notifies that address. Passkeys not being **inside** login methods is the most important
 * decision in this layout: a login-method row is one provider record while passkeys are a list, so
 * merging puts "3 passkeys" beside "Google" and the row's delete cannot say what it deletes.
 */
export const SECURITY_SUBSECTION_TITLE = {
	email: "Email",
	password: "Password",
	loginMethods: "Sign-in methods",
	passkeys: "Passkey",
	sessions: "Active sessions",
} as const;

export const SECURITY_SUBSECTION_DESCRIPTION = {
	email:
		"Your sign-in identifier and the address that receives security notices.",
	loginMethods: "Ways you can sign in to this account.",
	passkeys:
		"Sign in with your device's fingerprint, face or PIN, without a password.",
	sessions: "Devices signed in to this account.",
} as const;

export const SECURITY_LOAD_FAILED =
	"Couldn't load your account details. Please try again.";
export const SECURITY_OFFLINE =
	"Waiting for a connection. Your account details load once connected.";
/** Says only that the held value is stale without erasing it; same sentence rule as the notifications screen. */
export const SECURITY_STALE =
	"Couldn't refresh your account details. This is the last confirmed value.";

/**
 * The action for the needs-fresh-login state; the sentence is in `security-error.ts`.
 *
 * Not `Try again`: asking again with the same session gets the same answer, so the one thing to do is
 * sign out and sign in again.
 */
export const REAUTH_ACTION_LABEL = "Sign out and sign in again";

/**
 * Unverified is not a fault. On deployments that do not require verification it is a normal state,
 * and on those that do, this person already signed in and sees this screen. So no destructive color
 * and no scare; give a concrete next action instead.
 */
export const EMAIL_UNVERIFIED_NOTE =
	"Open the verification email in your inbox to confirm this address is yours.";

export const EMAIL_RESEND_LABEL = "Send verification email";
export const EMAIL_RESENDING_LABEL = "Sending…";
/** The remaining seconds tick, wired like the web's same button. */
export const emailResendCooldownLabel = (seconds: number): string =>
	`Send again (${seconds}s)`;
/**
 * Means received, not verified. Writing "verified" would leave someone who believed it blocked at
 * the next sign-in.
 */
export const EMAIL_RESENT_NOTE =
	"We sent a verification email. Please check your inbox.";
export const EMAIL_RESEND_FAILED =
	"Couldn't resend the email. Please try again in a moment.";

export const EMAIL_CHANGE_LABEL = "Change email";
export const EMAIL_CHANGE_DIALOG_TITLE = "Change email";
export const EMAIL_CHANGE_DIALOG_DESCRIPTION =
	"A verification email goes to the new address. The address doesn't change until you open the link.";
export const EMAIL_CURRENT_LABEL = "Current email";
export const EMAIL_NEW_LABEL = "New email";
export const EMAIL_NEW_PLACEHOLDER = "new@example.com";
export const EMAIL_CHANGE_SUBMIT_LABEL = "Send verification email";
export const EMAIL_CHANGE_SUBMITTING_LABEL = "Sending…";
/**
 * The notice says first that nothing has changed. Writing "changed" would leave someone who
 * believed it blocked at the next sign-in.
 */
export const EMAIL_CHANGE_REQUESTED_NOTE =
	"We sent a confirmation email. The address doesn't change until you open every link in it.";
export const EMAIL_CHANGE_FAILED =
	"Couldn't start the email change. Please try again in a moment.";

export const PASSWORD_PRESENT_NOTE =
	"You can sign in with your email and password.";
/**
 * Does not name a provider. "Even without Google" points someone who signed up only with Apple at a
 * method they never used; which method they signed in with is already stated by the login-method
 * list below.
 */
export const PASSWORD_ABSENT_NOTE =
	"No password yet. Set one to sign in without social sign-in.";

export const PASSWORD_ACTION_LABEL = {
	change: "Change password",
	set: "Set password",
} as const;

export const PASSWORD_DIALOG_TITLE = {
	change: "Change password",
	set: "Set password",
} as const;

export const PASSWORD_CURRENT_LABEL = "Current password";
export const PASSWORD_NEW_LABEL = "New password";
export const PASSWORD_CONFIRM_LABEL = "Confirm new password";
export const PASSWORD_SUBMIT_LABEL = "Save";
export const PASSWORD_SUBMITTING_LABEL = "Saving…";

/**
 * The result states the operation that just finished, not one derived from the current mode. After
 * the first set, `hasPassword` turns true and the screen moves to `change` at that moment; choosing
 * by the current mode would tell someone who just **set** a password it was "changed".
 */
export const PASSWORD_RESULT_NOTE = {
	set: "Your password was set.",
	changed: "Your password was changed.",
} as const;

export const PASSWORD_CHANGE_FAILED =
	"Couldn't change the password. Please try again in a moment.";

export const LOGIN_METHOD_LINKED_LABEL = "Linked";
export const LOGIN_METHOD_UNLINKED_LABEL = "Not linked";
export const loginMethodLinkedSince = (date: string): string => `Since ${date}`;

export const LOGIN_METHOD_CONNECT_LABEL = "Link";
export const LOGIN_METHOD_CONNECTING_LABEL = "Redirecting…";
export const LOGIN_METHOD_DISCONNECT_LABEL = "Disconnect";
export const LOGIN_METHOD_DISCONNECTING_LABEL = "Disconnecting…";

/**
 * Generic sentence for a failed link, used only when there is no named reason.
 *
 * Used only when `linkAccountProvider` returns an explicit failure (`AuthErrorLike`). A round trip
 * that ended without error but did not connect the method gets the non-assertive sentence of
 * `connectOutcomeNotice`; telling someone who closed the sheet themselves "could not connect" makes
 * them doubt their account.
 */
export const LOGIN_METHOD_CONNECT_FAILED =
	"Couldn't link the sign-in method. Please try again in a moment.";

/**
 * For the last method, write the reason and what to do instead of a button. A disabled button does
 * not say why it cannot be pressed, so users read it as broken or keep pressing. Here there is
 * something to do: connect another method first.
 */
export const LOGIN_METHOD_LAST_NOTE =
	"This is your last sign-in method. Link another sign-in method first.";

/**
 * The credential row has no `Link` button; that operation belongs to the password section. Say where
 * to go instead of a dead button.
 */
export const LOGIN_METHOD_CREDENTIAL_HINT =
	"Setting a password above links it.";

/**
 * For a method that cannot be started in this app: state facts only.
 *
 * Never "coming soon". A method linked from another device still shows in this row and can be
 * removed, so that is stated too.
 */
export const LOGIN_METHOD_UNAVAILABLE_HINT = "Can't be linked in this app.";

export const disconnectDialogTitle = (label: string): string =>
	`Unlink ${label} sign-in?`;
export const disconnectDialogDescription = (
	label: string,
	remaining: string,
): string =>
	`You'll no longer be able to sign in with ${label}. After unlinking, you can sign in with ${remaining}. You can link it again later.`;

export const passkeyRegisteredAt = (date: string): string =>
	`Registered ${date}`;
export const PASSKEY_RENAME_LABEL = "Rename";
export const PASSKEY_DELETE_LABEL = "Delete";

export const PASSKEY_EMPTY_NOTE = "No passkeys registered.";
/**
 * Says why there is no registration button, and draws no dead button.
 *
 * Registering a passkey needs the platform credential ceremony, which this app's auth stack lacks
 * (the reasoning is in the `passkeys-section.tsx` header). A disabled button would be a "coming
 * soon" promise that this slice cannot keep.
 *
 * Instead it states what can be done here: view and delete passkeys registered on other devices.
 */
export const PASSKEY_REGISTER_UNAVAILABLE_NOTE =
	"New passkeys can't be added in this app. Passkeys registered on other devices can be renamed or deleted here.";

export const PASSKEY_LIST_FAILED =
	"Couldn't load your passkeys. Please try again.";
export const PASSKEY_LIST_OFFLINE =
	"There's no connection, so your passkeys couldn't be fetched.";
export const PASSKEY_LIST_STALE =
	"Couldn't refresh your passkeys. This is the last confirmed value.";

export const PASSKEY_RENAME_DIALOG_TITLE = "Rename passkey";
export const PASSKEY_NAME_LABEL = "Passkey name";
export const PASSKEY_RENAME_SUBMIT_LABEL = "Save";
export const PASSKEY_RENAME_SUBMITTING_LABEL = "Saving…";

export const passkeyDeleteTitle = (name: string): string => `Delete ${name}?`;
/**
 * States what can no longer be done and what stays as is. Deleting a credential only blocks future
 * sign-ins; open sessions stay. Without saying so, users read this button as signing a device out.
 */
export const PASSKEY_DELETE_DESCRIPTION =
	"You'll no longer be able to sign in with this passkey. Devices already signed in stay as they are.";
export const PASSKEY_DELETE_CONFIRM_LABEL = "Delete";

export const SESSION_CURRENT_LABEL = "This device";
export const SESSION_OTHER_LABEL = "Another device";
/** Writes only what is known; no invented device name or location. */
export const sessionTimesNote = (
	createdAt: string,
	expiresAt: string,
): string => `Signed in ${createdAt} · expires ${expiresAt}`;
export const SESSION_CURRENT_NOTE = "The device you're using now.";

export const SESSION_REVOKE_LABEL = "Sign out";
export const sessionsExpandLabel = (hidden: number): string =>
	`Show ${hidden} more devices`;

export const SESSIONS_REVOKE_OTHERS_LABEL = "Sign out all other devices";
export const SESSIONS_REVOKE_OTHERS_TITLE = "Sign out all other devices?";
/**
 * States the count and that this device stays. Without the first, the button does not say whether
 * it is one device or six; without the second, it cannot tell whether it signs me out too. People
 * do not press what they do not understand, yet the situation that needs it (a lost device) is when
 * they must.
 */
export const revokeOthersDescription = (count: number): string =>
	`${count} other devices will be signed out. This device stays signed in. Conversations and drafts stored on each device aren't deleted.`;
export const SESSIONS_REVOKE_OTHERS_CONFIRM_LABEL = "Sign out other devices";
export const SESSIONS_REVOKING_LABEL = "Signing out…";

export const SESSIONS_LIST_FAILED =
	"Couldn't load your sessions. Please try again.";
export const SESSIONS_LIST_OFFLINE =
	"There's no connection, so your sessions couldn't be fetched.";
export const SESSIONS_LIST_STALE =
	"Couldn't refresh your sessions. This is the last confirmed value.";
