/**
 * Copy for the account screen: profile, security, login methods, passkeys, data and deletion.
 */
export const account = {
	accountDeletionGuide: {
		accountDeletionGuide: "Account deletion guide",
		howToDelete: "How to delete",
		signInToRowcat: "Sign in to RowCat.",
		goToAccountFromThe: "Go to Account from the menu at the top right.",
		pressDeleteAccountInThe:
			"Press Delete account in the danger zone at the bottom of the screen.",
		reviewTheNoticeAndIf:
			"Review the notice and, if the account uses a password, enter your current password.",
		anAccountThatUsesOnly:
			"An account that uses only social sign-in has no password, so it can only be deleted after a recent sign-in. If it's refused, sign out, sign in again and try.",
		deletionHappensImmediatelyAndCan:
			"Deletion happens immediately and can't be undone.",
		ifAScreenAskingFor:
			"If a screen asking for your date of birth or waiting for guardian consent is showing, you can press Delete account right there without going to Account.",
		whatGetsDeleted: "What gets deleted",
		yourAccountAndSignIn:
			"Your account and sign-in details (email, password, linked social accounts)",
		signInSessionsOnEvery: "Sign-in sessions on every device",
		memberInformationAndProfile: "Member information and profile",
		favoritesFollowsAndBlocks: "Favorites, follows and blocks",
		notificationsYouReceivedWhereYou:
			"Notifications you received — where you appear in another member's notifications, those remain but your name and the link to your profile disappear.",
		dataKeptForSyncBetween:
			"Data kept for sync between devices — the server keeps only ciphertext, and that is deleted too",
		conversationsAndDraftsSavedOn:
			"Conversations and drafts saved on the device used for deletion",
		theSyncKeyRememberedOn:
			"The sync key remembered on the device used for deletion",
		whatMayRemain: "What may remain",
		publiclyPublishedStoriesTheyMay:
			"Publicly published stories — they may remain with the author details removed. The link between the story and your account is deleted, along with the creator name and profile link.",
		conversationsAndDraftsAlreadySaved:
			"Conversations and drafts already saved on other devices — see below.",
		dataLeftOnOtherDevices: "Data left on other devices",
		rowcatConversationsAndDraftsAre:
			"RowCat conversations and drafts are stored on the devices you use, not on the server. Deleting the account erases the server's data and the deleting device's data, but copies already saved on other devices can't be erased remotely.",
		thoseDevicesAreSignedOut:
			"Those devices are signed out once the account is gone. To remove the remaining data, clear the browser's site data or delete the app on that device.",
		ifYouCanTSign: "If you can't sign in",
		accountDeletionRequiresConfirmingIt:
			"Account deletion requires confirming it's you, so it can only be done while signed in. If you forgot your password, recover your sign-in first.",
		ifYouCanTSign2:
			"If you can't sign in by any method, ask this service's operator to delete the account.",
		howItDiffersFromOther: "How it differs from other actions",
		signOut: "Sign out",
		theAccountStaysAndThis:
			"The account stays, and this device's conversations and drafts aren't erased. Sign in again with the same account to continue where you left off.",
		deleteAccount: "Delete account",
		theAccountItselfDisappearsIt:
			"The account itself disappears. It can't be undone, and signing up again the same way doesn't bring back earlier data.",
	},
	deleteAccountDialog: {
		deleteYourAccount: "Delete your account?",
		thisCanTBeUndone: "This can't be undone.",
		whatGetsDeleted: "What gets deleted",
		yourAccountAndSignIn: "Your account and sign-in details",
		conversationsAndDraftsSavedOn:
			"Conversations and drafts saved on this device",
		dataKeptForSyncBetween: "Data kept for sync between devices",
		favoritesFollowsAndBlocks: "Favorites, follows and blocks",
		whatMayRemain: "What may remain",
		publiclyPublishedStoriesTheyMay:
			"Publicly published stories — they may remain with the author details removed",
		conversationsAndDraftsAlreadySaved:
			"Conversations and drafts already saved on other devices — they disappear once you sign out or clear app data there",
		currentPassword: "Current password",
		forSecurityDeletionOnlyWorks:
			"For security, deletion only works after a recent sign-in. If it's refused, sign out, sign in again and try.",
		cancel: "Cancel",
		deletingAccount: "Deleting account…",
		deleteAccount: "Delete account",
	},
	dataSection: {
		data: "Data",
		conversationsAndDraftsInProgress:
			"Conversations and drafts in progress are saved on this device.",
		signingOutDoesnTErase:
			"Signing out doesn't erase this device's data; sign in again with the same account to continue.",
		syncBetweenDevices: "Sync between devices",
		conversationsAndDraftsAreEncrypted:
			"Conversations and drafts are encrypted on this device and continue on your other devices. The server stores only ciphertext and can't read it. Changes from other devices arrive when you reopen this device or return to the screen.",
	},
	twoFactorDialogs: {
		signingInWithAPassword:
			"Signing in with a password now also asks for your authenticator app code. If you lose the app, sign in with a saved backup code and set it up again.",
		scanTheQrCodeWith:
			"Scan the QR code with your authenticator app or enter the key yourself, then enter the six digits the app shows. It turns on once the code is confirmed.",
		turningItOffLetsYou:
			"Turning it off lets you sign in with just a password. The authenticator registration and backup codes stop working.",
		oneTimeCodesForSigning:
			"One-time codes for signing in if you lose your authenticator app. Each code works once.",
		signingInWithAPassword2:
			"Signing in with a password will also ask for a code from your authenticator app. First, confirm your password.",
		iVeWrittenTheBackup:
			"I've written the backup codes down somewhere safe. They can't be shown again after this window closes.",
		gettingTenNewCodesMakes:
			"Getting ten new codes makes all your current backup codes stop working.",
		theseAreYourNewBackup:
			"These are your new backup codes. They can't be shown again after this window closes.",
		ifYouCanTScan: "If you can't scan the QR code, enter this key",
		qrCodeToScanWith: "QR code to scan with your authenticator app",
		twoFactorAuthenticationIsOn: "Two-factor authentication is on",
		getNewBackupCodes: "Get new backup codes",
		couldnTCopy: "Couldn't copy",
		turnOnTwoFactorAuthentication: "Turn on two-factor authentication",
		turnOffTwoFactorAuthentication: "Turn off two-factor authentication",
		codeFromYourAuthenticatorApp: "Code from your authenticator app",
		iVeWrittenThemDown: "I've written them down",
		currentPassword: "Current password",
		copied: "Copied",
		getNewCodes: "Get new codes",
		copyAll: "Copy all",
		close: "Close",
		cancel: "Cancel",
		next: "Next",
		turnOn: "Turn on",
		turnOff: "Turn off",
	},
	sessionsSection: {
		forSecuritySignOutAnd:
			"For security, sign out and sign in again to refresh this list.",
		forSecuritySignOutAnd2:
			"For security, sign out and sign in again to see this list.",
		youReNotConnectedRight:
			"You're not connected right now. The session list reloads once you're connected.",
		couldnTRefreshTheCurrent: "Couldn't refresh the current session list.",
		loadingSessions: "Loading sessions…",
		thisIsTheDeviceYou: "This is the device you're using",
		signOutAllOtherDevices: "Sign out all other devices",
		loading: "Loading…",
		tryAgain: "Try again",
		thisDevice: "This device",
		anotherDevice: "Another device",
		signOut: "Sign out",
		showMoreDevices: "Show {{count}} more devices",
		signedInExpires: "Signed in {{signedIn}} · expires {{expires}}",
	},
	passkeyDialogs: {
		giveItANameYou:
			"Give it a name you'll recognize. It's only used to tell entries apart in the list.",
		thisCanTBeUndone:
			"This can't be undone. To use the same device again, register it anew.",
		afterNamingItConfirmWith:
			"After naming it, confirm with this device's unlock method (fingerprint, face or PIN).",
		signingInWithThisPasskey:
			"Signing in with this passkey stays the same; only the name in the list changes.",
		otherSignInMethodsSuch:
			"Other sign-in methods, such as your password and social sign-in, stay as they are.",
		deleteThisPasskey: "Delete this passkey?",
		checkingTheDevice: "Checking the device…",
		renamePasskey: "Rename passkey",
		saving: "Saving…",
		deleting: "Deleting…",
		addAPasskey: "Add a passkey",
		deletePasskey: "Delete passkey",
		name: "Name",
		cancel: "Cancel",
		continue: "Continue",
		save: "Save",
		noLongerSignIn: "<name>{{name}}</name> can no longer be used to sign in.",
	},
	securitySection: {
		youReNotConnectedRight:
			"You're not connected right now. Account details reload once you're connected.",
		evenIfYourPasswordLeaks:
			"Even if your password leaks, no one gets in without your authenticator app code.",
		signInWithYourDevice:
			"Sign in with your device's fingerprint, face or PIN, without a password.",
		yourSignInIdentifierAnd:
			"Your sign-in identifier and the address that receives security notices.",
		waysYouCanSignIn: "Ways you can sign in to this account.",
		devicesSignedInToThis: "Devices signed in to this account.",
		couldnTLoadAccountDetails: "Couldn't load account details.",
		loadingAccountDetails: "Loading account details…",
		loading: "Loading…",
		accountCreated: "Account created",
		twoFactorAuthentication: "Two-factor authentication",
		signInMethods: "Sign-in methods",
		tryAgain: "Try again",
		activeSessions: "Active sessions",
		password: "Password",
		email: "Email",
		passkeys: "Passkeys",
		security: "Security",
	},
	passkeysSection: {
		noPasskeysYetAddOne:
			"No passkeys yet. Add one to sign in with this device's fingerprint, face or PIN, without a password.",
		thisBrowserDoesnTSupport:
			"This browser doesn't support passkeys, so new ones can't be added. You can still delete entries in the list above.",
		noPasskeysYetThisBrowser:
			"No passkeys yet. This browser doesn't support passkeys, so one can't be added here.",
		forSecuritySignOutAnd:
			"For security, sign out and sign in again to refresh this list.",
		youReNotConnectedRight:
			"You're not connected right now. The passkey list reloads once you're connected.",
		forSecuritySignOutAnd2:
			"For security, sign out and sign in again to see this list.",
		couldnTRefreshTheCurrent: "Couldn't refresh the current passkey list.",
		loadingPasskeys: "Loading passkeys…",
		loading: "Loading…",
		addAPasskey: "Add a passkey",
		tryAgain: "Try again",
		rename: "Rename",
		delete: "Delete",
		registered: "Registered {{date}}",
	},
	passkeyError: {
		forSecurityARecentSign:
			"For security, a recent sign-in is required. Sign out, sign in again and try.",
		aPasskeyIsAlreadyRegistered:
			"A passkey is already registered on this device. Check the list below.",
		couldnTRegisterThePasskey:
			"Couldn't register the passkey. Check your connection and try again.",
		couldnTSendTheRequest:
			"Couldn't send the request. Check your connection and try again.",
		couldnTRenameThePasskey:
			"Couldn't rename the passkey. Please try again in a moment.",
		couldnTProcessTheRequest:
			"Couldn't process the request. Please try again in a moment.",
		passkeyRegistrationDidnTComplete:
			"Passkey registration didn't complete. Please try again.",
		thisPasskeyWasAlreadyDeleted:
			"This passkey was already deleted. Please refresh the page.",
		youVeBeenSignedOut: "You've been signed out. Please sign in again.",
		theValueEnteredIsnT: "The value entered isn't in a valid format.",
	},
	securityError: {
		forSecurityARecentSign:
			"For security, a recent sign-in is required. Sign out, sign in again and try.",
		theLastSignInMethod:
			"The last sign-in method can't be disconnected. Link another sign-in method first.",
		thisAccountAlreadyHasA:
			"This account already has a password. Refresh and use change password instead.",
		thisAccountHasNoPassword:
			"This account has no password. Refresh and try again.",
		couldnTSendTheRequest:
			"Couldn't send the request. Check your connection and try again.",
		couldnTChangeThePassword:
			"Couldn't change the password. Please try again in a moment.",
		thisSignInMethodWas:
			"This sign-in method was already disconnected. Please refresh the page.",
		couldnTProcessTheRequest:
			"Couldn't process the request. Please try again in a moment.",
		thisIsTheDeviceYou:
			"This is the device you're using. Use sign out to end it.",
		tooManyRequestsPleaseTry:
			"Too many requests. Please try again in a moment.",
		youVeBeenSignedOut: "You've been signed out. Please sign in again.",
		theValueEnteredIsnT: "The value entered isn't in a valid format.",
		theCurrentPasswordIsIncorrect: "The current password is incorrect.",
		theNewPasswordIsToo: "The new password is too short.",
		theNewPasswordIsToo2: "The new password is too long.",
	},
	avatarField: {
		couldnTLoadTheProfile:
			"Couldn't load the profile photo. Refresh and try again.",
		thisAccountIsBannedSo:
			"This account is banned, so the profile photo can't be changed.",
		thisAccountIsSuspendedSo:
			"This account is suspended, so the profile photo can't be changed.",
		profilePhoto: "Profile photo",
		uploading: "Uploading…",
		uploadPhoto: "Upload photo",
		removing: "Removing…",
		changePhoto: "Change photo",
		delete: "Delete",
		photoAlt: "{{name}}'s profile photo",
		myPhotoAlt: "My profile photo",
	},
	deletionTerminal: {
		butTheConversationsAndDrafts:
			"But the conversations and drafts left on this device couldn't be cleaned up. If this app is open in another tab, close it and try again.",
		youCanAlsoDeleteThe:
			"You can also delete the remaining data yourself by clearing this site's stored data in your browser settings.",
		cleaningUpDataSavedOn:
			"Cleaning up data saved on this device. Please wait a moment.",
		yourAccountWasDeleted: "Your account was deleted",
		deletingAccount: "Deleting account…",
		goToSignIn: "Go to sign-in",
		cleanUpAgain: "Clean up again",
	},
	contentSection: {
		adultStoriesArenTShown:
			"Adult stories aren't shown, and the setting can't be turned on. All-ages stories and conversations are available as usual.",
		adultContentDisplayCanOnly:
			"Adult content display can only be set on accounts that completed identity verification.",
		whenOffAdultStoriesDon:
			"When off, adult stories don't appear in the gallery or story pages.",
		thisAccountHasnTCompleted:
			"This account hasn't completed identity verification.",
		adultContentIsnTShown: "Adult content isn't shown.",
		thisAccountIsUnder14: "This account is under 14.",
		thisAccountIsUnder19: "This account is under 19.",
		showAdultContent: "Show adult content",
		contentDisplay: "Content display",
	},
	changeEmailDialog: {
		weLlSendAConfirmation:
			"We'll send a confirmation email. The address doesn't change until you open the link in it.",
		forSecurityThisGoesThrough:
			"For security, this goes through confirmation. If the email doesn't arrive, check your spam folder.",
		changeEmailAddress: "Change email address",
		sendConfirmationEmail: "Send confirmation email",
		currentEmail: "Current email",
		sending: "Sending…",
		newEmail: "New email",
		cancel: "Cancel",
	},
	passwordDialog: {
		settingAPasswordAlsoLets:
			"Setting a password also lets you sign in with your email and password.",
		otherDevicesStaySignedIn: "Other devices stay signed in after the change.",
		confirmNewPassword: "Confirm new password",
		changePassword: "Change password",
		setPassword: "Set password",
		currentPassword: "Current password",
		newPassword: "New password",
		saving: "Saving…",
		cancel: "Cancel",
	},
	revokeOthersDialog: {
		dataSavedOnEachDevice:
			"Data saved on each device, such as conversations and drafts, isn't erased.",
		thisDeviceStaysSignedIn: "This device stays signed in.",
		signOutAllOtherDevices: "Sign out all other devices?",
		signOutOtherDevices: "Sign out other devices",
		signingOut: "Signing out…",
		cancel: "Cancel",
		endsSessions:
			"Sign-in on <strong>{{count}}</strong> other devices ends. To use them again, sign in on each.",
	},
	disconnectMethodDialog: {
		youCanLinkItAgain: "You can link it again later.",
		disconnecting: "Disconnecting…",
		disconnect: "Disconnect",
		cancel: "Cancel",
		title: "Disconnect {{label}} sign-in?",
		noLonger: "You'll no longer be able to sign in with {{label}}.",
		remainingOnly:
			"After disconnecting, you can sign in only with <strong>{{methods}}</strong>.",
		remaining:
			"After disconnecting, you can sign in with <strong>{{methods}}</strong>.",
	},
	deleteAccountSection: {
		conversationsAndDraftsOnThis:
			"Conversations and drafts on this device and data kept for sync are deleted along with it.",
		publiclyPublishedStoriesMayRemain:
			"Publicly published stories may remain with the author details removed.",
		aDeletedAccountCanT: "A deleted account can't be restored.",
		seeWhatGetsDeleted: "See what gets deleted",
		dangerZone: "Danger zone",
		deleteAccount: "Delete account",
	},
	deleteAccountError: {
		forSecurityARecentSign:
			"For security, a recent sign-in is required. Sign out, sign in again and try.",
		couldnTConfirmTheResult:
			"Couldn't confirm the result. Refresh to check whether the account still exists.",
		thisAccountHasNoPassword:
			"This account has no password. Refresh the page and try again.",
		couldnTDeleteTheAccount:
			"Couldn't delete the account. Please try again in a moment.",
		tooManyRequestsPleaseTry:
			"Too many requests. Please try again in a moment.",
		youVeBeenSignedOut: "You've been signed out. Please sign in again.",
		thePasswordIsIncorrect: "The password is incorrect.",
	},
	avatarCropDialog: {
		thePartInsideTheCircle:
			"The part inside the circle becomes your profile photo. Drag to move it and zoom as needed.",
		useThisArea: "Use this area",
		cropPhoto: "Crop photo",
		creating: "Creating…",
		zoom: "Zoom",
		cancel: "Cancel",
	},
	twoFactorSection: {
		availableForAccountsThatSign:
			"Available for accounts that sign in with a password. Set a password first.",
		offTurnItOnTo:
			"Off. Turn it on to also ask for your authenticator app code when signing in with a password.",
		onSigningInWithA:
			"On. Signing in with a password also asks for your authenticator app code.",
		getNewBackupCodes: "Get new backup codes",
		turnOffTwoFactorAuthentication: "Turn off two-factor authentication",
		turnOnTwoFactorAuthentication: "Turn on two-factor authentication",
	},
	passwordSection: {
		noPasswordYetSetOne:
			"No password yet. Set one to sign in without social sign-in.",
		youCanSignInWith: "You can sign in with your email and password.",
		yourPasswordWasSet: "Your password was set.",
		yourPasswordWasChanged: "Your password was changed.",
		changePassword: "Change password",
		setPassword: "Set password",
	},
	deleteAccountTrigger: {
		youReNotConnectedSo:
			"You're not connected, so deletion can't proceed right now. It reloads once you're connected.",
		accountDetailsCouldnTBe:
			"Account details couldn't be loaded, so deletion can't proceed right now.",
		loading: "Loading…",
		tryAgain: "Try again",
		deleteAccount: "Delete account",
	},
	accountError: {
		couldnTSaveTheChange:
			"Couldn't save the change. Please try again in a moment.",
		couldnTSendTheRequest:
			"Couldn't send the request. Please check your connection.",
		thisAccountIsRestrictedSo:
			"This account is restricted, so it can't be changed.",
		youVeBeenSignedOut: "You've been signed out. Please sign in again.",
		theValueEnteredIsnT: "The value entered isn't in a valid format.",
	},
	passkeyLabel: {
		pleaseEnterAPasskeyName: "Please enter a passkey name.",
		passkey: "Passkey",
		tooLong: "A passkey name can be up to {{max}} characters.",
	},
	loginMethodLabel: {
		email: "Email",
		kakao: "Kakao",
	},
	accountPage: {
		publishingAndInteractionsAreRestricted:
			"Publishing and interactions are restricted, but you can still check account details, change content display and sign out.",
		thisAccountIsBanned: "This account is banned.",
		thisAccountIsSuspended: "This account is suspended.",
	},
	passwordForm: {
		theNewPasswordsDonT: "The new passwords don't match.",
		tooShort: "A password must be at least {{min}} characters.",
		tooLong: "A password must be at most {{max}} characters.",
	},
	saveLabel: {
		saving: "Saving…",
		saved: "Saved",
		save: "Save",
	},
	accountShell: {
		account: "Account",
	},
	profileSection: {
		couldnTLoadTheBio: "Couldn't load the bio. Refresh and try again.",
		yourNicknameAndBioAppear:
			"Your nickname and bio appear on your public profile and published stories.",
		writeAShortBio: "Write a short bio.",
		pleaseEnterANickname: "Please enter a nickname.",
		viewPublicProfile: "View public profile",
		profile: "Profile",
		nickname: "Nickname",
		bio: "Bio",
		nicknameTooLong: "A nickname can be up to {{max}} characters.",
		bioTooLong: "A bio can be up to {{max}} characters.",
	},
	adultVerificationState: {
		identityVerificationIsnTAvailable:
			"Identity verification isn't available right now. Please check again in a moment.",
		identityVerificationWentAheadIn:
			"Identity verification went ahead in another window. Please start again from the beginning.",
		identityVerificationCanTProceed:
			"Identity verification can't proceed right now. Please try again in a moment.",
		noIdentityVerificationIsIn:
			"No identity verification is in progress. Please start again from the beginning.",
		couldnTCompleteIdentityVerification:
			"Couldn't complete identity verification. Please try again in a moment.",
		accountsUnder14CanT: "Accounts under 14 can't use adult content.",
		theIdentityVerificationWindowExpired:
			"The identity verification window expired. Please start again.",
		identityVerificationDidnTComplete:
			"Identity verification didn't complete. Please try again.",
		couldnTSendTheRequest:
			"Couldn't send the request. Please check your connection.",
		identityVerificationFailedPleaseTry:
			"Identity verification failed. Please try again.",
		youVeBeenSignedOut: "You've been signed out. Please sign in again.",
		inProgressInTheVerification: "In progress in the verification window…",
		checking: "Checking…",
		opening: "Opening…",
	},
	avatarFile: {
		aRestrictedAccountCanT:
			"A restricted account can't change its profile photo. Check the restriction on your account screen.",
		adjustThePhotoDragOr:
			"Adjust the photo — drag or use the arrow keys to move it, and zoom with the slider below",
		couldnTChangeTheProfile:
			"Couldn't change the profile photo. Please try again in a moment.",
		couldnTSaveTheImage:
			"Couldn't save the image. Please try again in a moment.",
		couldnTReadTheImage: "Couldn't read the image. The file may be damaged.",
		couldnTReadTheImage2:
			"Couldn't read the image. Please choose another photo.",
		theFileIsEmptyPlease: "The file is empty. Please choose another image.",
		youNeedToSignIn: "You need to sign in.",
		inputHint:
			"{{formats}} · at least {{min}}px · cropped to a square (crop it yourself above {{max}}MB)",
		tooLarge:
			"Profile photos can be up to {{max}}MB. Please choose a smaller file.",
		unsupported: "Only {{formats}} files can be uploaded.",
		cropTooSmall:
			"Only photos at least {{min}}px wide and tall can be cropped.",
		badDimensions:
			"The image size doesn't fit. Choose a photo at least {{min}}px wide and tall, and at most {{max}}px on each side.",
	},
	accountSkeleton: {
		yourNicknameAndBioAppear:
			"Your nickname and bio appear on your public profile and published stories.",
		loadingAccountDetails: "Loading account details",
		contentDisplay: "Content display",
		twoFactorAuthentication: "Two-factor authentication",
		signInMethods: "Sign-in methods",
		dangerZone: "Danger zone",
		activeSessions: "Active sessions",
		password: "Password",
		profile: "Profile",
		data: "Data",
		email: "Email",
		passkeys: "Passkeys",
		security: "Security",
	},
	loginMethodsSection: {
		setAPasswordBelowTo: "Set a password below to link it",
		thisIsYourLastSign: "This is your last sign-in method",
		notLinked: "Not linked",
		redirecting: "Redirecting…",
		disconnect: "Disconnect",
		linked: "Linked",
		link: "Link",
		since: "Since {{date}}",
	},
	emailSection: {
		weSentAConfirmationEmail:
			"We sent a confirmation email. The address doesn't change until you open every link in it.",
		openTheVerificationEmailIn:
			"Open the verification email in your inbox to confirm this address is yours.",
		weSentAVerificationEmail:
			"We sent a verification email. Please check your inbox.",
		sendVerificationEmail: "Send verification email",
		sending: "Sending…",
		changeEmail: "Change email",
		verificationNeeded: "Verification needed",
		verified: "Verified",
		resendIn: "Resend (",
		seconds: "s)",
	},
	adultVerification: {
		verifyingYourIdentityForExample:
			"Verifying your identity, for example with a mobile phone, confirms whether you're 19 or older. Finishing it doesn't turn adult content display on automatically.",
		verifyYourIdentityAgainTo:
			"Verify your identity again to see adult content. Until then, adult stories stay hidden even with the display on.",
		onceYouTurn19Verify: "Once you turn 19, verify again to use adult content.",
		identityVerificationIsRequiredTo:
			"Identity verification is required to use adult content.",
		itSBeenAYear: "It's been a year since identity verification.",
		verifyAgain: "Verify again",
		verifyIdentity: "Verify identity",
	},
	changeEmail: {
		forSecurityARecentSign:
			"For security, a recent sign-in is required. Sign out, sign in again and try.",
		couldnTSendTheRequest:
			"Couldn't send the request. Check your connection and try again.",
		couldnTStartTheEmail:
			"Couldn't start the email change. Please try again in a moment.",
		tooManyRequestsPleaseTry:
			"Too many requests. Please try again in a moment.",
		changingEmailIsnTAvailable:
			"Changing email isn't available on this deployment.",
		youVeBeenSignedOut: "You've been signed out. Please sign in again.",
		pleaseEnterANewEmail: "Please enter a new email address.",
		thatEmailAddressIsnT: "That email address isn't valid.",
		thatSTheAddressYou: "That's the address you're already using.",
	},
	pinnedStoriesField: {
		someStoriesCanTBe:
			"Some stories can't be pinned. Remove the ones that aren't public and save again.",
		onlyStoriesVisibleOnYour:
			"Only stories visible on your public profile can be chosen.",
		noMorePublicStoriesTo: "No more public stories to choose.",
		couldnTLoadTheStory: "Couldn't load the story list.",
		couldnTLoadFeaturedStories: "Couldn't load featured stories.",
		noPinnedStories: "No pinned stories.",
		addFeaturedStory: "Add featured story",
		tryAgain: "Try again",
		addStory: "Add story",
		untitled: "Untitled",
		showMore: "Show more",
		featuredStories: "Featured stories",
		close: "Close",
		limitNote: "Pin up to {{limit}} stories at the top of your public profile.",
		moveEarlier: "Move {{title}} earlier",
		moveLater: "Move {{title}} later",
		unpin: "Unpin {{title}}",
	},
	useAccountDeletion: {
		accountCouldNotEraseThis:
			"[account] could not erase this device's local data",
		accountCouldNotSendThe: "[account] could not send the deletion request",
	},
	avatarCropRender: {
		couldNotCreateTheImage: "could not create the image",
		couldNotOpenTheCanvas: "could not open the canvas",
		decodeFailed: "decode failed",
		emptyImage: "empty image",
	},
	restriction: {
		banned: {
			nickname: "This account is banned, so the nickname can't be changed.",
			bio: "This account is banned, so the bio can't be changed.",
			pinned: "This account is banned, so featured stories can't be changed.",
		},
		suspended: {
			nickname: "This account is suspended, so the nickname can't be changed.",
			bio: "This account is suspended, so the bio can't be changed.",
			pinned:
				"This account is suspended, so featured stories can't be changed.",
		},
	},
	connect: {
		account: "account",
		providerAccount: "{{provider}} account",
		alreadyLinked:
			"This {{subject}} is already linked to another RowCat account. Accounts can't be merged.",
		emailMismatchApple:
			'Only a {{subject}} with the same email as your RowCat account can be linked. Turn off "Hide My Email" on Apple\'s screen and try again.',
		emailMismatch:
			"Only a {{subject}} with the same email as your RowCat account can be linked.",
		failed: "Couldn't link the {{subject}}. Please try again in a moment.",
		incomplete: "Linking the {{subject}} didn't complete.",
	},
};
