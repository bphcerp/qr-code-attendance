# Contributing

## Commits

Follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):
`feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `style:`, `build:`, `chore:`.

Every commit should do one revertable thing. If you're adding a dependency
and then using it to fix something, that's two commits -- a `build:` for the
dependency, a `fix:` for the change that uses it -- even though reverting the
`build:` commit alone would break the `fix:` commit sitting on top of it.
That's the accepted tradeoff for keeping commits reviewable in isolation.

## Branches

Name branches in imperative, present tense, with one clear object:
`fix-roster-race`, `add-static-qr-duration`, `refactor-token-derivation`.
Every commit on a branch should relate to that one thing -- anything that
doesn't gets reverted or rebased out before merging.

## Pull requests

Describe the change accurately and, if it fixes a specific incident or bug,
say what broke and why. Test against the `prod` migration path
(`npm run db:migrate:prod --force` against a scratch database, not
production) before merging anything that touches `src/db/schema.ts` -- see
[docs/design-notes.md](docs/design-notes.md) for why that step has bitten us
three times already.
