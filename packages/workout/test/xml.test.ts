import { expect, test } from "vite-plus/test";
import { parseXml, renderXml, XmlSyntaxError } from "../src/xml";

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
  expect(root.name).toBe("a");
  expect([...root.attributes]).toEqual([
    ["x", "1"],
    ["y", '<AB&"'],
  ]);
  expect(root.children.map((child) => [child.name, child.line])).toEqual([
    ["b", 4],
    ["c", 5],
    ["b", 7],
  ]);
  expect(root.children[1]?.text).toBe("t'ext <raw>");
});

test.each([
  ["<a>", "Unclosed element <a> on line 1"],
  ["<a></b>", "Expected </a> but found </b> on line 1"],
  ['<a x="1" x="2"/>', 'Duplicate attribute "x" on line 1'],
  ["<a>&nbsp;</a>", 'Unknown entity "&nbsp;" on line 1'],
  ["<a/><b/>", "Unexpected content after the root element on line 1"],
  ['<!DOCTYPE a [<!ENTITY e "x">]><a/>', "Document type declarations are not supported on line 1"],
  ["\n\n<a x=1/>", "Expected a quoted attribute value on line 3"],
])("rejects %s", (source, message) => {
  expect(() => parseXml(source)).toThrow(XmlSyntaxError);
  expect(() => parseXml(source)).toThrow(message);
});

test("escapes what it writes", () => {
  expect(
    renderXml({
      name: "a",
      attributes: [
        ["m", 'say "hi" & <go>\nnow'],
        ["skipped", undefined],
      ],
      children: [{ name: "b", text: "1 < 2 & 3" }],
    }),
  ).toBe(
    '<a m="say &quot;hi&quot; &amp; &lt;go&gt;&#10;now">\n    <b>1 &lt; 2 &amp; 3</b>\n</a>\n',
  );
});

test("reads back what it writes", () => {
  const text = 'line one\nline "two" & <three>';
  const root = parseXml(
    renderXml({ name: "a", attributes: [["m", text]], children: [{ name: "b", text }] }),
  );
  expect(root.attributes.get("m")).toBe(text);
  expect(root.children[0]?.text).toBe(text);
});
