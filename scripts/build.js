#!/usr/bin/env node

/**
 * Build script for autoclaude using esbuild.
 *
 * Produces two self-contained CJS bundles (minus native deps):
 *   dist/cli/index.js  — CLI entry point (hooks + commands)
 *   dist/mcp/index.js  — MCP server entry point
 *
 * Run with: node scripts/build.js  (compile this file first, or use via npm run build)
 */

const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const outdir = path.join(__dirname, "..", "dist");

// Clean output directory
if (fs.existsSync(outdir)) {
  fs.rmSync(outdir, { recursive: true });
}

const shared = {
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  sourcemap: true,
  external: ["better-sqlite3"],
};

async function build() {
  // CLI entry point
  await esbuild.build({
    ...shared,
    entryPoints: [path.join(__dirname, "..", "src", "cli", "index.ts")],
    outfile: path.join(outdir, "cli", "index.js"),
    banner: { js: "#!/usr/bin/env node" },
  });

  // MCP server entry point
  await esbuild.build({
    ...shared,
    entryPoints: [path.join(__dirname, "..", "src", "mcp", "index.ts")],
    outfile: path.join(outdir, "mcp", "index.js"),
  });

  console.log("Build complete: dist/cli/index.js, dist/mcp/index.js");
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
