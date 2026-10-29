import type { Messages } from "../../types.ts";

export const sync: Messages["sync"] = {
	failure: {
		autoSyncToggle:
			"자동 동기화 설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		recoveryRotate:
			"복구 코드를 새로 발급하지 못했습니다. 기존 코드는 그대로 쓸 수 있습니다.",
		forgetDevice:
			"이 기기의 신뢰를 해제하지 못했습니다. 잠시 후 다시 시도해 주세요.",
	},
	error: {
		sync_quota_exceeded: "동기화 저장 공간이 가득 찼습니다.",
		sync_keyring_proof_invalid: "이 기기의 열쇠가 더 이상 맞지 않습니다.",
		account_restricted: "제한된 계정은 새 변경을 올릴 수 없습니다.",
		login_required: "다시 로그인해 주세요.",
		fallback: "동기화에 실패했습니다. 잠시 후 다시 시도해 주세요.",
	},
	section: {
		preparing: "준비 중…",
		autoSyncLabel: "자동 동기화",
		autoSyncNote:
			"이 기기에서 변경 사항을 자동으로 동기화합니다. 이 설정은 기기마다 따로 저장됩니다.",
		setup: "동기화 설정",
		connectFromOtherDevice: "다른 기기로 연결",
		useRecoveryCode: "복구 코드 사용",
		startOver: "처음부터 다시 시작",
		syncNow: "지금 동기화",
		connectNewDevice: "새 기기 연결",
		rotateRecoveryCode: "복구 코드 재발급",
		forgetDevice: "이 기기 신뢰 해제",
		forgetNote:
			"신뢰 해제는 이 기기에만 적용됩니다. 다른 기기의 접근을 막지 않고, 로그아웃되지도 않으며, 서버에 저장된 데이터도 지워지지 않습니다. 이 기기의 대화와 초안은 그대로 남습니다.",
		recoveryTitleDefault: "복구 코드",
		recoveryTitleSetup: "복구 코드를 적어 두세요",
		recoveryTitleRotated: "새 복구 코드",
	},
	status: {
		checking: "확인 중…",
		disabledTitle: "동기화가 설정되지 않았습니다.",
		disabledBody:
			"설정하면 대화와 초안이 암호화된 채로 다른 기기와 이어집니다. 서버는 그 내용을 읽을 수 없습니다.",
		lockedTitle: "이 기기에서는 잠겨 있습니다.",
		lockedBody:
			"이미 동기화 중인 다른 기기에서 연결하거나, 복구 코드를 입력하면 이 기기에서도 이어갈 수 있습니다.",
		syncing: "동기화 중…",
		errorBody:
			"이 기기의 대화와 초안은 그대로 있습니다. 다시 시도할 수 있습니다.",
		lastSynced: "마지막 동기화: {{when}}",
		neverSynced: "아직 동기화하지 않았습니다.",
	},
	auto: {
		off: "자동 동기화가 꺼져 있습니다.",
		offline: "오프라인에서 대기 중입니다.",
		backoff: "연결을 기다리는 중입니다. 잠시 후 다시 시도합니다.",
		blocked: "동기화를 다시 확인해 주세요.",
		on: "변경 사항은 자동으로 동기화됩니다.",
	},
	recoverySummary: {
		count_one: "{{count}}건",
		count_other: "{{count}}건",
	},
	recoveryCode: {
		shownOnce:
			"이 코드는 지금 한 번만 표시됩니다. 다른 기기에서 동기화를 열 때 필요합니다.",
		serverUnaware:
			"서버는 이 코드를 알지 못합니다. 코드를 잃고 신뢰된 기기도 남아 있지 않으면 <strong>서버에 저장된 동기화 데이터를 다시는 읽을 수 없습니다.</strong>",
		cannotRecover:
			"저희도 복구해 드릴 수 없습니다. 이 기기의 대화와 초안은 그대로 남습니다.",
		acknowledge: "코드를 안전한 곳에 적어 두었습니다.",
		copyFailed: "복사하지 못했습니다. 위 코드를 직접 선택해 복사해 주세요.",
		done: "확인했습니다",
	},
	unlock: {
		title: "잠금 해제",
		description: "동기화를 설정할 때 받은 복구 코드를 입력하세요.",
		label: "복구 코드",
		submit: "잠금 해제",
		mistyped: "복구 코드를 다시 확인해 주세요. 잘못 입력된 글자가 있습니다.",
		wrongCode:
			"이 코드로는 잠금을 해제할 수 없습니다. 다른 코드인지 확인해 주세요.",
	},
	pair: {
		title: "다른 기기로 연결",
		description:
			"이미 동기화를 쓰고 있는 기기에서 이 코드를 입력하면, 복구 코드 없이 이 기기에서도 동기화를 이어갈 수 있습니다.",
		creating: "코드를 만드는 중…",
		instructions:
			"기존 기기의 <strong>계정 → 데이터 → 새 기기 연결</strong>에서 이 코드를 입력하세요. 승인되면 이 화면이 자동으로 넘어갑니다.",
		timeLeft: "남은 시간",
		pairedTitle: "이 기기에서 동기화가 열렸습니다.",
		pairedBody: "다른 기기의 대화와 초안을 곧 이어서 볼 수 있습니다.",
		expiredTitle: "코드가 만료되었습니다.",
		expiredBody: "다시 시작하면 새 코드가 만들어집니다.",
		startFailed: "연결을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		pollFailed: "연결을 확인하지 못했습니다. 네트워크를 확인해 주세요.",
		wrongAccount:
			"받은 열쇠가 이 계정의 것이 아닙니다. 이 기기에는 아무것도 저장하지 않았습니다.",
		expiredOrCancelled:
			"연결이 만료되었거나 취소되었습니다. 다시 시작해 주세요.",
		incomplete:
			"연결을 완료하지 못했습니다. 코드를 다시 확인하고 처음부터 시도해 주세요.",
		loginRequired: "다시 로그인해 주세요.",
	},
	approve: {
		title: "새 기기 연결",
		description: "새 기기의 화면에 표시된 코드를 입력하세요.",
		approvedTitle: "승인했습니다.",
		approvedBody: "새 기기에서 곧 동기화가 열립니다.",
		label: "연결 코드",
		warning:
			"승인하면 그 기기가 이 계정의 대화와 초안을 읽을 수 있게 됩니다. 승인한 뒤에는 원격으로 되돌릴 수 없습니다.",
		submit: "승인",
		submitting: "승인 중…",
		malformed: "코드를 다시 확인해 주세요. 16글자입니다.",
		notFound:
			"그 코드로 기다리는 기기가 없습니다. 코드가 만료됐을 수 있습니다.",
		alreadyApproved: "이미 승인된 코드입니다.",
		restricted: "제한된 계정은 새 기기를 연결할 수 없습니다.",
		locked: "이 기기가 잠겨 있어 승인할 수 없습니다.",
		failed: "승인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
	},
	reset: {
		failed:
			"서버의 동기화 데이터를 비우지 못했습니다. 잠시 후 다시 시도해 주세요.",
		recentLogin:
			"보안을 위해 최근 로그인 확인이 필요합니다. 다시 로그인한 뒤 시도해 주세요.",
		title: "동기화를 처음부터 다시 시작할까요?",
		description:
			"서버에 저장된 동기화 데이터와 이 기기의 열쇠가 삭제됩니다. 이 기기의 대화와 초안은 그대로 남고, 동기화를 다시 설정하면 새 열쇠로 다시 올라갑니다. 다른 기기의 데이터도 그대로이며, 그 기기는 다음에 열릴 때 동기화를 다시 설정해야 합니다.",
		submit: "처음부터 다시 시작",
		pending: "처리 중…",
	},
};
