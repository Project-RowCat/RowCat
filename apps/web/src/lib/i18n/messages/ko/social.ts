import type { Messages } from "../../types.ts";

export const social: Messages["social"] = {
	follow: { follow: "팔로우", following: "팔로잉" },
	favorite: {
		add: "즐겨찾기 추가",
		remove: "즐겨찾기 제거",
		saveFailed: "저장하지 못했습니다",
	},
	menu: {
		manage: "{{name}} 제작자 관리",
		report: "신고",
		block: "차단",
		unblock: "차단 해제",
		reportTarget: "프로필",
	},
	blockDialog: {
		title: "이 제작자를 차단할까요?",
		description:
			"<name>{{name}}</name>님의 작품과 댓글이 회원님 화면에 표시되지 않고, 팔로우 중이라면 해제됩니다. 차단을 해제해도 팔로우는 복구되지 않습니다.",
		submit: "차단",
		submitting: "차단 중…",
	},
	error: {
		followFailed: "팔로우하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		blockFailed: "차단하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		blockedTarget:
			"차단한 제작자입니다. 차단을 해제한 뒤 팔로우할 수 있습니다.",
		selfFollow: "자기 자신은 팔로우할 수 없습니다.",
		selfBlock: "자기 자신은 차단할 수 없습니다.",
		followRestricted:
			"이용이 제한된 계정은 팔로우할 수 없습니다. 계정 화면에서 제한 내용을 확인해 주세요.",
		blockRestricted:
			"이용이 제한된 계정은 차단할 수 없습니다. 계정 화면에서 제한 내용을 확인해 주세요.",
		loginRequired: "로그인이 필요합니다.",
		notFound: "제작자를 찾을 수 없습니다.",
	},
};
