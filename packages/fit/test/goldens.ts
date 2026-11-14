import { readFileSync } from "node:fs";

const rideKit = new URL("../../../apps/ride/RideKit/", import.meta.url);

export const traceNames = [
  "quick-test-trainer-drop",
  "recovery-every-control",
  "trainer-and-strap",
] as const;

function read(path: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(path, rideKit)));
}

export function sampleRide(): Uint8Array {
  return read("Sources/RideData/Resources/SampleRide.fit");
}

export function trace(
  name: (typeof traceNames)[number] | "laps-marked-paused-and-skipped",
): Uint8Array {
  return read(`Tests/RideCoreTests/Traces/${name}.fit`);
}
