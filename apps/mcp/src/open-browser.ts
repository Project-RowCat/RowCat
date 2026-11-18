import { spawn } from "node:child_process";

/**
 * Opens the sign-in approval address in the browser of the person at this computer. **The one file
 * in this package allowed to start another program** (`boundaries.test.ts`), and what makes that
 * acceptable is how little it can do:
 *
 * - The program is fixed per platform, here. Nothing the server sends and nothing a person types
 *   chooses what runs.
 * - The address is one argument and `shell` is false: no shell parses it, so the `&` in a query
 *   string is a character rather than a command separator. That is why Windows uses `rundll32` and
 *   not `cmd /c start`, which would hand the address to `cmd`'s parser.
 * - Only `http:`/`https:` addresses without credentials are passed. The Windows and macOS openers
 *   would just as willingly run a local file.
 * - Nothing is awaited and no output is read. A missing opener (no `xdg-open` in a container) is not
 *   a sign-in failure: the address is printed regardless and can be opened anywhere.
 *
 * It declines rather than guesses where a browser would open in the wrong place. Over SSH the browser
 * that opens is the remote machine's, which nobody is looking at; a Linux session with no display
 * would have `xdg-open` fall back to a text browser that takes over this terminal.
 */

export interface BrowserOpener {
	readonly command: string;
	/** Arguments before the address. */
	readonly args: readonly string[];
}

/** Which program opens a browser here, or `null` when this computer has none for the person. */
export function browserOpenerFor(
	platform: NodeJS.Platform,
	env: Readonly<Record<string, string | undefined>>,
): BrowserOpener | null {
	if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY) return null;
	if (platform === "darwin") return { command: "open", args: [] };
	if (platform === "win32")
		return {
			command: "rundll32.exe",
			args: ["url.dll,FileProtocolHandler"],
		};
	if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return null;
	return { command: "xdg-open", args: [] };
}

/** The address in the one form that is passed on, or `null` when it may not be. */
export function openableAddress(address: string): string | null {
	let url: URL;
	try {
		url = new URL(address);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return null;
	if (url.username || url.password) return null;
	return url.toString();
}

/** Whether a browser was asked to open; the caller prints the address either way. */
export function openBrowser(
	address: string,
	platform: NodeJS.Platform = process.platform,
	env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
	const opener = browserOpenerFor(platform, env);
	const url = openableAddress(address);
	if (opener === null || url === null) return false;
	try {
		const child = spawn(opener.command, [...opener.args, url], {
			shell: false,
			stdio: "ignore",
			detached: true,
			windowsHide: true,
		});
		child.on("error", () => {
			// A missing opener is not a sign-in failure; the printed address stands (see the header).
		});
		child.unref();
		return true;
	} catch {
		return false;
	}
}
