import type { Messages } from "../../types.ts";

export const auth: Messages["auth"] = {
	rateLimited: "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
	emailTaken: "이미 사용 중인 이메일입니다.",
	passwordTooShort: "비밀번호는 {{min}}자 이상이어야 합니다.",
	passwordTooLong: "비밀번호는 {{max}}자 이하여야 합니다.",
	invalidEmail: "이메일 형식이 올바르지 않습니다.",
	signinTransport: "로그인 요청을 처리하지 못했습니다. 다시 시도해 주세요.",
	signupTransport: "가입 요청을 처리하지 못했습니다. 다시 시도해 주세요.",
	emailNotVerified:
		"이메일 확인이 필요합니다. 받은 편지함에서 확인 메일을 열어 주세요.",
	invalidCredentials: "이메일 또는 비밀번호가 올바르지 않습니다.",
	signupFailed: "가입하지 못했습니다. 잠시 후 다시 시도해 주세요.",
	signOutFailed:
		"로그아웃하지 못했습니다. 아직 로그인된 상태이니 다시 시도해 주세요.",
	nameRequired: "이름을 입력해 주세요.",
	emailRequired: "이메일을 입력해 주세요.",
	passwordRequired: "비밀번호를 입력해 주세요.",
	newPasswordRequired: "새 비밀번호를 입력해 주세요.",
	passwordMismatch: "비밀번호가 일치하지 않습니다.",
	social: {
		kakao: "카카오",
		startTransport:
			"{{provider}} 로그인을 시작하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.",
		startFailed:
			"{{provider}} 로그인을 시작하지 못했습니다. 다른 방법으로 로그인하거나 잠시 후 다시 시도해 주세요.",
		emailConsentProvider:
			"{{provider}} 계정의 이메일 제공에 동의해야 로그인할 수 있습니다. 다시 시도한 뒤 이메일 항목에 동의해 주세요.",
		emailConsent:
			"이메일 제공에 동의해야 로그인할 수 있습니다. 다시 시도한 뒤 이메일 항목에 동의해 주세요.",
		notLinkedProvider:
			"이 이메일로 만든 RowCat 계정에 아직 {{provider}} 로그인이 연결되어 있지 않습니다. 원래 쓰던 방법으로 로그인한 뒤 계정 화면에서 {{provider}} 로그인을 연결해 주세요.",
		notLinked:
			"이 이메일로 만든 RowCat 계정에 아직 이 로그인 수단이 연결되어 있지 않습니다. 원래 쓰던 방법으로 로그인한 뒤 계정 화면에서 연결해 주세요.",
		emailMismatch:
			"이미 있는 RowCat 계정과 이메일이 달라 로그인하지 못했습니다. 처음 가입할 때 쓴 방법으로 로그인해 주세요.",
		alreadyLinkedProvider:
			"이 {{provider}} 계정은 이미 다른 RowCat 계정에 연결되어 있습니다. 계정을 합칠 수는 없습니다.",
		alreadyLinked:
			"이 계정은 이미 다른 RowCat 계정에 연결되어 있습니다. 계정을 합칠 수는 없습니다.",
		incompleteProvider:
			"{{provider}} 로그인이 완료되지 않았습니다. 다시 시도하거나 다른 방법으로 로그인해 주세요.",
		incomplete:
			"로그인이 완료되지 않았습니다. 다시 시도하거나 다른 방법으로 로그인해 주세요.",
		redirecting: "{{provider}}로 이동하는 중…",
		continue: "{{provider}}로 계속하기",
	},
	passkey: {
		transport:
			"패스키 로그인을 처리하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.",
		failed: "패스키로 로그인하지 못했습니다. 다른 로그인 방법을 이용해 주세요.",
		checking: "패스키를 확인하는 중…",
		signIn: "패스키로 로그인",
	},
	verification: {
		resendTransport:
			"메일을 다시 보내지 못했습니다. 연결을 확인한 뒤 시도해 주세요.",
		alreadyVerified: "이미 확인된 이메일입니다. 그대로 로그인해 주세요.",
		resendFailed: "메일을 다시 보내지 못했습니다. 잠시 후 다시 시도해 주세요.",
		title: "이메일을 확인해 주세요",
		created: "계정이 만들어졌습니다. 아래 주소로 확인 메일을 보냈습니다.",
		notVerified:
			"이 계정은 아직 이메일이 확인되지 않았습니다. 확인 메일을 다시 보냈습니다.",
		body: "메일 안의 링크를 열면 확인이 끝나고, 그다음 로그인할 수 있습니다. 링크는 일정 시간이 지나면 만료됩니다.",
		sending: "보내는 중…",
		resendIn: "다시 보내기 (",
		seconds: "초)",
		resend: "확인 메일 다시 보내기",
		resent: "확인 메일을 다시 보냈습니다.",
		wrongAddress: "주소가 틀렸나요? 처음으로 돌아가기",
	},
	form: {
		name: "이름",
		email: "이메일",
		password: "비밀번호",
		confirmPassword: "비밀번호 확인",
		hidePassword: "비밀번호 숨기기",
		showPassword: "비밀번호 표시",
		remember: "로그인 상태 유지",
		forgot: "비밀번호를 잊으셨나요?",
		signUp: "가입하기",
		signingUp: "가입하는 중…",
		signIn: "로그인",
		signingIn: "로그인하는 중…",
	},
	page: {
		createAccount: "계정 만들기",
		signIn: "로그인",
		verified: "이메일 확인이 끝났습니다. 이제 로그인할 수 있습니다.",
		passwordReset:
			"비밀번호를 바꿨습니다. 다른 기기에서는 모두 로그아웃되었으니 새 비밀번호로 로그인해 주세요.",
		or: "또는",
		haveAccount: "이미 계정이 있나요? ",
		noAccount: "계정이 없나요? ",
		signUp: "회원가입",
	},
	reset: {
		title: "비밀번호 재설정",
		remembered: "비밀번호가 기억났나요?",
		signIn: "로그인",
		expiredTitle: "링크를 다시 받아 주세요",
		forgotTitle: "비밀번호를 잊으셨나요?",
		expiredBody:
			"재설정 링크가 만료되었거나 이미 사용되었습니다. 가입한 이메일 주소를 입력하면 새 링크를 보내 드립니다.",
		forgotBody:
			"가입한 이메일 주소를 입력하면 새 비밀번호를 정할 수 있는 링크를 보내 드립니다.",
		email: "이메일",
		sending: "보내는 중…",
		send: "재설정 링크 받기",
		sentTitle: "메일함을 확인해 주세요",
		sentBody:
			"아래 주소로 가입된 계정이 있다면 비밀번호 재설정 링크를 보냈습니다.",
		sentNote:
			"링크는 1시간 동안 한 번만 쓸 수 있습니다. 메일이 보이지 않으면 스팸함도 확인해 주세요.",
		wrongAddress: "주소가 틀렸나요? 다시 입력하기",
		newTitle: "새 비밀번호를 정해 주세요",
		newBody:
			"바꾸고 나면 이 계정에 로그인되어 있던 모든 기기에서 로그아웃됩니다.",
		newPassword: "새 비밀번호",
		confirmNewPassword: "새 비밀번호 확인",
		changing: "바꾸는 중…",
		change: "비밀번호 바꾸기",
		emailRequired: "이메일을 입력해 주세요.",
		requestTransport:
			"요청을 보내지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.",
		disabled:
			"지금은 비밀번호 재설정 메일을 보낼 수 없습니다. 다른 로그인 방법으로 들어와 주세요.",
		requestFailed: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		changeTransport:
			"비밀번호를 바꾸지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.",
		changeFailed: "비밀번호를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.",
	},
	twoFactor: {
		title: "2단계 인증",
		authenticatorPrompt: "인증 앱에 표시된 여섯 자리 코드를 입력해 주세요.",
		backupPrompt:
			"받아 둔 백업 코드 하나를 입력해 주세요. 쓴 코드는 다시 쓸 수 없습니다.",
		authenticatorLabel: "인증 코드",
		backupLabel: "백업 코드",
		checking: "확인하는 중…",
		confirm: "확인",
		useBackup: "인증 앱을 쓸 수 없나요? 백업 코드로 로그인",
		useAuthenticator: "인증 앱 코드로 로그인",
		restart: "처음부터 다시 로그인",
		disconnected: "연결이 끊겼습니다. 다시 시도해 주세요.",
		expired: "확인 시간이 지났습니다. 처음부터 다시 로그인해 주세요.",
		locked:
			"여러 번 틀려 잠시 잠겼습니다. 잠시 후 처음부터 다시 로그인해 주세요.",
		backupInvalid: "백업 코드가 맞지 않거나 이미 사용한 코드입니다.",
		codeInvalid: "코드가 맞지 않습니다. 인증 앱의 지금 코드를 입력해 주세요.",
		recentLogin:
			"보안을 위해 최근에 로그인한 기기에서만 바꿀 수 있습니다. 다시 로그인한 뒤 시도해 주세요.",
		passwordInvalid: "비밀번호가 맞지 않습니다.",
		otherFailed: "처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
	},
};
