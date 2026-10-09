import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const tauriDirectory = fileURLToPath(new URL("../src-tauri/", import.meta.url));

// Ensure ~/.cargo/bin is included in PATH if cargo is installed in standard locations
const env = { ...process.env };
const pathSeparator = process.platform === "win32" ? ";" : ":";
const pathKey =
  Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
const currentPath = env[pathKey] ?? "";

const candidateDirs = [
  process.env.CARGO_HOME ? join(process.env.CARGO_HOME, "bin") : null,
  join(homedir(), ".cargo", "bin"),
].filter(Boolean);

for (const dir of candidateDirs) {
  const binaryName = process.platform === "win32" ? "cargo.exe" : "cargo";
  if (existsSync(join(dir, binaryName))) {
    const segments = currentPath.split(pathSeparator);
    if (!segments.includes(dir)) {
      env[pathKey] = `${dir}${pathSeparator}${currentPath}`;
    }
    break;
  }
}

const checks = [
  ["cargo", ["fmt", "--all", "--check"]],
  ["cargo", ["clippy", "--all-targets", "--", "-D", "warnings"]],
  ["cargo", ["test"]],
];

for (const [command, args] of checks) {
  const result = spawnSync(command, args, {
    cwd: tauriDirectory,
    stdio: "inherit",
    env,
  });

  if (result.error) {
    console.error(`Could not run ${command}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
