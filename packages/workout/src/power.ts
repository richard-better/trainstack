import type { IssueLog } from "./issues.ts";
import type { Level, Target } from "./model.ts";

function scaled(level: Level, factor: number): Level {
  switch (level.kind) {
    case "constant":
      return { kind: "constant", value: level.value * factor };
    case "range":
      return { kind: "range", low: level.low * factor, high: level.high * factor };
    case "ramp":
      return { kind: "ramp", from: level.from * factor, to: level.to * factor };
  }
}

export function powerLevel(
  log: IssueLog,
  target: Target | undefined,
  unit: "ftp" | "watts",
  ftp: number | undefined,
  at: string,
): Level | undefined {
  if (target?.type !== "power") return undefined;
  if (target.unit === unit) return target.level;
  if (ftp === undefined) {
    log.fail(
      "unsupported",
      target.unit === "watts"
        ? "Power in watts needs an FTP to become a share of FTP"
        : "Power as a share of FTP needs an FTP to become watts",
      at,
    );
    return undefined;
  }
  if (!Number.isFinite(ftp) || ftp <= 0) {
    log.fail("unsupported", `FTP ${ftp} is not a positive number of watts`, at);
    return undefined;
  }
  return scaled(target.level, unit === "watts" ? ftp : 1 / ftp);
}
