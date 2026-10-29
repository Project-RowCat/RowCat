import type { Messages } from "../../types.ts";

export const runtimeTemplates: Messages["runtimeTemplates"] = {
	template: {
		blank: {
			name: "Blank",
			description: "진입 파일 하나로 시작합니다. 구조를 직접 잡고 싶을 때.",
			demonstrates1: "진입 파일",
			demonstrates2: "화면 구성",
			demonstrates3: "텍스트 스타일",
		},
		investigation: {
			name: "Investigation",
			description: "조사로 단서를 모으고 사건을 여는 화면. 진행이 저장됩니다.",
			demonstrates1: "useStoryState로 남는 단서와 조사 기록",
			demonstrates2: "중복이 표현되지 않는 진행 규칙",
			demonstrates3: "정적 콘텐츠와 저장된 id의 분리",
			demonstrates4: "저장된 값에서 파생되는 완료 상태",
		},
		messenger: {
			name: "Messenger",
			description:
				"메시지를 직접 입력하면 AI가 답하는 대화 화면. 대화가 저장됩니다.",
			demonstrates1: "TextInput으로 받는 자유 입력",
			demonstrates2: "useGeneration()으로 부르는 RowCat AI",
			demonstrates3: "화면의 useState와 진행의 useStoryState",
			demonstrates4: "실패해도 남는 내 메시지와 다시 시도",
		},
		"relationship-profile": {
			name: "Relationship Profile",
			description: "활동으로 관계가 자라는 인물 화면. 진행이 저장됩니다.",
			demonstrates1: "useStoryState로 남는 관계와 활동 기록",
			demonstrates2: "useMemo로 만드는 파생 단계",
			demonstrates3: "저장된 id에서 그리는 활동 기록",
			demonstrates4: "한 번만 할 수 있는 활동",
		},
		"visual-novel": {
			name: "Visual Novel",
			description:
				"선택지로 갈라지는 장면과 이어지는 호감도. 진행이 저장됩니다.",
			demonstrates1: "useStoryState로 이어지는 플레이스루 진행",
			demonstrates2: "분기하는 장면 데이터와 화면의 분리",
			demonstrates3: "저장된 값에서 파생되는 결말",
			demonstrates4: "화면의 useState와 진행의 useStoryState",
		},
		"idol-debut": {
			name: "데뷔까지 여덟 주",
			description:
				"데뷔 평가까지 여덟 주. 연습생 다섯의 매니저가 되어 한 주를 짜고, 저녁마다 한 명과 남아 직접 말을 겁니다. 무엇을 건네는지가 무엇을 알게 되는지를 정하고, 알게 된 이야기는 다음 데뷔조에도 남습니다.",
			demonstrates1: "직접 건넨 한마디가 무엇을 알게 될지 정하는 저녁",
			demonstrates2: "플레이어의 문장을 낱말로 판정하는 순수 규칙",
			demonstrates3: "열린 이야기를 지시문에 실어 인물의 목소리로 답하게 하기",
			demonstrates4: "세 칸을 짜면 그대로 정산되는 결정적인 주간 규칙",
			demonstrates5: "다섯 멤버의 보컬 · 댄스 · 표현과 컨디션 · 신뢰",
			demonstrates6: "선택지로 갈라지는 주간 사건과 두 번의 중간 점검",
			demonstrates7:
				"useStoryState의 여덟 주와 usePersistentState의 남는 이야기",
			demonstrates8: "resolveEnding 하나가 정하는 네 가지 끝",
			demonstrates9: "전이로 장면이 바뀌는 것을 말하는 화면 구성",
		},
	},
	gallery: {
		fileCount_one: "파일 {{count}}개",
		fileCount_other: "파일 {{count}}개",
		confirm: "{{name}}(으)로 시작하기",
		title: "런타임 만들기",
		description:
			"템플릿으로 시작하거나 빈 프로젝트로 시작합니다. 만들어진 파일은 전부 고칠 수 있습니다.",
		all: "전체",
		filterLabel: "분류 필터",
		listLabel: "템플릿",
		demonstrates: "이 템플릿이 보여 주는 것",
		files: "만들어지는 파일",
		featured: "추천",
		cancel: "취소",
		creating: "런타임을 만드는 중…",
		failed: "런타임을 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
		retry: "다시 시도",
	},
	category: {
		basic: "기본",
		story: "스토리",
		social: "소셜",
		game: "게임",
	},
	complexity: {
		beginner: "입문",
		intermediate: "보통",
		advanced: "깊이 있는 예제",
	},
};
