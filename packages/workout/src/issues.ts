export const workoutFormats = ["zwo", "erg", "mrc"] as const;
export type WorkoutFormat = (typeof workoutFormats)[number];

export type IssueCode = "malformed" | "unsupported" | "dropped" | "expanded";

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

  constructor(
    readonly format: WorkoutFormat | undefined,
    readonly issues: FormatIssue[],
  ) {
    super(
      `${format ? `.${format} ` : ""}conversion failed: ${issues
        .map((issue) => (issue.at ? `${issue.at}: ${issue.message}` : issue.message))
        .join("; ")}`,
    );
  }
}

export class IssueLog {
  readonly errors: FormatIssue[] = [];
  readonly warnings: FormatIssue[] = [];

  constructor(readonly format: WorkoutFormat) {}

  fail(code: "malformed" | "unsupported", message: string, at?: string): void {
    this.errors.push({ code, message, at });
  }

  warn(code: "dropped" | "expanded" | "malformed", message: string, at?: string): void {
    this.warnings.push({ code, message, at });
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
