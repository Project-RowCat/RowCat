import type { Messages } from "../../types.ts";

export const settings: Messages["settings"] = {
	title: "설정",
	navLabel: "설정 분류",
	category: {
		general: "일반",
		ai: "AI",
		persona: "페르소나",
	},
	categoryDescription: {
		general: "이 앱의 모양과 이 기기의 언어·알림·저장된 데이터를 관리합니다.",
		ai: "새 대화에 기본으로 적용되는 생성 설정입니다. 이 기기에만 적용됩니다.",
		persona: "대화에서 맡을 역할을 저장해 두고 여러 대화에서 다시 고릅니다.",
	},
	account: {
		label: "계정 관리",
		hint: "계정 화면으로 이동합니다",
	},
	guest: {
		title: "로그인이 필요합니다",
		description:
			"테마 색·생성 기본값·페르소나는 계정과 이 기기에 저장됩니다. 화면 밝기와 언어는 로그인하지 않아도 머리말에서 바꿀 수 있습니다.",
	},
	unavailable: "세션을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
	appearance: {
		sectionTitle: "화면",
		fieldLabel: "화면 밝기",
		fieldDescription:
			"시스템 설정을 따르거나 밝기를 직접 고릅니다. 이 기기에만 적용됩니다.",
		value: {
			system: "시스템 설정 따르기",
			light: "밝게",
			dark: "어둡게",
		},
	},
	language: {
		fieldLabel: "언어",
		fieldDescription:
			"RowCat을 표시할 언어입니다. 따로 고르지 않으면 휴대폰의 언어를 따릅니다. 이 기기에만 적용됩니다.",
		system: "시스템 설정 따르기",
	},
	localData: {
		sectionTitle: "이 기기의 데이터",
		sectionDescription: "대화와 작성 중인 초안은 이 기기에 저장됩니다.",
		rowLabel: "저장된 데이터 지우기",
		rowDescription:
			"이 기기에 저장된 대화와 초안을 지웁니다. 계정과 다른 기기의 데이터는 그대로입니다.",
		action: "데이터 지우기",
		pending: "지우는 중…",
		confirmTitle: "이 기기의 데이터를 지울까요?",
		confirmDescription: "이 기기에 저장된 것만 지워지며, 되돌릴 수 없습니다.",
		removed:
			"대화와 메시지, 메모리, 페르소나, 작성 중인 초안, 이 기기의 생성 설정, 기억해 둔 동기화 키, 연결한 AI 제공자 API 키가 함께 지워집니다.",
		kept: "계정은 그대로입니다. 발행한 작품과 댓글, 다른 기기의 데이터는 함께 사라지지 않습니다. AI 제공자 계정의 API 키도 폐기되지 않습니다.",
		syncNote:
			"여러 기기 동기화를 쓰고 있다면 서버에 보관된 암호화 사본은 남습니다. 이 기기에서 키를 다시 입력하면 그 사본이 다시 내려옵니다.",
		afterNote:
			"지운 뒤에도 로그인은 유지되고, 이 기기의 데이터는 빈 상태에서 다시 시작합니다.",
		failure: "데이터를 지우지 못했습니다. 잠시 후 다시 시도해 주세요.",
	},
};
