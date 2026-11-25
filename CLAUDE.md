# Working on the Urðr VS Code extension

- Read `docs/architecture.md` first.
- The extension works without an Urðr server. Do not add anything that
  needs one.
- Changes the Urðr crates need go to `silencesys/dh--urdr` as their own
  pull request, after the maintainer agrees. Do not copy Urðr code here
  to change it.
- Tests define done. Before a pull request, all of these pass:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cd extension && npm run build && npm test
```

- Commit messages: imperative subject under 72 characters.
