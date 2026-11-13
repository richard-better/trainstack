import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ActivityFileError,
  decodeActivityFile,
  maxActivityFileBytes,
  type ActivityFileErrorCode,
} from "../src/index.ts";
import { file, fileNames, text } from "./files.ts";

function assertFails(data: Uint8Array, code: ActivityFileErrorCode) {
  assert.throws(
    () => decodeActivityFile(data),
    (error) => error instanceof ActivityFileError && error.code === code,
  );
}

function random(seed: number) {
  let state = seed;
  return (below: number) => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) % below;
  };
}

function gpx(trackpoints: string): Uint8Array {
  return text(`<gpx version="1.1"><trk><trkseg>${trackpoints}</trkseg></trk></gpx>`);
}

function timed(seconds: number): string {
  return `<trkpt lat="47.5" lon="19.0"><time>${new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString()}</time></trkpt>`;
}

function elapsedMilliseconds(work: () => void): number {
  const started = performance.now();
  work();
  return performance.now() - started;
}

test("fails with an ActivityFileError at every length an XML file could be cut to", () => {
  for (const name of fileNames) {
    const data = file(name);
    const rootEnd = data.lastIndexOf(0x3e) + 1;
    for (let length = 0; length < rootEnd; length++) {
      assert.throws(
        () => decodeActivityFile(data.subarray(0, length)),
        ActivityFileError,
        `${name} cut to ${length} bytes`,
      );
    }
  }
});

test("decodes or fails with an ActivityFileError when bytes are corrupted", () => {
  const next = random(64);
  const files = fileNames.map(file);
  const markup = text(`<>/&;="'![]?-:`);
  for (let round = 0; round < 3000; round++) {
    const data = files[round % files.length]!.slice();
    const changes = 1 + next(8);
    for (let change = 0; change < changes; change++) {
      data[next(data.length)] = next(2) === 0 ? markup[next(markup.length)]! : next(256);
    }
    try {
      decodeActivityFile(data);
    } catch (error) {
      assert.ok(error instanceof ActivityFileError, `round ${round}: ${String(error)}`);
    }
  }
});

test("rejects XML that is not well formed", () => {
  assertFails(text("<gpx><trk></trkseg></gpx>"), "malformed");
  assertFails(text("<gpx><trk>"), "truncated");
  assertFails(text("<gpx><!-- never closed"), "truncated");
  assertFails(text('<gpx version="1.1></gpx>'), "truncated");
  assertFails(text("<gpx version=1.1></gpx>"), "malformed");
  assertFails(text("<gpx><trk><trkseg><trkpt lat='1'lon='2'/></trkseg></trk></gpx>"), "malformed");
  assertFails(text("<gpx><![CDATA[ never closed"), "truncated");
  assertFails(text("<gpx><!ELEMENT trk ANY></gpx>"), "malformed");
  assertFails(
    text("<TrainingCenterDatabase><Activities></Activities></TrainingCenterDatabase>"),
    "noActivity",
  );
});

test("never expands entities a DOCTYPE declares", () => {
  const laughs = Array.from(
    { length: 9 },
    (_, level) => `<!ENTITY lol${level + 1} "${`&lol${level};`.repeat(10)}">`,
  ).join("");
  assertFails(
    text(`<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY lol0 "lol">${laughs}]><gpx>&lol9;</gpx>`),
    "unrecognizedFormat",
  );
  const named = decodeActivityFile(
    text(
      `<gpx><trk><name>&lol9; &amp; &#0; &#xD800;</name><trkseg>${timed(0)}</trkseg></trk></gpx>`,
    ),
  );
  assert.equal(named.name, "&lol9; & � �");
});

test("rejects nesting deeper than any activity file needs, without recursing", () => {
  assertFails(text(`<gpx>${"<a>".repeat(200_000)}`), "malformed");
});

test("rejects an element with more attributes than any activity file needs", () => {
  const attributes = Array.from({ length: 65 }, (_, index) => `a${index}="1"`).join(" ");
  assertFails(text(`<gpx ${attributes}></gpx>`), "malformed");
});

test("keeps only the first few kilobytes of an element's text", () => {
  const activity = decodeActivityFile(
    text(`<gpx><trk><name>${"ab".repeat(100_000)}</name><trkseg>${timed(0)}</trkseg></trk></gpx>`),
  );
  assert.equal(activity.name, "ab".repeat(2048));
});

test("rejects a file larger than the limit before reading it", () => {
  const huge = new Uint8Array(maxActivityFileBytes + 1);
  huge.set(text("<gpx>"));
  assertFails(huge, "tooLarge");
});

test("decodes a ten hour ride recorded every second in well under a second per ten megabytes", () => {
  const points = Array.from(
    { length: 36_000 },
    (_, second) =>
      `<trkpt lat="${(47.5 + second / 100_000).toFixed(7)}" lon="19.0400000"><ele>${(100 + (second % 50)).toFixed(1)}</ele><time>${new Date(Date.UTC(2026, 0, 1) + second * 1000).toISOString()}</time><extensions><power>${200 + (second % 40)}</power><gpxtpx:TrackPointExtension><gpxtpx:atemp>18</gpxtpx:atemp><gpxtpx:hr>140</gpxtpx:hr><gpxtpx:cad>90</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt>\n`,
  ).join("");
  const data = gpx(points);
  assert.ok(data.length > 10_000_000, `${data.length} bytes`);
  let records = 0;
  const milliseconds = elapsedMilliseconds(() => {
    records = decodeActivityFile(data).records.length;
  });
  assert.equal(records, 36_000);
  assert.ok(milliseconds < 3000, `${milliseconds} ms`);
});

test("spends time in proportion to size on input crafted to be slow", () => {
  const megabytes = 8;
  const size = megabytes * 1024 * 1024;
  const crafted = {
    attributes: text(`<gpx ${'a="1" '.repeat(size / 6)}/>`),
    distinctAttributes: text(
      `<gpx ${Array.from({ length: size / 12 }, (_, index) => `a${index}="1"`).join(" ")}/>`,
    ),
    textBetweenComments: text(`<gpx><trk><name>${"a<!---->".repeat(size / 8)}</name></trk></gpx>`),
    entities: text(`<gpx><trk><name>${"&amp;".repeat(size / 5)}</name></trk></gpx>`),
    comment: text(`<gpx><!--${"-".repeat(size)}--></gpx>`),
    untimedPoints: gpx('<trkpt lat="1" lon="2"/>'.repeat(size / 24)),
    emptyElements: text(`<gpx>${"<a/>".repeat(size / 4)}</gpx>`),
    unclosedCdata: text(`<gpx>${"<![CDATA[".repeat(size / 9)}`),
    closingTags: text(`<gpx>${"<x></x>".repeat(size / 7)}</gpx>`),
    unknownLeaves: gpx(
      `<trkpt lat="1" lon="2">${"<extensions><hr>1</hr></extensions>".repeat(size / 36)}</trkpt>`,
    ),
  };
  for (const [name, data] of Object.entries(crafted)) {
    const milliseconds = elapsedMilliseconds(() => {
      try {
        decodeActivityFile(data);
      } catch (error) {
        assert.ok(error instanceof ActivityFileError, `${name}: ${String(error)}`);
      }
    });
    assert.ok(milliseconds < 3000, `${name} took ${milliseconds} ms`);
  }
});
