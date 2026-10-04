import { spawnSync } from "node:child_process";

/**
 * `hutch electrobun build` packages `build.copy` sources verbatim — it never
 * runs a bundler — so the vite bundle (`frontend/dist` → `views/app`) has to
 * be rebuilt first or the packaged app would ship a stale/absent UI.
 *
 * Wired through `scripts.preBuild` in `electrobun.config.ts`, which Hutch
 * resolves as a *module path* (not a shell string) and runs with the project
 * root as cwd. The command itself stays the workspace's `build` script so the
 * frontend build has exactly one definition.
 */
export default function preBuild(): void {
  const result = spawnSync(
    "corepack",
    ["pnpm", "--filter", "@markup/electrobun-frontend", "build"],
    { cwd: process.cwd(), stdio: "inherit", shell: true },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `frontend build failed (exit ${result.status ?? `signal ${result.signal}`})`,
    );
  }
}
