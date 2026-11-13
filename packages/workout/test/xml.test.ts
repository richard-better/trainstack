import assert from "node:assert/strict";
import { test } from "node:test";
import { parseXml, renderXml, XmlSyntaxError } from "../src/xml.ts";

test("reads attributes, entities, CDATA and nested elements in order", () => {
  const root = parseXml(`﻿<?xml version="1.0"?>
<!-- comment -->
<a x='1' y="&lt;&#65;&#x42;&amp;&quot;">
  <b/>
  <c>t&apos;ext <![CDATA[<raw>]]></c>
  <!-- inside -->
  <b z="2"></b>
</a>
`);
  assert.equal(root.name, "a");
  assert.deepEqual(
    [...root.attributes],
    [
      ["x", "1"],
      ["y", '<AB&"'],
    ],
  );
  assert.deepEqual(
    root.children.map((child) => [child.name, child.line]),
    [
      ["b", 4],
      ["c", 5],
      ["b", 7],
    ],
  );
  assert.equal(root.children[1]?.text, "t'ext <raw>");
});

for (const [source, message] of [
  ["<a>", "Unclosed element <a> on line 1"],
  ["<a></b>", "Expected </a> but found </b> on line 1"],
  ['<a x="1" x="2"/>', 'Duplicate attribute "x" on line 1'],
  ["<a>&nbsp;</a>", 'Unknown entity "&nbsp;" on line 1'],
  ["<a/><b/>", "Unexpected content after the root element on line 1"],
  ['<!DOCTYPE a [<!ENTITY e "x">]><a/>', "Document type declarations are not supported on line 1"],
  ["\n\n<a x=1/>", "Expected a quoted attribute value on line 3"],
] as [string, string][]) {
  test(`rejects ${String(source)}`, () => {
    assert.throws(() => parseXml(source), XmlSyntaxError);
    assert.throws(
      () => parseXml(source),
      (error: Error) => error.message.includes(message),
    );
  });
}

test("escapes what it writes", () => {
  assert.equal(
    renderXml({
      name: "a",
      attributes: [
        ["m", 'say "hi" & <go>\nnow'],
        ["skipped", undefined],
      ],
      children: [{ name: "b", text: "1 < 2 & 3" }],
    }),

    '<a m="say &quot;hi&quot; &amp; &lt;go&gt;&#10;now">\n    <b>1 &lt; 2 &amp; 3</b>\n</a>\n',
  );
});

test("reads back what it writes", () => {
  const text = 'line one\nline "two" & <three>';
  const root = parseXml(
    renderXml({ name: "a", attributes: [["m", text]], children: [{ name: "b", text }] }),
  );
  assert.equal(root.attributes.get("m"), text);
  assert.equal(root.children[0]?.text, text);
});

test("refuses elements nested past the depth limit", () => {
  const nested = (depth: number) => `${"<a>".repeat(depth)}${"</a>".repeat(depth)}`;
  assert.equal(parseXml(nested(64)).name, "a");
  assert.throws(
    () => parseXml(nested(100_000)),
    (error: Error) => error.message.includes("Elements nest deeper than 64 levels on line 1"),
  );
});

test("reads a large file in linear time", () => {
  const children = '<b x="1"/>\n'.repeat(200_000);
  const started = performance.now();
  const root = parseXml(`<a>\n${children}</a>`);
  assert.equal(root.children.length, 200_000);
  assert.equal(root.children.at(-1)?.line, 200_001);
  assert.ok(performance.now() - started < 5_000);
});

test("rejects entities named after object properties", () => {
  assert.throws(
    () => parseXml("<a>&constructor;</a>"),
    (error: Error) => error.message.includes('Unknown entity "&constructor;"'),
  );
});
