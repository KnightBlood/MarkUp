import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Markup",
    identifier: "dev.markup.editor",
    version: "0.1.0",
    description: "Markdown editor",
    // macOS 的 .md 关联：Electrobun 只在该平台生成 CFBundleDocumentTypes
    // （Windows/Linux 上游不支持，由本仓库自写的 NSIS / AppImage 包装负责，
    // 见 scripts/packaging/）。`icon` 是 .icns，构建时会拷进 Resources。
    fileAssociations: [
      { ext: ["md", "markdown"], name: "Markdown", role: "Editor", icon: "assets/doc.icns" },
    ],
  },
  build: {
    mainProcess: "bun",
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    // The vite-built shell UI is copied verbatim into the packaged
    // `views/app` directory and loaded as `views://app/index.html`
    // (the same offline, self-hosted bundle the other shells embed).
    copy: {
      "frontend/dist": "views/app",
    },
    // Rebuild + relaunch when the frontend bundle or the synced menu
    // source changes (frontend is rebuilt by `vite build --watch`).
    watch: ["frontend/dist", "menu.json"],
    buildFolder: "dist",
    win: {
      icon: "assets/icon.ico",
    },
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  scripts: {
    // Packaging copies `frontend/dist` verbatim (see `build.copy` above), so
    // the vite bundle must be rebuilt before every Electrobun build. Hutch
    // resolves this value as a module path relative to the project root.
    preBuild: "scripts/pre-build.ts",
  },
  release: {
    // Local/CI builds must not fetch the previous release to diff.
    generatePatch: false,
  },
} satisfies ElectrobunConfig;
