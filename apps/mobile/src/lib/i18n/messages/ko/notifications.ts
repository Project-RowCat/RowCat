import type { Messages } from "../../types.ts";

export const notifications: Messages["notifications"] = {
	screen: {
		title: "알림",
		empty: "아직 알림이 없습니다.",
		tabsLabel: "알림 종류",
		offline: "지금은 연결되어 있지 않습니다. 연결되면 알림을 다시 불러옵니다.",
		error: "알림을 불러오지 못했습니다.",
		stale: "마지막 갱신에 실패해 이전에 받은 상태를 보여 주고 있습니다.",
		retry: "다시 시도",
		more: "더 보기",
		moreBusy: "불러오는 중…",
		markAll: "모두 읽음",
		markAllFailed:
			"알림을 모두 읽음으로 표시하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		guest: {
			title: "로그인하면 알림을 볼 수 있습니다",
			description: "팔로우, 댓글, 계정 안내가 이 알림함으로 도착합니다.",
			action: "로그인",
		},
		unavailable: "세션을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
	},
	tab: {
		general: "일반",
		updates: "업데이트",
	},
	unseenUpdate: ", 새로운 업데이트 있음",
	bell: {
		label: "알림",
		unread: "알림, 읽지 않음 {{badge}}개",
	},
	deletedActor: "삭제된 사용자",
	unnamed: "이름 없음",
	message: {
		follow: "{{who}}님이 회원님을 팔로우했습니다.",
		commentReply:
			'{{who}}님이 "{{title}}"에 남긴 회원님의 댓글에 답글을 남겼어요.',
		commentReplyUntitled: "{{who}}님이 회원님의 댓글에 답글을 남겼어요.",
		storyComment: '{{who}}님이 "{{title}}"에 댓글을 남겼습니다.',
		storyCommentUntitled: "{{who}}님이 회원님의 작품에 댓글을 남겼습니다.",
		published: "{{who}}님이 새 작품을 공개했습니다.",
		reportReviewed: "신고하신 내용을 검토했습니다.",
		moderationAction: "계정에 운영 조치가 적용되었습니다.",
		moderationReversed: "적용되었던 운영 조치가 해제되었습니다.",
		appUpdate: "앱 업데이트가 필요합니다.",
		appealAccepted: "이의 제기가 받아들여졌습니다.",
		appealRejected: "이의 제기가 받아들여지지 않았습니다.",
		appealResolved: "이의 제기 결과가 등록되었습니다.",
	},
	appUpdateDetail:
		"{{platform}} 앱 {{version}} 미만은 더 이상 지원되지 않습니다.",
	unreadSummary: "읽지 않음 {{total}}개",
	unreadRow: "읽지 않음, {{message}}",
	push: {
		sectionTitle: "푸시 알림",
		sectionDescription:
			"이 기기에만 적용됩니다. 알림 기록은 계정에 남아 다른 기기에서도 그대로 보입니다.",
		fieldLabel: "이 기기의 푸시 알림",
		offer:
			"푸시 알림을 켜면 댓글, 팔로우, 계정 안내를 이 기기에서 받을 수 있습니다.",
		enable: "푸시 알림 켜기",
		enabling: "켜는 중…",
		enabled: "이 기기에서 푸시 알림을 받고 있습니다.",
		disable: "이 기기에서 끄기",
		disabling: "끄는 중…",
		blocked:
			"시스템 설정에서 RowCat 알림이 꺼져 있습니다. 이 기기에서 받으려면 설정에서 알림을 허용해 주세요.",
		openSettings: "시스템 설정 열기",
		incomplete:
			"알림 권한은 허용되었지만 이 기기를 등록하지 못했습니다. 다시 시도해 주세요.",
		retry: "다시 시도",
		failure: {
			permission: "알림 권한이 허용되지 않았습니다.",
			token:
				"이 기기의 알림 주소를 받지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.",
			server: "이 기기를 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		},
		disableNote:
			"끄면 이 기기로 알림을 보내지 않습니다. 시스템의 알림 권한은 그대로 유지됩니다.",
	},
};
