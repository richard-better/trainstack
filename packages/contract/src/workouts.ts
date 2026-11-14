import { oc } from "@orpc/contract";
import {
  focusSchema,
  sportSchema,
  workoutFileFormats,
  workoutFormats,
  workoutSchema,
} from "@trainstack/workout";
import { z } from "zod";

export const MAX_WORKOUT_BYTES = 256 * 1024;
export const MAX_WORKOUT_FILE_BYTES = 1024 * 1024;
export const MAX_WORKOUT_LIST_ENTRIES = 1000;

export const workoutIdSchema = z
  .uuid()
  .describe(
    "Chosen by the client that creates the workout, so a device can create one offline and a replayed create changes nothing",
  );

export const builtinWorkoutIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(100)
  .describe("A built-in workout's id: its name in lowercase words joined by hyphens");

export const workoutListIdSchema = z.uuid().describe("Chosen by the client that creates the list");

export const workoutFormatSchema = z.enum(workoutFormats);

export const workoutFileFormatSchema = z.enum(workoutFileFormats);

const editedAt = z
  .date()
  .describe(
    "When the athlete made this edit, by the device's clock. Of two writes to the same workout or list, the later one wins; of two at the same moment, the server picks the same one in either order",
  );

export const workoutTotalsSchema = z.object({
  seconds: z.number().describe("The time of every step measured in time"),
  meters: z.number().describe("The distance of every step measured in distance"),
});

export const workoutOriginSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("builtin"), id: builtinWorkoutIdSchema }),
    z.object({ kind: z.literal("file"), format: workoutFileFormatSchema, fileName: z.string() }),
  ])
  .nullable()
  .describe(
    "Where the workout came from: a copied built-in, an imported file, or null if made here",
  );

const summaryFields = {
  name: z.string(),
  sport: sportSchema,
  focus: focusSchema.nullable(),
  description: z.string().nullable(),
  author: z.string().nullable(),
  tags: z.array(z.string()),
  totals: workoutTotalsSchema,
};

export const workoutSummarySchema = z.object({
  id: workoutIdSchema,
  ...summaryFields,
  origin: workoutOriginSchema,
  createdAt: z.date(),
  updatedAt: editedAt,
});

export const storedWorkoutSchema = workoutSummarySchema.extend({
  workout: workoutSchema.describe(
    "The workout itself, whole and self-contained, so a plan can embed a copy of it",
  ),
});

export const builtinWorkoutSummarySchema = z.object({
  id: builtinWorkoutIdSchema,
  ...summaryFields,
});

export const builtinWorkoutSchema = builtinWorkoutSummarySchema.extend({
  workout: workoutSchema,
});

export const workoutSortSchema = z
  .enum(["updated", "name", "duration"])
  .describe(
    "updated: the latest edit first. name: A to Z. duration: the shortest first, by the time of its timed steps",
  );

export const builtinWorkoutSortSchema = z
  .enum(["library", "name", "duration"])
  .describe(
    "library: the order the library presents them in. name: A to Z. duration: the shortest first",
  );

const filters = {
  query: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe(
      "Words that must each appear in the name, description, author or tags, ignoring case and accents",
    ),
  sport: sportSchema.optional(),
  focus: focusSchema.optional(),
  minSeconds: z
    .number()
    .nonnegative()
    .optional()
    .describe("The least time, counting only steps measured in time"),
  maxSeconds: z.number().nonnegative().optional(),
};

export const workoutDeletionSchema = z.object({ id: workoutIdSchema, deletedAt: z.date() });

export const formatIssueSchema = z.object({
  code: z.enum(["malformed", "unsupported", "dropped", "expanded", "converted", "approximated"]),
  message: z.string(),
  at: z.string().optional(),
});

const exportWarnings = z
  .array(formatIssueSchema)
  .describe(
    "What the format has no place for and was left out, such as names or notes, and what was converted or approximated",
  );

export const exportedWorkoutSchema = z.union([
  z.object({
    fileName: z.string(),
    contentType: z.string(),
    text: z.string().describe("The file, for the text formats .zwo, .erg and .mrc"),
    warnings: exportWarnings,
  }),
  z.object({
    fileName: z.string(),
    contentType: z.string(),
    base64: z.string().describe("The file's bytes in base64, for the binary .fit format"),
    warnings: exportWarnings,
  }),
]);

const exportInput = {
  format: workoutFileFormatSchema,
  approximate: z
    .boolean()
    .optional()
    .describe(
      "For .fit: write a ramp as a staircase of steady steps and a max effort as a step with no target, each reported in warnings, instead of refusing the workout",
    ),
  ftp: z
    .number()
    .int()
    .min(1)
    .max(2000)
    .optional()
    .describe(
      "Watts. Needed to write power as a share of FTP to .erg, or watts to .zwo and .mrc. A .fit file holds either, and takes threshold heart rate and pace from the athlete's settings",
    ),
};

const unauthorized = { UNAUTHORIZED: {} };

const workoutNotFound = { NOT_FOUND: { status: 404, message: "No such workout" } };

const workoutDeleted = {
  WORKOUT_DELETED: {
    status: 410,
    message: "The workout was deleted, and a deleted workout stays deleted",
    data: workoutDeletionSchema,
  },
};

const editTooFarAhead = {
  EDITED_IN_THE_FUTURE: {
    status: 422,
    message: "updatedAt is later than the server's clock",
  },
};

const invalidWorkout = {
  INVALID_WORKOUT: {
    status: 422,
    message: "The workout is not valid in the workout model",
    data: z.object({ reason: z.string() }),
  },
};

const workoutTooLarge = {
  WORKOUT_TOO_LARGE: {
    status: 413,
    message: `A workout can take at most ${MAX_WORKOUT_BYTES} bytes`,
  },
};

const conversionFailed = {
  WORKOUT_FORMAT_ERROR: {
    status: 422,
    message: "The file could not be read, or the workout cannot be written in that format",
    data: z.object({
      format: workoutFileFormatSchema.nullable(),
      issues: z.array(formatIssueSchema),
    }),
  },
};

const workoutPage = <T extends z.ZodType>(item: T) =>
  z.object({ workouts: z.array(item), nextCursor: z.string().nullable() });

export const workoutsContract = {
  list: oc
    .route({
      method: "GET",
      path: "/workouts",
      description: "The athlete's own workouts, filtered and sorted, a page at a time",
    })
    .errors(unauthorized)
    .input(
      z.object({
        ...filters,
        sort: workoutSortSchema.default("updated"),
        limit: z.number().int().min(1).max(200).default(50),
        cursor: z.string().max(1000).optional(),
      }),
    )
    .output(workoutPage(workoutSummarySchema)),
  get: oc
    .route({ method: "GET", path: "/workouts/{id}" })
    .errors({ ...unauthorized, ...workoutNotFound, ...workoutDeleted })
    .input(z.object({ id: workoutIdSchema }))
    .output(storedWorkoutSchema),
  put: oc
    .route({
      method: "POST",
      path: "/workouts/{id}",
      description:
        "Create the workout, or replace it whole. The write with the later updatedAt wins, so a device that edited offline sends its edits when it is back. The response is what the server holds afterwards, which is another device's edit when that one is later",
    })
    .errors({
      ...unauthorized,
      ...workoutDeleted,
      ...editTooFarAhead,
      ...workoutTooLarge,
      ...invalidWorkout,
    })
    .input(z.object({ id: workoutIdSchema, workout: workoutSchema, updatedAt: editedAt }))
    .output(storedWorkoutSchema),
  delete: oc
    .route({
      method: "DELETE",
      path: "/workouts/{id}",
      description:
        "Delete the workout and take it out of every list. It stays deleted: a later write to it, from a device that has not heard yet, is refused with WORKOUT_DELETED",
    })
    .errors(unauthorized)
    .input(z.object({ id: workoutIdSchema }))
    .output(workoutDeletionSchema),
  changes: oc
    .route({
      method: "GET",
      path: "/workouts/changes",
      description:
        "Every workout written or deleted since the cursor, for a device that keeps a copy of the library",
    })
    .errors(unauthorized)
    .input(z.object({ since: z.string().regex(/^\d+$/).optional() }))
    .output(
      z.object({
        workouts: z.array(storedWorkoutSchema),
        deleted: z.array(workoutDeletionSchema),
        cursor: z.string().describe("Pass as since to get only what changes after this read"),
      }),
    ),
  import: oc
    .route({
      method: "POST",
      path: "/workouts/import",
      successStatus: 200,
      description:
        "Read a .zwo, .erg, .mrc or .fit file, picked by its extension, into a workout stored under id. A .fit file's zone and percent of max heart rate targets become the athlete's own values from their settings today, reported in warnings",
    })
    .errors({
      ...unauthorized,
      ...workoutDeleted,
      ...editTooFarAhead,
      ...workoutTooLarge,
      ...conversionFailed,
    })
    .input(
      z.object({
        file: z.file().min(1).max(MAX_WORKOUT_FILE_BYTES),
        id: workoutIdSchema,
        updatedAt: editedAt,
      }),
    )
    .output(
      z.object({
        workout: storedWorkoutSchema,
        warnings: z
          .array(formatIssueSchema)
          .describe("What the file held that the workout has no place for, or read loosely"),
      }),
    ),
  export: oc
    .route({ method: "GET", path: "/workouts/{id}/export" })
    .errors({ ...unauthorized, ...workoutNotFound, ...workoutDeleted, ...conversionFailed })
    .input(z.object({ id: workoutIdSchema, ...exportInput }))
    .output(exportedWorkoutSchema),
};

const builtinNotFound = { NOT_FOUND: { status: 404, message: "No such built-in workout" } };

export const builtinWorkoutsContract = {
  list: oc
    .route({
      method: "GET",
      path: "/builtin-workouts",
      description:
        "The workouts TrainStack ships, the same for every athlete and read-only. They are Ride's bundled workouts",
    })
    .errors(unauthorized)
    .input(
      z.object({
        ...filters,
        sort: builtinWorkoutSortSchema.default("library"),
      }),
    )
    .output(z.object({ workouts: z.array(builtinWorkoutSummarySchema) })),
  get: oc
    .route({ method: "GET", path: "/builtin-workouts/{id}" })
    .errors({ ...unauthorized, ...builtinNotFound })
    .input(z.object({ id: builtinWorkoutIdSchema }))
    .output(builtinWorkoutSchema),
  copy: oc
    .route({
      method: "POST",
      path: "/builtin-workouts/{id}/copy",
      description:
        "Copy a built-in workout into the athlete's own, under a new id, where they can change it",
    })
    .errors({
      ...unauthorized,
      ...builtinNotFound,
      ...workoutDeleted,
      ...editTooFarAhead,
    })
    .input(z.object({ id: builtinWorkoutIdSchema, as: workoutIdSchema, updatedAt: editedAt }))
    .output(storedWorkoutSchema),
  export: oc
    .route({ method: "GET", path: "/builtin-workouts/{id}/export" })
    .errors({ ...unauthorized, ...builtinNotFound, ...conversionFailed })
    .input(z.object({ id: builtinWorkoutIdSchema, ...exportInput }))
    .output(exportedWorkoutSchema),
};

export const workoutListSchema = z.object({
  id: workoutListIdSchema,
  name: z.string(),
  workoutIds: z.array(workoutIdSchema).describe("In the athlete's order"),
  createdAt: z.date(),
  updatedAt: editedAt,
});

export const workoutListDeletionSchema = z.object({ id: workoutListIdSchema, deletedAt: z.date() });

const listNotFound = { NOT_FOUND: { status: 404, message: "No such list" } };

const listDeleted = {
  LIST_DELETED: {
    status: 410,
    message: "The list was deleted, and a deleted list stays deleted",
    data: workoutListDeletionSchema,
  },
};

const listFull = {
  LIST_FULL: {
    status: 422,
    message: `A list holds at most ${MAX_WORKOUT_LIST_ENTRIES} workouts`,
  },
};

const listEntryWrite = {
  updatedAt: editedAt.describe(
    "When the athlete placed or removed the workout, by the device's clock. Each workout's place in a list is its own setting: of two writes to it, the later wins, so an add and a removal on two devices settle the same in either order",
  ),
};

export const workoutListsContract = {
  list: oc
    .route({ method: "GET", path: "/workout-lists" })
    .errors(unauthorized)
    .input(z.object({}))
    .output(z.object({ lists: z.array(workoutListSchema) })),
  get: oc
    .route({ method: "GET", path: "/workout-lists/{id}" })
    .errors({ ...unauthorized, ...listNotFound, ...listDeleted })
    .input(z.object({ id: workoutListIdSchema }))
    .output(workoutListSchema),
  put: oc
    .route({
      method: "POST",
      path: "/workout-lists/{id}",
      description: "Create the list or rename it. The later updatedAt wins",
    })
    .errors({ ...unauthorized, ...listDeleted, ...editTooFarAhead })
    .input(
      z.object({
        id: workoutListIdSchema,
        name: z.string().trim().min(1).max(200),
        updatedAt: editedAt,
      }),
    )
    .output(workoutListSchema),
  delete: oc
    .route({
      method: "DELETE",
      path: "/workout-lists/{id}",
      description: "Delete the list. Its workouts stay in the library",
    })
    .errors(unauthorized)
    .input(z.object({ id: workoutListIdSchema }))
    .output(workoutListDeletionSchema),
  place: oc
    .route({
      method: "POST",
      path: "/workout-lists/{id}/entries",
      description:
        "Put a workout in the list right after another one, or first when after is null. It adds the workout, or moves it if it is there already. A workout can be in several lists",
    })
    .errors({
      ...unauthorized,
      ...listNotFound,
      ...listDeleted,
      ...workoutNotFound,
      ...workoutDeleted,
      ...editTooFarAhead,
      ...listFull,
    })
    .input(
      z.object({
        id: workoutListIdSchema,
        workoutId: workoutIdSchema,
        after: workoutIdSchema
          .nullable()
          .describe("The workout to follow. When it is not in the list, the workout goes last"),
        ...listEntryWrite,
      }),
    )
    .output(workoutListSchema),
  remove: oc
    .route({ method: "POST", path: "/workout-lists/{id}/entries/remove" })
    .errors({ ...unauthorized, ...listNotFound, ...listDeleted, ...editTooFarAhead })
    .input(z.object({ id: workoutListIdSchema, workoutId: workoutIdSchema, ...listEntryWrite }))
    .output(workoutListSchema),
  changes: oc
    .route({
      method: "GET",
      path: "/workout-lists/changes",
      description: "Every list written or deleted since the cursor, each written one whole",
    })
    .errors(unauthorized)
    .input(z.object({ since: z.string().regex(/^\d+$/).optional() }))
    .output(
      z.object({
        lists: z.array(workoutListSchema),
        deleted: z.array(workoutListDeletionSchema),
        cursor: z.string(),
      }),
    ),
};

export type WorkoutSummary = z.infer<typeof workoutSummarySchema>;
export type StoredWorkout = z.infer<typeof storedWorkoutSchema>;
export type BuiltinWorkoutSummary = z.infer<typeof builtinWorkoutSummarySchema>;
export type BuiltinWorkout = z.infer<typeof builtinWorkoutSchema>;
export type WorkoutOrigin = z.infer<typeof workoutOriginSchema>;
export type WorkoutList = z.infer<typeof workoutListSchema>;
export type WorkoutSort = z.infer<typeof workoutSortSchema>;
export type ExportedWorkout = z.infer<typeof exportedWorkoutSchema>;
