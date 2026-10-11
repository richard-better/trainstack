import { rmSync } from "node:fs";

// Default: build for current platform (macOS on dev machines).
// Override with BUILD_TARGET=linux-x64 or linux-arm64 for deploy/Docker.
const host = `${process.platform}-${process.arch}`;
const target = process.env.BUILD_TARGET || host;
const isCrossCompile = target !== host;

// Clean previous build
rmSync("dist", { recursive: true, force: true });

const compile: Bun.CompileBuildOptions = { outfile: "./dist/server" };
if (isCrossCompile) {
  compile.target = `bun-${target}` as Bun.Build.CompileTarget;
}

// biome-ignore lint/correctness/noUndeclaredVariables: Bun global
const result = await Bun.build({
  entrypoints: ["src/index.ts"],
  target: "bun",
  bytecode: true,
  compile,
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log(`Build complete: dist/server (${target})`);
