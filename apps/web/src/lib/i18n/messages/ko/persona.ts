import type { Messages } from "../../types.ts";

export const persona: Messages["persona"] = {
	nameEmpty: "이름을 입력해 주세요.",
	nameTooLong: "이름은 {{max}}자까지 쓸 수 있습니다.",
	descriptionTooLong: "설명은 {{max}}자까지 쓸 수 있습니다.",
	saveFailed: "페르소나를 저장하지 못했습니다. 다시 시도해 주세요.",
	deleteFailed: "페르소나를 삭제하지 못했습니다. 다시 시도해 주세요.",
	applyFailed: "이 대화의 페르소나를 바꾸지 못했습니다. 다시 시도해 주세요.",
	deleteNotice: "이미 이 페르소나로 시작한 대화는 그대로 유지됩니다.",
	storyDefault: "작품 기본 페르소나",
	none: "설정 안 함",
	storyDefaultHint: "작품이 제안한 역할을 그대로 씁니다",
	emptyTitle: "저장된 페르소나가 없습니다",
	emptyBody:
		"페르소나는 대화에서 내가 맡을 역할입니다. 자주 쓰는 이름과 설정을 저장해 두면 여러 대화에서 다시 고를 수 있습니다.",
	editor: {
		name: "이름",
		namePlaceholder: "지훈",
		description: "설명",
		descriptionPlaceholder: "대학생. 조용한 성격이며 추리소설을 좋아한다.",
		saving: "저장 중…",
	},
	dialog: {
		editTitle: "페르소나 수정",
		newTitle: "새 페르소나",
		description:
			"대화에서 내가 맡을 역할입니다. 이름은 화자와 `{{userToken}}`에, 설명은 모델이 읽는 설정에 쓰입니다.",
		save: "저장",
		create: "만들기",
		deleteTitle: "페르소나를 삭제할까요?",
		deleteBody: "<name>{{name}}</name>을(를) 서재에서 지웁니다. {{notice}}",
		deleting: "삭제 중…",
	},
	library: {
		unavailableTitle: "페르소나를 열 수 없습니다",
		unavailableBody:
			"페르소나는 계정별로 이 기기에 저장됩니다. 다시 로그인하면 그대로 있습니다.",
		signIn: "로그인",
		create: "새 페르소나",
		createFirst: "첫 페르소나 만들기",
		manage: "{{name}} 페르소나 관리",
		edit: "수정",
		loading: "페르소나를 불러오는 중입니다",
	},
	page: {
		title: "페르소나",
		description:
			"대화에서 내가 맡을 역할을 관리합니다. 여기 저장해 두면 여러 대화에서 다시 고를 수 있습니다.",
	},
};
