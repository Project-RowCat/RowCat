import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Canvas } from "#/components/app-shell/canvas.tsx";

/**
 * The discover screen's frame: the header and title stay in place whatever the body is (list,
 * placeholder, or error). If loading and error states each drew their own shell, the title would
 * shift on every state change, and on error even the brand would vanish, making the app look dead.
 *
 * The frame wraps only server-sourced content. Local data (conversations, drafts) does not go here:
 * discover is a document guests and search bots also receive, so this device's conversation titles
 * must not end up in server HTML. Resumption belongs to the global navigation's `Conversations` entry and the
 * `/chats` list.
 */
export function GalleryShell({ children }: { children: ReactNode }) {
	const { t } = useTranslation("gallery");
	return (
		<Canvas>
			<header className="mb-5">
				<h1 className="text-2xl font-black tracking-tight sm:text-3xl">
					{t("title")}
				</h1>
			</header>
			{children}
		</Canvas>
	);
}
