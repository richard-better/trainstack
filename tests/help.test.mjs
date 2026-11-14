import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import ts from "typescript";

import { helpTopics } from "../hosted/apps/account/src/lib/help.ts";

const HELP = "hosted/apps/marketing/src/content/help";
const IMAGES = "hosted/apps/marketing/public";
const WHERE_THE_LABELS_LIVE = ["hosted/apps/account/src", "packages/contract/src"];

async function filesUnder(directory, extensions) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext)))
    .map((entry) => join(entry.parentPath, entry.name));
}

async function helpPages() {
  const names = (await readdir(HELP)).filter((name) => name.endsWith(".md"));
  return Promise.all(
    names.map(async (name) => ({
      slug: name.replace(/\.md$/, ""),
      text: await readFile(join(HELP, name), "utf8"),
    })),
  );
}

const asOneLine = (text) => text.replace(/\s+/g, " ").trim();

const textOf = (child) =>
  ts.isJsxText(child)
    ? child.text
    : ts.isJsxExpression(child) && child.expression && ts.isStringLiteral(child.expression)
      ? child.expression.text
      : null;

function runsOfText(children) {
  const runs = [""];
  for (const child of children) {
    const text = textOf(child);
    if (text === null) runs.push("");
    else runs[runs.length - 1] += text;
  }
  return runs;
}

function shownText(file, source) {
  const pieces = [];
  const visit = (node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      pieces.push(node.text);
    }
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) pieces.push(...runsOfText(node.children));
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
  return pieces.map(asOneLine).filter(Boolean);
}

async function appText() {
  const files = (
    await Promise.all(WHERE_THE_LABELS_LIVE.map((dir) => filesUnder(dir, [".ts", ".tsx"])))
  ).flat();
  const sources = await Promise.all(files.map((file) => readFile(file, "utf8")));
  return files.flatMap((file, index) => shownText(file, sources[index])).join("\n");
}

const bodyOf = (text) => text.replace(/^---\n[\s\S]*?\n---\n/, "");

test("every help topic the web app links to is a help page, and every help page is a topic", async () => {
  const slugs = (await helpPages()).map((page) => page.slug).toSorted();
  assert.deepEqual(slugs, [...helpTopics].toSorted());
});

test("every screen, button and setting a help page names in bold is still in the web app", async () => {
  const app = await appText();
  const missing = [];
  for (const page of await helpPages()) {
    for (const [, label] of bodyOf(page.text).matchAll(/\*\*([\s\S]+?)\*\*/g)) {
      if (!app.includes(asOneLine(label))) missing.push(`${page.slug}: ${label}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("links between help pages and to their images resolve", async () => {
  const pages = await helpPages();
  const slugs = new Set(pages.map((page) => page.slug));
  const broken = [];
  for (const page of pages) {
    for (const [, slug] of page.text.matchAll(/\]\(\/help\/([^)#?]*)[^)]*\)/g)) {
      if (!slugs.has(slug)) broken.push(`${page.slug}: /help/${slug}`);
    }
    for (const [, image] of page.text.matchAll(/\]\((\/help-images\/[^)]+)\)/g)) {
      if (!existsSync(join(IMAGES, image))) broken.push(`${page.slug}: ${image}`);
    }
  }
  assert.deepEqual(broken, []);
});

test("every help page says what it is for and where it belongs", async () => {
  for (const page of await helpPages()) {
    const front = page.text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
    for (const field of ["title", "summary", "section", "order"]) {
      assert.match(front, new RegExp(`^${field}: .+`, "m"), `${page.slug} has no ${field}`);
    }
  }
});
