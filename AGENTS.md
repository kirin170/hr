# Repository workflow

## Branches

- `master` is the protected release branch. Do not commit or push directly to `master`.
- Use the shared `dev` branch for development. Start new local work from `dev` and keep it aligned with `origin/dev`.

## Development and publishing

- Before starting work, run `git switch dev` and `git pull --ff-only origin dev`.
- Make and commit development changes on `dev`.
- Push completed local work to `origin/dev` with `git push origin dev`. For the first push from a new checkout, use `git push -u origin dev`.
- Do not force-push or rewrite shared `dev` history.

## Promoting to master

- After development is ready, the repository owner reviews and merges `dev` into `master` through a pull request.
- The current GitHub protection requires a pull request and two status checks for `master`; let those checks finish before merging.
- Do not merge into `master` or change branch protection unless the user explicitly asks.
