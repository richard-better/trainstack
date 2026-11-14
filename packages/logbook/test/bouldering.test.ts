import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  asFont,
  asV,
  type BoulderingDetail,
  boulderingDetailSchema,
  boulderingSummary,
  type Circuit,
  fontGrades,
  fontToV,
  gradePyramid,
  type Problem,
  vGrades,
  vToFont,
} from "../src/index.ts";

const problem = (overrides: Partial<Problem>): Problem => ({
  grade: { scale: "font", grade: "6A" },
  name: null,
  attempts: 1,
  outcome: "flash",
  styles: [],
  angle: null,
  notes: null,
  restSeconds: null,
  ...overrides,
});

const circuit: Circuit = {
  name: "Boulderbar",
  colours: [
    { name: "Yellow", from: "4", to: "5" },
    { name: "Green", from: "5+", to: "6A+" },
    { name: "Black", from: null, to: null },
  ],
};

const session = (problems: Problem[], withCircuit: Circuit | null = null): BoulderingDetail => ({
  sport: "bouldering",
  venue: { kind: "gym", name: "Boulderbar" },
  circuit: withCircuit,
  problems,
});

describe("grade scales", () => {
  test("every Font grade has one V grade, and every V grade a Font range that maps back to it", () => {
    for (const font of fontGrades) assert.ok(vGrades.includes(fontToV[font]), font);
    for (const v of vGrades) {
      const [from, to] = vToFont[v];
      assert.equal(fontToV[from], v);
      assert.equal(fontToV[to], v);
    }
  });

  test("the stated table: 6A and 6A+ are V3, 7A is V6, 8A is V11", () => {
    assert.equal(fontToV["6A"], "V3");
    assert.equal(fontToV["6A+"], "V3");
    assert.equal(fontToV["7A"], "V6");
    assert.equal(fontToV["8A"], "V11");
  });

  test("a V grade reads as the easiest Font grade it covers, and a colour by the range the gym gives", () => {
    assert.equal(asFont({ scale: "v", grade: "V4" }, null), "6B");
    assert.equal(asV({ scale: "circuit", colour: "Green" }, circuit), "V2");
    assert.equal(asFont({ scale: "circuit", colour: "Black" }, circuit), null);
  });
});

describe("boulderingDetailSchema", () => {
  test("holds a gym session on a colour circuit with styles, angles and rests", () => {
    const detail = session(
      [
        problem({
          grade: { scale: "circuit", colour: "Green" },
          styles: ["crimpy"],
          angle: "overhang",
          restSeconds: 120,
        }),
        problem({ grade: { scale: "v", grade: "V4" }, outcome: "project", attempts: 6 }),
      ],
      circuit,
    );
    assert.deepEqual(boulderingDetailSchema.parse(detail), detail);
  });

  test("refuses a flash that took more than one attempt, and a colour the circuit does not have", () => {
    assert.equal(
      boulderingDetailSchema.safeParse(session([problem({ outcome: "flash", attempts: 2 })]))
        .success,
      false,
    );
    assert.equal(
      boulderingDetailSchema.safeParse(
        session([problem({ grade: { scale: "circuit", colour: "Pink" } })], circuit),
      ).success,
      false,
    );
  });
});

describe("bouldering numbers", () => {
  test("counts tops, first ascents, flashes and attempts, and names the hardest top across scales", () => {
    const summary = boulderingSummary(
      session(
        [
          problem({ grade: { scale: "font", grade: "6B" } }),
          problem({ grade: { scale: "v", grade: "V5" }, outcome: "send", attempts: 4 }),
          problem({ grade: { scale: "font", grade: "7A" }, outcome: "project", attempts: 8 }),
          problem({ grade: { scale: "circuit", colour: "Green" }, outcome: "repeat", attempts: 2 }),
        ],
        circuit,
      ),
    );
    assert.equal(summary.problems, 4);
    assert.equal(summary.tops, 3);
    assert.equal(summary.sends, 2);
    assert.equal(summary.flashes, 1);
    assert.equal(summary.attempts, 15);
    assert.deepEqual(summary.hardestTop?.grade, { scale: "v", grade: "V5" });
    assert.deepEqual(summary.hardestFlash?.grade, { scale: "font", grade: "6B" });
  });

  test("colours of one circuit compare by the circuit's order, graded or not", () => {
    const summary = boulderingSummary(
      session(
        [
          problem({ grade: { scale: "circuit", colour: "Black" } }),
          problem({ grade: { scale: "circuit", colour: "Yellow" } }),
        ],
        circuit,
      ),
    );
    assert.deepEqual(summary.hardestTop?.grade, { scale: "circuit", colour: "Black" });
  });

  test("an ungraded colour counts as hard as the graded colour below it, in any order", () => {
    const problems = [
      problem({ grade: { scale: "circuit", colour: "Black" } }),
      problem({ grade: { scale: "circuit", colour: "Green" } }),
      problem({ grade: { scale: "font", grade: "5" } }),
    ];
    for (const order of [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ]) {
      const summary = boulderingSummary(
        session(
          order.map((index) => problems[index]!),
          circuit,
        ),
      );
      assert.deepEqual(
        summary.hardestTop?.grade,
        { scale: "circuit", colour: "Black" },
        String(order),
      );
    }
  });

  test("a circuit with no grades at all ranks below every graded problem", () => {
    const summary = boulderingSummary(
      session(
        [
          problem({ grade: { scale: "circuit", colour: "Black" } }),
          problem({ grade: { scale: "font", grade: "3" } }),
        ],
        {
          name: "Ungraded",
          colours: [
            { name: "White", from: null, to: null },
            { name: "Black", from: null, to: null },
          ],
        },
      ),
    );
    assert.deepEqual(summary.hardestTop?.grade, { scale: "font", grade: "3" });
  });

  test("the pyramid counts first ascents and projects by grade, hardest first, and leaves out repeats", () => {
    const pyramid = gradePyramid(
      [
        session([
          problem({ grade: { scale: "font", grade: "6A" } }),
          problem({ grade: { scale: "font", grade: "6A+" }, outcome: "send", attempts: 3 }),
          problem({ grade: { scale: "font", grade: "6B" }, outcome: "project", attempts: 5 }),
          problem({ grade: { scale: "font", grade: "6B" }, outcome: "repeat", attempts: 1 }),
        ]),
        session([problem({ grade: { scale: "circuit", colour: "Black" } })], circuit),
      ],
      "v",
    );
    assert.deepEqual(pyramid.steps, [
      { grade: "V4", flashes: 0, sends: 0, projects: 1, attempts: 5 },
      { grade: "V3", flashes: 1, sends: 1, projects: 0, attempts: 4 },
    ]);
    assert.equal(pyramid.ungraded, 1);
  });

  test("a pyramid over a circuit whose colours changed follows its latest order", () => {
    const older: Circuit = {
      name: "Boulderbar",
      colours: [
        { name: "Green", from: null, to: null },
        { name: "Yellow", from: null, to: null },
        { name: "Black", from: null, to: null },
      ],
    };
    const newer: Circuit = {
      name: "Boulderbar",
      colours: [
        { name: "Yellow", from: null, to: null },
        { name: "Black", from: null, to: null },
      ],
    };
    const pyramid = gradePyramid(
      [
        session([problem({ grade: { scale: "circuit", colour: "Yellow" } })], older),
        session([problem({ grade: { scale: "circuit", colour: "Black" } })], newer),
      ],
      { circuit: "Boulderbar" },
    );
    assert.deepEqual(
      pyramid.steps.map(({ grade }) => grade),
      ["Black", "Yellow"],
    );
  });

  test("a pyramid in a circuit's colours follows the circuit's order", () => {
    const pyramid = gradePyramid(
      [
        session(
          [
            problem({ grade: { scale: "circuit", colour: "Yellow" } }),
            problem({ grade: { scale: "circuit", colour: "Black" } }),
            problem({ grade: { scale: "font", grade: "7A" } }),
          ],
          circuit,
        ),
      ],
      { circuit: "Boulderbar" },
    );
    assert.deepEqual(
      pyramid.steps.map(({ grade }) => grade),
      ["Black", "Yellow"],
    );
    assert.equal(pyramid.ungraded, 1);
  });
});
