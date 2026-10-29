/**
 * The timeline's clock display is web-owned. It is not in the shared module (debug-view.ts in
 * @rowcat/chat)
 * because it reads the device's time zone. If a clock or locale entered the pure rule layer, its
 * values could no longer be checked as values, which weakens the reason that layer exists. The date
 * is not shown: a test session does not cross a day, and if it did, the screen would have been
 * reloaded and has no record anyway.
 */
export const formatClock = (at: number): string => {
	const date = new Date(at);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};
