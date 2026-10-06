# Contributing

Thanks for helping build TrainStack.

## Contributor License Agreement

Before we can merge your first pull request, you need to sign the
[Contributor License Agreement](CLA.md). You keep the copyright in your contributions; the
agreement lets the project license and transfer them. This is what lets TrainStack use
different licenses for different parts of the repository and change them later.

When you open a pull request, a bot asks you to sign by commenting:

```text
I have read the CLA Document and I hereby sign the CLA
```

You only sign once. The signature covers all of your future contributions.

## Licenses

Your contribution is licensed according to the directory it lives in. See
[LICENSING.md](LICENSING.md). Keep code in the right place: shared code that the app or
third-party clients need belongs in `packages/`, never in `hosted/`.

## Checks

Run these before opening a pull request:

```bash
bun run check
bun run test
```
