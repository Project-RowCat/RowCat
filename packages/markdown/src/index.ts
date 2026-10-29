/**
 * `@rowcat/markdown` — the platform-neutral markdown rules for conversation bodies.
 *
 * This lives outside `@rowcat/chat` because `apps/api` imports that package and never parses
 * markdown; keeping the parser here keeps micromark out of the API's runtime graph.
 *
 * Deliberately absent: React/RN rendering, styling, HTML strings and sanitizers. In particular,
 * never produce an HTML string from the tree — it will eventually end up in
 * `dangerouslySetInnerHTML`.
 */
export * from "./fixture.ts";
export * from "./image-url.ts";
export * from "./nodes.ts";
export * from "./normalize.ts";
export * from "./parse.ts";
export * from "./safety.ts";
export * from "./url-policy.ts";
