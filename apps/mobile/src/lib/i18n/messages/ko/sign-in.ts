import type { Messages } from "../../types.ts";

export const signIn: Messages["signIn"] = {
	login: {
		signInTitle: "로그인",
		signUpTitle: "회원가입",
		nickname: "닉네임",
		email: "이메일",
		password: "비밀번호",
		confirmPassword: "비밀번호 확인",
		forgot: "비밀번호를 잊으셨나요?",
		signIn: "로그인",
		signUp: "가입하기",
		or: "또는",
		haveAccount: "이미 계정이 있나요? ",
		noAccount: "계정이 없나요? ",
		haveAccountLabel: "이미 계정이 있나요? 로그인",
		noAccountLabel: "계정이 없나요? 회원가입",
	},
	twoFactor: {
		title: "2단계 인증",
		authenticatorPrompt: "인증 앱에 표시된 여섯 자리 코드를 입력해 주세요.",
		backupPrompt:
			"받아 둔 백업 코드 하나를 입력해 주세요. 쓴 코드는 다시 쓸 수 없습니다.",
		authenticatorLabel: "인증 코드",
		backupLabel: "백업 코드",
		useBackupLabel: "백업 코드로 로그인",
		useBackup: "인증 앱을 쓸 수 없나요? 백업 코드로 로그인",
		useAuthenticator: "인증 앱 코드로 로그인",
		restart: "처음부터 다시 로그인",
	},
	social: {
		continue: "{{provider}}로 계속하기",
		redirecting: "{{provider}}로 이동하는 중…",
		providerUnavailable: "지금은 {{provider}} 로그인을 쓸 수 없습니다.",
		incomplete:
			"{{provider}} 로그인이 완료되지 않았습니다. 다시 시도하거나, 이 이메일로 가입한 적이 있다면 이메일로 로그인해 주세요.",
	},
	failure: {
		invalid_credentials: "이메일 또는 비밀번호를 확인해 주세요.",
		email_taken: "이미 사용 중인 이메일입니다.",
		invalid_email: "이메일 주소를 확인해 주세요.",
		password_too_short: "비밀번호는 8자 이상이어야 합니다.",
		password_too_long: "비밀번호가 너무 깁니다.",
		password_mismatch: "비밀번호가 일치하지 않습니다.",
		name_required: "닉네임을 입력해 주세요.",
		too_many_attempts: "잠시 후 다시 시도해 주세요.",
		provider_unavailable: "지금은 이 방법으로 로그인할 수 없습니다.",
		social_without_session:
			"로그인이 완료되지 않았습니다. 다시 시도하거나, 이 이메일로 가입한 적이 있다면 이메일로 로그인해 주세요.",
		unreachable: "서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		email_not_verified:
			"이메일 확인이 필요합니다. 받은 편지함에서 확인 메일을 열어 주세요.",
		session_without_viewer: "로그인하지 못했습니다. 다시 시도해 주세요.",
		sign_out_failed: "로그아웃하지 못했습니다. 다시 시도해 주세요.",
		two_factor_invalid_code:
			"코드가 맞지 않습니다. 인증 앱의 지금 코드를 입력해 주세요.",
		two_factor_invalid_backup_code:
			"백업 코드가 맞지 않거나 이미 사용한 코드입니다.",
		two_factor_expired:
			"확인 시간이 지났습니다. 처음부터 다시 로그인해 주세요.",
		two_factor_locked:
			"여러 번 틀려 잠시 잠겼습니다. 잠시 후 처음부터 다시 로그인해 주세요.",
		unknown: "로그인하지 못했습니다. 다시 시도해 주세요.",
	},
};
