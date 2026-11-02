# Repository guidance

Use Scoped Commits format for every PR title and commit in its branch: `<scope>: <short description>`, where the scope names the affected area, such as `agents`, `web`, or `db`. For changes spanning areas, use their common parent scope or a comma-separated list of scopes.

## No comments in code

Code has no comments. If code needs explaining, give it a better name or a type, or pin the
behaviour with a test whose name says it. Knowledge no code can carry goes in an AGENTS.md or
the docs. Linters enforce it: `trainstack/no-comments` (`packages/config/lint/trainstack.mjs`)
for JavaScript and TypeScript, and `ride-lint` for Swift (see `apps/ride/AGENTS.md`). Neither can
be switched off in a file: a test fails on any `eslint-disable` or `oxlint-disable` directive.

When you fix a bug or a review finding that a lint rule could have caught, add the rule in the
same change so the mistake cannot come back.

## Images in pull requests

Upload screenshots and videos straight to the pull request with the GitHub CLI's `--attach` flag. Do not push evidence branches or commit images to the repository to link them.

```sh
gh pr create --body-file body.md --attach './before.png#Before: the old layout' --attach './after.png#After: the new layout'
gh pr edit 23 --attach ./after.png
gh pr comment 23 --attach ./recording.mov
```

If the body references an attached file by its path, such as `![after](./after.png)`, `gh` rewrites the reference to the uploaded asset, so you can place images inline. Attachments the body does not reference are appended to it. Alt text follows the path after `#`.
