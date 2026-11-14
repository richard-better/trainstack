import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { restartedWithoutARecord, smartRecordedRide } from "./smart-recorded-ride.ts";

const directory = process.argv[2]!;
writeFileSync(join(directory, "smart-recorded-ride.fit"), smartRecordedRide());
writeFileSync(
  join(directory, "restarted-without-a-record.fit"),
  restartedWithoutARecord({ recordWhileStopped: false }),
);
writeFileSync(
  join(directory, "restarted-with-a-record-while-stopped.fit"),
  restartedWithoutARecord({ recordWhileStopped: true }),
);
