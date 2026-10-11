import { describe, expect, it } from "vitest";

import {
  exercises,
  getExercisesForSportsAndEquipment,
  getExerciseNamesForSportsAndEquipment,
} from "../services/constants/exercises";

describe("getExercisesForSportsAndEquipment", () => {
  it("empty equipment returns only bodyweight exercises", () => {
    const results = getExercisesForSportsAndEquipment(["running"], []);
    expect(results.length).toBeGreaterThan(0);
    for (const ex of results) {
      expect(ex.equipment).toEqual([]);
    }
  });

  it("dumbbells unlocks dumbbell-tagged exercises", () => {
    const bodyweight = getExercisesForSportsAndEquipment(["running"], []);
    const withDumbbells = getExercisesForSportsAndEquipment(["running"], ["dumbbells"]);
    expect(withDumbbells.length).toBeGreaterThan(bodyweight.length);
    const newOnes = withDumbbells.filter((ex) => !bodyweight.some((b) => b.id === ex.id));
    expect(newOnes.length).toBeGreaterThan(0);
    for (const ex of newOnes) {
      expect(ex.equipment).toContain("dumbbell");
    }
  });

  it("equipment IDs without catalogue mapping (yoga-mat, kettlebell) return bodyweight only", () => {
    const onlyBodyweight = getExercisesForSportsAndEquipment(["running"], ["yoga-mat"]);
    const baseline = getExercisesForSportsAndEquipment(["running"], []);
    expect(onlyBodyweight.map((e) => e.id).sort()).toEqual(baseline.map((e) => e.id).sort());
  });

  it("exercises requiring equipment the user does not own are filtered out", () => {
    // Pick an exercise that requires dumbbell.
    const dumbbellEx = exercises.find((ex) => ex.equipment.includes("dumbbell"));
    expect(dumbbellEx).toBeDefined();
    const sport = dumbbellEx!.sportTags[0]!;

    const noDumbbells = getExercisesForSportsAndEquipment([sport], []);
    expect(noDumbbells.find((ex) => ex.id === dumbbellEx!.id)).toBeUndefined();

    const withDumbbells = getExercisesForSportsAndEquipment([sport], ["dumbbells"]);
    expect(withDumbbells.find((ex) => ex.id === dumbbellEx!.id)).toBeDefined();
  });

  it("empty sports list does not filter by sport (returns all matching equipment-wise)", () => {
    const all = getExercisesForSportsAndEquipment([], []);
    const allBodyweight = exercises.filter((ex) => ex.equipment.length === 0);
    expect(all.map((e) => e.id).sort()).toEqual(allBodyweight.map((e) => e.id).sort());
  });

  it("exercise names helper returns names matching the filtered set", () => {
    const filtered = getExercisesForSportsAndEquipment(["running"], ["dumbbells"]);
    const names = getExerciseNamesForSportsAndEquipment(["running"], ["dumbbells"]);
    expect(names).toEqual(filtered.map((ex) => ex.name));
  });
});
