# Contributing

## Layout

```
extension/   the VS Code extension (TypeScript): client and language server
core/        the Rust crate the language server runs, compiled to WebAssembly
docs/        how it works, starting with docs/architecture.md
examples/    a document for each feature, used by the tests
```

## Building

You need Rust 1.100 with the `wasm32-unknown-unknown` target,
`wasm-bindgen-cli` 0.2.130 and Node 22. The Urðr crates are fetched from
the Urðr repository, which is private for now, so building needs read
access to it.

```sh
cargo test --workspace
cd extension
npm ci
npm run build      # WebAssembly, type check, bundle
npm test
npx vsce package --no-dependencies
```

Install the `.vsix` with **Extensions → … → Install from VSIX…**.

Before a pull request, these must pass:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cd extension && npm run build && npm test
```

## Releasing

Set the new version in `extension/package.json` and add a section for it
to `CHANGELOG.md` (the Marketplace shows it). Merge that, then tag the
commit and push the tag:

```sh
git tag v0.4.0
git push origin v0.4.0
```

CI builds and tests the tag, checks that it matches the version, and
publishes `urdr-xml-0.4.0.vsix` and the examples on the Releases page.
A version with a hyphen (`v0.4.0-beta.1`) is a pre-release on GitHub
only; other versions also go to:

- the Visual Studio Marketplace, when the repository variable
  `MARKETPLACE_PUBLISH` is `true`. The publisher `urdr-db` trusts this
  repository's `ci.yml` (Trusted Publishing), so no token is stored.
- Open VSX, when the repository has the secret `OVSX_PAT`.

Every push to `main` also replaces the **dev** pre-release with a build
of that commit.
