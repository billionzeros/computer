/**
 * Version info for the anton.computer agent.
 * Git hash is resolved at runtime from the repo or falls back to "dev".
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const SPEC_VERSION = "0.1.0";

function getPackageVersion(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "..", "package.json"), "utf-8")
    );
    return pkg.version ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
}

function getGitHash(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: "pipe" })
      .toString()
      .trim();
  } catch {
    return "dev";
  }
}

export const VERSION = getPackageVersion();
export const GIT_HASH = getGitHash();
