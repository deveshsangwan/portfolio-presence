# Development

Use Node.js 24 and the pinned `pnpm@11.5.2`, matching CI:

```sh
pnpm install --frozen-lockfile
pnpm check
```

## Compiler commands

Both workspace packages pin [`tsc-rs@0.7.0`](https://github.com/pingdotgg/ts-rust/releases/tag/v0.7.0)
exactly. Commands use its standard compiler mode.

- `pnpm typecheck` runs Rust checking over `src`, `test`, and the root TypeScript
  configs using `tsconfig.json`.
- `pnpm build` uses tsup to bundle ESM and declarations, then marks the React
  entry as a client module. Build the library before checking the example,
  which resolves the package's `dist` exports.
- `pnpm --dir examples/next-basic typecheck` runs `next typegen` followed by
  Rust checking over the example and generated route types. Its `build` command
  runs this check before `next build`.
- `pnpm test:integration` packs the built library, checks root, Next.js, and
  React consumers with Rust and the TypeScript 6 JavaScript API, then exercises
  the packed ESM at runtime.

`pnpm check` runs these paths, unit tests, publint, the example production build,
and the VitePress docs build. Both quality CI and the publish workflow run it
after a frozen installation. There is no separate prepack or compiler watch
command. `pnpm docs:dev` continues to use VitePress's development server.

## Retained JavaScript TypeScript

The root and example retain `typescript@^6.0.3`, locked to 6.0.3:

- tsup uses the JavaScript compiler API for declaration generation and bundling.
  Keeping this path preserves the published `.d.ts` format.
- Next.js uses it for its own configuration, route generation, and build-time
  checks. The additional Rust check does not replace those framework checks
  or the Next language-service plugin.
- Integration tests use `transpileModule` for runtime fixtures and `createProgram`
  to verify that published declarations remain consumable by TypeScript 6.
- VitePress's Vue tooling also depends on JavaScript TypeScript APIs. Its docs
  build remains a VitePress build.

Do not alias `typescript` to `tsc-rs`; their JavaScript APIs differ.

## Installation and release caveats

Keep optional dependencies enabled. CI uses Linux x64, supplied by
`@tsc-rs/linux-x64@0.7.0`. The lockfile also records the release's Linux arm64,
macOS x64/arm64, and Windows x64/arm64 packages. The pnpm `allowBuilds` entry
permits the compiler's startup-optimization postinstall without changing the
existing esbuild or sharp policy. No Rust toolchain is needed.

`pnpm exec tsc-rs --version` reports the underlying `7.1.0-dev` compiler.
Check the npm release separately with
`node -p "require('tsc-rs/package.json').version"`.

Release 0.7.0 has a [declaration diagnostic issue with `noEmit`](https://github.com/pingdotgg/ts-rust/issues/86).
Always run the actual tsup declaration build and packed-consumer tests before
publishing. Its [documented build-watch issue](https://github.com/pingdotgg/ts-rust/blob/v0.7.0/npm/tsc-rs-readme.md#known-problems)
can exit 70 after edits; this repository does not use `-b --watch`.

To roll back, revert the compiler migration commit with `git revert`, then run
`pnpm install --frozen-lockfile` and `pnpm check`.
