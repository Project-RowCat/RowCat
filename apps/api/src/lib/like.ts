/**
 * Escapes user input before it goes into a `LIKE`/`ILIKE` pattern. `%`, `_` and `\` are pattern
 * characters; left raw they widen the match (not an injection, the value is bound) and the trigram
 * index cannot serve them. Postgres's default escape character is backslash, independent of
 * `standard_conforming_strings` because the value is bound.
 */
export const escapeLikePattern = (input: string): string =>
	input.replace(/[\\%_]/g, (ch) => `\\${ch}`);

export const containsPattern = (input: string): string =>
	`%${escapeLikePattern(input)}%`;

export const prefixPattern = (input: string): string =>
	`${escapeLikePattern(input)}%`;
