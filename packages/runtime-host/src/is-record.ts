/**
 * Whether the value is a non-array object. Three validators ask this same question before they read
 * fields from a wire value.
 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
