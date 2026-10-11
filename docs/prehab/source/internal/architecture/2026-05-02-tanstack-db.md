# TanStack DB for snappy UX

**Status:** exploration, not committed
**Date:** 2026-05-02

## What it is

[TanStack DB](https://tanstack.com/db/latest) is a reactive client-first store that sits between fetch and components. Currently in beta. Two core concepts:

- **Collections** — typed, normalized in-memory tables. A `QueryCollection` wraps a TanStack Query `queryFn`, so it slots in over our existing oRPC + `@tanstack/react-query` setup with no transport change.
- **Live queries** — reactive selects across collections, executed via _differential dataflow_: an update to one row recomputes only the affected rows of every dependent query (~sub-ms even at 100k rows) instead of re-running the whole select.

Writes go through `collection.update/insert/delete` or `createOptimisticAction`. The collection keeps optimistic state separate from synced state, applies it instantly to all live queries, then commits on success or auto-rolls back on failure. This replaces hand-rolled `onMutate` / `onError` / `invalidateQueries` chains.

## Why it fits prehab-app

The native client today (`apps/native/hooks/use-session.ts`, `use-exercises.ts`, `use-session-templates.ts`) relies on `staleTime` + `queryClient.invalidateQueries` to keep the home, agenda, and streak views in sync. Every in-session mutation (`updateProgress`, `skipExercise`, `complete`, `logCapacity`, `acknowledgeRestDay`) triggers a refetch round-trip before the UI reflects truth. That round-trip is the visible hitch users feel.

### High-leverage targets

1. **In-session mutations.** Optimistic mutators on a `sessions` collection make the home card and streak update in the same frame the user taps — no invalidate, no refetch flash.
2. **Today's session × agenda × streak.** Today these are three separate `useQuery` hooks (`useDailySession`, `useAgenda`, `useStreak`) with independent staleTimes. Modeled as one collection plus three live queries (`today`, `range(start,end)`, `streak = count completed in last N days`), completing today's session updates all three locally, instantly.
3. **Exercises catalogue.** Read-mostly, `staleTime: 10 * 60_000`. The exercise-detail screen (`app/exercise/[id]`) currently issues a second `orpc.exercises.get` call. Reading from the in-memory collection makes detail navigation instant.
4. **Session templates.** Same shape as exercises.

### Stays as plain mutations

`generateDailySession`, `regenerateDailySession`, `generateWeeklyScaffold` are server-side AI / scaffold RPCs, not CRUD. The client can't predict the AI output, so optimistic apply has no value. Keep them as oRPC mutations; the resulting session row simply lands in the sessions collection on completion.

## Migration shape (sketch)

- Add `@tanstack/db`, `@tanstack/db-collections`, `@tanstack/react-db`.
- Define collections in `apps/native/lib/collections.ts`: `sessionsCollection`, `exercisesCollection`, `sessionTemplatesCollection`. Each takes the existing `orpc.*.queryOptions(...)` plus `onInsert` / `onUpdate` / `onDelete` handlers that call the existing `client.sessions.*` mutations.
- Hooks become thin wrappers around `useLiveQuery` — e.g. `useDailySession()` becomes a live query filtered by `sessionDate = today`.
- The `queryClient.invalidateQueries({ queryKey: ["sessions"] })` calls disappear; the collection's persistence handler refetches affected rows on its own (suppress with `{ refetch: false }` where the server response is already authoritative).

## Tradeoffs

- **Beta.** API may shift before 1.0; expect minor churn.
- **Cold start still hits the network** unless we persist collections (AsyncStorage adapter on RN). Worth doing for the home screen.
- **Server-generated, idempotent endpoints** like `generateDailySession` need the auto-refetch-after-mutation policy tuned so we don't fight server state.
- **No sync engine needed.** Electric / PowerSync are overkill — we're not multi-device-realtime. A plain `QueryCollection` over oRPC is the right tier and avoids running differential dataflow against a Postgres replication shape on a phone.

## Recommendation

Pilot on the **sessions collection only**. That's where the perceived snappiness wins live (in-session mutations + home / agenda / streak coherence). Exercises and templates can come along after if it feels good. Skip Electric / sync engines unless multi-device live state becomes a real requirement.

## References

- TanStack DB overview — https://tanstack.com/db/latest/docs/overview.md
- Query Collection — https://tanstack.com/db/latest/docs/collections/query-collection.md
