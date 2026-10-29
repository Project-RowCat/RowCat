import type { ReactNode } from "react";
import { Canvas } from "#/components/app-shell/canvas.tsx";

/**
 * The frame of the create screen. The title is deliberately not here. The list shows `Create`, the
 * editor shows the draft title, and if this file took a title setting it would become a screen
 * assembler. The discover screen's shell holds only a title, which is the same kind of minimal
 * frame. This file only guarantees that loading, error, and body states share one frame.
 */
export function CreateShell({ children }: { children: ReactNode }) {
	return <Canvas>{children}</Canvas>;
}

/**
 * The editor's shell. It used to have a `← Drafts` link. That link moved to the context slot of the
 * persistent header (`draft-header-context.tsx`), since the same action in two places would leave
 * one of them as dead decoration. The header also stays in place while the placeholder, error, and
 * body change. The destination rule carried over unchanged: a fixed `/create` route, not browser
 * history. The editor can open without passing through the list (a saved address, a restored
 * browser session, or a later cross-device sync link), so back navigation can leave RowCat.
 * Whatever path brought the user in, the exit must be the same, or the link's name would be false.
 * The shell is kept, not deleted, because the route placeholder and error boundary frame themselves
 * with this name. Without it, each of those three would call `Canvas` directly, and one would
 * eventually drop the width. This is not kept for a future split between list and editor.
 */
export function DraftEditorShell({ children }: { children: ReactNode }) {
	return (
		<CreateShell>
			{/*
			 * The editor alone is one step narrower. The workspace's main views (drafts, published works,
			 * analytics) are lists and grids and use the full canvas width. The editor is a single authoring
			 * form, and its widest field is prose (`Description`, up to 4,000 characters, and the `Prompt` body).
			 * At canvas width on a 1440px screen, that textarea would be 1,100px wide, so one line would run
			 * over 90 characters. The repository has already settled this for similar text: the work
			 * description uses `max-w-2xl`, with a comment noting that at 740px a line runs past 50 characters
			 * and the reader loses the start of the next line; the chat body stops at `max-w-3xl`, with a note
			 * saying it is not widened just because space remains. The writing side has no reason to sit
			 * outside that rule: the sentences written here are the ones those screens display.
			 * So it uses the same `max-w-3xl` as the chat body. On narrow screens it changes nothing, since the
			 * screen is already narrower.
			 */}
			<div className="mx-auto w-full max-w-3xl">{children}</div>
		</CreateShell>
	);
}
