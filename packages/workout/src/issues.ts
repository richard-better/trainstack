export const workoutFormats = ["zwo", "erg", "mrc"] as const;
export type WorkoutFormat = (typeof workoutFormats)[number];

export const workoutFileFormats = [...workoutFormats, "fit"] as const;
export type WorkoutFileFormat = (typeof workoutFileFormats)[number];

export type IssueCode =
  | "malformed"
  | "unsupported"
  | "dropped"
  | "expanded"
  | "converted"
  | "approximated";

export type FormatIssue = {
  code: IssueCode;
  message: string;
  at?: string | undefined;
};

export type Converted<T> = {
  value: T;
  warnings: FormatIssue[];
};

export class WorkoutFormatError extends Error {
  override readonly name = "WorkoutFormatError";

  readonly format: WorkoutFileFormat | undefined;
  readonly issues: FormatIssue[];

  constructor(format: WorkoutFileFormat | undefined, issues: FormatIssue[]) {
    super(
      `${format ? `.${format} ` : ""}conversion failed: ${issues
        .map((issue) => (issue.at ? `${issue.at}: ${issue.message}` : issue.message))
        .join("; ")}`,
    );
    this.format = format;
    this.issues = issues;
  }
}

export class IssueLog {
  readonly errors: FormatIssue[] = [];
  readonly warnings: FormatIssue[] = [];

  readonly format: WorkoutFileFormat;

  constructor(format: WorkoutFileFormat) {
    this.format = format;
  }

  fail(code: "malformed" | "unsupported", message: string, at?: string): void {
    this.errors.push(at === undefined ? { code, message } : { code, message, at });
  }

  warn(code: Exclude<IssueCode, "unsupported">, message: string, at?: string): void {
    this.warnings.push(at === undefined ? { code, message } : { code, message, at });
  }

  abort(code: "malformed" | "unsupported", message: string, at?: string): never {
    this.fail(code, message, at);
    throw new WorkoutFormatError(this.format, this.errors);
  }

  result<T>(value: T): Converted<T> {
    if (this.errors.length > 0) throw new WorkoutFormatError(this.format, this.errors);
    return { value, warnings: this.warnings };
  }
}
