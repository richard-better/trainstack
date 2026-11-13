import type { ActivityFileFormat } from "../db/schema";
import { summarizeFit } from "./fit";
import type { FileSummary } from "./file-summary";

export const decoders: Partial<Record<ActivityFileFormat, (bytes: Uint8Array) => FileSummary>> = {
  fit: summarizeFit,
};

export const decodableFormats = Object.keys(decoders) as ActivityFileFormat[];
