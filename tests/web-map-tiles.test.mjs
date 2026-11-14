import assert from "node:assert/strict";
import { test } from "node:test";
import { routeMapStyle } from "../hosted/apps/account/src/lib/map-tiles.ts";

test("woodland keeps its fill without requesting the missing wood-pattern sprite", () => {
  const wood = {
    id: "wood",
    type: "fill",
    paint: { "fill-color": "#202020", "fill-pattern": "wood-pattern" },
  };
  const other = { id: "other", type: "fill", paint: { "fill-pattern": "existing" } };
  const style = { version: 8, sources: {}, layers: [wood, other] };
  const result = routeMapStyle(style);
  assert.deepEqual(result.layers[0].paint, { "fill-color": "#202020" });
  assert.equal(result.layers[1], other);
  assert.equal(wood.paint["fill-pattern"], "wood-pattern");
});
