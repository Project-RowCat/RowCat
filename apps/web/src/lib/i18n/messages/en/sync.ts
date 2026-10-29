/**
 * The sync section under Account → Data and its dialogs (features/sync).
 */
export const sync = {
	failure: {
		autoSyncToggle:
			"Couldn't save the automatic sync setting. Please try again in a moment.",
		recoveryRotate:
			"Couldn't issue a new recovery code. Your current code still works.",
		forgetDevice:
			"Couldn't stop trusting this device. Please try again in a moment.",
	},
	error: {
		sync_quota_exceeded: "Sync storage is full.",
		sync_keyring_proof_invalid: "This device's key no longer matches.",
		account_restricted: "A restricted account can't upload new changes.",
		login_required: "Please sign in again.",
		fallback: "Sync failed. Please try again in a moment.",
	},
	section: {
		preparing: "Preparing…",
		autoSyncLabel: "Automatic sync",
		autoSyncNote:
			"Syncs changes on this device automatically. This setting is saved separately on each device.",
		setup: "Set up sync",
		connectFromOtherDevice: "Connect from another device",
		useRecoveryCode: "Use recovery code",
		startOver: "Start over",
		syncNow: "Sync now",
		connectNewDevice: "Connect a new device",
		rotateRecoveryCode: "Reissue recovery code",
		forgetDevice: "Stop trusting this device",
		forgetNote:
			"This applies only to this device. It doesn't block other devices, doesn't sign you out, and doesn't erase data stored on the server. Conversations and drafts on this device stay as they are.",
		recoveryTitleDefault: "Recovery code",
		recoveryTitleSetup: "Write down your recovery code",
		recoveryTitleRotated: "New recovery code",
	},
	status: {
		checking: "Checking…",
		disabledTitle: "Sync isn't set up.",
		disabledBody:
			"Once set up, your conversations and drafts continue on your other devices, encrypted. The server can't read them.",
		lockedTitle: "Locked on this device.",
		lockedBody:
			"Connect from another device that's already syncing, or enter your recovery code to continue on this device.",
		syncing: "Syncing…",
		errorBody:
			"Conversations and drafts on this device are intact. You can try again.",
		lastSynced: "Last synced: {{when}}",
		neverSynced: "Not synced yet.",
	},
	auto: {
		off: "Automatic sync is off.",
		offline: "Waiting while offline.",
		backoff: "Waiting for a connection. Will try again shortly.",
		blocked: "Please check sync again.",
		on: "Changes sync automatically.",
	},
	recoverySummary: {
		count_one: "{{count}} item",
		count_other: "{{count}} items",
	},
	recoveryCode: {
		shownOnce:
			"This code is shown only this once. You'll need it to open sync on another device.",
		serverUnaware:
			"The server doesn't know this code. If you lose it and have no trusted device left, <strong>the sync data stored on the server can never be read again.</strong>",
		cannotRecover:
			"We can't recover it for you either. Conversations and drafts on this device stay as they are.",
		acknowledge: "I've written the code down somewhere safe.",
		copyFailed:
			"Couldn't copy. Please select the code above and copy it yourself.",
		done: "I've saved it",
	},
	unlock: {
		title: "Unlock",
		description: "Enter the recovery code you received when you set up sync.",
		label: "Recovery code",
		submit: "Unlock",
		mistyped:
			"Please check the recovery code again. Some characters are wrong.",
		wrongCode:
			"This code can't unlock sync. Please check whether it's a different code.",
	},
	pair: {
		title: "Connect from another device",
		description:
			"Enter this code on a device that already uses sync to continue syncing here without a recovery code.",
		creating: "Creating a code…",
		instructions:
			"On your existing device, enter this code under <strong>Account → Data → Connect a new device</strong>. This screen moves on automatically once it's approved.",
		timeLeft: "Time left",
		pairedTitle: "Sync is open on this device.",
		pairedBody:
			"You'll soon see the conversations and drafts from your other devices.",
		expiredTitle: "The code has expired.",
		expiredBody: "Start again to get a new code.",
		startFailed: "Couldn't start connecting. Please try again in a moment.",
		pollFailed: "Couldn't check the connection. Please check your network.",
		wrongAccount:
			"The key received doesn't belong to this account. Nothing was saved on this device.",
		expiredOrCancelled:
			"The connection expired or was cancelled. Please start again.",
		incomplete:
			"Couldn't finish connecting. Check the code and try again from the start.",
		loginRequired: "Please sign in again.",
	},
	approve: {
		title: "Connect a new device",
		description: "Enter the code shown on the new device's screen.",
		approvedTitle: "Approved.",
		approvedBody: "Sync will open on the new device shortly.",
		label: "Connection code",
		warning:
			"Approving lets that device read this account's conversations and drafts. It can't be undone remotely after approval.",
		submit: "Approve",
		submitting: "Approving…",
		malformed: "Please check the code again. It's 16 characters.",
		notFound: "No device is waiting with that code. It may have expired.",
		alreadyApproved: "This code has already been approved.",
		restricted: "A restricted account can't connect new devices.",
		locked: "This device is locked, so it can't approve.",
		failed: "Couldn't approve. Please try again in a moment.",
	},
	reset: {
		failed:
			"Couldn't clear sync data on the server. Please try again in a moment.",
		recentLogin:
			"For security, a recent sign-in is required. Please sign in again and try.",
		title: "Start sync over from the beginning?",
		description:
			"Sync data stored on the server and this device's key will be deleted. Conversations and drafts on this device stay, and they upload again with a new key once you set up sync again. Other devices' data stays too; those devices will need to set up sync again the next time they open.",
		submit: "Start over",
		pending: "Working…",
	},
};
