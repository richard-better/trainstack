import { analysisStatistics } from "@trainstack/analysis";
import { type SQL, sql } from "drizzle-orm";

const analysisStatisticNames = JSON.stringify(analysisStatistics.map(({ name }) => name));

export const isAnalysisStatistic = (name: SQL | SQL.Aliased | unknown) =>
  sql`(${name} IN (SELECT value FROM json_each(${analysisStatisticNames})) OR ${name} GLOB 'time_in_*_zone_*_s')`;
