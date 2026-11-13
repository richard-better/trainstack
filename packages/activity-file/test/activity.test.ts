import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeFit } from "@trainstack/fit";

import { sampleRide } from "../../fit/test/goldens.ts";
import {
  ActivityFileError,
  decodeActivityFile,
  decodeGpx,
  decodeTcx,
  detectActivityFileFormat,
  type ActivityFileErrorCode,
} from "../src/index.ts";
import { file, fileNames, text } from "./files.ts";

function assertFails(data: Uint8Array, code: ActivityFileErrorCode) {
  assert.throws(
    () => decodeActivityFile(data),
    (error) => error instanceof ActivityFileError && error.code === code,
  );
}

test("detects each format from the content, whatever the file is called", () => {
  assert.equal(detectActivityFileFormat(sampleRide()), "fit");
  assert.equal(detectActivityFileFormat(sampleRide().buffer as ArrayBuffer), "fit");
  for (const name of fileNames) {
    assert.equal(detectActivityFileFormat(file(name)), name.slice(name.lastIndexOf(".") + 1), name);
  }
  assert.equal(detectActivityFileFormat(text("<html><body>Ride</body></html>")), undefined);
  assert.equal(detectActivityFileFormat(text("lat,lon\n47.5,19.0")), undefined);
  assert.equal(detectActivityFileFormat(new Uint8Array([0x1f, 0x8b, 0x08, 0x00])), undefined);
  assert.equal(detectActivityFileFormat(new Uint8Array()), undefined);
});

test("decodes a FIT file to what decodeFit gives", () => {
  const fit = decodeFit(sampleRide());
  const activity = decodeActivityFile(sampleRide());
  assert.equal(activity.format, "fit");
  assert.equal(activity.name, fit.workoutName);
  assert.deepEqual(activity.summary, fit.summary);
  assert.deepEqual(activity.laps, fit.laps);
  assert.deepEqual(activity.records, fit.records);
  assert.deepEqual(activity.events, fit.events);
});

test("decodes GPX and TCX to what their own decoders give", () => {
  for (const name of ["strava-ride.gpx", "garmin-connect-run.gpx", "garmin-connect-ride.tcx"]) {
    const decode = name.endsWith(".gpx") ? decodeGpx : decodeTcx;
    assert.deepEqual(decodeActivityFile(file(name)), decode(file(name)), name);
  }
  assert.equal(decodeActivityFile(file("strava-run.tcx").buffer as ArrayBuffer).format, "tcx");
});

test("gives one summary shape for every format", () => {
  const keys = (bytes: Uint8Array) => Object.keys(decodeActivityFile(bytes).summary).toSorted();
  const fitKeys = keys(sampleRide());
  assert.deepEqual(keys(file("strava-ride.gpx")), fitKeys);
  assert.deepEqual(keys(file("garmin-connect-ride.tcx")), fitKeys);
});

test("reports a FIT file's own failure with the FIT decoder's error as its cause", () => {
  const data = sampleRide();
  data[Math.floor(data.length / 2)]! ^= 0xff;
  assert.throws(
    () => decodeActivityFile(data),
    (error) =>
      error instanceof ActivityFileError &&
      error.code === "badChecksum" &&
      error.format === "fit" &&
      error.cause instanceof Error &&
      error.cause.name === "FitDecodeError",
  );
});

test("rejects data in no format it knows", () => {
  assertFails(new Uint8Array(), "unrecognizedFormat");
  assertFails(text("not an activity, only some text"), "unrecognizedFormat");
  assertFails(text("<kml><Document/></kml>"), "unrecognizedFormat");
  assert.throws(
    () => decodeGpx(file("strava-run.tcx")),
    (error) => error instanceof ActivityFileError && error.code === "unrecognizedFormat",
  );
  assert.throws(
    () => decodeTcx(file("strava-ride.gpx")),
    (error) => error instanceof ActivityFileError && error.code === "unrecognizedFormat",
  );
});
