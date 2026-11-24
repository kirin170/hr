# Repository workflow

## Branches

- `master` is the protected release branch. Do not commit or push directly to `master`.
- Use the shared `dev` branch for development. Start new local work from `dev` and keep it aligned with `origin/dev`.

## Development and publishing

- Before starting work, run `git switch dev` and pull `origin/dev` with the proxy form below.
- Make and commit development changes on `dev`.
- Do not force-push or rewrite shared `dev` history.

### Remote access goes through the local proxy

Direct connections to `github.com` from this machine are intermittently reset: TCP and TLS
succeed and response headers arrive, but the response body is dropped, so `git push` fails
with `Recv failure: Connection was reset` or a connect timeout. `api.github.com` and
`codeload.github.com` are unaffected, which makes the failure look random.

Every remote operation in this project therefore goes through the local proxy at
`127.0.0.1:7890`. Use this exact form for pushes:

```bash
git -C 'D:\hr' -c remote.origin.proxy=http://127.0.0.1:7890 push origin dev
```

For the first push from a new checkout, add `-u`:

```bash
git -C 'D:\hr' -c remote.origin.proxy=http://127.0.0.1:7890 push -u origin dev
```

Apply the same `-c remote.origin.proxy=http://127.0.0.1:7890` to `fetch` and `pull`, which
reach the same host and fail the same way:

```bash
git -C 'D:\hr' -c remote.origin.proxy=http://127.0.0.1:7890 pull --ff-only origin dev
```

Do not replace this with a plain `git push`, and do not "fix" failures by retrying in a loop
or by changing the remote URL, hosts file, or global git config. If the proxy itself is down,
say so and stop rather than falling back to a direct connection.

## Promoting to master

- After development is ready, the repository owner reviews and merges `dev` into `master` through a pull request.
- The current GitHub protection requires a pull request and two status checks for `master`; let those checks finish before merging.
- Do not merge into `master` or change branch protection unless the user explicitly asks.
