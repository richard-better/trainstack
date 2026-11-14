import { writeFileSync } from "node:fs";

import { smartRecordedRide } from "./smart-recorded-ride.ts";

writeFileSync(process.argv[2]!, smartRecordedRide());
