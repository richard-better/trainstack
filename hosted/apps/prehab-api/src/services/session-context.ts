/**
 * Shared session/plan date + context helpers.
 *
 * Extracted from the RPC router so both the request path (rpc/router.ts) and
 * the async generation worker (session-generation-job.ts) share one source of
 * truth for plan-arc math and the scaffold window (PRE-138).
 */

import { and, desc, eq } from "drizzle-orm";
import { db, plans } from "../db";

// A generated/lazily-scaffolded plan materializes its opening window eagerly;
// later days fill on demand (PRE-149). The window is the same whether a plan
// is created up front or a day is generated lazily.
export const SCAFFOLD_WINDOW_DAYS = 14;

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0] as string;
}

// Whole days between two YYYY-MM-DD strings (b - a). Negative if b precedes a.
export function daysBetween(a: string, b: string): number {
  const ms = new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

export function computeAge(dob: string | Date | null): number | null {
  if (!dob) return null;
  const d = typeof dob === "string" ? new Date(dob) : dob;
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

// The user's single active plan id (or null). Used to attach lazily-scaffolded
// program_schedule rows to the plan that owns the calendar (PRE-149 invariant:
// new rows belong to the active plan).
export async function getActivePlanId(userId: string): Promise<string | null> {
  const rows = await db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.userId, userId), eq(plans.status, "active")))
    .orderBy(desc(plans.createdAt))
    .limit(1);
  return rows[0]?.id ?? null;
}

// Week position of `date` within the user's active plan (PRE-147 plan-contextual
// titles). Null when there's no active plan. Mirrors serializePlan's arc math so
// the title's "week X of Y" matches what the home band shows.
export async function getActivePlanArc(
  userId: string,
  date: string,
): Promise<{ week: number; totalWeeks: number } | null> {
  const rows = await db
    .select({ startDate: plans.startDate, endDate: plans.endDate })
    .from(plans)
    .where(and(eq(plans.userId, userId), eq(plans.status, "active")))
    .orderBy(desc(plans.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const totalWeeks = Math.max(1, Math.ceil(daysBetween(row.startDate, row.endDate) / 7));
  const elapsed = daysBetween(row.startDate, date);
  const week = Math.min(Math.max(Math.floor(elapsed / 7) + 1, 1), totalWeeks);
  return { week, totalWeeks };
}
