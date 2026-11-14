import { z } from "zod";

export const muscles = [
  "chest",
  "front_delts",
  "side_delts",
  "rear_delts",
  "triceps",
  "biceps",
  "forearms",
  "lats",
  "upper_back",
  "traps",
  "lower_back",
  "abs",
  "obliques",
  "glutes",
  "quads",
  "hamstrings",
  "adductors",
  "abductors",
  "calves",
] as const;
export const muscleSchema = z.enum(muscles);
export type Muscle = z.infer<typeof muscleSchema>;

export const equipment = [
  "barbell",
  "dumbbell",
  "kettlebell",
  "machine",
  "cable",
  "bodyweight",
  "band",
  "hangboard",
  "other",
] as const;
export const equipmentSchema = z.enum(equipment);
export type Equipment = z.infer<typeof equipmentSchema>;

export const exerciseMeasureSchema = z.enum(["reps", "time"]);
export type ExerciseMeasure = z.infer<typeof exerciseMeasureSchema>;

export const catalogueExerciseIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, "lowercase words joined by underscores")
  .refine((id) => catalogueById.has(id), "not a lift in the catalogue");

export const customExerciseIdSchema = z.uuid();

export const exerciseIdSchema = z
  .union([catalogueExerciseIdSchema, customExerciseIdSchema])
  .describe("A lift from the catalogue, by its slug, or one of the athlete's own, by its UUID");

const exerciseFields = {
  name: z.string().trim().min(1).max(80),
  equipment: equipmentSchema,
  primaryMuscles: z.array(muscleSchema).max(muscles.length),
  secondaryMuscles: z.array(muscleSchema).max(muscles.length),
  measure: exerciseMeasureSchema.describe(
    "reps: sets count repetitions. time: sets are holds measured in seconds, such as a plank or a hang",
  ),
  bodyweight: z
    .boolean()
    .describe("Whether the athlete's body is the load, so sets add to it or take from it"),
};

export const customExerciseSchema = z.object({ id: customExerciseIdSchema, ...exerciseFields });
export type CustomExercise = z.infer<typeof customExerciseSchema>;

export type Exercise = {
  id: string;
  name: string;
  equipment: Equipment;
  primaryMuscles: readonly Muscle[];
  secondaryMuscles: readonly Muscle[];
  measure: ExerciseMeasure;
  bodyweight: boolean;
};

type Entry = [
  id: string,
  name: string,
  equipment: Equipment,
  primary: Muscle[],
  secondary: Muscle[],
  options?: { measure?: ExerciseMeasure; bodyweight?: boolean },
];

const entries: Entry[] = [
  ["back_squat", "Back squat", "barbell", ["quads", "glutes"], ["adductors", "lower_back"]],
  ["front_squat", "Front squat", "barbell", ["quads"], ["glutes", "abs", "upper_back"]],
  ["goblet_squat", "Goblet squat", "dumbbell", ["quads", "glutes"], ["abs"]],
  ["leg_press", "Leg press", "machine", ["quads"], ["glutes"]],
  [
    "bulgarian_split_squat",
    "Bulgarian split squat",
    "dumbbell",
    ["quads", "glutes"],
    ["adductors"],
  ],
  ["lunge", "Lunge", "dumbbell", ["quads", "glutes"], ["hamstrings"]],
  [
    "deadlift",
    "Deadlift",
    "barbell",
    ["hamstrings", "glutes", "lower_back"],
    ["quads", "traps", "forearms"],
  ],
  [
    "sumo_deadlift",
    "Sumo deadlift",
    "barbell",
    ["glutes", "adductors", "quads"],
    ["hamstrings", "lower_back"],
  ],
  [
    "trap_bar_deadlift",
    "Trap bar deadlift",
    "barbell",
    ["quads", "glutes"],
    ["hamstrings", "traps"],
  ],
  ["romanian_deadlift", "Romanian deadlift", "barbell", ["hamstrings", "glutes"], ["lower_back"]],
  ["good_morning", "Good morning", "barbell", ["hamstrings", "lower_back"], ["glutes"]],
  ["hip_thrust", "Hip thrust", "barbell", ["glutes"], ["hamstrings"]],
  ["kettlebell_swing", "Kettlebell swing", "kettlebell", ["glutes", "hamstrings"], ["lower_back"]],
  [
    "power_clean",
    "Power clean",
    "barbell",
    ["glutes", "quads", "traps"],
    ["hamstrings", "upper_back"],
  ],
  ["leg_extension", "Leg extension", "machine", ["quads"], []],
  ["leg_curl", "Leg curl", "machine", ["hamstrings"], []],
  ["nordic_curl", "Nordic curl", "bodyweight", ["hamstrings"], [], { bodyweight: true }],
  ["calf_raise", "Calf raise", "machine", ["calves"], []],
  ["bench_press", "Bench press", "barbell", ["chest"], ["triceps", "front_delts"]],
  ["incline_bench_press", "Incline bench press", "barbell", ["chest", "front_delts"], ["triceps"]],
  [
    "dumbbell_bench_press",
    "Dumbbell bench press",
    "dumbbell",
    ["chest"],
    ["triceps", "front_delts"],
  ],
  [
    "incline_dumbbell_press",
    "Incline dumbbell press",
    "dumbbell",
    ["chest", "front_delts"],
    ["triceps"],
  ],
  ["chest_fly", "Chest fly", "cable", ["chest"], ["front_delts"]],
  ["push_up", "Push-up", "bodyweight", ["chest"], ["triceps", "front_delts"], { bodyweight: true }],
  ["dip", "Dip", "bodyweight", ["chest", "triceps"], ["front_delts"], { bodyweight: true }],
  ["overhead_press", "Overhead press", "barbell", ["front_delts"], ["triceps", "side_delts"]],
  [
    "dumbbell_shoulder_press",
    "Dumbbell shoulder press",
    "dumbbell",
    ["front_delts"],
    ["triceps", "side_delts"],
  ],
  ["push_press", "Push press", "barbell", ["front_delts"], ["triceps", "quads"]],
  ["lateral_raise", "Lateral raise", "dumbbell", ["side_delts"], []],
  ["rear_delt_fly", "Rear delt fly", "dumbbell", ["rear_delts"], ["upper_back"]],
  ["face_pull", "Face pull", "cable", ["rear_delts"], ["upper_back"]],
  ["shrug", "Shrug", "barbell", ["traps"], ["forearms"]],
  ["pull_up", "Pull-up", "bodyweight", ["lats"], ["biceps", "upper_back"], { bodyweight: true }],
  ["chin_up", "Chin-up", "bodyweight", ["lats", "biceps"], ["upper_back"], { bodyweight: true }],
  ["lat_pulldown", "Lat pulldown", "cable", ["lats"], ["biceps"]],
  ["barbell_row", "Barbell row", "barbell", ["upper_back", "lats"], ["biceps", "rear_delts"]],
  ["dumbbell_row", "Dumbbell row", "dumbbell", ["lats", "upper_back"], ["biceps"]],
  ["seated_cable_row", "Seated cable row", "cable", ["upper_back", "lats"], ["biceps"]],
  [
    "inverted_row",
    "Inverted row",
    "bodyweight",
    ["upper_back"],
    ["biceps", "rear_delts"],
    { bodyweight: true },
  ],
  ["barbell_curl", "Barbell curl", "barbell", ["biceps"], ["forearms"]],
  ["dumbbell_curl", "Dumbbell curl", "dumbbell", ["biceps"], ["forearms"]],
  ["hammer_curl", "Hammer curl", "dumbbell", ["biceps", "forearms"], []],
  ["triceps_pushdown", "Triceps pushdown", "cable", ["triceps"], []],
  ["skull_crusher", "Skull crusher", "barbell", ["triceps"], []],
  ["wrist_curl", "Wrist curl", "dumbbell", ["forearms"], []],
  ["plank", "Plank", "bodyweight", ["abs"], ["obliques"], { measure: "time", bodyweight: true }],
  [
    "side_plank",
    "Side plank",
    "bodyweight",
    ["obliques"],
    ["abs"],
    { measure: "time", bodyweight: true },
  ],
  [
    "hanging_leg_raise",
    "Hanging leg raise",
    "bodyweight",
    ["abs"],
    ["forearms"],
    { bodyweight: true },
  ],
  ["ab_wheel", "Ab wheel rollout", "other", ["abs"], ["lats"], { bodyweight: true }],
  [
    "back_extension",
    "Back extension",
    "bodyweight",
    ["lower_back", "glutes"],
    ["hamstrings"],
    { bodyweight: true },
  ],
  [
    "farmers_carry",
    "Farmer's carry",
    "dumbbell",
    ["forearms", "traps"],
    ["abs"],
    { measure: "time" },
  ],
  [
    "hangboard_hang",
    "Hangboard hang",
    "hangboard",
    ["forearms"],
    ["lats"],
    { measure: "time", bodyweight: true },
  ],
  [
    "dead_hang",
    "Dead hang",
    "bodyweight",
    ["forearms"],
    ["lats"],
    { measure: "time", bodyweight: true },
  ],
  [
    "campus_board",
    "Campus board",
    "hangboard",
    ["forearms", "lats"],
    ["biceps"],
    { bodyweight: true },
  ],
];

export const exerciseCatalogue: readonly Exercise[] = entries.map(
  ([id, name, kind, primaryMuscles, secondaryMuscles, options]) => ({
    id,
    name,
    equipment: kind,
    primaryMuscles,
    secondaryMuscles,
    measure: options?.measure ?? "reps",
    bodyweight: options?.bodyweight ?? false,
  }),
);

const catalogueById = new Map(exerciseCatalogue.map((exercise) => [exercise.id, exercise]));

export const catalogueExercise = (id: string) => catalogueById.get(id);

export function findExercise(id: string, custom: readonly CustomExercise[] = []) {
  return catalogueById.get(id) ?? custom.find((exercise) => exercise.id === id);
}
