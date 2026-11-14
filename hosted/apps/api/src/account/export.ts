import { and, getTableColumns, gt, sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { Hono } from "hono";

import { contentTypes } from "../activities/files";
import { sessionOf } from "../context";
import type { Database } from "../db";
import {
  athleteFiles,
  handlingOf,
  type AnyExported,
  isExported,
  sqlNameOf,
  tableOf,
  tableKeys,
  type TableKey,
} from "./athlete-data";
import type { AthleteBuckets } from "./deletion";
import { endOfArchive, fileHeader, paddingAfter } from "./tar";

export type ExportDeps = { env: AthleteBuckets; database: () => Database };

const ROWS_PER_QUERY = 500;
const BYTES_PER_PART = 4 * 1024 * 1024;
const ROWID = "__rowid";

const extensionOf = Object.fromEntries(
  Object.entries(contentTypes).map(([format, type]) => [type, `.${format}`]),
);

type Counted = { path: string; rows: number; parts: number };
type CountedFiles = { folder: string; files: number; bytes: number };

class TarStream {
  private writer: WritableStreamDefaultWriter<Uint8Array>;

  constructor(private readonly stream: WritableStream<Uint8Array>) {
    this.writer = stream.getWriter();
  }

  async file(path: string, bytes: Uint8Array, modified: Date) {
    await this.writer.write(fileHeader(path, bytes.byteLength, modified));
    await this.writer.write(bytes);
    await this.writer.write(paddingAfter(bytes.byteLength));
  }

  async streamed(path: string, size: number, body: ReadableStream<Uint8Array>, modified: Date) {
    await this.writer.write(fileHeader(path, size, modified));
    this.writer.releaseLock();
    await body.pipeTo(this.stream, { preventClose: true });
    this.writer = this.stream.getWriter();
    await this.writer.write(paddingAfter(size));
  }

  async end() {
    await this.writer.write(endOfArchive);
    await this.writer.close();
  }

  async fail(reason: unknown) {
    await this.writer.abort(reason).catch(() => undefined);
  }
}

export function exportRoutes(deps: ExportDeps) {
  const app = new Hono();

  app.get("/export", async (c) => {
    const session = await sessionOf(c.req.raw);
    if (!session) return c.json({ error: "unauthorized" }, 401, { "Cache-Control": "no-store" });
    const madeAt = new Date();
    const folder = `trainstack-export-${madeAt.toISOString().slice(0, 10)}`;
    const { readable, writable } = new IdentityTransformStream();
    const archive = new TarStream(writable);
    writeArchive(deps, session.user.id, folder, madeAt, archive).catch(async (error) => {
      console.error(error);
      await archive.fail(error);
    });
    return new Response(readable, {
      headers: {
        "Content-Type": "application/x-tar",
        "Content-Disposition": `attachment; filename="${folder}.tar"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  return app;
}

async function writeArchive(
  deps: ExportDeps,
  userId: string,
  folder: string,
  madeAt: Date,
  archive: TarStream,
) {
  const database = deps.database();
  const tables: Counted[] = [];
  for (const key of tableKeys) {
    const handling = handlingOf(key);
    if (isExported(handling)) {
      tables.push(await writeTable(database, key, handling, userId, folder, madeAt, archive));
    }
  }
  const files: CountedFiles[] = [];
  for (const each of athleteFiles) {
    const bucket = deps.env[each.bucket];
    const prefix = each.prefix(userId);
    const counted = { folder: each.archiveFolder, files: 0, bytes: 0 };
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ prefix, cursor, include: ["httpMetadata"] });
      for (const listed of page.objects) {
        const object = await bucket.get(listed.key);
        if (!object) continue;
        const extension = extensionOf[object.httpMetadata?.contentType ?? ""] ?? "";
        const name = `${folder}/${each.archiveFolder}/${listed.key.slice(prefix.length)}${extension}`;
        await archive.streamed(name, object.size, object.body, object.uploaded);
        counted.files += 1;
        counted.bytes += object.size;
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    files.push(counted);
  }
  await archive.file(
    `${folder}/README.md`,
    new TextEncoder().encode(readme(madeAt, tables, files)),
    madeAt,
  );
  await archive.end();
}

async function writeTable(
  database: Database,
  key: TableKey,
  handling: AnyExported,
  userId: string,
  folder: string,
  madeAt: Date,
  archive: TarStream,
): Promise<Counted> {
  const table = tableOf(key) as SQLiteTable;
  const withheld = new Set<string>(handling.withheld?.columns ?? []);
  const columns = Object.fromEntries(
    Object.entries(getTableColumns(table)).filter(([name]) => !withheld.has(name)),
  );
  const readable = handling.readable ?? {};
  const owner = handling.owner(table as never);
  const path = `${folder}/data/${sqlNameOf(key)}`;
  const counted: Counted = { path: `data/${sqlNameOf(key)}`, rows: 0, parts: 0 };
  let part: Uint8Array[] = [];
  let partBytes = 0;
  const flush = async () => {
    if (part.length === 0) return;
    counted.parts += 1;
    const bytes = new Uint8Array(partBytes);
    let offset = 0;
    for (const line of part) {
      bytes.set(line, offset);
      offset += line.byteLength;
    }
    await archive.file(`${path}/${String(counted.parts).padStart(4, "0")}.jsonl`, bytes, madeAt);
    part = [];
    partBytes = 0;
  };

  let after = 0;
  for (;;) {
    const rowid = sql<number>`rowid`;
    const rows = (await database
      .select({ ...columns, [ROWID]: rowid } as Record<string, AnySQLiteColumn | SQL>)
      .from(table)
      .where(and(sql`${owner} = ${userId}`, gt(rowid, after)))
      .orderBy(rowid)
      .limit(ROWS_PER_QUERY)) as Record<string, unknown>[];
    for (const row of rows) {
      after = row[ROWID] as number;
      delete row[ROWID];
      for (const [name, read] of Object.entries(readable)) if (read) row[name] = read(row[name]);
      const line = new TextEncoder().encode(`${JSON.stringify(row)}\n`);
      part.push(line);
      partBytes += line.byteLength;
      counted.rows += 1;
      if (partBytes >= BYTES_PER_PART) await flush();
    }
    if (rows.length < ROWS_PER_QUERY) break;
  }
  await flush();
  return counted;
}

function readme(madeAt: Date, tables: Counted[], files: CountedFiles[]) {
  const exported = tableKeys.flatMap((key) => {
    const handling = handlingOf(key);
    if (!isExported(handling)) return [];
    const counted = tables.find(({ path }) => path === `data/${sqlNameOf(key)}`)!;
    const columns = Object.keys(getTableColumns(tableOf(key) as SQLiteTable)).filter(
      (name) => !handling.withheld?.columns.includes(name),
    );
    return [
      `### ${counted.path}/`,
      "",
      handling.about,
      "",
      `${counted.rows} ${counted.rows === 1 ? "row" : "rows"} in ${counted.parts} ${counted.parts === 1 ? "part" : "parts"}. Fields: ${columns.map((name) => `\`${name}\``).join(", ")}.`,
      ...(handling.withheld
        ? [
            "",
            `Left out: ${handling.withheld.columns.map((name) => `\`${name}\``).join(", ")}, because ${handling.withheld.why}.`,
          ]
        : []),
      "",
    ];
  });
  const notExported = tableKeys.flatMap((key) => {
    const handling = handlingOf(key);
    return isExported(handling) ? [] : [`- \`${sqlNameOf(key)}\`: ${handling.notExported}`];
  });
  const folders = athleteFiles.flatMap((each) => {
    const counted = files.find(({ folder }) => folder === each.archiveFolder)!;
    return [
      `### ${each.archiveFolder}/`,
      "",
      each.about,
      "",
      `${counted.files} ${counted.files === 1 ? "file" : "files"}, ${counted.bytes} bytes.`,
      "",
    ];
  });
  return [
    "# Your TrainStack data",
    "",
    `Everything TrainStack held about your account on ${madeAt.toISOString()}.`,
    "",
    "## How it is laid out",
    "",
    "Each folder under `data/` is one kind of record, as JSON Lines: one JSON object per line, split into numbered parts of a few megabytes. Field names are the ones TrainStack uses. Times are ISO 8601 in UTC, days are `YYYY-MM-DD`, and ids are shared between folders, so `activityId` in `data/activity_statistic` is the `id` of a row in `data/activity`.",
    "",
    "## Records",
    "",
    ...exported,
    "## Files",
    "",
    ...folders,
    "## What is not in this archive",
    "",
    "TrainStack keeps these too, but they are short-lived workings rather than your data. Deleting your account deletes any of them that belong to it.",
    "",
    ...notExported,
    "",
  ].join("\n");
}
