---
name: pr
description: "Use when writing a PR body."
---

Use this template for the PR body:

```markdown
## Summary

<what changed and why it matters to users or maintainers>

## Evidence

- **Before:** <screenshot, output, or failing test run>
  **After:** <screenshot, output, or passing test run>

## Merge Danger

**Door:** <one-way or two-way>

<optional: explain the risk or reversibility>

**Blast Radius:** <one-word description>

<optional: describe potential ramifications of merging>
```

Use the user's domain language from `GLOSSARY.md` when the repository has one.

## Sections

### Summary

Explain what changed, why it was needed, and its impact on users or maintainers. Call out important behavior or compatibility changes.

### Evidence

Give concrete evidence that the change works. Include before and after evidence when a meaningful comparison is available. For visual changes, use screenshots when the environment supports them. For execution evidence, report the checks and outputs actually produced.

### Merge Danger

Describe whether the change is a one-way or two-way door. Changes that are cheap to roll back are lower risk; destructive or hard-to-reverse decisions are one-way doors.

Describe the blast radius with one word, then note likely effects such as layout changes, consumer breakages, or mobile responsiveness when relevant.
