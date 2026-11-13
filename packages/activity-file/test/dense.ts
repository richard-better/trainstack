import { fitChecksum } from "../../fit/src/checksum.ts";

const start = Date.UTC(2026, 0, 1);
const fitEpochMilliseconds = 631_065_600_000;
const semicirclesPerDegree = 2 ** 31 / 180;

function point(second: number) {
  return {
    time: start + second * 1000,
    latitude: 47.5 + Math.sin(second / 600) / 100,
    longitude: 19.04 + Math.cos(second / 600) / 100,
    altitude: 100 + 20 * Math.sin(second / 300),
    speed: 8 + Math.sin(second / 60),
    heartRate: 130 + (second % 30),
    cadence: 85 + (second % 10),
    distance: second * 8,
    power: 200 + (second % 50),
  };
}

export function denseFit(size: number): Uint8Array {
  const recordSize = 25;
  const definition = [
    0x40, 0, 0, 20, 0, 9, 253, 4, 0x86, 0, 4, 0x85, 1, 4, 0x85, 2, 2, 0x84, 6, 2, 0x84, 3, 1, 0x02,
    4, 1, 0x02, 5, 4, 0x86, 7, 2, 0x84,
  ];
  const count = Math.floor((size - 14 - definition.length - 2) / recordSize);
  const dataSize = definition.length + count * recordSize;
  const bytes = new Uint8Array(14 + dataSize + 2);
  const view = new DataView(bytes.buffer);
  bytes.set([14, 0x20, 0x5c, 0x08]);
  view.setUint32(4, dataSize, true);
  bytes.set([0x2e, 0x46, 0x49, 0x54], 8);
  view.setUint16(12, fitChecksum(bytes.subarray(0, 12)), true);
  bytes.set(definition, 14);
  let position = 14 + definition.length;
  for (let second = 0; second < count; second++) {
    const sample = point(second);
    bytes[position] = 0;
    view.setUint32(position + 1, (sample.time - fitEpochMilliseconds) / 1000, true);
    view.setInt32(position + 5, Math.round(sample.latitude * semicirclesPerDegree), true);
    view.setInt32(position + 9, Math.round(sample.longitude * semicirclesPerDegree), true);
    view.setUint16(position + 13, Math.round((sample.altitude + 500) * 5), true);
    view.setUint16(position + 15, Math.round(sample.speed * 1000), true);
    bytes[position + 17] = sample.heartRate;
    bytes[position + 18] = sample.cadence;
    view.setUint32(position + 19, sample.distance * 100, true);
    view.setUint16(position + 23, sample.power, true);
    position += recordSize;
  }
  view.setUint16(position, fitChecksum(bytes.subarray(0, position)), true);
  return bytes;
}

function xml(size: number, head: string, tail: string, item: (second: number) => string) {
  const encoder = new TextEncoder();
  const bytes = new Uint8Array(size);
  let position = encoder.encodeInto(head, bytes).written;
  const end = size - encoder.encode(tail).length;
  for (let second = 0; ; second++) {
    const encoded = encoder.encode(item(second));
    if (position + encoded.length > end) break;
    bytes.set(encoded, position);
    position += encoded.length;
  }
  position += encoder.encodeInto(tail, bytes.subarray(position)).written;
  return bytes.subarray(0, position);
}

export function denseGpx(size: number): Uint8Array {
  return xml(
    size,
    `<?xml version="1.0" encoding="UTF-8"?>\n<gpx creator="StravaGPX" version="1.1" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">\n <trk>\n  <name>Dense Ride</name>\n  <type>cycling</type>\n  <trkseg>\n`,
    `  </trkseg>\n </trk>\n</gpx>\n`,
    (second) => {
      const sample = point(second);
      return `   <trkpt lat="${sample.latitude.toFixed(7)}" lon="${sample.longitude.toFixed(7)}">\n    <ele>${sample.altitude.toFixed(1)}</ele>\n    <time>${new Date(sample.time).toISOString().replace(".000", "")}</time>\n    <extensions>\n     <power>${sample.power}</power>\n     <gpxtpx:TrackPointExtension>\n      <gpxtpx:atemp>18</gpxtpx:atemp>\n      <gpxtpx:hr>${sample.heartRate}</gpxtpx:hr>\n      <gpxtpx:cad>${sample.cadence}</gpxtpx:cad>\n     </gpxtpx:TrackPointExtension>\n    </extensions>\n   </trkpt>\n`;
    },
  );
}

export function denseTcx(size: number): Uint8Array {
  return xml(
    size,
    `<?xml version="1.0" encoding="UTF-8"?>\n<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">\n <Activities>\n  <Activity Sport="Biking">\n   <Id>${new Date(start).toISOString()}</Id>\n   <Lap StartTime="${new Date(start).toISOString()}">\n    <TriggerMethod>Manual</TriggerMethod>\n    <Track>\n`,
    `    </Track>\n   </Lap>\n  </Activity>\n </Activities>\n</TrainingCenterDatabase>\n`,
    (second) => {
      const sample = point(second);
      return `     <Trackpoint>\n      <Time>${new Date(sample.time).toISOString()}</Time>\n      <Position>\n       <LatitudeDegrees>${sample.latitude.toFixed(7)}</LatitudeDegrees>\n       <LongitudeDegrees>${sample.longitude.toFixed(7)}</LongitudeDegrees>\n      </Position>\n      <AltitudeMeters>${sample.altitude.toFixed(1)}</AltitudeMeters>\n      <DistanceMeters>${sample.distance.toFixed(1)}</DistanceMeters>\n      <HeartRateBpm>\n       <Value>${sample.heartRate}</Value>\n      </HeartRateBpm>\n      <Cadence>${sample.cadence}</Cadence>\n      <Extensions>\n       <ns3:TPX>\n        <ns3:Speed>${sample.speed.toFixed(3)}</ns3:Speed>\n        <ns3:Watts>${sample.power}</ns3:Watts>\n       </ns3:TPX>\n      </Extensions>\n     </Trackpoint>\n`;
    },
  );
}
