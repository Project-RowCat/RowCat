import type { Messages } from "../../types.ts";

export const account: Messages["account"] = {
	accountDeletionGuide: {
		accountDeletionGuide: "계정 삭제 안내",
		howToDelete: "삭제하는 방법",
		signInToRowcat: "RowCat에 로그인합니다.",
		goToAccountFromThe: "오른쪽 위 메뉴에서 계정으로 이동합니다.",
		pressDeleteAccountInThe: "화면 맨 아래 위험 영역에서 계정 삭제를 누릅니다.",
		reviewTheNoticeAndIf:
			"안내를 확인하고, 비밀번호로 가입한 계정이라면 현재 비밀번호를 입력합니다.",
		anAccountThatUsesOnly:
			"소셜 로그인만 사용하는 계정에는 비밀번호가 없으므로, 대신 최근에 로그인한 상태에서만 삭제할 수 있습니다. 거절되면 로그아웃한 뒤 다시 로그인하고 시도해 주세요.",
		deletionHappensImmediatelyAndCan:
			"삭제는 즉시 처리되며 되돌릴 수 없습니다.",
		ifAScreenAskingFor:
			"생년월일 확인이나 보호자 동의를 기다리는 화면이 떠 있다면, 계정으로 이동하지 않아도 그 화면에서 바로 계정 삭제를 누를 수 있습니다.",
		whatGetsDeleted: "삭제되는 항목",
		yourAccountAndSignIn:
			"계정과 로그인 정보(이메일·비밀번호·연결된 소셜 계정)",
		signInSessionsOnEvery: "모든 기기의 로그인 세션",
		memberInformationAndProfile: "회원 정보와 프로필",
		favoritesFollowsAndBlocks: "즐겨찾기·팔로우·차단 기록",
		notificationsYouReceivedWhereYou:
			"받은 알림 — 다른 회원이 받은 알림에 회원님이 등장하는 경우, 그 알림은 남지만 회원님의 이름과 프로필로 가는 링크는 사라집니다.",
		dataKeptForSyncBetween:
			"기기 간 동기화에 보관된 데이터 — 서버에는 암호문만 보관되며, 그 암호문도 함께 삭제됩니다",
		conversationsAndDraftsSavedOn:
			"삭제를 진행한 기기에 저장된 대화와 작성 중인 초안",
		theSyncKeyRememberedOn: "삭제를 진행한 기기에 기억된 동기화 열쇠",
		whatMayRemain: "남을 수 있는 항목",
		publiclyPublishedStoriesTheyMay:
			"공개 발행한 작품 — 작성자 정보를 지운 채 남을 수 있습니다. 작품과 계정을 잇는 정보는 삭제되며, 제작자 이름과 프로필로 가는 링크도 사라집니다.",
		conversationsAndDraftsAlreadySaved:
			"다른 기기에 이미 저장된 대화와 초안 — 아래를 참고해 주세요.",
		dataLeftOnOtherDevices: "다른 기기에 남은 데이터",
		rowcatConversationsAndDraftsAre:
			"RowCat의 대화와 초안은 서버가 아니라 사용하는 기기에 저장됩니다. 계정을 삭제하면 서버에 보관된 데이터와 삭제를 진행한 기기의 데이터는 지워지지만, 다른 기기에 이미 저장된 사본까지 원격으로 지울 수는 없습니다.",
		thoseDevicesAreSignedOut:
			"그 기기들은 계정이 사라진 뒤 로그인 상태가 풀립니다. 남은 데이터를 없애려면 해당 기기에서 브라우저의 사이트 데이터를 삭제하거나 앱을 삭제해 주세요.",
		ifYouCanTSign: "로그인할 수 없는 경우",
		accountDeletionRequiresConfirmingIt:
			"계정 삭제는 본인 확인을 거쳐야 하므로 로그인한 상태에서만 진행할 수 있습니다. 비밀번호를 잊었다면 먼저 로그인을 복구해 주세요.",
		ifYouCanTSign2:
			"어떤 방법으로도 로그인할 수 없다면 이 서비스의 운영자에게 계정 삭제를 요청해 주세요.",
		howItDiffersFromOther: "계정 삭제와 다른 것",
		signOut: "로그아웃",
		theAccountStaysAndThis:
			"계정은 그대로 있고, 이 기기의 대화와 초안도 지워지지 않습니다. 같은 계정으로 다시 로그인하면 그대로 이어서 볼 수 있습니다.",
		deleteAccount: "계정 삭제",
		theAccountItselfDisappearsIt:
			"계정 자체가 사라집니다. 되돌릴 수 없고, 같은 방법으로 다시 가입해도 이전 데이터는 돌아오지 않습니다.",
	},
	deleteAccountDialog: {
		deleteYourAccount: "계정을 삭제할까요?",
		thisCanTBeUndone: "이 작업은 되돌릴 수 없습니다.",
		whatGetsDeleted: "삭제되는 항목",
		yourAccountAndSignIn: "계정과 로그인 정보",
		conversationsAndDraftsSavedOn: "이 기기에 저장된 대화와 작성 중인 초안",
		dataKeptForSyncBetween: "기기 간 동기화에 보관된 데이터",
		favoritesFollowsAndBlocks: "즐겨찾기·팔로우·차단 기록",
		whatMayRemain: "남을 수 있는 항목",
		publiclyPublishedStoriesTheyMay:
			"공개 발행한 작품 — 작성자 정보를 지운 채 남을 수 있습니다",
		conversationsAndDraftsAlreadySaved:
			"다른 기기에 이미 저장된 대화와 초안 — 그 기기에서 로그아웃하거나 앱 데이터를 지워야 사라집니다",
		currentPassword: "현재 비밀번호",
		forSecurityDeletionOnlyWorks:
			"보안을 위해 최근에 로그인한 상태에서만 삭제할 수 있습니다. 거절되면 로그아웃한 뒤 다시 로그인하고 시도해 주세요.",
		cancel: "취소",
		deletingAccount: "계정 삭제 중…",
		deleteAccount: "계정 삭제",
	},
	dataSection: {
		data: "데이터",
		conversationsAndDraftsInProgress:
			"대화와 작성 중인 초안은 이 기기에 저장됩니다.",
		signingOutDoesnTErase:
			"로그아웃해도 이 기기의 데이터는 지워지지 않고, 같은 계정으로 다시 로그인하면 그대로 이어서 볼 수 있습니다.",
		syncBetweenDevices: "기기 간 동기화",
		conversationsAndDraftsAreEncrypted:
			"대화와 초안을 이 기기에서 암호화해 보관하고 다른 기기로 이어갑니다. 서버에는 암호문만 저장되며 내용은 읽히지 않습니다. 다른 기기의 변경은 이 기기를 다시 열거나 화면으로 돌아올 때 따라옵니다.",
	},
	twoFactorDialogs: {
		signingInWithAPassword:
			"이제 비밀번호로 로그인할 때 인증 앱의 코드를 함께 묻습니다. 인증 앱을 잃으면 받아 둔 백업 코드로 로그인한 뒤 새로 설정할 수 있습니다.",
		scanTheQrCodeWith:
			"인증 앱으로 QR 코드를 찍거나 키를 직접 입력한 뒤, 앱에 표시된 여섯 자리를 입력해 주세요. 코드를 확인해야 켜집니다.",
		turningItOffLetsYou:
			"끄면 비밀번호만으로 로그인할 수 있게 됩니다. 인증 앱의 등록과 백업 코드는 더 이상 쓸 수 없습니다.",
		oneTimeCodesForSigning:
			"인증 앱을 잃었을 때 로그인할 수 있는 일회용 코드입니다. 각 코드는 한 번만 쓸 수 있습니다.",
		signingInWithAPassword2:
			"비밀번호로 로그인할 때 인증 앱의 코드를 한 번 더 묻습니다. 먼저 비밀번호를 확인합니다.",
		iVeWrittenTheBackup:
			"백업 코드를 안전한 곳에 받아 적었습니다. 이 창을 닫으면 다시 볼 수 없습니다.",
		gettingTenNewCodesMakes:
			"새 코드 열 개를 받으면 지금까지의 백업 코드는 전부 쓸 수 없게 됩니다.",
		theseAreYourNewBackup:
			"새 백업 코드입니다. 이 창을 닫으면 다시 볼 수 없습니다.",
		ifYouCanTScan: "QR을 찍을 수 없으면 이 키를 입력하세요",
		qrCodeToScanWith: "인증 앱으로 찍을 QR 코드",
		twoFactorAuthenticationIsOn: "2단계 인증이 켜졌습니다",
		getNewBackupCodes: "백업 코드 다시 받기",
		couldnTCopy: "복사하지 못했습니다",
		turnOnTwoFactorAuthentication: "2단계 인증 켜기",
		turnOffTwoFactorAuthentication: "2단계 인증 끄기",
		codeFromYourAuthenticatorApp: "인증 앱의 코드",
		iVeWrittenThemDown: "받아 적었습니다",
		currentPassword: "현재 비밀번호",
		copied: "복사했습니다",
		getNewCodes: "새로 받기",
		copyAll: "모두 복사",
		close: "닫기",
		cancel: "취소",
		next: "다음",
		turnOn: "켜기",
		turnOff: "끄기",
	},
	sessionsSection: {
		forSecuritySignOutAnd:
			"보안을 위해, 로그아웃한 뒤 다시 로그인하면 이 목록을 갱신할 수 있습니다.",
		forSecuritySignOutAnd2:
			"보안을 위해, 로그아웃한 뒤 다시 로그인하면 이 목록을 볼 수 있습니다.",
		youReNotConnectedRight:
			"지금은 연결되어 있지 않습니다. 연결되면 세션 목록을 다시 불러옵니다.",
		couldnTRefreshTheCurrent: "현재 세션 목록을 갱신하지 못했습니다.",
		loadingSessions: "세션 목록을 불러오는 중…",
		thisIsTheDeviceYou: "지금 보고 있는 기기입니다",
		signOutAllOtherDevices: "다른 기기 모두 로그아웃",
		loading: "불러오는 중…",
		tryAgain: "다시 시도",
		thisDevice: "현재 기기",
		anotherDevice: "다른 기기",
		signOut: "로그아웃",
		showMoreDevices: "다른 기기 {{count}}대 더 보기",
		signedInExpires: "{{signedIn}} 로그인 · {{expires}} 만료",
	},
	passkeyDialogs: {
		giveItANameYou:
			"이 기기를 알아볼 수 있는 이름을 적어 주세요. 목록에서 구분하는 용도로만 쓰입니다.",
		thisCanTBeUndone:
			"삭제하면 되돌릴 수 없습니다. 같은 기기를 다시 쓰려면 새로 등록해야 합니다.",
		afterNamingItConfirmWith:
			"이름을 정하면 이 기기의 잠금 해제 방법(지문·얼굴·PIN)으로 확인합니다.",
		signingInWithThisPasskey:
			"이 패스키로 로그인하는 방법은 그대로이고, 목록에 보이는 이름만 바뀝니다.",
		otherSignInMethodsSuch:
			"비밀번호와 소셜 로그인 등 다른 로그인 방법은 그대로 남습니다.",
		deleteThisPasskey: "이 패스키를 삭제할까요?",
		checkingTheDevice: "기기를 확인하는 중…",
		renamePasskey: "패스키 이름 변경",
		saving: "저장하는 중…",
		deleting: "삭제하는 중…",
		addAPasskey: "패스키 추가",
		deletePasskey: "패스키 삭제",
		name: "이름",
		cancel: "취소",
		continue: "계속",
		save: "저장",
		noLongerSignIn:
			"<name>{{name}}</name>로는 더 이상 로그인할 수 없게 됩니다.",
	},
	securitySection: {
		youReNotConnectedRight:
			"지금은 연결되어 있지 않습니다. 연결되면 계정 정보를 다시 불러옵니다.",
		evenIfYourPasswordLeaks:
			"비밀번호가 새어 나가도 인증 앱의 코드 없이는 들어올 수 없게 합니다.",
		signInWithYourDevice:
			"비밀번호 없이 기기의 지문·얼굴·PIN으로 로그인합니다.",
		yourSignInIdentifierAnd: "로그인 식별자이자 보안 알림을 받는 주소입니다.",
		waysYouCanSignIn: "이 계정에 로그인할 수 있는 방법입니다.",
		devicesSignedInToThis: "이 계정으로 로그인되어 있는 기기입니다.",
		couldnTLoadAccountDetails: "계정 정보를 불러오지 못했습니다.",
		loadingAccountDetails: "계정 정보를 불러오는 중…",
		loading: "불러오는 중…",
		accountCreated: "계정 생성일",
		twoFactorAuthentication: "2단계 인증",
		signInMethods: "로그인 방법",
		tryAgain: "다시 시도",
		activeSessions: "활성 세션",
		password: "비밀번호",
		email: "이메일",
		passkeys: "패스키",
		security: "보안",
	},
	passkeysSection: {
		noPasskeysYetAddOne:
			"등록된 패스키가 없습니다. 패스키를 추가하면 비밀번호 없이 이 기기의 지문·얼굴·PIN으로 로그인할 수 있습니다.",
		thisBrowserDoesnTSupport:
			"이 브라우저는 패스키를 지원하지 않아 새로 추가할 수 없습니다. 위 목록의 삭제는 그대로 할 수 있습니다.",
		noPasskeysYetThisBrowser:
			"등록된 패스키가 없습니다. 이 브라우저는 패스키를 지원하지 않아 여기서는 추가할 수 없습니다.",
		forSecuritySignOutAnd:
			"보안을 위해, 로그아웃한 뒤 다시 로그인하면 이 목록을 갱신할 수 있습니다.",
		youReNotConnectedRight:
			"지금은 연결되어 있지 않습니다. 연결되면 패스키 목록을 다시 불러옵니다.",
		forSecuritySignOutAnd2:
			"보안을 위해, 로그아웃한 뒤 다시 로그인하면 이 목록을 볼 수 있습니다.",
		couldnTRefreshTheCurrent: "현재 패스키 목록을 갱신하지 못했습니다.",
		loadingPasskeys: "패스키 목록을 불러오는 중…",
		loading: "불러오는 중…",
		addAPasskey: "패스키 추가",
		tryAgain: "다시 시도",
		rename: "이름 변경",
		delete: "삭제",
		registered: "{{date}} 등록",
	},
	passkeyError: {
		forSecurityARecentSign:
			"보안을 위해 최근 로그인 확인이 필요합니다. 로그아웃한 뒤 다시 로그인하고 시도해 주세요.",
		aPasskeyIsAlreadyRegistered:
			"이 기기에는 이미 패스키가 등록되어 있습니다. 아래 목록에서 확인해 주세요.",
		couldnTRegisterThePasskey:
			"패스키를 등록하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.",
		couldnTSendTheRequest:
			"요청을 보내지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.",
		couldnTRenameThePasskey:
			"패스키 이름을 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.",
		couldnTProcessTheRequest:
			"요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		passkeyRegistrationDidnTComplete:
			"패스키 등록이 완료되지 않았습니다. 다시 시도해 주세요.",
		thisPasskeyWasAlreadyDeleted:
			"이미 삭제된 패스키입니다. 화면을 새로고침해 주세요.",
		youVeBeenSignedOut: "로그인이 풀렸습니다. 다시 로그인해 주세요.",
		theValueEnteredIsnT: "입력한 값이 형식에 맞지 않습니다.",
	},
	securityError: {
		forSecurityARecentSign:
			"보안을 위해 최근 로그인 확인이 필요합니다. 로그아웃한 뒤 다시 로그인하고 시도해 주세요.",
		theLastSignInMethod:
			"마지막 로그인 방법은 해제할 수 없습니다. 다른 로그인 방법을 먼저 연결해 주세요.",
		thisAccountAlreadyHasA:
			"이미 비밀번호가 설정된 계정입니다. 새로고침한 뒤 비밀번호 변경을 이용해 주세요.",
		thisAccountHasNoPassword:
			"이 계정에는 비밀번호가 없습니다. 새로고침한 뒤 다시 시도해 주세요.",
		couldnTSendTheRequest:
			"요청을 보내지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.",
		couldnTChangeThePassword:
			"비밀번호를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		thisSignInMethodWas:
			"이미 해제된 로그인 방법입니다. 화면을 새로고침해 주세요.",
		couldnTProcessTheRequest:
			"요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		thisIsTheDeviceYou:
			"지금 사용 중인 기기입니다. 로그아웃으로 종료해 주세요.",
		tooManyRequestsPleaseTry:
			"요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
		youVeBeenSignedOut: "로그인이 풀렸습니다. 다시 로그인해 주세요.",
		theValueEnteredIsnT: "입력한 값이 형식에 맞지 않습니다.",
		theCurrentPasswordIsIncorrect: "현재 비밀번호가 올바르지 않습니다.",
		theNewPasswordIsToo: "새 비밀번호가 너무 짧습니다.",
		theNewPasswordIsToo2: "새 비밀번호가 너무 깁니다.",
	},
	avatarField: {
		couldnTLoadTheProfile:
			"프로필 사진을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.",
		thisAccountIsBannedSo:
			"이용이 차단된 계정이라 프로필 사진을 변경할 수 없습니다.",
		thisAccountIsSuspendedSo:
			"이용이 정지된 계정이라 프로필 사진을 변경할 수 없습니다.",
		profilePhoto: "프로필 사진",
		uploading: "올리는 중…",
		uploadPhoto: "사진 올리기",
		removing: "지우는 중…",
		changePhoto: "사진 변경",
		delete: "삭제",
		photoAlt: "{{name}} 프로필 사진",
		myPhotoAlt: "내 프로필 사진",
	},
	deletionTerminal: {
		butTheConversationsAndDrafts:
			"다만 이 기기에 남은 대화와 초안을 정리하지 못했습니다. 다른 탭에서 이 앱을 열어 두었다면 닫은 뒤 다시 시도해 주세요.",
		youCanAlsoDeleteThe:
			"정리되지 않은 데이터는 브라우저 설정에서 이 사이트의 저장 데이터를 지워 직접 삭제할 수도 있습니다.",
		cleaningUpDataSavedOn:
			"이 기기에 저장된 데이터를 정리하고 있습니다. 잠시만 기다려 주세요.",
		yourAccountWasDeleted: "계정은 삭제되었습니다",
		deletingAccount: "계정 삭제 중…",
		goToSignIn: "로그인 화면으로",
		cleanUpAgain: "다시 정리",
	},
	contentSection: {
		adultStoriesArenTShown:
			"성인향 작품은 표시되지 않으며, 설정을 켤 수 없습니다. 전체이용가 작품과 대화는 그대로 이용할 수 있습니다.",
		adultContentDisplayCanOnly:
			"성인 콘텐츠 표시는 본인확인을 마친 계정에서만 설정할 수 있습니다.",
		whenOffAdultStoriesDon:
			"끄면 갤러리와 작품에서 성인향 작품이 보이지 않습니다.",
		thisAccountHasnTCompleted: "본인확인을 마치지 않은 계정입니다.",
		adultContentIsnTShown: "성인 콘텐츠는 표시되지 않습니다.",
		thisAccountIsUnder14: "만 14세 미만 계정입니다.",
		thisAccountIsUnder19: "만 19세 미만 계정입니다.",
		showAdultContent: "성인 콘텐츠 표시",
		contentDisplay: "콘텐츠 표시",
	},
	changeEmailDialog: {
		weLlSendAConfirmation:
			"확인 메일을 보냅니다. 메일 안의 링크를 열기 전까지 이메일 주소는 바뀌지 않습니다.",
		forSecurityThisGoesThrough:
			"보안을 위해 확인 절차를 거칩니다. 메일이 오지 않으면 스팸함을 확인해 주세요.",
		changeEmailAddress: "이메일 주소 변경",
		sendConfirmationEmail: "확인 메일 보내기",
		currentEmail: "현재 이메일",
		sending: "보내는 중…",
		newEmail: "새 이메일",
		cancel: "취소",
	},
	passwordDialog: {
		settingAPasswordAlsoLets:
			"비밀번호를 설정하면 이메일과 비밀번호로도 로그인할 수 있습니다.",
		otherDevicesStaySignedIn: "변경한 뒤에도 다른 기기의 로그인은 유지됩니다.",
		confirmNewPassword: "새 비밀번호 확인",
		changePassword: "비밀번호 변경",
		setPassword: "비밀번호 설정",
		currentPassword: "현재 비밀번호",
		newPassword: "새 비밀번호",
		saving: "저장 중…",
		cancel: "취소",
	},
	revokeOthersDialog: {
		dataSavedOnEachDevice:
			"대화와 초안 등 각 기기에 저장된 데이터는 지워지지 않습니다.",
		thisDeviceStaysSignedIn:
			"지금 사용 중인 이 기기는 그대로 로그인 상태로 남습니다.",
		signOutAllOtherDevices: "다른 기기를 모두 로그아웃할까요?",
		signOutOtherDevices: "다른 기기 로그아웃",
		signingOut: "종료하는 중…",
		cancel: "취소",
		endsSessions:
			"다른 기기 <strong>{{count}}대</strong>의 로그인이 종료됩니다. 그 기기에서 다시 이용하려면 로그인해야 합니다.",
	},
	disconnectMethodDialog: {
		youCanLinkItAgain: "나중에 다시 연결할 수 있습니다.",
		disconnecting: "해제하는 중…",
		disconnect: "연결 해제",
		cancel: "취소",
		title: "{{label}} 로그인을 연결 해제할까요?",
		noLonger: "{{label}}로는 더 이상 로그인할 수 없게 됩니다.",
		remainingOnly:
			"해제한 뒤에는 <strong>{{methods}}</strong>로만 로그인할 수 있습니다.",
		remaining:
			"해제한 뒤에는 <strong>{{methods}}</strong>로 로그인할 수 있습니다.",
	},
	deleteAccountSection: {
		conversationsAndDraftsOnThis:
			"이 기기에 저장된 대화와 초안, 동기화에 보관된 데이터가 함께 삭제됩니다.",
		publiclyPublishedStoriesMayRemain:
			"공개 발행한 작품은 작성자 정보가 제거된 상태로 남을 수 있습니다.",
		aDeletedAccountCanT: "계정을 삭제하면 복구할 수 없습니다.",
		seeWhatGetsDeleted: "삭제되는 항목 자세히 보기",
		dangerZone: "위험 영역",
		deleteAccount: "계정 삭제",
	},
	deleteAccountError: {
		forSecurityARecentSign:
			"보안을 위해 최근 로그인 확인이 필요합니다. 로그아웃한 뒤 다시 로그인하고 시도해 주세요.",
		couldnTConfirmTheResult:
			"요청 결과를 확인하지 못했습니다. 새로고침해 계정이 남아 있는지 확인해 주세요.",
		thisAccountHasNoPassword:
			"이 계정에는 비밀번호가 없습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.",
		couldnTDeleteTheAccount:
			"계정을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		tooManyRequestsPleaseTry:
			"요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
		youVeBeenSignedOut: "로그인이 풀렸습니다. 다시 로그인해 주세요.",
		thePasswordIsIncorrect: "비밀번호가 올바르지 않습니다.",
	},
	avatarCropDialog: {
		thePartInsideTheCircle:
			"원 안에 들어오는 부분이 프로필 사진이 됩니다. 끌어서 옮기고 확대해 주세요.",
		useThisArea: "이 부분 사용",
		cropPhoto: "사진 자르기",
		creating: "만드는 중…",
		zoom: "확대",
		cancel: "취소",
	},
	twoFactorSection: {
		availableForAccountsThatSign:
			"비밀번호로 로그인하는 계정에서 쓸 수 있습니다. 먼저 비밀번호를 설정해 주세요.",
		offTurnItOnTo:
			"꺼져 있습니다. 켜면 비밀번호로 로그인할 때 인증 앱의 코드를 함께 묻습니다.",
		onSigningInWithA:
			"켜져 있습니다. 비밀번호로 로그인할 때 인증 앱의 코드를 함께 묻습니다.",
		getNewBackupCodes: "백업 코드 다시 받기",
		turnOffTwoFactorAuthentication: "2단계 인증 끄기",
		turnOnTwoFactorAuthentication: "2단계 인증 켜기",
	},
	passwordSection: {
		noPasswordYetSetOne:
			"아직 비밀번호가 없습니다. 설정하면 소셜 로그인 없이도 로그인할 수 있습니다.",
		youCanSignInWith: "이메일과 비밀번호로 로그인할 수 있습니다.",
		yourPasswordWasSet: "비밀번호가 설정되었습니다.",
		yourPasswordWasChanged: "비밀번호가 변경되었습니다.",
		changePassword: "비밀번호 변경",
		setPassword: "비밀번호 설정",
	},
	deleteAccountTrigger: {
		youReNotConnectedSo:
			"지금은 연결되어 있지 않아 삭제를 진행할 수 없습니다. 연결되면 다시 불러옵니다.",
		accountDetailsCouldnTBe:
			"계정 정보를 불러오지 못해 지금은 삭제를 진행할 수 없습니다.",
		loading: "불러오는 중…",
		tryAgain: "다시 시도",
		deleteAccount: "계정 삭제",
	},
	accountError: {
		couldnTSaveTheChange: "변경하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		couldnTSendTheRequest: "요청을 보내지 못했습니다. 연결을 확인해 주세요.",
		thisAccountIsRestrictedSo: "이용이 제한된 계정이라 변경할 수 없습니다.",
		youVeBeenSignedOut: "로그인이 풀렸습니다. 다시 로그인해 주세요.",
		theValueEnteredIsnT: "입력한 값이 형식에 맞지 않습니다.",
	},
	passkeyLabel: {
		pleaseEnterAPasskeyName: "패스키 이름을 입력해 주세요.",
		passkey: "패스키",
		tooLong: "패스키 이름은 {{max}}자 이하여야 합니다.",
	},
	loginMethodLabel: {
		email: "이메일",
		kakao: "카카오",
	},
	accountPage: {
		publishingAndInteractionsAreRestricted:
			"작품 발행과 상호작용은 제한되지만, 계정 정보 확인과 콘텐츠 표시 설정, 로그아웃은 그대로 할 수 있습니다.",
		thisAccountIsBanned: "이용이 차단된 계정입니다.",
		thisAccountIsSuspended: "이용이 정지된 계정입니다.",
	},
	passwordForm: {
		theNewPasswordsDonT: "새 비밀번호가 서로 다릅니다.",
		tooShort: "비밀번호는 {{min}}자 이상이어야 합니다.",
		tooLong: "비밀번호는 {{max}}자 이하여야 합니다.",
	},
	saveLabel: {
		saving: "저장 중…",
		saved: "저장됨",
		save: "저장",
	},
	accountShell: {
		account: "계정",
	},
	profileSection: {
		couldnTLoadTheBio:
			"소개를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.",
		yourNicknameAndBioAppear:
			"닉네임과 소개는 공개 프로필과 발행한 작품에 표시됩니다.",
		writeAShortBio: "자기소개를 짧게 적어 주세요.",
		pleaseEnterANickname: "닉네임을 입력해 주세요.",
		viewPublicProfile: "공개 프로필 보기",
		profile: "프로필",
		nickname: "닉네임",
		bio: "소개",
		nicknameTooLong: "닉네임은 {{max}}자 이하여야 합니다.",
		bioTooLong: "소개는 {{max}}자 이하여야 합니다.",
	},
	adultVerificationState: {
		identityVerificationIsnTAvailable:
			"지금은 본인확인을 이용할 수 없습니다. 잠시 후 다시 확인해 주세요.",
		identityVerificationWentAheadIn:
			"다른 창에서 본인확인이 진행되었습니다. 처음부터 다시 시작해 주세요.",
		identityVerificationCanTProceed:
			"지금은 본인확인을 진행할 수 없습니다. 잠시 후 다시 시도해 주세요.",
		noIdentityVerificationIsIn:
			"진행 중인 본인확인이 없습니다. 처음부터 다시 시작해 주세요.",
		couldnTCompleteIdentityVerification:
			"본인확인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		accountsUnder14CanT:
			"만 14세 미만 계정은 성인 콘텐츠를 이용할 수 없습니다.",
		theIdentityVerificationWindowExpired:
			"본인확인의 유효 시간이 지났습니다. 다시 시작해 주세요.",
		identityVerificationDidnTComplete:
			"본인확인이 완료되지 않았습니다. 다시 시도해 주세요.",
		couldnTSendTheRequest: "요청을 보내지 못했습니다. 연결을 확인해 주세요.",
		identityVerificationFailedPleaseTry:
			"본인확인에 실패했습니다. 다시 시도해 주세요.",
		youVeBeenSignedOut: "로그인이 풀렸습니다. 다시 로그인해 주세요.",
		inProgressInTheVerification: "본인확인 창에서 진행 중…",
		checking: "확인하는 중…",
		opening: "여는 중…",
	},
	avatarFile: {
		aRestrictedAccountCanT:
			"이용이 제한된 계정은 프로필 사진을 바꿀 수 없습니다. 계정 화면에서 제한 내용을 확인해 주세요.",
		adjustThePhotoDragOr:
			"사진 위치 조정 — 끌거나 방향키로 옮기고, 아래 슬라이더로 확대합니다",
		couldnTChangeTheProfile:
			"프로필 사진을 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.",
		couldnTSaveTheImage:
			"이미지를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		couldnTReadTheImage:
			"이미지를 읽지 못했습니다. 파일이 손상되었을 수 있습니다.",
		couldnTReadTheImage2: "이미지를 읽지 못했습니다. 다른 사진을 골라 주세요.",
		theFileIsEmptyPlease: "빈 파일입니다. 다른 이미지를 골라 주세요.",
		youNeedToSignIn: "로그인이 필요합니다.",
		inputHint:
			"{{formats}} · {{min}}px 이상 · 정사각형으로 잘립니다 ({{max}}MB 초과 시 직접 자르기)",
		tooLarge:
			"프로필 사진은 최대 {{max}}MB까지 올릴 수 있습니다. 더 작은 파일을 골라 주세요.",
		unsupported: "{{formats}} 파일만 올릴 수 있습니다.",
		cropTooSmall: "가로·세로 {{min}}px 이상인 사진만 자를 수 있습니다.",
		badDimensions:
			"이미지 크기가 맞지 않습니다. 가로·세로 {{min}}px 이상, 한 변 {{max}}px 이내인 사진을 골라 주세요.",
	},
	accountSkeleton: {
		yourNicknameAndBioAppear:
			"닉네임과 소개는 공개 프로필과 발행한 작품에 표시됩니다.",
		loadingAccountDetails: "계정 정보를 불러오는 중입니다",
		contentDisplay: "콘텐츠 표시",
		twoFactorAuthentication: "2단계 인증",
		signInMethods: "로그인 방법",
		dangerZone: "위험 영역",
		activeSessions: "활성 세션",
		password: "비밀번호",
		profile: "프로필",
		data: "데이터",
		email: "이메일",
		passkeys: "패스키",
		security: "보안",
	},
	loginMethodsSection: {
		setAPasswordBelowTo: "아래에서 비밀번호를 설정하면 연결됩니다",
		thisIsYourLastSign: "마지막 로그인 방법입니다",
		notLinked: "연결되지 않음",
		redirecting: "이동하는 중…",
		disconnect: "연결 해제",
		linked: "연결됨",
		link: "연결",
		since: "{{date}}부터",
	},
	emailSection: {
		weSentAConfirmationEmail:
			"확인 메일을 보냈습니다. 메일 안의 링크를 모두 열기 전까지 이메일 주소는 바뀌지 않습니다.",
		openTheVerificationEmailIn:
			"받은 편지함에서 확인 메일을 열면 이 주소가 회원님의 것임을 확인할 수 있습니다.",
		weSentAVerificationEmail:
			"확인 메일을 보냈습니다. 받은 편지함을 확인해 주세요.",
		sendVerificationEmail: "확인 메일 보내기",
		sending: "보내는 중…",
		changeEmail: "이메일 변경",
		verificationNeeded: "확인 필요",
		verified: "확인됨",
		resendIn: "다시 보내기 (",
		seconds: "초)",
	},
	adultVerification: {
		verifyingYourIdentityForExample:
			"휴대전화 등으로 본인확인을 하면 만 19세 이상인지 확인됩니다. 확인을 마쳐도 성인 콘텐츠 표시는 자동으로 켜지지 않습니다.",
		verifyYourIdentityAgainTo:
			"성인 콘텐츠를 보려면 본인확인을 다시 해 주세요. 다시 확인하기 전까지는 표시를 켜 두어도 성인향 작품이 보이지 않습니다.",
		onceYouTurn19Verify:
			"만 19세가 된 뒤에는 본인확인을 다시 하면 성인 콘텐츠를 이용할 수 있습니다.",
		identityVerificationIsRequiredTo:
			"성인 콘텐츠를 이용하려면 본인확인이 필요합니다.",
		itSBeenAYear: "본인확인 후 1년이 지났습니다.",
		verifyAgain: "본인확인 다시 하기",
		verifyIdentity: "본인확인",
	},
	changeEmail: {
		forSecurityARecentSign:
			"보안을 위해 최근 로그인 확인이 필요합니다. 로그아웃한 뒤 다시 로그인하고 시도해 주세요.",
		couldnTSendTheRequest:
			"요청을 보내지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.",
		couldnTStartTheEmail:
			"이메일 변경을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		tooManyRequestsPleaseTry:
			"요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
		changingEmailIsnTAvailable: "이 배포에서는 이메일 변경을 쓸 수 없습니다.",
		youVeBeenSignedOut: "로그인이 풀렸습니다. 다시 로그인해 주세요.",
		pleaseEnterANewEmail: "새 이메일 주소를 입력해 주세요.",
		thatEmailAddressIsnT: "이메일 형식이 올바르지 않습니다.",
		thatSTheAddressYou: "지금 쓰고 있는 주소와 같습니다.",
	},
	pinnedStoriesField: {
		someStoriesCanTBe:
			"고정할 수 없는 작품이 섞여 있습니다. 공개 상태가 아닌 작품을 빼고 다시 저장해 주세요.",
		onlyStoriesVisibleOnYour: "공개 프로필에 보이는 작품만 고를 수 있습니다.",
		noMorePublicStoriesTo: "더 고를 수 있는 공개 작품이 없습니다.",
		couldnTLoadTheStory: "작품 목록을 불러오지 못했습니다.",
		couldnTLoadFeaturedStories: "대표작을 불러오지 못했습니다.",
		noPinnedStories: "고정한 작품이 없습니다.",
		addFeaturedStory: "대표작 추가",
		tryAgain: "다시 시도",
		addStory: "작품 추가",
		untitled: "제목 없음",
		showMore: "더 보기",
		featuredStories: "대표작",
		close: "닫기",
		limitNote: "공개 프로필 맨 위에 최대 {{limit}}개까지 고정합니다.",
		moveEarlier: "{{title}} 앞으로 옮기기",
		moveLater: "{{title}} 뒤로 옮기기",
		unpin: "{{title}} 고정 해제",
	},
	useAccountDeletion: {
		accountCouldNotEraseThis: "[account] 이 기기의 로컬 데이터를 지우지 못했다",
		accountCouldNotSendThe: "[account] 탈퇴 요청을 보내지 못했다",
	},
	avatarCropRender: {
		couldNotCreateTheImage: "이미지를 만들지 못했다",
		couldNotOpenTheCanvas: "캔버스를 열지 못했다",
		decodeFailed: "디코드 실패",
		emptyImage: "빈 이미지",
	},
	restriction: {
		banned: {
			nickname: "이용이 차단된 계정이라 닉네임을 변경할 수 없습니다.",
			bio: "이용이 차단된 계정이라 소개를 변경할 수 없습니다.",
			pinned: "이용이 차단된 계정이라 대표작을 변경할 수 없습니다.",
		},
		suspended: {
			nickname: "이용이 정지된 계정이라 닉네임을 변경할 수 없습니다.",
			bio: "이용이 정지된 계정이라 소개를 변경할 수 없습니다.",
			pinned: "이용이 정지된 계정이라 대표작을 변경할 수 없습니다.",
		},
	},
	connect: {
		account: "계정",
		providerAccount: "{{provider}} 계정",
		alreadyLinked:
			"이 {{subject}}은 이미 다른 RowCat 계정에 연결되어 있습니다. 계정을 합칠 수는 없습니다.",
		emailMismatchApple:
			'RowCat 계정과 같은 이메일의 {{subject}}만 연결할 수 있습니다. Apple 화면에서 "내 이메일 가리기"를 끄고 다시 시도해 주세요.',
		emailMismatch:
			"RowCat 계정과 같은 이메일의 {{subject}}만 연결할 수 있습니다.",
		failed: "{{subject}}을 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		incomplete: "{{subject}} 연결이 완료되지 않았습니다.",
	},
};
