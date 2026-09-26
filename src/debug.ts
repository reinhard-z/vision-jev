// Debug extras, off by default. Enable by adding `?debug` to the URL.
export const DEBUG = new URLSearchParams(window.location.search).has("debug");
