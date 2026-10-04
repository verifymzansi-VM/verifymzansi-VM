/**
 * Video mode values the site header needs. Kept free of imports so the
 * header (on every page) never pulls in the browse option lists.
 */
export const VIDEO_MODE_DESKTOP_QUERY = "(min-width: 1024px) and (pointer: fine)";
/** Set by the entry button: Close goes back there instead of opening a list. */
export const VIDEO_MODE_FROM_KEY = "vm:video:from";
