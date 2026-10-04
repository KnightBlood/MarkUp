// @hutch cottontail=production
export default {
  packageManager: "bun",
  scripts: {
    install: ["hutch", "pm", "install", "--frozen-lockfile"],
    dev: ["hutch", "electrobun", "dev", "--watch"],
    build: ["hutch", "electrobun", "build", "--env=stable"],
    // hutch runs scripts as argv arrays and does not prepend
    // `node_modules/.bin`, so invoke the local tsc through node.
    typecheck: ["node", "./node_modules/typescript/bin/tsc", "--noEmit"],
    // `hutch electrobun build` only bundles what `build.copy` points at, so the
    // vite bundle it copies must exist first (the pnpm workspace root is found
    // by walking up from this directory).
    ui: ["corepack", "pnpm", "--filter", "@markup/electrobun-frontend", "build"],
  },
};
