import { installMonacoDomShims } from "./monaco-dom.ts";

/**
 * Lets jsdom test files set up Monaco. It has to be a setup file for ordering: ESM evaluates
 * imports first, so filling globals on a test file's first line is too late, and Monaco's
 * contribution modules touch these globals at load time. In Node environment files it does nothing.
 */
installMonacoDomShims();
