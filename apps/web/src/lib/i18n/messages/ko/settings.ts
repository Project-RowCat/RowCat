import type { Messages } from "../../types.ts";

export const settings: Messages["settings"] = {
	theme: {
		preset: {
			default: "기본",
			white: "흰색",
			gray: "회색",
			black: "검은색",
		},
		sectionTitle: "테마",
		sectionDescription:
			"이 설정은 계정에 저장되어 로그인한 다른 기기에도 적용되고, 밝은 화면과 어두운 화면 어디에서나 같은 색이 쓰입니다.",
		presetGroupTitle: "기본 색상",
		presetGroupDescription: "RowCat이 준비한 색상 중 하나를 고를 수 있습니다.",
		customGroupTitle: "직접 색상 꾸미기",
		customGroupDescription:
			"원하는 색상으로 배경, 표면, 포인트 색상과 배경 그라데이션을 직접 설정할 수 있습니다.",
		foregroundNote: "글자색은 선택한 색상에 맞춰 자동으로 조정됩니다.",
		save: "색상 저장",
		saveNote: "직접 설정한 색상은 저장해야 계정에 적용됩니다.",
		resetMenu: "초기화",
		clearColors: "직접 설정 초기화",
		resetAll: "전체 테마 초기화",
		slotPreset: "프리셋 색상 사용",
		slotUnset: "프리셋 색상",
		pickerSurface: "색상 채도와 밝기",
		pickerHue: "색상 계열",
		pickerHex: "색상 코드",
		pickerCurrent: "현재 색상",
		invalidValue: "#rrggbb 형식의 색만 사용할 수 있습니다.",
		gradientToggle: "배경 그라데이션",
		gradientToggleDescription:
			"배경을 두 가지 색이 이어지는 그라데이션으로 그립니다.",
		gradientFrom: "시작 색상",
		gradientFromNote: "위 배경 색상이 그대로 쓰입니다.",
		gradientTo: "끝 색상",
		gradientToDescription: "배경 색상에서 이 색으로 이어집니다.",
		gradientToControl: "그라데이션 끝",
		gradientAngle: "방향",
		gradientAngleUnit: "도",
		gradientContrast:
			"두 색의 밝기 차이가 커서 글자가 잘 보이지 않을 수 있습니다.",
		randomPalette: "랜덤 팔레트",
		randomGradient: "그라데이션 랜덤",
		previewTitle: "테마 미리보기",
		previewNote: "미리보기는 저장하기 전까지 이 상자 안에만 적용됩니다.",
		slot: {
			background: "배경",
			surface: "표면",
			primary: "포인트",
		},
		slotDescription: {
			background: "페이지 전체의 기본 배경입니다.",
			surface: "카드, 팝오버, 사이드바의 배경입니다.",
			primary: "버튼과 선택된 요소에 쓰이는 강조색입니다.",
		},
		failure: {
			preset: "기본 색상을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
			colors: "색상을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
			clearColors:
				"직접 설정을 초기화하지 못했습니다. 잠시 후 다시 시도해 주세요.",
			resetAll: "테마를 초기화하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		},
	},
	nav: {
		general: "일반",
		ai: "AI",
		persona: "페르소나",
		account: "계정 관리",
		return: "대화로 돌아가기",
	},
	appearance: {
		theme: {
			system: "시스템 설정 따르기",
			light: "밝게",
			dark: "어둡게",
		},
		language: "언어",
		languageDescription:
			"RowCat을 표시할 언어입니다. 이 브라우저에 저장되며, 적용하려면 페이지를 다시 불러옵니다.",
	},
	connect: {
		notPermitted:
			"만 14세 미만 회원은 개인 API 키를 연결할 수 없습니다. 대화는 RowCat 제공 모델로 이용할 수 있습니다.",
		saveFailed: "연결을 저장하지 못했습니다. 다시 시도해 주세요.",
		invalidCredential: "제공자가 이 API 키를 거절했습니다. 키를 확인해 주세요.",
		rateLimited:
			"제공자의 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.",
		quotaExceeded:
			"제공자 계정의 사용 한도를 초과했습니다. 제공자 계정을 확인해 주세요.",
		unavailable: "지금은 키를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
	},
	providerDialog: {
		replaceTitle: "{{label}} 키 교체",
		connectTitle: "{{label}} 연결",
		description: "{{label}}의 개인 API 키로 대화를 생성합니다.",
	},
	picker: {
		surfaceValue: "채도 {{saturation}}%, 밝기 {{brightness}}%",
		hueValue: "{{degrees}}도",
	},
	section: {
		editColor: "{{name}} 색상 편집",
		colorHue: "{{name}} 색상 계열",
	},
	providers: {
		disconnectTitle: "{{label}} 연결을 해제할까요?",
	},
	generationDefaults: {
		connect: "{{provider}} 연결하기",
		appliedToNewConversationsBy:
			"새 대화에 기본으로 적용됩니다. 이 기기에만 적용되며, 대화마다 다르게 설정한 경우에는 그 대화의 설정이 우선합니다.",
		couldnTSaveTheSettings: "설정을 저장하지 못했습니다. 다시 시도해 주세요.",
		howDeeplyToThinkBefore: "답변 전에 얼마나 깊게 생각할지 정합니다.",
		theDefaultLengthOfReplies: "대화에서 받을 응답의 기본 분량입니다.",
		theModelThatGeneratesConversations: "대화를 생성할 모델입니다.",
		generationDefaults: "기본 생성",
	},
	themeCustomizationSection: {
		youReNotConnectedRight:
			"지금은 연결되어 있지 않습니다. 연결되면 테마 설정을 다시 불러옵니다.",
		couldnTLoadThemeSettings: "테마 설정을 불러오지 못했습니다.",
		resetting: "초기화 중…",
		saving: "저장 중…",
		getStarted: "시작하기",
	},
	settingsGeneralPage: {
		manageHowTheAppLooks:
			"앱의 표시 방식과 테마 색상, 이 기기에 저장된 데이터를 관리합니다.",
		general: "일반",
	},
	localDataSection: {
		clearsTheConversationsDraftsGeneration:
			"이 브라우저에 저장된 대화와 초안, 생성 설정과 저장해 둔 API 키를 지웁니다. 계정과 다른 기기의 데이터는 그대로입니다.",
		conversationsDraftsInProgressThis:
			"대화와 작성 중인 초안, 이 기기의 생성 설정과 저장해 둔 AI 제공자 API 키가 이 브라우저에 저장됩니다.",
		couldnTClearTheData:
			"데이터를 지우지 못했습니다. 다른 탭에서 RowCat을 열어 두었다면 닫고 다시 시도해 주세요.",
		clearStoredData: "저장된 데이터 지우기",
		thisDeviceSData: "이 기기 데이터",
		clearData: "데이터 지우기",
		dangerZone: "위험 영역",
	},
	settingsAiPage: {
		manageConversationGenerationDefaultsAnd:
			"대화 생성의 기본값과 개인 AI 제공자를 관리합니다. 여기 있는 값은 이 기기에만 적용됩니다.",
	},
	providerConnectionDialog: {
		whenYouUseThisProvider:
			"이 제공자를 사용할 때 대화 생성에 필요한 컨텍스트가 브라우저에서 해당 제공자로 직접 전송됩니다.",
		apiUsageFeesForThat:
			"해당 제공자의 API 사용 요금은 사용자의 제공자 계정에 청구될 수 있습니다.",
		theApiKeyIsStored:
			"API 키는 이 기기에만 저장되며 RowCat 서버로 전송되지 않습니다.",
		usingAPersonalApiKey:
			"공용 기기에서는 개인 API 키 사용을 권장하지 않습니다.",
		hideApiKey: "API 키 가리기",
		createAnApiKey: "API 키 만들기",
		showApiKey: "API 키 보기",
		apiKey: "API 키",
		checking: "확인 중…",
		hide: "가리기",
		show: "보기",
		replace: "교체",
		connect: "연결",
	},
	localDataResetDialog: {
		ifYouUseSyncAcross:
			"기기 간 동기화를 쓰고 있다면 서버에 보관된 암호화 사본은 남아 있습니다. 이 기기에서 열쇠를 다시 넣으면 그 사본이 다시 내려옵니다.",
		conversationsDraftsInProgressThis:
			"대화와 작성 중인 초안, 이 기기의 생성 설정, 저장해 둔 AI 제공자 API 키, 기억해 둔 동기화 열쇠가 함께 지워집니다.",
		yourAccountStaysPublishedStories:
			"계정은 그대로 남습니다. 발행한 작품과 댓글은 이 조작으로 사라지지 않습니다.",
		onlyWhatSStoredIn:
			"이 브라우저에 저장된 내용만 지워지고, 되돌릴 수 없습니다.",
		thePageReloadsAfterClearing: "지운 뒤에는 페이지를 다시 불러옵니다.",
		clearThisDeviceSData: "이 기기의 데이터를 지울까요?",
		clearData: "데이터 지우기",
		clearing: "지우는 중…",
	},
	providerConnections: {
		deletesTheApiKeyStored:
			"이 기기에 저장된 API 키를 지웁니다. 이 제공자를 선택한 대화는 다시 연결하기 전까지 생성할 수 없지만, 선택해 둔 모델 설정은 그대로 유지됩니다. 제공자 계정의 키와 다른 기기의 연결은 그대로입니다.",
		membersUnder14CanT:
			"만 14세 미만 회원은 개인 API 키를 연결할 수 없어요. 대화는 RowCat 제공 모델로 그대로 이용할 수 있고, 만 14세가 되면 이 기능이 열립니다.",
		connectAPersonalApiKey:
			"개인 API 키를 연결하면 그 제공자의 모델을 선택할 수 있습니다. 연결은 이 기기에서만 사용되며, API 키는 RowCat 서버로 전송되지 않습니다.",
		couldnTDisconnectPleaseTry:
			"연결을 해제하지 못했습니다. 다시 시도해 주세요.",
		aiProviders: "AI 제공자",
		notConnected: "연결 안 됨",
		disconnect: "연결 해제",
		disconnecting: "해제 중…",
		replaceKey: "키 교체",
		connected: "연결됨",
		connect: "연결",
	},
	settingsNavigation: {
		settings: "설정",
	},
	appearanceSection: {
		followTheSystemSettingOr:
			"시스템 설정을 따르거나 밝기를 직접 고릅니다. 이 브라우저에만 적용됩니다.",
		screenBrightness: "화면 밝기",
		display: "표시",
	},
	runtimeGeneration: {
		title: "생성 설정",
		description: "이 작품의 AI 생성에 쓸 모델과 추론 정도입니다.",
		modelDescription: "이 작품을 생성할 모델입니다.",
		reasoningDescription:
			"이 작품에서 답변 전에 얼마나 깊게 생각할지 정합니다.",
		saveFailed: "설정을 저장하지 못했습니다. 다시 시도해 주세요.",
		inheritTitle: "기본 설정",
		inheritBefore: "이 작품에서 따로 지정하지 않은 항목은 ",
		inheritLink: "기본 AI 설정",
		inheritAfter:
			"을 따릅니다. 여기서 고른 값은 이 기기에만 적용되고, 다음 생성 요청부터 쓰입니다.",
		connectProvider: "AI 설정에서 {{provider}} 연결하기",
	},
};
