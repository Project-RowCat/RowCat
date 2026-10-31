import type { Messages } from "../../types.ts";

export const runtimeStudio: Messages["runtimeStudio"] = {
	intro: {
		title: "커스텀 인터랙티브 경험 만들기",
		body: "TypeScript와 TSX로 이 작품만의 화면과 상호작용을 만듭니다. 템플릿으로 시작하거나 빈 프로젝트로 시작할 수 있고, 지금 쓰고 있는 프롬프트·로어·시작 장면·상황 이미지는 그대로 남습니다.",
		action: "시작하기",
		capability1: "커스텀 UI",
		capability2: "상호작용 상태",
		capability3: "재사용 가능한 컴포넌트",
		capability4: "분기하는 진행",
	},
	section: {
		title: "런타임",
		description:
			"코드로 만드는 선택적 확장입니다. 켜지 않아도 작품은 그대로 발행됩니다.",
		enabledBadge: "켜짐",
		disabledBadge: "꺼짐",
		open: "스튜디오 열기",
		disable: "런타임 끄기",
		enable: "런타임 다시 켜기",
		confidentiality:
			"런타임 코드는 플레이어 기기에서 실행되므로 비밀 저장소가 아닙니다. 비밀번호, API 키처럼 공개되면 안 되는 값을 코드에 넣지 마세요.",
		publishNotice:
			"작품을 발행하면 런타임도 함께 발행됩니다. 코드는 서버에서 컴파일되고, 플레이어는 그 결과를 받아 실행합니다.",
		savedCheckClean:
			"저장된 코드의 구조 검사: 이상 없음. 타입 검사와 컴파일은 발행 때 서버가 합니다.",
		savedCheckFailed:
			"저장된 코드를 검사하지 못했습니다. 스튜디오에서 확인해 주세요.",
		savedCheckOpen: "스튜디오에서 고치기",
		savedCheckProblems:
			"저장된 코드의 구조 검사: 문제 {{errors}}개. 이대로 발행하면 서버가 거절합니다.",
		loadingProject: "프로젝트를 불러오는 중…",
		fileCount: "{{count}}개의 파일이 이 작품에 붙어 있습니다.",
	},
	disableConfirm: {
		title: "런타임을 끌까요?",
		body: "작성한 코드는 그대로 남습니다. 다시 켜면 지금 상태에서 이어서 쓸 수 있습니다.",
		confirm: "런타임 끄기",
		cancel: "취소",
	},
	studio: {
		title: "Runtime Studio",
		back: "초안 편집기로",
		open: "열기",
		newFile: "새 파일",
		newFolder: "새 폴더",
		rename: "이름 변경",
		copyPath: "경로 복사",
		collapseAll: "모두 접기",
		remove: "삭제",
		explorer: "탐색기",
		preview: "미리보기",
		showPreview: "미리보기 보기",
		hidePreview: "미리보기 숨기기",
		panel: "도구 패널",
		openPanel: "패널 열기",
		closePanel: "패널 닫기",
		openProblems: "문제 패널 열기",
		closeTab: "닫기",
		closeOtherTabs: "나머지 탭 닫기",
		closeAllTabs: "모든 탭 닫기",
		tabMenu: "탭 메뉴",
		revealInExplorer: "탐색기에서 보기",
		studioMenu: "스튜디오 메뉴",
		layout: "레이아웃",
		showExplorer: "탐색기 보기",
		hideExplorer: "탐색기 숨기기",
		resetLayout: "패널 크기 초기화",
		quickOpen: "파일 열기",
		quickOpenPlaceholder: "파일 이름 또는 경로",
		quickOpenEmpty: "맞는 파일이 없습니다.",
		quickOpenResults: "검색 결과",
		commandPalette: "명령 팔레트",
		commandPalettePlaceholder: "조작 이름",
		commandPaletteEmpty: "맞는 조작이 없습니다.",
		commandPaletteResults: "조작 목록",
		breadcrumb: "파일 위치",
		breadcrumbMenu: "파일 메뉴",
		problemsFilter: "문제 필터",
		problemsFilterAll: "전체",
		problemsFilterErrors: "오류",
		problemsFilterWarnings: "경고",
		problemsFilterEmpty: "이 등급에 해당하는 문제가 없습니다.",
		openEntry: "진입 파일 열기",
	},
	onboarding: {
		title: "처음이라면",
		run: "미리보기에서 실행합니다",
		problems: "오류는 Problems 칸에 모입니다",
		dismiss: "안내 닫기",
		edit: "{{entry}}부터 고쳐 보세요",
	},
	explorerEmpty: {
		title: "아직 파일이 없습니다.",
	},
	editorEmpty: {
		noFiles: "코드를 작성할 파일이 없습니다.",
		noFilesAction: "새 파일 만들기",
		noSelection: "탐색기에서 파일을 골라 편집을 시작하세요.",
		noSelectionShortcut: "파일 열기",
	},
	copyPath: {
		copied: "경로를 복사했습니다.",
		failed: "경로를 복사하지 못했습니다.",
	},
	assets: {
		title: "자산",
		description: "코드에서 이름으로 부르는 그림과 소리입니다.",
		empty: "아직 묶어 둔 자산이 없습니다.",
		add: "자산 추가",
		nameLabel: "자산 이름",
		namePlaceholder: "characters/sena/smile",
		rename: "이름 변경",
		replace: "파일 교체",
		replaceKindImage: "이미지는 이미지로만 교체할 수 있습니다.",
		replaceKindAudio: "소리는 소리로만 교체할 수 있습니다.",
		remove: "목록에서 제거",
		copyName: "이름 복사",
		copyCall: "asset(...) 복사",
		copied: "복사했습니다.",
		copyFailed: "복사하지 못했습니다.",
		publishNotice: "바꾼 자산은 다시 발행해야 작품에 반영됩니다.",
		renameNotice:
			"이름을 바꿔도 코드는 자동으로 바뀌지 않습니다. 직접 고쳐 주세요.",
		cancel: "취소",
		confirm: "저장",
		searchLabel: "자산 이름으로 찾기",
		searchPlaceholder: "이름으로 찾기",
		kindFilterLabel: "자산 종류",
		noMatch: "조건에 맞는 자산이 없습니다.",
		clearQuery: "조건 지우기",
		referencesHeading: "코드에 직접 적힌 자리",
		nameHint: '코드에서 `asset("이름")`으로 부릅니다.',
		kindFilter: {
			all: "전체",
			image: "이미지",
			audio: "소리",
		},
		assembled:
			"이름을 조립해 부르는 자리 {{count}}곳은 이 이름을 쓰는지 확인할 수 없습니다.",
		moreReferences: "외 {{count}}곳",
		removeConfirm: {
			titleAudio: "소리를 목록에서 제거할까요?",
			titleImage: "이미지를 목록에서 제거할까요?",
			descriptionAudio:
				"`{{path}}` 이름이 사라집니다. 올린 소리 자체는 지워지지 않고, 이미 발행한 작품은 다시 발행하기 전까지 그대로 들립니다.",
			descriptionImage:
				"`{{path}}` 이름이 사라집니다. 올린 이미지 자체는 지워지지 않고, 이미 발행한 작품은 다시 발행하기 전까지 그대로 보입니다.",
			consequenceAudio:
				"다른 소리를 그 이름으로 묶기 전까지 그 자리는 소리가 나지 않습니다.",
			consequenceImage:
				"다른 이미지를 그 이름으로 묶기 전까지 그 자리는 자리표시자가 됩니다.",
			confirm: "제거",
			cancel: "취소",
		},
		referenceNotice:
			"코드에 직접 적힌 사용처가 {{count}}곳 있습니다. {{consequence}}",
		actions: "{{path}} 조작",
	},
	deleteConfirm: {
		title: "파일을 삭제할까요?",
		body: "{{path}} 파일이 이 프로젝트에서 사라집니다. 되돌릴 수 없습니다.",
		confirm: "삭제",
		cancel: "취소",
	},
	actionFailure: "이 조작을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
	problemSource: {
		module: "모듈 해석",
		policy: "런타임 정책",
		runtime: "컴파일러",
	},
	problemsEmpty: {
		title: "문제가 없습니다",
		body: "타입·문법 오류와 런타임 컴파일러의 진단이 여기 모입니다. 실행 중의 출력과 진단은 Console 칸에 옵니다.",
	},
	assetKind: {
		image: "이미지",
		audio: "소리",
	},
	compile: {
		idle: "검사 대기",
		checking: "검사 중…",
		clean: "이상 없음",
		failed: "검사 실패",
		warnings_one: "경고 {{value}}개",
		warnings_other: "경고 {{value}}개",
		problems_one: "문제 {{value}}개",
		problems_other: "문제 {{value}}개",
		checkerFailed:
			"런타임 검사기를 실행하지 못했습니다. 코드는 그대로 저장되어 있습니다.{{detail}}",
	},
	assetName: {
		invalidShape: "이름은 `characters/sena/smile`처럼 적습니다.",
	},
	bottomPanel: {
		errorPrefix: "오류 ",
		warningPrefix: "경고 ",
		error: "오류",
		warning: "경고",
	},
	tabs: {
		close: "{{path}} 탭 닫기",
		closeOtherTabs: "나머지 탭 닫기",
		openFiles: "열린 파일",
	},
	imageFile: {
		empty: "빈 파일입니다. 다른 이미지를 골라 주세요.",
		tooLarge:
			"런타임 이미지는 최대 {{max}}MB까지 올릴 수 있습니다. 더 작은 파일을 골라 주세요.",
		unsupported: "{{formats}} 파일만 올릴 수 있습니다.",
		generic: "이미지를 올리지 못했습니다. 잠시 후 다시 시도해 주세요.",
		invalidImage: "이미지를 읽지 못했습니다. 파일이 손상되었을 수 있습니다.",
		invalidDimensions: "이미지 크기가 너무 큽니다. 해상도를 줄여 주세요.",
		storageFailed: "이미지를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		inputHint: "{{formats}} · 최대 {{max}}MB",
	},
	audioFile: {
		empty: "빈 파일입니다. 다른 파일을 골라 주세요.",
		tooLarge:
			"런타임 소리는 최대 {{max}}MB까지 올릴 수 있습니다. 더 작은 파일을 골라 주세요.",
		unsupported: "{{formats}} 파일만 올릴 수 있습니다.",
		generic: "소리를 올리지 못했습니다. 잠시 후 다시 시도해 주세요.",
		invalidAudio: "소리 파일을 읽지 못했습니다. 파일이 손상되었을 수 있습니다.",
		tooLong:
			"소리는 {{minutes}}분까지 올릴 수 있습니다. 더 짧은 파일을 골라 주세요.",
		storageFailed: "소리를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		inputHint: "{{formats}} · 최대 {{max}}MB · {{minutes}}분",
	},
	mobileTab: {
		files: "파일",
		code: "코드",
		preview: "미리보기",
	},
	explorer: {
		folder: "{{name}} 폴더",
		menu: "{{label}} 메뉴",
	},
	runtimePreview: {
		runtimePreview: "런타임 미리보기",
	},
	codeEditor: {
		runtimeCodeEditor: "런타임 코드 편집기",
	},
	runtimeOnboardingStrip: {
		dismissGuide: "안내 닫기",
	},
	deleteDialog: {
		deleteThisFile: "이 파일을 삭제할까요?",
	},
	runtimeStudioPage: {
		draftsAreSavedOnThe:
			"초안은 기기에 계정별로 저장됩니다. 다른 계정에서 만든 초안이라면 그 계정으로 로그인해 주세요.",
		youCanTurnItOn: "초안 편집기의 런타임 구획에서 켤 수 있습니다.",
		runtimeIsnTOnFor: "이 초안에는 런타임이 켜져 있지 않습니다.",
		thisDraftIsnTIn: "이 계정에 없는 초안입니다.",
		loadingTheProject: "프로젝트를 불러오는 중…",
		loadingTheEditor: "편집기를 불러오는 중…",
		backToDrafts: "초안 목록으로",
		previewWidth: "미리보기 폭",
		quickOpen: "빠른 열기",
		explorerWidth: "탐색기 폭",
		panelHeight: "패널 높이",
		files: "파일",
	},
	runtimeSection: {
		runtimeIsOffTheCode:
			"런타임이 꺼져 있습니다. 작성한 코드는 그대로 남아 있고, 다시 켜면 이어서 쓸 수 있습니다.",
	},
	panel: {
		newFile: "새 파일",
	},
	breadcrumb: {
		closeAllTabs: "모든 탭 닫기",
	},
	mobileTabs: {
		workspace: "작업 공간",
	},
	pathIssue: {
		empty: "경로를 입력해 주세요.",
		too_long: "경로는 {{max}}자를 넘을 수 없습니다.",
		too_deep: "폴더는 {{max}}단계까지만 만들 수 있습니다.",
		traversal: "프로젝트 바깥은 가리킬 수 없습니다.",
		reserved:
			"프로젝트 맨 위의 `node_modules`와 `.rowcat`은 예약된 이름입니다. 다른 폴더 이름을 써 주세요.",
		segment_too_long: "이름은 {{max}}자를 넘을 수 없습니다.",
		invalid_character: "영문·숫자와 `.`·`_`·`-`만 쓸 수 있습니다.",
		unsupported_extension: "{{extensions}} 파일만 만들 수 있습니다.",
		content_too_long: "파일 하나는 {{max}}자를 넘을 수 없습니다.",
		file: {
			too_many: "파일은 {{max}}개까지 만들 수 있습니다.",
			duplicate: "같은 경로의 파일이 이미 있습니다.",
		},
		asset: {
			too_many: "이미지는 {{max}}개까지 묶을 수 있습니다.",
			duplicate: "같은 이름의 이미지가 이미 있습니다.",
		},
	},
	beta: {
		label: "베타",
		srPrefix: "크리에이터 런타임 ",
		promise:
			"크리에이터 런타임은 베타입니다. 지금 공개된 API는 호환을 지키며 넓혀 가고, 호환을 깨는 변경이 필요하면 미리 알립니다.",
	},
};
