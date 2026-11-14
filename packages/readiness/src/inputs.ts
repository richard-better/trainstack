export const checkInItems = ["sleep", "energy", "soreness", "stress", "mood"] as const;

export type CheckInItem = (typeof checkInItems)[number];

export type IllnessKind = "respiratory" | "stomach" | "fever" | "other";

export type InjuryTraining = "full" | "reduced" | "none";

export interface ReadinessCheckIn<Area extends string = string> {
  readonly day: string;
  readonly ratings: Readonly<Record<CheckInItem, number | null>>;
  readonly illness: { readonly kind: IllnessKind } | null;
  readonly injury: { readonly area: Area; readonly training: InjuryTraining } | null;
}

export interface ReadinessPlanned {
  readonly id: string;
  readonly kind: "workout" | "note" | "rest";
  readonly state: "planned" | "completed" | "skipped" | "missed";
  readonly seconds: number | null;
  readonly load: number | null;
}

export interface ReadinessInput<Area extends string = string> {
  readonly checkIns: readonly ReadinessCheckIn<Area>[];
  readonly stress: ReadonlyMap<string, number>;
  readonly planned: ReadonlyMap<string, readonly ReadinessPlanned[]>;
}

export const unmeasured = ["sleep", "resting_heart_rate", "hrv"] as const;

export type Unmeasured = (typeof unmeasured)[number];
