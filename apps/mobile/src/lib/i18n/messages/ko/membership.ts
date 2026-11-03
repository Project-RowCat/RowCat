import type { Messages } from "../../types.ts";

export const membership: Messages["membership"] = {
	generic: "지금은 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.",
	offline: "요청을 보내지 못했습니다. 연결을 확인해 주세요.",
	sessionExpired: "로그인이 만료되었습니다. 다시 로그인해 주세요.",
	age: {
		title: "생년월일을 알려 주세요",
		description:
			"만 {{guardianAge}}세 미만인 경우 보호자의 동의가 필요해서 한 번만 여쭤봅니다. RowCat은 생년월일을 저장하지 않고, 만 {{guardianAge}}세 미만인지와 만 {{guardianAge}}세가 되는 날짜만 기록합니다.",
		fieldLabel: "생년월일",
		placeholder: "YYYY-MM-DD",
		hint: "예: 2011-03-07",
		submit: "확인",
		submitting: "확인 중…",
		empty: "생년월일을 입력해 주세요.",
		invalid:
			"생년월일을 다시 확인해 주세요. 오늘보다 뒤의 날짜는 입력할 수 없습니다.",
		exitNote:
			"생년월일을 알려 주지 않으면 서비스를 이용할 수 없습니다. 로그아웃하거나, 이 화면에서 바로 계정을 삭제하실 수 있습니다.",
	},
	guardian: {
		title: "보호자 동의가 필요해요",
		description:
			"만 {{guardianAge}}세 미만이라면 보호자(법정대리인)의 동의를 받아야 RowCat을 이용할 수 있어요. 아래 링크를 보호자에게 전달해 주세요. 보호자가 본인확인을 하고 동의하면 바로 이용할 수 있습니다.",
		steps: {
			verify: "보호자가 휴대전화 등으로 본인확인을 합니다.",
			consent: "보호자가 RowCat 이용에 동의합니다.",
			expiry: "링크는 하루 동안만 쓸 수 있어요.",
		},
		create: "보호자 동의 링크 만들기",
		recreate: "링크 다시 만들기",
		creating: "만드는 중…",
		linkTitle: "보호자에게 보낼 링크",
		copy: "링크 복사",
		copied: "복사했어요",
		share: "공유",
		newLink: "새 링크 만들기",
		copyFailed: "복사하지 못했어요. 위 주소를 직접 선택해 복사해 주세요.",
		shareFailed: "공유하지 못했어요. 링크를 복사해 주세요.",
		newLinkNote: "새 링크를 만들면 이전 링크는 쓸 수 없게 돼요.",
		waiting: "보호자의 동의를 기다리고 있어요.",
		declined: "보호자가 동의하지 않으셨어요. 다시 부탁드릴 수 있어요.",
		originMissing:
			"지금은 보호자 링크를 만들 수 없어요. 잠시 후 다시 시도해 주세요.",
		exitNote:
			"보호자의 동의를 받기 전까지는 서비스를 이용할 수 없어요. 로그아웃하거나, 이 화면에서 바로 계정을 삭제할 수 있어요.",
		unavailable:
			"지금은 보호자 동의 절차를 시작할 수 없습니다. 준비가 끝나면 이용하실 수 있어요.",
		notRequired:
			"이 계정에는 보호자 동의가 필요하지 않습니다. 화면을 다시 열어 주세요.",
	},
	gate: {
		signOut: "로그아웃",
		signingOut: "로그아웃 중…",
		signOutFailed: "로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		deleteGuide: "삭제되는 항목 자세히 보기",
	},
	adult: {
		verify: "본인확인",
		reverify: "본인확인 다시 하기",
		renewTitle: "본인확인 후 1년이 지났습니다.",
		renewNote:
			"성인 콘텐츠를 보려면 본인확인을 다시 해 주세요. 다시 확인하기 전까지는 표시를 켜 두어도 성인향 작품이 보이지 않습니다.",
		busy: {
			beginning: "여는 중…",
			provider: "본인확인 창에서 진행 중…",
			completing: "확인하는 중…",
		},
		surfaceTitle: "본인확인",
		surfaceNote:
			"확인이 끝나면 자동으로 돌아옵니다. 닫으면 진행하지 않고 취소됩니다.",
		done: "본인확인 결과를 반영했습니다.",
		recheck: "결과 다시 확인",
		recheckNote:
			"본인확인은 끝났지만 결과를 반영하지 못했습니다. 다시 확인해 주세요.",
		onWeb: "웹에서 본인확인",
		onWebNote:
			"지금은 앱에서 본인확인을 할 수 없습니다. 웹에서 로그인한 뒤 계정 화면에서 이어서 진행해 주세요.",
		error: {
			unavailable:
				"지금은 본인확인을 이용할 수 없습니다. 잠시 후 다시 확인해 주세요.",
			notFound: "진행 중인 본인확인이 없습니다. 처음부터 다시 시작해 주세요.",
			expired: "본인확인의 유효 시간이 지났습니다. 다시 시작해 주세요.",
			notCompleted: "본인확인이 완료되지 않았습니다. 다시 시도해 주세요.",
			conflict:
				"다른 창에서 본인확인이 진행되었습니다. 처음부터 다시 시작해 주세요.",
			providerFailed: "본인확인에 실패했습니다. 다시 시도해 주세요.",
			rateLimited: "본인확인 시도가 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
			minor:
				"만 {{guardianAge}}세 미만 계정은 성인 콘텐츠를 이용할 수 없습니다.",
			signedOut: "로그인이 풀렸습니다. 다시 로그인해 주세요.",
			failed: "본인확인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
			surfaceFailed:
				"본인확인 화면을 열지 못했습니다. 잠시 후 다시 시도해 주세요.",
			unsupported:
				"지금은 앱에서 본인확인을 할 수 없습니다. 웹에서 이어서 진행해 주세요.",
		},
	},
};
