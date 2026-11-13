export type ActivityFileFormat = "fit" | "gpx" | "tcx";

export type ActivityFileErrorCode =
  | "unrecognizedFormat"
  | "tooLarge"
  | "truncated"
  | "malformed"
  | "badChecksum"
  | "noActivity";

const messages: Record<ActivityFileErrorCode, string> = {
  unrecognizedFormat: "The data is not a FIT, GPX or TCX file.",
  tooLarge: "The file is larger than an activity file can be.",
  truncated: "The file ends before its data does.",
  malformed: "The file does not follow its format.",
  badChecksum: "The file's checksum does not match its contents.",
  noActivity: "The file has no timed points, laps or sessions.",
};

export class ActivityFileError extends Error {
  readonly code: ActivityFileErrorCode;
  readonly format: ActivityFileFormat | undefined;

  constructor(
    code: ActivityFileErrorCode,
    format: ActivityFileFormat | undefined,
    options?: ErrorOptions,
  ) {
    super(messages[code], options);
    this.name = "ActivityFileError";
    this.code = code;
    this.format = format;
  }
}
