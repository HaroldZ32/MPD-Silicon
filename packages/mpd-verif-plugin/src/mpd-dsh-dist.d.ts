// The installed @mpd-dsh/mpd ships the adapter as a BUILT `dist/index.js` with no
// declaration file beside it. This bundle imports the VALUE surface from that dist
// (so the built artifact keeps the dependency EXTERNAL and exactly one adapter
// instance is shared process-wide) and the TYPE surface from the dependency's
// TypeScript source. This ambient declaration re-exports the source types for the
// dist specifier, so the value imports stay type-checked under `strict: true`.
declare module "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js" {
  export * from "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/src/index.ts"
}
