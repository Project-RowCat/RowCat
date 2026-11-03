import type { Messages } from "../../types.ts";

export const persona: Messages["persona"] = {
	copy: {
		add: "새 페르소나",
		deleteTitle: "이 페르소나를 삭제할까요?",
		deleteConfirm: "삭제",
		deleteNotice: "이 페르소나로 이미 시작한 대화는 그대로 남습니다.",
		guest:
			"페르소나는 계정과 이 기기에 저장됩니다. 로그인하면 저장해 둔 역할을 볼 수 있습니다.",
		unavailable: "세션을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		storageError:
			"이 기기의 데이터를 열지 못했습니다. 페르소나를 불러올 수 없습니다.",
		readError: "페르소나를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
		saveFailed: "페르소나를 저장하지 못했습니다. 다시 시도해 주세요.",
		deleteFailed: "페르소나를 삭제하지 못했습니다. 다시 시도해 주세요.",
		applyFailed: "이 대화의 페르소나를 바꾸지 못했습니다. 다시 시도해 주세요.",
		storyDefault: "작품 기본 페르소나",
		none: "설정 안 함",
		storyDefaultHint: "작품이 제안하는 역할을 씁니다",
		emptyTitle: "저장한 페르소나가 없습니다",
		emptyBody:
			"페르소나는 대화에서 맡는 역할입니다. 자주 쓰는 이름과 설정을 저장해 두면 어느 대화에서든 다시 고를 수 있습니다.",
		name: "이름",
		description: "설명",
		save: "저장",
		editTitle: "페르소나 수정",
		newTitle: "새 페르소나",
		deleteThis: "이 페르소나 삭제",
	},
	edit: "{{name}} 수정",
	delete: "{{name}} 삭제",
	deleteDescription: "{{name}} 페르소나가 라이브러리에서 사라집니다.",
	nameEmpty: "이름을 입력해 주세요.",
	nameTooLong: "이름은 {{max}}자까지 쓸 수 있습니다.",
	descriptionTooLong: "설명은 {{max}}자까지 쓸 수 있습니다.",
	storySummary: "{{name}} · {{label}}",
};
