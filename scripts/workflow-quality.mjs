import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";

const tool = process.argv[2];
const commands = {
  actionlint: ["actionlint-py==1.7.7.23", "actionlint"],
  zizmor: ["zizmor==1.11.0", "zizmor", ".github/workflows"],
};

if (!commands[tool]) {
  console.error(`Unknown workflow quality tool: ${tool ?? "<missing>"}`);
  process.exit(1);
}

try {
  accessSync(".github/workflows", constants.R_OK);
} catch {
  console.log("No .github/workflows directory found; skipping workflow checks.");
  process.exit(0);
}

const [packageSpec, ...args] = commands[tool];
const result = spawnSync("uvx", ["--from", packageSpec, ...args], {
  stdio: "inherit",
});

if (result.error) {
  console.error(
    `Unable to run ${tool}. Install uv, then retry: https://docs.astral.sh/uv/getting-started/installation/`,
  );
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
