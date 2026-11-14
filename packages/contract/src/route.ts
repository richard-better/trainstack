import { z } from "zod";

export const activityRouteSchema = z
  .object({
    segments: z
      .array(z.string())
      .describe(
        "Google encoded polylines, precision 5, of the track while the timer ran. A new segment starts after a pause, a GPS gap of more than 60 seconds, or a jump faster than 100 m/s, so nothing draws a line across the map. Simplified with Douglas-Peucker to about 1e-4 degrees, and to at most 300 points across all segments",
      ),
    bounds: z
      .tuple([z.number(), z.number(), z.number(), z.number()])
      .describe("[west, south, east, north] in degrees, over every position kept"),
  })
  .nullable()
  .describe(
    "A simplified route of where the activity went, for a thumbnail or a first map, from the analysis of this activity's own file. Null for an indoor activity, for a file without positions, and until the file is analysed. Each copy of a duplicated workout has the route of its own file",
  );

export type ActivityRoute = z.infer<typeof activityRouteSchema>;
