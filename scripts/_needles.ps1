$ErrorActionPreference = 'Stop'
$root = 'D:\works\markup'
$hits = 0
$misses = 0

function Check-Needle {
  param([string]$Label, [string]$Path, [string]$Pattern, [switch]$Literal)
  if ([string]::IsNullOrEmpty($Path)) {
    Write-Output "MISS $Label (no candidate path)"
    $script:misses++
    return
  }
  if (!(Test-Path $Path)) {
    Write-Output "MISS $Label (file not found: $Path)"
    $script:misses++
    return
  }
  $found = $false
  try {
    if ($Literal) {
      $found = [bool](Select-String -LiteralPath $Path -Pattern $Pattern -SimpleMatch -Quiet -ErrorAction SilentlyContinue)
    } else {
      $found = [bool](Select-String -Path $Path -Pattern $Pattern -Quiet -ErrorAction SilentlyContinue)
    }
  } catch {
    $found = $false
  }
  if ($found) { Write-Output "HIT  $Label"; $script:hits++ } else { Write-Output "MISS $Label ($Path)"; $script:misses++ }
}

function Check-File {
  param([string]$Label, [string]$Path)
  if ([string]::IsNullOrEmpty($Path)) { Write-Output "MISS $Label (no candidate)"; $script:misses++; return }
  if (Test-Path $Path) { Write-Output "HIT  $Label"; $script:hits++ } else { Write-Output "MISS $Label ($Path)"; $script:misses++ }
}

# The inverse of Check-Needle: asserts something is gone. Used where a bug was
# a hardcoded value rather than a missing one — a positive assertion on the
# replacement can pass while the old constant is still sitting there winning.
function Check-Absent {
  param([string]$Label, [string]$Path, [string]$Pattern, [switch]$Literal)
  if (!(Test-Path $Path)) {
    Write-Output "MISS $Label (file not found: $Path)"
    $script:misses++
    return
  }
  $found = $false
  try {
    if ($Literal) {
      $found = [bool](Select-String -LiteralPath $Path -Pattern $Pattern -SimpleMatch -Quiet -ErrorAction SilentlyContinue)
    } else {
      $found = [bool](Select-String -Path $Path -Pattern $Pattern -Quiet -ErrorAction SilentlyContinue)
    }
  } catch {
    $found = $false
  }
  if ($found) {
    Write-Output "MISS $Label (must not appear in $Path)"
    $script:misses++
  } else {
    Write-Output "HIT  $Label"
    $script:hits++
  }
}

# --- web dist (assets js) ---
$webAssets = Get-ChildItem "$root\apps\web\dist\assets\*.js" -ErrorAction SilentlyContinue
if ($webAssets) {
  $joined = ($webAssets | ForEach-Object { Get-Content $_.FullName -Raw }) -join "`n"
  $tmp = [System.IO.Path]::GetTempFileName()
  [System.IO.File]::WriteAllText($tmp, $joined, [System.Text.Encoding]::UTF8)
  foreach ($kw in @('insert.xmind', 'insert.drawio', 'insert.plantuml', 'insert.file', 'mxGraphModel', '@startuml', 'flyfish-file-viewer', 'msg-dialog__title', 'msg-dialog--prompt', 'settings__search', 'menubar__btn', 'context-menu__iconbtn', 'format.bold', 'edit.copyAsMarkdown', 'insert.hr', 'data-item-type', 'avbridge-player', 'plantuml.visualEdit', 'plantuml-editor__panel', 'SequenceDiagram')) {
    Check-Needle "web dist js :: $kw" $tmp $kw -Literal
  }
  Remove-Item $tmp -Force
} else {
  Write-Output 'MISS web dist assets (not built)'
  $script:misses++
}
# --- web dist (assets css): tab strip shares the sidebar's tab row -------
$webCss = Get-ChildItem "$root\apps\web\dist\assets\*.css" -ErrorAction SilentlyContinue
if ($webCss) {
  $joinedCss = ($webCss | ForEach-Object { Get-Content $_.FullName -Raw }) -join "`n"
  $tmpCss = [System.IO.Path]::GetTempFileName()
  [System.IO.File]::WriteAllText($tmpCss, $joinedCss, [System.Text.Encoding]::UTF8)
  foreach ($kw in @('.tabbar', '.shell-main', '.sidebar__tabs', '.settings__search', '.menubar__btn', '.context-menu__iconbtn', '.context-menu__row', '.msg-dialog__input', 'calc(100vh - 8px)', '.plantuml-editor__panel')) {
    Check-Needle "web dist css :: $kw" $tmpCss $kw -Literal
  }
  Remove-Item $tmpCss -Force
} else {
  Write-Output 'MISS web dist assets css (not built)'
  $script:misses++
}
# --- multi-tab shell sources (always asserted, build or not) -------------
Check-File 'ui source :: tabBar.ts' "$root\packages\ui\src\ui\tabBar.ts"
Check-File 'ui source :: keybindings.ts' "$root\packages\ui\src\ui\keybindings.ts"
Check-File 'ui source :: menuBar.ts' "$root\packages\ui\src\ui\menuBar.ts"
Check-File 'ui source :: promptDialog.ts' "$root\packages\ui\src\ui\promptDialog.ts"
Check-File 'core source :: textFormat.ts' "$root\packages\core\src\textFormat.ts"
Check-File 'electrobun main :: bun entry' "$root\apps\electrobun\src\bun\index.ts"
Check-File 'electrobun main :: rpc schema' "$root\apps\electrobun\shared\rpc.ts"
Check-File 'electrobun view :: host impl' "$root\apps\electrobun\frontend\src\main.ts"
Check-Needle 'ui source :: shell-main row' "$root\packages\ui\src\theme\shell.css" '.shell-main' -Literal
Check-Needle 'ui source :: shared tab row height' "$root\packages\ui\src\theme\tokens.css" '--tabrow-height' -Literal
Check-Needle 'ui source :: menu max-height' "$root\packages\ui\src\theme\shell.css" 'max-height: calc(100vh - 8px)' -Literal
Check-Needle 'ui source :: glyph rows' "$root\packages\ui\src\ui\contextMenu.ts" 'context-menu__row' -Literal
Check-Needle 'core source :: DocStore restoreTab' "$root\packages\core\src\docStore.ts" 'restoreTab' -Literal
Check-Needle 'core source :: inline slice' "$root\packages\core\src\adapters\wysiwyg.ts" 'Slice.maxOpen' -Literal
Check-Needle 'core source :: native block formats' "$root\packages\core\src\adapters\wysiwyg.ts" 'wrapInHeadingCommand' -Literal
Check-Needle 'core source :: task checkbox plugin' "$root\packages\core\src\adapters\wysiwyg.ts" 'taskCheckboxPlugin' -Literal
Check-Needle 'core css :: task checkbox box' "$root\packages\core\src\adapters\wysiwyg.css" "data-item-type='task'" -Literal
Check-Needle 'core source :: block format api' "$root\packages\core\src\adapters\types.ts" 'setBlockFormat' -Literal
Check-Needle 'ui source :: block format wiring' "$root\packages\ui\src\shell.ts" 'supportsBlockFormat' -Literal
Check-Needle 'ui source :: close request flow' "$root\packages\ui\src\shell.ts" 'resolveCloseRequest' -Literal
Check-Needle 'ui source :: recents mirror wiring' "$root\packages\ui\src\shell.ts" 'onRecentsChange' -Literal
Check-Needle 'core source :: recents mirror' "$root\packages\core\src\docStore.ts" 'recentsListener' -Literal
Check-Needle 'ui source :: quit/devtools commands' "$root\packages\ui\src\shell.ts" "id: 'help.devtools'" -Literal
Check-Needle 'electron source :: hidden menu bar' "$root\apps\electron\src\main\main.ts" 'setMenuBarVisibility(false)' -Literal
Check-Needle 'electron source :: devtools ipc' "$root\apps\electron\src\main\main.ts" 'appOpenDevTools' -Literal
Check-Needle 'tauri source :: hidden menu bar' "$root\apps\tauri\src-tauri\src\lib.rs" 'hide_menu' -Literal
Check-Needle 'tauri source :: devtools command' "$root\apps\tauri\src-tauri\src\lib.rs" 'open_devtools' -Literal
Check-Needle 'wails source :: hidden menu bar' "$root\apps\wails\main.go" 'HideMenuBar' -Literal
Check-Needle 'wails source :: devtools service' "$root\apps\wails\services\host.go" 'OpenDevTools' -Literal
# --- electrobun (fifth shell): HostAPI over Electrobun's typed view<->bun RPC
Check-Needle 'electrobun source :: hidden menu bar' "$root\apps\electrobun\src\bun\index.ts" 'HIDE_NATIVE_MENU_BAR' -Literal
Check-Needle 'electrobun source :: devtools rpc' "$root\apps\electrobun\src\bun\index.ts" 'appOpenDevTools' -Literal
Check-Needle 'electrobun source :: menu.json shortcuts' "$root\apps\electrobun\src\bun\index.ts" 'menu.globalShortcuts' -Literal
Check-Needle 'electrobun source :: close interception' "$root\apps\electrobun\src\bun\index.ts" "emitHostEvent('close-request'" -Literal
Check-Needle 'electrobun source :: native save dialog' "$root\apps\electrobun\src\bun\saveDialog.ts" 'GetSaveFileNameW' -Literal
Check-Needle 'electrobun source :: single host channel' "$root\apps\electrobun\shared\rpc.ts" "'host-event'" -Literal
Check-Needle 'electrobun view :: host platform' "$root\apps\electrobun\frontend\src\main.ts" "platform: 'electrobun'" -Literal
Check-Needle 'electrobun view :: confirm close' "$root\apps\electrobun\frontend\src\main.ts" 'winConfirmClose' -Literal
Check-Needle 'electrobun config :: offline views bundle' "$root\apps\electrobun\electrobun.config.ts" 'views/app' -Literal
Check-Needle 'electrobun config :: mac md association' "$root\apps\electrobun\electrobun.config.ts" 'fileAssociations' -Literal
Check-Needle 'electrobun main :: mac open-url' "$root\apps\electrobun\src\bun\index.ts" "events.on('open-url'" -Literal
Check-Needle 'electrobun main :: argv file scan' "$root\apps\electrobun\src\bun\index.ts" 'scanArgvForFiles' -Literal
Check-Needle 'electrobun main :: file-open flush' "$root\apps\electrobun\src\bun\index.ts" "emitHostEvent('file-open'" -Literal
# --- tauri: association + single-instance receive + per-OS bundles ----------
Check-Needle 'tauri packaging :: md association' "$root\apps\tauri\src-tauri\tauri.conf.json" 'fileAssociations' -Literal
Check-Needle 'tauri packaging :: nsis install mode' "$root\apps\tauri\src-tauri\tauri.conf.json" 'installMode' -Literal
Check-Needle 'tauri main :: single instance plugin' "$root\apps\tauri\src-tauri\src\lib.rs" 'tauri_plugin_single_instance' -Literal
Check-Needle 'tauri main :: mac opened event' "$root\apps\tauri\src-tauri\src\lib.rs" 'RunEvent::Opened' -Literal
Check-Needle 'tauri main :: argv file open' "$root\apps\tauri\src-tauri\src\lib.rs" 'deliver_argv' -Literal
Check-Needle 'tauri main :: file-open flush' "$root\apps\tauri\src-tauri\src\lib.rs" 'flush_file_open' -Literal
# --- shared packaging wrappers (electrobun / tauri / wails on macOS) --------
Check-File 'packaging :: macos pkg script' "$root\scripts\packaging\macos-pkg.sh"
Check-File 'packaging :: electrobun windows nsis' "$root\scripts\packaging\electrobun\windows.nsi"
Check-File 'packaging :: electrobun linux appimage' "$root\scripts\packaging\electrobun\linux-appimage.sh"
Check-Needle 'packaging :: nsis directory page' "$root\scripts\packaging\electrobun\windows.nsi" 'MUI_PAGE_DIRECTORY' -Literal
Check-Needle 'packaging :: pkg destination domains' "$root\scripts\packaging\macos-pkg.sh" 'enable_anywhere' -Literal
# --- wails: association (config.yml is the source of truth) + receive -------
Check-Needle 'wails packaging :: md association' "$root\apps\wails\build\config.yml" 'fileAssociations' -Literal
Check-Needle 'wails packaging :: pnpm workspace manager' "$root\apps\wails\Taskfile.yml" 'PACKAGE_MANAGER: "pnpm"' -Literal
Check-Needle 'wails packaging :: linux mime type' "$root\scripts\packaging\markup.desktop" 'MimeType=text/markdown' -Literal
Check-File 'wails packaging :: desktop entry' "$root\scripts\packaging\markup.desktop"
# Wails generates the platform scaffolding itself (Taskfiles, Info.plist,
# windows/nsis/project.nsi, which carries MUI_PAGE_DIRECTORY + the association
# macro), so CI must run it before packaging.
Check-Needle 'ci :: wails generates build assets' "$root\.github\workflows\build.yml" 'wails3 update build-assets' -Literal
Check-Needle 'ci :: wails nsis per-user scope' "$root\.github\workflows\build.yml" 'INSTALL_SCOPE=user' -Literal
Check-Needle 'wails main :: single instance' "$root\apps\wails\main.go" 'SingleInstance' -Literal
Check-Needle 'wails main :: argv file scan' "$root\apps\wails\main.go" 'scanArgsForFiles' -Literal
Check-Needle 'wails main :: file-open flush' "$root\apps\wails\main.go" 'flushFileOpen' -Literal
# The electrobun frontend resolves `electrobun/*` into a gitignored devkit, so
# the shared typecheck job must exclude it — the electrobun job checks it after
# `hutch electrobun sync` instead.
Check-Needle 'ci :: typecheck excludes devkit package' "$root\.github\workflows\build.yml" '!@markup/electrobun-frontend' -Literal
Check-Needle 'ci :: electrobun checks its frontend' "$root\.github\workflows\build.yml" 'pnpm --filter @markup/electrobun-frontend typecheck' -Literal
# Electrobun exposes no menu-bar visibility flag: `setApplicationMenu` is the
# only thing that grows an HMENU, so installing one would un-hide the native
# bar. Assert the call stays out of the shell (the other four hide it instead).
$ebMain = "$root\apps\electrobun\src\bun\index.ts"
if (Test-Path $ebMain) {
  if ((Get-Content $ebMain -Raw) -match 'setApplicationMenu\(') { Write-Output 'MISS electrobun main :: no native menu installed'; $script:misses++ } else { Write-Output 'HIT  electrobun main :: no native menu installed'; $script:hits++ }
} else {
  Write-Output 'MISS electrobun main :: no native menu installed (missing file)'
  $script:misses++
}
Check-Needle 'host api :: confirmClose' "$root\packages\host-api\src\types.ts" 'confirmClose' -Literal
Check-Needle 'electron main :: close interception' "$root\apps\electron\src\main\main.ts" "event: 'close-request'" -Literal
# --- file association: shared receive contract + electron's half ------------
Check-Needle 'host api :: file-open event' "$root\packages\host-api\src\types.ts" "'file-open': string" -Literal
Check-Needle 'ui :: file-open subscription' "$root\packages\ui\src\hostEvents.ts" "host.app.on('file-open'" -Literal
Check-Needle 'ui :: file-open routed to openPath' "$root\packages\ui\src\shell.ts" 'onFileOpen' -Literal
Check-Needle 'electron main :: single instance lock' "$root\apps\electron\src\main\main.ts" 'requestSingleInstanceLock' -Literal
Check-Needle 'electron main :: mac open-file' "$root\apps\electron\src\main\main.ts" "app.on('open-file'" -Literal
Check-Needle 'electron main :: argv file scan' "$root\apps\electron\src\main\main.ts" 'scanArgvForFiles' -Literal
# --- per-OS installers with a user-selectable install location --------------
Check-Needle 'electron packaging :: nsis assisted installer' "$root\apps\electron\electron-builder.yml" 'oneClick: false' -Literal
Check-Needle 'electron packaging :: nsis directory page' "$root\apps\electron\electron-builder.yml" 'allowToChangeInstallationDirectory: true' -Literal
Check-Needle 'electron packaging :: mac pkg target' "$root\apps\electron\electron-builder.yml" 'target: pkg' -Literal
Check-Needle 'electron packaging :: linux appimage target' "$root\apps\electron\electron-builder.yml" 'target: AppImage' -Literal
Check-Needle 'electron packaging :: md association' "$root\apps\electron\electron-builder.yml" 'fileAssociations' -Literal
Check-Needle 'core source :: inline format export' "$root\packages\core\src\textFormat.ts" 'export function inlineFormatEdit' -Literal
Check-Needle 'core source :: block format export' "$root\packages\core\src\textFormat.ts" 'export function blockFormatEdit' -Literal
Check-Needle 'ui source :: format pipeline wiring' "$root\packages\ui\src\shell.ts" 'applyInlineFormat' -Literal
Check-Needle 'ui source :: menubar wiring' "$root\packages\ui\src\shell.ts" 'createMenuBar' -Literal
Check-Needle 'core source :: selection end offset' "$root\packages\core\src\adapters\wysiwyg.ts" 'endOffset' -Literal
Check-Needle 'core source :: source adapter selection end' "$root\packages\core\src\adapters\source.ts" 'selectionEnd' -Literal
Check-Needle 'menu json :: tab.close' "$root\packages\host-api\src\menu.json" 'tab.close' -Literal
Check-Needle 'menu json :: paragraph section' "$root\packages\host-api\src\menu.json" 'format.h1' -Literal
Check-Needle 'menu json :: format section' "$root\packages\host-api\src\menu.json" 'format.bold' -Literal
Check-Needle 'menu json :: copy-as command' "$root\packages\host-api\src\menu.json" 'edit.copyAsMarkdown' -Literal
Check-Needle 'menu json :: horizontal rule' "$root\packages\host-api\src\menu.json" 'insert.hr' -Literal
# file-viewer vite plugin registered in all five shell configs
foreach ($cfg in @("$root\apps\web\vite.config.ts", "$root\apps\electron\vite.config.ts", "$root\apps\tauri\frontend\vite.config.ts", "$root\apps\wails\frontend\vite.config.ts", "$root\apps\electrobun\frontend\vite.config.ts")) {
  Check-Needle "vite config :: fileViewerRenderers ($cfg)" $cfg 'fileViewerRenderers' -Literal
}
# file-viewer copied assets (copyAssets:true → dist/file-viewer/…)
$fvDir = Get-ChildItem "$root\apps\web\dist\file-viewer" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($fvDir) { Write-Output 'HIT  web dist :: file-viewer assets dir'; $script:hits++ } else { Write-Output 'MISS web dist :: file-viewer assets dir'; $script:misses++ }
# The plugin's closeBundle asset copy can be truncated silently (AV/session
# kills) — the full preset-all payload is ~2957 files; `vendor/pdf` (pdf.js
# fonts/cmaps) and `wasm` are the trees that vanish first, so guard them.
Check-File 'web dist :: file-viewer vendor/pdf' "$root\apps\web\dist\file-viewer\vendor\pdf"
Check-File 'web dist :: file-viewer wasm' "$root\apps\web\dist\file-viewer\wasm"
# plantuml lazy chunk + viz asset must be emitted
Check-File 'web dist :: plantuml chunk' ((Get-ChildItem "$root\apps\web\dist\assets\*.js" -ErrorAction SilentlyContinue | Where-Object { (Get-Content $_.FullName -Raw) -match 'renderToString|@startuml' } | Select-Object -First 1).FullName)
Check-File 'web dist :: viz-global asset' ((Get-ChildItem "$root\apps\web\dist\assets\viz-global*" -ErrorAction SilentlyContinue | Select-Object -First 1).FullName)

# --- electron renderer dist ---
$electronRenderer = "$root\apps\electron\dist\renderer\assets"
if (Test-Path $electronRenderer) {
  $joined = (Get-ChildItem "$electronRenderer\*.js" | ForEach-Object { Get-Content $_.FullName -Raw }) -join "`n"
  $tmp = [System.IO.Path]::GetTempFileName()
  [System.IO.File]::WriteAllText($tmp, $joined, [System.Text.Encoding]::UTF8)
  foreach ($kw in @('insert.xmind', 'insert.drawio', 'insert.plantuml', 'insert.file', 'mxGraphModel', '@startuml', 'flyfish-file-viewer', 'msg-dialog__title', 'markup:host-message-request', 'menubar__btn', 'context-menu__iconbtn', 'format.bold', 'data-item-type')) {
    Check-Needle "electron renderer :: $kw" $tmp $kw -Literal
  }
  Remove-Item $tmp -Force
  Check-File 'electron renderer :: viz-global asset' ((Get-ChildItem "$electronRenderer\viz-global*" -ErrorAction SilentlyContinue | Select-Object -First 1).FullName)
} else {
  Write-Output 'MISS electron renderer dist (not built)'
  $script:misses++
}

# --- HostAPI dialog → in-app <dialog> (no native boxes) ---
Check-Needle 'electron preload :: message bridge' "$root\apps\electron\dist\main\src\preload\preload.js" 'markup:host-message-reply' -Literal
$emMain = "$root\apps\electron\dist\main\src\main\main.js"
if (Test-Path $emMain) {
  $mainText = Get-Content $emMain -Raw
  if ($mainText -match 'showMessageBox') { Write-Output 'MISS electron main :: showMessageBox removed'; $script:misses++ } else { Write-Output 'HIT  electron main :: showMessageBox removed'; $script:hits++ }
}
foreach ($pair in @(@('tauri frontend', "$root\apps\tauri\frontend\dist\assets"), @('wails frontend', "$root\apps\wails\frontend\dist\assets"), @('electrobun frontend', "$root\apps\electrobun\frontend\dist\assets"))) {
  $name = $pair[0]; $dir = $pair[1]
  $js = Get-ChildItem "$dir\*.js" -ErrorAction SilentlyContinue
  if ($js) {
    $joined = ($js | ForEach-Object { Get-Content $_.FullName -Raw }) -join "`n"
    $tmp = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllText($tmp, $joined, [System.Text.Encoding]::UTF8)
    Check-Needle "$name :: msg-dialog" $tmp 'msg-dialog__title' -Literal
    Remove-Item $tmp -Force
  } else {
    Write-Output "MISS $name dist assets (not built)"
    $script:misses++
  }
}

# --- electron main/preload + asar ---
Check-Needle 'electron main :: readBase64' "$root\apps\electron\dist\main\src\main\main.js" 'readBase64' -Literal
Check-Needle 'electron main :: confirmClose ipc' "$root\apps\electron\dist\main\src\main\main.js" 'winConfirmClose' -Literal
Check-Needle 'electron main :: hidden menu bar (dist)' "$root\apps\electron\dist\main\src\main\main.js" 'setMenuBarVisibility' -Literal
Check-Needle 'electron main :: openDevTools ipc' "$root\apps\electron\dist\main\src\preload\preload.js" 'appOpenDevTools' -Literal
Check-Needle 'electron main :: confirmClose channel' "$root\apps\electron\dist\main\shared\ipc.js" 'markup:win:confirmClose' -Literal
Check-Needle 'electron main :: close-request event' "$root\apps\electron\dist\main\src\main\main.js" 'close-request' -Literal
Check-Needle 'electron preload :: confirmClose bridge' "$root\apps\electron\dist\main\src\preload\preload.js" 'winConfirmClose' -Literal
# tsc emits `require('@markup/host-api')` verbatim for the workspace import and
# electron-builder ships no node_modules — build:main must drop a bundled CJS
# copy here or the packed app dies at startup with MODULE_NOT_FOUND.
Check-File 'electron main :: host-api bundle' "$root\apps\electron\dist\main\node_modules\@markup\host-api\index.js"
$asar = "$root\apps\electron\release\win-unpacked\resources\app.asar"
Check-File 'electron asar exists' $asar
if (Test-Path $asar) {
  $bytes = [System.IO.File]::ReadAllBytes($asar)
  $text = [System.Text.Encoding]::ASCII.GetString($bytes)
  foreach ($kw in @('insert.plantuml', 'insert.xmind', 'insert.drawio', 'insert.file')) {
    if ($text.Contains($kw)) { Write-Output "HIT  electron asar :: $kw"; $script:hits++ } else { Write-Output "MISS electron asar :: $kw"; $script:misses++ }
  }
}

# --- tauri exe ---
$tauriExe = "$root\apps\tauri\src-tauri\target\release\markup.exe"
Check-File 'tauri exe exists' $tauriExe
if (Test-Path $tauriExe) {
  $text = [System.Text.Encoding]::ASCII.GetString([System.IO.File]::ReadAllBytes($tauriExe))
  foreach ($kw in @('insert.plantuml', 'insert.xmind', 'read_base64', 'insert.file')) {
    if ($text.Contains($kw)) { Write-Output "HIT  tauri exe :: $kw"; $script:hits++ } else { Write-Output "MISS tauri exe :: $kw"; $script:misses++ }
  }
}

# --- wails exe ---
$wailsExe = "$root\apps\wails\markup-wails.exe"
Check-File 'wails exe exists' $wailsExe
if (Test-Path $wailsExe) {
  $text = [System.Text.Encoding]::ASCII.GetString([System.IO.File]::ReadAllBytes($wailsExe))
  foreach ($kw in @('insert.plantuml', 'insert.xmind', 'insert.drawio', 'insert.file')) {
    if ($text.Contains($kw)) { Write-Output "HIT  wails exe :: $kw"; $script:hits++ } else { Write-Output "MISS wails exe :: $kw"; $script:misses++ }
  }
}

# --- menu copies in sync ---
foreach ($copy in @("$root\apps\electron\shared\menu.json", "$root\apps\tauri\src-tauri\src\menu.json", "$root\apps\wails\menu.json", "$root\apps\electrobun\menu.json")) {
  Check-Needle "menu copy :: insert.plantuml ($copy)" $copy 'insert.plantuml' -Literal
  Check-Needle "menu copy :: insert.file ($copy)" $copy 'insert.file' -Literal
}

# --- brand assets (app icon / document icon) ---
Check-File 'brand :: app icon svg' "$root\artifacts\brand\icon-full.svg"
Check-File 'brand :: app icon ico' "$root\artifacts\brand\icon.ico"
Check-File 'brand :: document icon svg' "$root\artifacts\brand\icon-doc.svg"
Check-File 'brand :: document icon ico' "$root\artifacts\brand\doc.ico"
Check-File 'brand :: icon generator' "$root\scripts\make-icons.mjs"
Check-Needle 'brand :: electron icon config' "$root\apps\electron\electron-builder.yml" 'build/icon.ico' -Literal
Check-Needle 'brand :: electron md association' "$root\apps\electron\electron-builder.yml" 'fileAssociations' -Literal
Check-Needle 'brand :: tauri icon config' "$root\apps\tauri\src-tauri\tauri.conf.json" 'icons/icon.ico' -Literal
Check-Needle 'brand :: wails window icon' "$root\apps\wails\main.go" 'Icon:        appIcon' -Literal
Check-File 'brand :: web favicon' "$root\apps\web\public\favicon.svg"

# --- avbridge video embeds (vendor libav + <avbridge-player> playback) ----
Check-File 'avbridge :: libav vendor plugin' "$root\scripts\libav-vendor-plugin.mjs"
Check-File 'avbridge :: libav vendor plugin types' "$root\scripts\libav-vendor-plugin.d.mts"
foreach ($app in @('apps\web', 'apps\electron', 'apps\tauri\frontend', 'apps\wails\frontend', 'apps\electrobun\frontend')) {
  Check-Needle "vite config :: libav vendor ($app)" "$root\$app\vite.config.ts" 'libavVendorPlugin' -Literal
}
Check-Needle 'core source :: avbridge player element mount' "$root\packages\core\src\embeds.ts" 'avbridge-player' -Literal
Check-Needle 'core source :: avbridge bootstrap queue' "$root\packages\core\src\embeds.ts" 'avbridgeBootstrapChain' -Literal
Check-Needle 'core source :: avbridge bootstrap timeout' "$root\packages\core\src\embeds.ts" 'AVBRIDGE_BOOTSTRAP_TIMEOUT_MS' -Literal
Check-Needle 'core source :: widget keeps avbridge controls alive' "$root\packages\core\src\adapters\wysiwyg.ts" 'avbridge-player' -Literal

# --- plantuml visual editing (beautiful-plantuml canvas + official preview) ---
Check-File 'plantuml :: fence range helper' "$root\packages\core\src\fenceRange.ts"
Check-File 'plantuml :: edit bridge (resolver registry)' "$root\packages\core\src\plantumlEditBridge.ts"
Check-File 'plantuml :: lazy React dialog' "$root\packages\ui\src\ui\plantumlEditor.ts"
Check-Needle 'plantuml :: dialog lazy-loads the visual editor' "$root\packages\ui\src\ui\plantumlEditor.ts" "import('beautiful-plantuml')" -Literal
Check-Needle 'plantuml :: dialog official preview via renderEmbed' "$root\packages\ui\src\ui\plantumlEditor.ts" "renderEmbed('plantuml'" -Literal
Check-Needle 'plantuml :: command registered in shell' "$root\packages\ui\src\shell.ts" 'plantuml.visualEdit' -Literal
Check-Needle 'plantuml :: resolver wired (wysiwyg)' "$root\packages\core\src\adapters\wysiwyg.ts" 'setPlantumlResolver' -Literal
Check-Needle 'plantuml :: resolver wired (source)' "$root\packages\core\src\adapters\source.ts" 'setPlantumlResolver' -Literal
Check-Needle 'plantuml :: resolver wired (hybrid)' "$root\packages\core\src\adapters\hybrid.ts" 'setPlantumlResolver' -Literal
Check-Needle 'plantuml :: ui dependency' "$root\packages\ui\package.json" 'beautiful-plantuml' -Literal
Check-Needle 'plantuml :: core smoke wired' "$root\packages\core\package.json" 'pm-puml.mts' -Literal
Check-Needle 'plantuml :: ui smoke wired' "$root\packages\ui\package.json" 'pm-s-plantuml.mts' -Literal
Check-Needle 'mdsyntax :: core smoke wired' "$root\packages\core\package.json" 'pm-syntax.mts' -Literal

# --- 图像 ▸ 插入图片时 (image persistence: inline data URL or a copy on disk) ---
# One resolver decides where the bytes go, so the three views cannot drift; and
# `writeBase64`/`mkdirp` must exist together in every host that can write at all
# (web deliberately has neither, which is what keeps its images inline).
Check-Needle 'imagepersist :: resolver' "$root\packages\core\src\imagePersist.ts" 'export async function resolveImageInsert(' -Literal
Check-Needle 'imagepersist :: five copy modes' "$root\packages\host-api\src\types.ts" "export const IMAGE_COPY_MODES" -Literal
# `export *` cannot carry a runtime value through the CJS interop the smokes run
# on, so this named re-export is load-bearing, not decoration.
Check-Needle 'imagepersist :: value re-exported by name' "$root\packages\host-api\src\index.ts" "export { IMAGE_COPY_MODES } from './types'" -Literal
Check-Needle 'imagepersist :: config maps onto options' "$root\packages\core\src\imagePersist.ts" 'export function imagePersistOptionsFromConfig' -Literal
Check-Needle 'imagepersist :: ${filename} substitution' "$root\packages\core\src\imagePersist.ts" 'export function substitute(' -Literal
# The five targets live on the host-api side so the settings panel can render the
# radio group without dragging core (and its CSS) into a host context.
Check-Absent 'imagepersist :: settings does not import core' "$root\packages\ui\src\ui\settings.ts" "from '@markup/core'"
Check-Needle 'imagepersist :: host API (write bytes)' "$root\packages\host-api\src\types.ts" 'writeBase64?(path: string, dataUrl: string): Promise<void>' -Literal
Check-Needle 'imagepersist :: host API (mkdir -p)' "$root\packages\host-api\src\types.ts" 'mkdirp?(dir: string): Promise<void>' -Literal
Check-Needle 'imagepersist :: capability pairing verified' "$root\packages\host-api\src\verify.ts" 'required alongside fs.writeBase64' -Literal
# The view no longer reads the File — it splices a resolved {alt, url}.
Check-Needle 'imagepersist :: view contract' "$root\packages\core\src\adapters\types.ts" 'insertImage?(image: InsertedImage): boolean' -Literal
Check-Needle 'imagepersist :: wysiwyg splices it' "$root\packages\core\src\adapters\wysiwyg.ts" 'insertImage(image: InsertedImage): boolean' -Literal
Check-Needle 'imagepersist :: source splices it' "$root\packages\core\src\adapters\source.ts" 'insertImage(image: InsertedImage): boolean' -Literal
Check-Needle 'imagepersist :: hybrid splices it' "$root\packages\core\src\adapters\hybrid.ts" 'insertImage(image: InsertedImage): boolean' -Literal
Check-Needle 'imagepersist :: shell owns the decision' "$root\packages\ui\src\shell.ts" 'const persistImage = async (' -Literal
Check-Needle 'imagepersist :: pane routes through it' "$root\packages\ui\src\ui\editor.ts" 'hooks.persistImage?.(file, source)' -Literal
Check-Needle 'imagepersist :: settings radio group' "$root\packages\ui\src\ui\settings.ts" "'image-copy-mode'" -Literal
Check-Needle 'imagepersist :: settings hides the path row by class' "$root\packages\ui\src\ui\settings.ts" "'settings__field--off'" -Literal
Check-Needle 'imagepersist :: electron writeBase64' "$root\apps\electron\shared\ipc.ts" 'fsWriteBase64' -Literal
Check-Needle 'imagepersist :: tauri writeBase64' "$root\apps\tauri\src-tauri\src\lib.rs" 'async fn write_base64(' -Literal
Check-Needle 'imagepersist :: tauri mkdirp' "$root\apps\tauri\src-tauri\src\lib.rs" 'async fn mkdirp(' -Literal
Check-Needle 'imagepersist :: wails writeBase64' "$root\apps\wails\services\host.go" 'func (s *HostService) WriteBase64(' -Literal
Check-Needle 'imagepersist :: electrobun writeBase64' "$root\apps\electrobun\shared\rpc.ts" 'fsWriteBase64' -Literal
Check-Needle 'imagepersist :: web has neither, on purpose' "$root\apps\web\src\main.ts" 'deliberately absent, not forgotten' -Literal
Check-Needle 'imagepersist :: config survives Tauri write-back' "$root\apps\tauri\src-tauri\src\lib.rs" 'image_copy_mode: Option<String>' -Literal
Check-Needle 'imagepersist :: config survives Wails write-back' "$root\apps\wails\services\host.go" 'json:"imageCopyMode,omitempty"' -Literal
Check-Needle 'imagepersist :: core smoke wired' "$root\packages\core\package.json" 'pm-imgpersist.mts' -Literal

# --- 图像工具 (document-side image tools: syntax switch, path, move/repoint) ---
# An `![](…)` inside a fenced block is *sample* markdown — rewriting it corrupts
# the sample — so fences and inline code spans are skipped by the scanner.
Check-Needle 'imagetools :: scanner skips fences' "$root\packages\core\src\imageTools.ts" 'export function collectImages(' -Literal
Check-Needle 'imagetools :: inline code is skipped too' "$root\packages\core\src\imageTools.ts" 'function inlineCodeRanges(' -Literal
Check-Needle 'imagetools :: syntax switch' "$root\packages\core\src\imageTools.ts" 'export function switchImageSyntaxEdit(' -Literal
Check-Needle 'imagetools :: scope helper' "$root\packages\core\src\imageTools.ts" 'export function imagesInScope(' -Literal
# A reference is matched by its *resolved* path, or `./a.png`, `a.png` and
# `sub/../a.png` would each look like a different file after a move.
Check-Needle 'imagetools :: repoint by resolved path' "$root\packages\core\src\imageTools.ts" 'export function repointImagesEdit(' -Literal
Check-Needle 'imagetools :: a drive letter is not a scheme' "$root\packages\core\src\imageTools.ts" "if (!scheme || scheme.length === 1) return null" -Literal
Check-Needle 'imagetools :: host API (delete a file)' "$root\packages\host-api\src\types.ts" 'remove?(path: string): Promise<void>' -Literal
Check-Needle 'imagetools :: electron remove' "$root\apps\electron\shared\ipc.ts" 'fsRemove' -Literal
Check-Needle 'imagetools :: tauri remove' "$root\apps\tauri\src-tauri\src\lib.rs" 'async fn remove_file(' -Literal
Check-Needle 'imagetools :: wails remove' "$root\apps\wails\services\host.go" 'func (s *HostService) Remove(' -Literal
Check-Needle 'imagetools :: electrobun remove' "$root\apps\electrobun\shared\rpc.ts" 'fsRemove' -Literal
Check-Needle 'imagetools :: web offers none of it' "$root\apps\web\src\main.ts" 'hides the destructive 图像工具' -Literal
Check-Needle 'imagetools :: shell command' "$root\packages\ui\src\shell.ts" "id: 'image.switchSyntax'" -Literal
Check-Needle 'imagetools :: context menu items' "$root\packages\ui\src\shell.ts" "registry.run('image.deleteFile')" -Literal
Check-Needle 'imagetools :: menu exposes them' "$root\packages\host-api\src\menu.json" 'image.moveAllTo' -Literal
Check-Needle 'imagetools :: core smoke wired' "$root\packages\core\package.json" 'pm-imgtools.mts' -Literal

# --- 段落：标题级别 / 列表缩进 / 任务状态 / 内容目录 / Front Matter ---
# 提升 promotes (`##` → `#`): a "higher heading level" is the more prominent
# one, which is also the direction Typora's Ctrl+= behaves in. The step helper is
# separate from the edit so the wysiwyg view can read the level and apply it
# through its own block command instead.
Check-Needle 'paragraph :: heading step helper' "$root\packages\core\src\textFormat.ts" 'export function stepHeadingLevel(' -Literal
Check-Needle 'paragraph :: 提升 promotes' "$root\packages\core\src\textFormat.ts" "if (step === 'up') return level <= 1 ? 1 : level - 1" -Literal
Check-Needle 'paragraph :: 降低 demotes out of h6' "$root\packages\core\src\textFormat.ts" 'return level === 0 ? 0 : level >= 6 ? 0 : level + 1' -Literal
Check-Needle 'paragraph :: heading edit' "$root\packages\core\src\textFormat.ts" 'export function headingLevelEdit(' -Literal
Check-Needle 'paragraph :: list indent edit' "$root\packages\core\src\textFormat.ts" 'export function listIndentEdit(' -Literal
Check-Needle 'paragraph :: task status edit' "$root\packages\core\src\textFormat.ts" 'export function taskStatusEdit(' -Literal
Check-Needle 'paragraph :: the toc marker is single-sourced' "$root\packages\core\src\textFormat.ts" "export const TOC_MARKER = '[TOC]'" -Literal
# The outline is collected before the rewrite, so a `[TOC]` above the headings
# still lists them — and the anchors are stamped in that same pass so a TOC link
# and a sidebar entry can never disagree about the slug.
Check-Needle 'paragraph :: outline collected first' "$root\packages\core\src\pipeline.ts" 'function collectToc(' -Literal
Check-Needle 'paragraph :: headings carry anchors' "$root\packages\core\src\pipeline.ts" 'hProperties: { ...(child.data?.hProperties ?? {}), id }' -Literal
Check-Needle 'paragraph :: toc expansion' "$root\packages\core\src\pipeline.ts" 'function tocNode(' -Literal
Check-Needle 'paragraph :: toc has a styling hook' "$root\packages\core\src\pipeline.ts" "className: ['md-toc']" -Literal
# Views that own structure natively do the edit themselves.
Check-Needle 'paragraph :: wysiwyg list indent' "$root\packages\core\src\adapters\wysiwyg.ts" 'setListIndent(step: ListIndentStep): boolean' -Literal
Check-Needle 'paragraph :: wysiwyg task status' "$root\packages\core\src\adapters\wysiwyg.ts" 'setTaskStatus(status: TaskStatus): boolean' -Literal
Check-Needle 'paragraph :: pane routes list indent' "$root\packages\ui\src\ui\editor.ts" 'setListIndent: (step) => {' -Literal
Check-Needle 'paragraph :: heading command' "$root\packages\ui\src\shell.ts" "id: 'format.headingUp'" -Literal
Check-Needle 'paragraph :: list indent command' "$root\packages\ui\src\shell.ts" "id: 'format.listIndent'" -Literal
Check-Needle 'paragraph :: task status command' "$root\packages\ui\src\shell.ts" "id: 'format.taskDone'" -Literal
Check-Needle 'paragraph :: toc command' "$root\packages\ui\src\shell.ts" "id: 'insert.toc'" -Literal
Check-Needle 'paragraph :: front matter command' "$root\packages\ui\src\shell.ts" "id: 'insert.frontmatter'" -Literal
Check-Needle 'paragraph :: context menu mirrors 段落' "$root\packages\ui\src\shell.ts" "registry.run('format.listIndent')" -Literal
Check-Needle 'paragraph :: menu exposes the heading steps' "$root\packages\host-api\src\menu.json" 'format.headingDown' -Literal
Check-Needle 'paragraph :: menu exposes the toc' "$root\packages\host-api\src\menu.json" 'insert.toc' -Literal
Check-Needle 'paragraph :: export styles the toc' "$root\packages\core\src\exportHtml.ts" '.md-toc {' -Literal

# --- 视图 ▸ 放大 / 缩小 (zoom ladder + Ctrl 滚轮) ---
Check-Needle 'zoom :: ladder' "$root\packages\ui\src\zoom.ts" 'export const ZOOM_STEPS: readonly number[]' -Literal
Check-Needle 'zoom :: snaps onto the ladder' "$root\packages\ui\src\zoom.ts" 'export function clampZoom(' -Literal
Check-Needle 'zoom :: wheel delta maps to a step' "$root\packages\ui\src\zoom.ts" 'export function zoomFromWheelDelta(' -Literal
Check-Needle 'zoom :: config field' "$root\packages\host-api\src\types.ts" 'viewZoom?: number' -Literal
Check-Needle 'zoom :: applied as a css var' "$root\packages\ui\src\shell.ts" "root.style.setProperty('--view-zoom', zoomCss(config.viewZoom))" -Literal
Check-Needle 'zoom :: css consumes it' "$root\packages\ui\src\theme\shell.css" 'zoom: var(--view-zoom, 1);' -Literal
Check-Needle 'zoom :: menu items' "$root\packages\host-api\src\menu.json" 'view.zoomIn' -Literal
Check-Needle 'zoom :: command registered' "$root\packages\ui\src\shell.ts" "id: 'view.zoomReset'" -Literal
# A passive wheel listener cannot preventDefault, so the option is load-bearing.
Check-Needle 'zoom :: wheel listener is non-passive' "$root\packages\ui\src\shell.ts" '{ passive: false },' -Literal
Check-Needle 'zoom :: config survives Tauri write-back' "$root\apps\tauri\src-tauri\src\lib.rs" 'view_zoom: Option<f64>' -Literal
Check-Needle 'zoom :: config survives Wails write-back' "$root\apps\wails\services\host.go" 'json:"viewZoom,omitempty"' -Literal

# --- 视图 ▸ 全屏 / 保持窗口在最前端 ---
# A *set* API, not a toggle: Wails only offers ToggleFullscreen, so the shell
# needs to be told the desired state rather than "flip it".
Check-Needle 'windowstate :: host API' "$root\packages\host-api\src\types.ts" 'setWindowState?(state: WindowState): Promise<void>' -Literal
Check-Needle 'windowstate :: electron' "$root\apps\electron\shared\ipc.ts" 'appSetWindowState' -Literal
Check-Needle 'windowstate :: tauri command' "$root\apps\tauri\src-tauri\src\lib.rs" 'async fn set_window_state(' -Literal
Check-Needle 'windowstate :: wails toggles what it has' "$root\apps\wails\frontend\src\main.ts" 'await Window.IsFullscreen()' -Literal
Check-Needle 'windowstate :: config field' "$root\packages\host-api\src\types.ts" 'alwaysOnTop?: boolean' -Literal
Check-Needle 'windowstate :: only pushed when it changes' "$root\packages\ui\src\shell.ts" 'if (onTop !== appliedAlwaysOnTop) {' -Literal
Check-Needle 'windowstate :: config survives Tauri write-back' "$root\apps\tauri\src-tauri\src\lib.rs" 'always_on_top: Option<bool>' -Literal
Check-Needle 'windowstate :: config survives Wails write-back' "$root\apps\wails\services\host.go" 'json:"alwaysOnTop,omitempty"' -Literal
# Bare F-keys have to be recognised, or F11 can never be a shortcut.
Check-Needle 'windowstate :: function keys need no modifier' "$root\packages\ui\src\commands.ts" 'if (!mod && !/^F\d{1,2}$/.test(key)) return null' -Literal
# The toggles are checkboxes so the menu can show state.
Check-Needle 'windowstate :: menu renders a checkbox' "$root\packages\host-api\src\menu.json" '"id": "view.alwaysOnTop", "label": "保持窗口在最前端", "on": "view.alwaysOnTopOn"' -Literal
Check-Needle 'windowstate :: checkbox state source' "$root\packages\ui\src\shell.ts" "if (id === 'view.alwaysOnTop') return appearance.alwaysOnTop === true" -Literal
Check-Needle 'windowstate :: fullscreen command' "$root\packages\ui\src\shell.ts" "id: 'view.fullscreen'," -Literal

# --- 视图 ▸ 只读模式 ---
# The lever is whatever *owns* `contenteditable` (ProseMirror props, CodeMirror's
# editable facet, OverType's textarea) — writing the DOM attribute directly gets
# reverted on the next render. And it has to be re-applied on every view mount,
# or switching views silently re-enables typing.
Check-Needle 'readonly :: host API' "$root\packages\host-api\src\types.ts" 'readOnly?: boolean' -Literal
Check-Needle 'readonly :: adapter contract' "$root\packages\core\src\adapters\types.ts" 'setReadOnly?(enabled: boolean): void' -Literal
Check-Needle 'readonly :: prose mirror props' "$root\packages\core\src\adapters\wysiwyg.ts" 'view.setProps({ editable: () => !enabled })' -Literal
Check-Needle 'readonly :: codemirror editable facet' "$root\packages\core\src\adapters\hybrid.ts" 'readOnlyCompartment.reconfigure(EditorView.editable.of(!enabled))' -Literal
Check-Needle 'readonly :: overtype textarea' "$root\packages\core\src\adapters\source.ts" 'instance.textarea.readOnly = readOnly' -Literal
Check-Needle 'readonly :: survives a view switch' "$root\packages\ui\src\ui\editor.ts" 'active?.setReadOnly?.(readOnly)' -Literal
Check-Needle 'readonly :: menu checkbox' "$root\packages\host-api\src\menu.json" '"id": "view.readOnly"' -Literal
Check-Needle 'readonly :: config survives Tauri write-back' "$root\apps\tauri\src-tauri\src\lib.rs" 'read_only: Option<bool>' -Literal
Check-Needle 'readonly :: config survives Wails write-back' "$root\apps\wails\services\host.go" 'json:"readOnly,omitempty"' -Literal
Check-Needle 'readonly :: core smoke wired' "$root\packages\core\package.json" 'pm-readonly.mts' -Literal

# --- 工具栏 (floating format bar over a selection) ---
Check-Needle 'toolbar :: module' "$root\packages\ui\src\ui\selectionToolbar.ts" 'export function createSelectionToolbar(' -Literal
# Without cancelling mousedown the editor collapses the selection and every
# command acts on a bare caret.
Check-Needle 'toolbar :: mousedown is cancelled' "$root\packages\ui\src\ui\selectionToolbar.ts" 'event.preventDefault()' -Literal
Check-Needle 'toolbar :: shell wires it' "$root\packages\ui\src\shell.ts" 'createSelectionToolbar((command) => registry.run(command))' -Literal
Check-Needle 'toolbar :: hidden in 只读模式' "$root\packages\ui\src\shell.ts" 'if (appearance.readOnly === true) {' -Literal
Check-Needle 'toolbar :: styles' "$root\packages\ui\src\theme\shell.css" '.selection-toolbar {' -Literal
Check-Needle 'toolbar :: ui smoke wired' "$root\packages\ui\package.json" 'pm-t-toolbar.mts' -Literal

# --- 导出选项与页面设置 ---
# The page values land inside a <style> element, so a `}` has to be rejected or
# the rest of the value becomes arbitrary CSS.
Check-Needle 'export :: page values are whitelisted' "$root\packages\core\src\exportHtml.ts" 'const PAGE_VALUE = /^[A-Za-z0-9\s.%/-]+$/' -Literal
Check-Needle 'export :: @page emitted' "$root\packages\core\src\exportHtml.ts" 'parts.push(`@page {' -Literal
Check-Needle 'export :: 按一级标题分页' "$root\packages\core\src\exportHtml.ts" "parts.push('h1 { break-before: page; }')" -Literal
Check-Needle 'export :: custom css wins by order' "$root\packages\core\src\exportHtml.ts" 'const css = [base, extra, custom].filter(Boolean).join' -Literal
Check-Needle 'export :: head/body extras' "$root\packages\core\src\exportHtml.ts" 'options.headHtml ??' -Literal
# 大纲 reuses the document's own [TOC] marker so its links cannot disagree with
# the heading anchors.
Check-Needle 'export :: outline reuses the toc marker' "$root\packages\core\src\exportHtml.ts" 'options.outline && !alreadyHasOutline' -Literal
Check-Needle 'export :: config maps onto options' "$root\packages\core\src\exportHtml.ts" 'export function exportOptionsFromConfig(' -Literal
Check-Needle 'export :: default folder honoured' "$root\packages\ui\src\shell.ts" 'const exportDefaultPath = (ext: string): string' -Literal
Check-Needle 'export :: 导出后 runs' "$root\packages\ui\src\shell.ts" 'const afterExport = async (path: string): Promise<void>' -Literal
Check-Needle 'export :: file url helper' "$root\packages\ui\src\shell.ts" 'const fileUrl = (path: string): string' -Literal
Check-Needle 'export :: config field (folder)' "$root\packages\host-api\src\types.ts" 'exportFolder?: string' -Literal
Check-Needle 'export :: config field (page size)' "$root\packages\host-api\src\types.ts" 'exportPageSize?: string' -Literal
Check-Needle 'export :: settings sections' "$root\packages\ui\src\ui\settings.ts" "'data-section': 'export-page'" -Literal
Check-Needle 'export :: config survives Tauri write-back' "$root\apps\tauri\src-tauri\src\lib.rs" 'export_page_size: Option<String>' -Literal
Check-Needle 'export :: config survives Wails write-back' "$root\apps\wails\services\host.go" 'json:"exportPageSize,omitempty"' -Literal

# --- 文件操作与拖放 ---
# The ordering of the classification is the decision: document beats image beats
# link. A `diagram.png.md` has an image MIME type and must still open.
Check-Needle 'drop :: classification lives in core' "$root\packages\core\src\dropTargets.ts" 'export function classifyDroppedFile(' -Literal
Check-Needle 'drop :: document test first' "$root\packages\core\src\dropTargets.ts" "if (isDocumentName(file.name ?? '')) return 'document'" -Literal
Check-Needle 'drop :: shell uses it' "$root\packages\ui\src\shell.ts" 'classifyDroppedFile(file)' -Literal
Check-Needle 'drop :: only file drags are claimed' "$root\packages\ui\src\shell.ts" "types.includes('Files')" -Literal
Check-Needle 'drop :: target cue' "$root\packages\ui\src\theme\shell.css" '.editor-pane.is-drop-target {' -Literal
Check-Needle 'drop :: core smoke wired' "$root\packages\core\package.json" 'pm-drop.mts' -Literal
Check-Needle 'file :: 保存全部' "$root\packages\ui\src\shell.ts" "id: 'file.saveAll'," -Literal
Check-Needle 'file :: 重新打开关闭的文件' "$root\packages\ui\src\shell.ts" "id: 'file.reopenClosed'," -Literal
# Only saved documents can be reopened — an untitled tab has nothing to read.
Check-Needle 'file :: only saved tabs are remembered' "$root\packages\ui\src\shell.ts" 'const rememberClosed = (path: string | undefined): void => {' -Literal
Check-Needle 'file :: menu exposes them' "$root\packages\host-api\src\menu.json" 'file.reopenClosed' -Literal

# --- 编辑 ▸ 选中当前… / 跳转 / 整行 ---
# The ranges are markdown offsets, so a range that is one character long selects
# the space after a word on the next click. CJK matters: Chinese has no spaces,
# so a non-ASCII run has to count as one word.
Check-Needle 'select :: scope scanner' "$root\packages\core\src\textFormat.ts" 'export function selectScope(' -Literal
Check-Needle 'select :: CJK counts as a word char' "$root\packages\core\src\textFormat.ts" 'const isWordChar = (ch: string): boolean => /[\p{L}\p{N}_]/u.test(ch)' -Literal
Check-Needle 'select :: full-width terminators' "$root\packages\core\src\textFormat.ts" 'const SENTENCE_END = /[.。!！?？;；]/' -Literal
# A sentence must not run across a blank line; clamping to the block reuses the
# tested blank-line rule instead of duplicating it.
Check-Needle 'select :: sentence clamped to the paragraph' "$root\packages\core\src\textFormat.ts" "const block = selectScope(markdown, at, 'block')" -Literal
Check-Needle 'select :: line range' "$root\packages\core\src\textFormat.ts" 'export function lineRangeAt(' -Literal
Check-Needle 'select :: jump edges' "$root\packages\core\src\textFormat.ts" "export function documentEdge(markdown: string, edge: 'start' | 'end'): TextRange {" -Literal
Check-Needle 'select :: command registered' "$root\packages\ui\src\shell.ts" "id: 'edit.selectSentence'," -Literal
Check-Needle 'select :: cut takes the newline too' "$root\packages\ui\src\shell.ts" 'const hasTrailing = range.to < markdown.length' -Literal
Check-Needle 'select :: menu exposes them' "$root\packages\host-api\src\menu.json" 'edit.jumpLineEnd' -Literal
Check-Needle 'select :: core smoke wired' "$root\packages\core\package.json" 'pm-select.mts' -Literal

# --- 编辑器行为 ▸ 保存时规范化 / 默认代码块语言 / 纯文本复制 ---
# Normalisation happens on the way to disk only: rewriting the buffer would move
# the selection in every view just because a line-ending preference changed.
Check-Needle 'save :: normalise on the way out' "$root\packages\core\src\saveText.ts" 'export function normalizeForSave(' -Literal
Check-Needle 'save :: empty stays empty' "$root\packages\core\src\saveText.ts" "if (markdown.length === 0) return markdown" -Literal
Check-Needle 'save :: terminator matches the style' "$root\packages\core\src\saveText.ts" 'text += options.lineEnding === ' -Literal
Check-Needle 'save :: applied by the store' "$root\packages\core\src\docStore.ts" 'text = normalizeForSave(text, {' -Literal
Check-Needle 'save :: config fields' "$root\packages\host-api\src\types.ts" 'lineEnding?: ' -Literal
Check-Needle 'save :: final newline field' "$root\packages\host-api\src\types.ts" 'ensureFinalNewline?: boolean' -Literal
Check-Needle 'save :: config survives Tauri write-back' "$root\apps\tauri\src-tauri\src\lib.rs" 'ensure_final_newline: Option<bool>' -Literal
Check-Needle 'save :: config survives Wails write-back' "$root\apps\wails\services\host.go" 'json:"ensureFinalNewline,omitempty"' -Literal
Check-Needle 'save :: core smoke wired' "$root\packages\core\package.json" 'pm-save.mts' -Literal
Check-Needle 'editor :: default code block language' "$root\packages\core\src\textFormat.ts" 'const info = language.trim().split(/\s+/)[0] ?? ' -Literal
Check-Needle 'editor :: language reaches the native fence' "$root\packages\ui\src\shell.ts" 'editor.setCodeLanguage(appearance.codeBlockLanguage.trim())' -Literal
Check-Needle 'editor :: copy-as-text can hand over the source' "$root\packages\ui\src\shell.ts" 'appearance.copyTextAsMarkdown === true' -Literal

# --- 智能输入 (智能引号 / 破折号 / 成对的符号) ---
# Three views, three input hooks, one set of rules. The rules are pure so they
# can be verified without a browser; the offset arithmetic is shared so a view
# cannot get `deleteBefore` or the wrap splice subtly wrong.
Check-Needle 'smartinput :: rules' "$root\packages\core\src\smartInput.ts" 'export function smartInput(' -Literal
Check-Needle 'smartinput :: shared offset arithmetic' "$root\packages\core\src\smartInput.ts" 'export function smartInputEdit(' -Literal
# An empty `text` with no rule applied would swallow every keystroke.
Check-Needle 'smartinput :: off inserts what was typed' "$root\packages\core\src\smartInput.ts" 'return { text, deleteBefore: 0, caretOffset: text.length }' -Literal
# Pairing a *closing* quote is how `a""` gets produced.
Check-Needle 'smartinput :: a closing position never pairs' "$root\packages\core\src\smartInput.ts" 'if (!opening) {' -Literal
Check-Needle 'smartinput :: view contract' "$root\packages\core\src\adapters\types.ts" 'setSmartInput?(options: SmartInputOptions): void' -Literal
Check-Needle 'smartinput :: codemirror inputHandler' "$root\packages\core\src\adapters\hybrid.ts" 'EditorView.inputHandler.of(' -Literal
Check-Needle 'smartinput :: overtype beforeinput' "$root\packages\core\src\adapters\source.ts" "addEventListener('beforeinput', onBeforeInput)" -Literal
Check-Needle 'smartinput :: prose mirror prop' "$root\packages\core\src\adapters\wysiwyg.ts" 'handleTextInput: (proseView, from, to, text) => {' -Literal
Check-Needle 'smartinput :: survives a view switch' "$root\packages\ui\src\ui\editor.ts" 'active?.setSmartInput?.(smartInputOptions)' -Literal
Check-Needle 'smartinput :: config fields' "$root\packages\host-api\src\types.ts" 'smartQuotes?: boolean' -Literal
Check-Needle 'smartinput :: settings section' "$root\packages\ui\src\ui\settings.ts" "'data-section': 'editor-smart-input'" -Literal
Check-Needle 'smartinput :: config survives Tauri write-back' "$root\apps\tauri\src-tauri\src\lib.rs" 'paired_symbols: Option<bool>' -Literal
Check-Needle 'smartinput :: config survives Wails write-back' "$root\apps\wails\services\host.go" 'json:"pairedSymbols,omitempty"' -Literal
Check-Needle 'smartinput :: core smoke wired' "$root\packages\core\package.json" 'pm-smartinput.mts' -Literal

# --- 查找 ▸ 全词匹配 ---
# `\b` is useless here: in CJK text it treats every character as a boundary, so
# 猫 would match inside 猫猫咪 — the opposite of what 全词匹配 promises. The
# lookaround is Unicode-aware instead.
Check-Needle 'find :: whole-word lookaround' "$root\packages\ui\src\findText.ts" '\\p{L}\\p{N}_' -Literal
Check-Needle 'find :: flag threaded through' "$root\packages\ui\src\findText.ts" 'wholeWord = false,' -Literal
Check-Needle 'find :: panel toggle' "$root\packages\ui\src\ui\findPanel.ts" "'全词匹配'" -Literal
Check-Needle 'find :: panel state' "$root\packages\ui\src\ui\findPanel.ts" 'let wholeWord = false' -Literal

# --- 字数统计浮窗 ---
Check-Needle 'stats :: panel module' "$root\packages\ui\src\ui\statsPanel.ts" 'export function createStatsPanel(' -Literal
# Zero words must be zero minutes: "约 1 分钟" for an empty document reads as a bug.
Check-Needle 'stats :: reading time rounds' "$root\packages\ui\src\ui\statsPanel.ts" 'export function readingMinutes(' -Literal
Check-Needle 'stats :: empty is a dash' "$root\packages\ui\src\ui\statsPanel.ts" "return minutes === 0 ? '—' : " -Literal
Check-Needle 'stats :: shell wires it' "$root\packages\ui\src\shell.ts" 'const statsPanel = createStatsPanel()' -Literal
# Counting the whole document for a hidden panel is pure waste.
Check-Needle 'stats :: only counts while open' "$root\packages\ui\src\shell.ts" 'if (!statsPanel.visible) return' -Literal
Check-Needle 'stats :: command registered' "$root\packages\ui\src\shell.ts" "id: 'view.stats'," -Literal
Check-Needle 'stats :: menu entry' "$root\packages\host-api\src\menu.json" '"id": "view.stats"' -Literal
Check-Needle 'stats :: styles' "$root\packages\ui\src\theme\shell.css" '.stats-panel {' -Literal
Check-Needle 'stats :: ui smoke wired' "$root\packages\ui\package.json" 'pm-u-stats.mts' -Literal

# --- 大纲浮窗 ---
# Same `extractOutline` as the sidebar tab, so a heading cannot appear in one and
# not the other; and the caret→heading lookup is `<=` so a caret exactly on a
# heading counts as being in it.
Check-Needle 'outline :: panel module' "$root\packages\ui\src\ui\outlinePanel.ts" 'export function createOutlinePanel(' -Literal
Check-Needle 'outline :: caret to heading' "$root\packages\ui\src\ui\outlinePanel.ts" 'export function activeOutlineIndex(' -Literal
# Collapsing hides a *subtree*: everything deeper than the collapsed heading, up
# to the next item at its level or above.
Check-Needle 'outline :: collapse hides the subtree' "$root\packages\ui\src\ui\outlinePanel.ts" 'export function visibleOutlineIndices(' -Literal
Check-Needle 'outline :: leaves have no twisty' "$root\packages\ui\src\ui\outlinePanel.ts" 'export function hasNestedHeadings(' -Literal
# Collapsed indices are positional, so a different document must not inherit them.
Check-Needle 'outline :: collapse state is per-document' "$root\packages\ui\src\ui\outlinePanel.ts" 'collapsed.clear()' -Literal

# --- 文件树内新建文件 / 文件夹 ---
# The sidebar only renders; the shell owns the prompt and the filesystem, so the
# handler passes (root, kind) across that boundary.
Check-Needle 'tree :: handler contract' "$root\packages\ui\src\ui\sidebar.ts" "createEntry?: (dir: string, kind: 'file' | 'folder') => void" -Literal
Check-Needle 'tree :: menu items' "$root\packages\ui\src\ui\sidebar.ts" "'新建文件夹…'" -Literal
# A name with a separator would silently create elsewhere — refuse rather than guess.
Check-Needle 'tree :: separator in the name is refused' "$root\packages\ui\src\shell.ts" "'名称不能包含斜杠'" -Literal
# `fs.write` clobbers without a word, and a tree action that eats a document is
# not recoverable.
Check-Needle 'tree :: refuses to overwrite' "$root\packages\ui\src\shell.ts" '已存在' -Literal
Check-Needle 'tree :: folder needs mkdirp' "$root\packages\ui\src\shell.ts" "'当前环境无法创建文件夹'" -Literal

# --- 文件树 glob 过滤 ---
# The last matching pattern wins (gitignore's rule), which is the only rule that
# lets a broad include be narrowed again; and `*` must not cross a `/`, or
# `*.md` would silently mean "any markdown anywhere".
Check-Needle 'glob :: parse + match' "$root\packages\core\src\globFilter.ts" 'export function matchesGlobList(' -Literal
Check-Needle 'glob :: last match wins' "$root\packages\core\src\globFilter.ts" 'if (ruleMatches(rule, path)) included = !rule.negated' -Literal
Check-Needle 'glob :: star does not cross a slash' "$root\packages\core\src\globFilter.ts" "out += '[^/]*'" -Literal
# `**` handled as a unit before `*`, or it would stop at the first slash — the
# one thing it exists to avoid.
Check-Needle 'glob :: double star is a unit' "$root\packages\core\src\globFilter.ts" 'if (pattern[i + 1] === ' -Literal
Check-Needle 'glob :: empty hides nothing' "$root\packages\core\src\globFilter.ts" 'if (rules.length === 0) return true' -Literal
Check-Needle 'glob :: applied to the listing' "$root\packages\ui\src\shell.ts" 'workspace.files = applyWorkspaceFilter(files)' -Literal
Check-Needle 'glob :: config field' "$root\packages\host-api\src\types.ts" 'workspaceGlob?: string' -Literal
Check-Needle 'glob :: settings section' "$root\packages\ui\src\ui\settings.ts" "'data-section': 'editor-workspace'" -Literal
Check-Needle 'glob :: config survives Tauri write-back' "$root\apps\tauri\src-tauri\src\lib.rs" 'workspace_glob: Option<String>' -Literal
Check-Needle 'glob :: config survives Wails write-back' "$root\apps\wails\services\host.go" 'json:"workspaceGlob,omitempty"' -Literal
Check-Needle 'glob :: core smoke wired' "$root\packages\core\package.json" 'pm-glob.mts' -Literal

# --- 显示隐藏的文件夹 / 文件 ---
# Two separate sets that must not be conflated: *hidden* is a leading dot, *noise*
# is node_modules/.git/dist. Turning on "show hidden" must not become a way to
# accidentally walk a checkout.
Check-Needle 'hidden :: predicate' "$root\packages\ui\src\workspace.ts" 'export function shouldSkipEntry(' -Literal
Check-Needle 'hidden :: noise dirs always skipped' "$root\packages\ui\src\workspace.ts" 'IGNORE_DIRS.has(entry.name)' -Literal
# Changing this needs a re-walk, unlike the glob filter: it decides which entries
# are visited at all, so there is no unfiltered list to re-derive from.
Check-Needle 'hidden :: only re-walks when it changes' "$root\packages\ui\src\shell.ts" 'if (hidden !== appliedShowHidden) {' -Literal
Check-Needle 'hidden :: config field' "$root\packages\host-api\src\types.ts" 'showHiddenFiles?: boolean' -Literal
Check-Needle 'hidden :: settings checkbox' "$root\packages\ui\src\ui\settings.ts" "'显示隐藏的文件夹 / 文件'" -Literal
Check-Needle 'hidden :: config survives Tauri write-back' "$root\apps\tauri\src-tauri\src\lib.rs" 'show_hidden_files: Option<bool>' -Literal
Check-Needle 'hidden :: config survives Wails write-back' "$root\apps\wails\services\host.go" 'json:"showHiddenFiles,omitempty"' -Literal
Check-Needle 'hidden :: ui smoke wired' "$root\packages\ui\package.json" 'pm-w-workspace.mts' -Literal

# --- 目录显示的标题层数 ---
# Filtering runs *after* extraction so surviving items keep their real levels: an
# h3 under a filtered-out h2 still indents as an h3 instead of taking its place.
Check-Needle 'outlinelevel :: filter' "$root\packages\ui\src\outline.ts" 'export function filterOutlineLevel(' -Literal
Check-Needle 'outlinelevel :: 0 means everything' "$root\packages\ui\src\outline.ts" 'if (maxLevel <= 0) return items' -Literal
Check-Needle 'outlinelevel :: sidebar applies it' "$root\packages\ui\src\ui\sidebar.ts" 'handlers.getOutlineMaxLevel?.() ?? 0' -Literal
Check-Needle 'outlinelevel :: floating panel applies it' "$root\packages\ui\src\shell.ts" 'filterOutlineLevel(extractOutline(editor.getMarkdown()), appearance.outlineMaxLevel ?? 0)' -Literal
Check-Needle 'outlinelevel :: config field' "$root\packages\host-api\src\types.ts" 'outlineMaxLevel?: number' -Literal
Check-Needle 'outlinelevel :: settings select' "$root\packages\ui\src\ui\settings.ts" "'大纲显示的标题层数'" -Literal
Check-Needle 'outlinelevel :: config survives Tauri write-back' "$root\apps\tauri\src-tauri\src\lib.rs" 'outline_max_level: Option<u8>' -Literal
Check-Needle 'outlinelevel :: config survives Wails write-back' "$root\apps\wails\services\host.go" 'json:"outlineMaxLevel,omitempty"' -Literal

# --- 在文件树中显示 / 在文档列表中显示 ---
# Following the active document must *move* the mark rather than add one, and a
# path outside the workspace must clear it instead of leaving a stale highlight.
Check-Needle 'revealsidebar :: api' "$root\packages\ui\src\ui\sidebar.ts" 'revealPath: (path: string | null, options?: { scroll?: boolean }) => void' -Literal
Check-Needle 'revealsidebar :: mark' "$root\packages\ui\src\ui\sidebar.ts" 'file-tree__recent${path === activePath' -Literal
# Re-rendering the whole list on every keystroke would be waste: the mark only
# moves when the path does.
Check-Needle 'revealsidebar :: only re-renders on change' "$root\packages\ui\src\ui\sidebar.ts" 'if (changed) refreshWorkspaceFiles()' -Literal
Check-Needle 'revealsidebar :: follows the active document' "$root\packages\ui\src\shell.ts" 'sidebar.revealPath(doc.getDocument()?.path ?? null)' -Literal
Check-Needle 'revealsidebar :: command registered' "$root\packages\ui\src\shell.ts" "id: 'file.revealInSidebar'," -Literal
Check-Needle 'revealsidebar :: styles' "$root\packages\ui\src\theme\shell.css" '.file-tree__recent.is-active {' -Literal

# --- 复制到 MS Word / 真正的 HTML 剪贴板 ---
# `writeText` alone hands the destination the *source*: pasting into Word would
# show the tags instead of a paragraph. `ClipboardItem` is the only way to offer
# a real `text/html` flavour.
Check-Needle 'word :: html clipboard flavour' "$root\packages\ui\src\shell.ts" 'const writeClipboardHtml = async (html: string, plain: string)' -Literal
Check-Needle 'word :: falls back to text' "$root\packages\ui\src\shell.ts" 'await writeClipboard(plain)' -Literal
# Our theme CSS confuses Word's importer, which is what motivates stripping it.
Check-Needle 'word :: strips our presentation' "$root\packages\ui\src\shell.ts" "await writeClipboardHtml(stripHtmlFormatting(sourceHtml), plainFallback)" -Literal
Check-Needle 'word :: command registered' "$root\packages\ui\src\shell.ts" "id: 'edit.copyToWord'," -Literal
Check-Needle 'word :: menu entry' "$root\packages\host-api\src\menu.json" 'edit.copyToWord' -Literal

# --- 首行缩进 ---
# A CSS variable so the preview, the export and the print path all read the same
# switch; and applied to paragraphs only — a list item or quote already has its
# own leading marker, and indenting those reads as a broken indent.
Check-Needle 'indent :: config field' "$root\packages\host-api\src\types.ts" 'firstLineIndent?: boolean' -Literal
Check-Needle 'indent :: preview variable' "$root\packages\ui\src\shell.ts" "'--mk-first-line-indent'" -Literal
Check-Needle 'indent :: paragraphs only' "$root\packages\ui\src\theme\shell.css" 'text-indent: var(--mk-first-line-indent, 0px);' -Literal
Check-Needle 'indent :: export rule' "$root\packages\core\src\exportHtml.ts" "'.markdown-body p { text-indent: 2em; }'" -Literal
Check-Needle 'indent :: config survives Tauri write-back' "$root\apps\tauri\src-tauri\src\lib.rs" 'first_line_indent: Option<bool>' -Literal
Check-Needle 'indent :: config survives Wails write-back' "$root\apps\wails\services\host.go" 'json:"firstLineIndent,omitempty"' -Literal

# --- 代码块自动换行 ---
# A variable rather than a second rule, so the preview and the export read one
# source; and the default stays `pre` — a code block wrapping changes what the
# code looks like, so it is a choice, not a neutral default.
Check-Needle 'codewrap :: config field' "$root\packages\host-api\src\types.ts" 'codeBlockWrap?: boolean' -Literal
Check-Needle 'codewrap :: preview reads the variable' "$root\packages\core\src\adapters\github.css" 'white-space: var(--mk-code-wrap, pre);' -Literal
Check-Needle 'codewrap :: shell sets it' "$root\packages\ui\src\shell.ts" "'--mk-code-wrap'" -Literal
Check-Needle 'codewrap :: settings checkbox' "$root\packages\ui\src\ui\settings.ts" "'代码块自动换行'" -Literal
Check-Needle 'codewrap :: config survives Tauri write-back' "$root\apps\tauri\src-tauri\src\lib.rs" 'code_block_wrap: Option<bool>' -Literal
Check-Needle 'codewrap :: config survives Wails write-back' "$root\apps\wails\services\host.go" 'json:"codeBlockWrap,omitempty"' -Literal

# --- 文件树 / 文件库（列表）---
# The 文件 tab was already a *flat list*, so the unimplemented half was the tree,
# not the list. Directories in the derived tree exist only because a markdown
# file is below them — inventing an empty folder would show something that
# cannot be opened to anything.
Check-Needle 'filetree :: deriver' "$root\packages\ui\src\workspace.ts" 'export function buildFileTree(' -Literal
Check-Needle 'filetree :: dirs sort before files' "$root\packages\ui\src\workspace.ts" "if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1" -Literal
Check-Needle 'filetree :: sidebar branch' "$root\packages\ui\src\ui\sidebar.ts" 'renderTreeNodes(buildFileTree(workspace.root, workspace.files), 0)' -Literal
Check-Needle 'filetree :: toggle' "$root\packages\ui\src\ui\sidebar.ts" "class: 'sidebar__view-toggle'," -Literal
Check-Needle 'filetree :: styles' "$root\packages\ui\src\theme\shell.css" '.file-tree__dir {' -Literal

# --- 默认缩进（引用/列表）---
# Clamped rather than trusted: a stray config value would otherwise indent by a
# negative or absurd amount, and the outdent side has to remove as much *as
# configured* — a fixed two leaves a 4-space level half-outdented forever.
Check-Needle 'indentsize :: clamp' "$root\packages\core\src\textFormat.ts" 'export function clampIndentSize(' -Literal
Check-Needle 'indentsize :: outdent follows the setting' "$root\packages\core\src\textFormat.ts" 'const indentRe = new RegExp(' -Literal
Check-Needle 'indentsize :: shell passes it' "$root\packages\ui\src\shell.ts" 'appearance.listIndentSize ?? 2' -Literal
Check-Needle 'indentsize :: config field' "$root\packages\host-api\src\types.ts" 'listIndentSize?: number' -Literal
Check-Needle 'indentsize :: settings input' "$root\packages\ui\src\ui\settings.ts" "'默认缩进（空格数，1–8）'" -Literal
Check-Needle 'indentsize :: config survives Tauri write-back' "$root\apps\tauri\src-tauri\src\lib.rs" 'list_indent_size: Option<u8>' -Literal
Check-Needle 'indentsize :: config survives Wails write-back' "$root\apps\wails\services\host.go" 'json:"listIndentSize,omitempty"' -Literal

# --- 保留单换行符 ---
# remark-parse keeps a soft break as a literal `\n` inside the text node, so this
# is a matter of splitting those nodes. Code blocks are untouched *by
# construction*: their newlines live in `code.value`, not in a text node.
Check-Needle 'linebreaks :: mdast transform' "$root\packages\core\src\pipeline.ts" 'function applyLineBreaks(' -Literal
Check-Needle 'linebreaks :: runs before transform' "$root\packages\core\src\pipeline.ts" 'if (options.preserveLineBreaks) applyLineBreaks(tree)' -Literal
Check-Needle 'linebreaks :: config maps onto options' "$root\packages\core\src\pipeline.ts" 'preserveLineBreaks: config.preserveLineBreaks === true' -Literal
Check-Needle 'linebreaks :: config field' "$root\packages\host-api\src\types.ts" 'preserveLineBreaks?: boolean' -Literal
Check-Needle 'linebreaks :: settings checkbox' "$root\packages\ui\src\ui\settings.ts" "'保留单换行符（段落内换行渲染为换行）'" -Literal
Check-Needle 'linebreaks :: config survives Tauri write-back' "$root\apps\tauri\src-tauri\src\lib.rs" 'preserve_line_breaks: Option<bool>' -Literal
Check-Needle 'linebreaks :: config survives Wails write-back' "$root\apps\wails\services\host.go" 'json:"preserveLineBreaks,omitempty"' -Literal

# --- 删除块 / 在上下方插入段落 ---
# 删除块 takes one separator with it: deleting only the text would leave the
# blank line behind, so repeatedly deleting blocks would grow a gap instead of
# shrinking the document.
Check-Needle 'blockops :: delete' "$root\packages\core\src\textFormat.ts" 'export function deleteBlockEdit(' -Literal
Check-Needle 'blockops :: delete takes a separator' "$root\packages\core\src\textFormat.ts" 'const trailing = markdown.slice(afterEnd).match(/^\n\n/)' -Literal
# Markdown has no empty paragraph, so "a new paragraph" is one more blank line.
Check-Needle 'blockops :: insert paragraph' "$root\packages\core\src\textFormat.ts" 'export function insertParagraphEdit(' -Literal
Check-Needle 'blockops :: commands registered' "$root\packages\ui\src\shell.ts" "id: 'format.deleteBlock'," -Literal
Check-Needle 'blockops :: menu entries' "$root\packages\host-api\src\menu.json" 'format.insertParagraphAfter' -Literal

# --- 链接引用 ---
# A reference label is an identifier, so the same text always has to produce the
# same label — including case. And a second definition for a label is a document
# error, not a duplicate convenience.
Check-Needle 'linkref :: label is a slug' "$root\packages\core\src\textFormat.ts" 'export function referenceLabel(' -Literal
Check-Needle 'linkref :: spaced destination is wrapped' "$root\packages\core\src\textFormat.ts" 'const destination = /\s/.test(url)' -Literal
Check-Needle 'linkref :: existing definition detected' "$root\packages\core\src\textFormat.ts" 'export function hasReferenceDefinition(' -Literal
Check-Needle 'linkref :: command registered' "$root\packages\ui\src\shell.ts" "id: 'format.linkReference'," -Literal
Check-Needle 'linkref :: definition written once' "$root\packages\ui\src\shell.ts" 'if (hasReferenceDefinition(after, label)) return' -Literal
Check-Needle 'linkref :: menu entry' "$root\packages\host-api\src\menu.json" 'format.linkReference' -Literal

# --- HTML 内容块 / 创建副本 ---
# Markdown passes raw HTML through, so the block only needs opening; and a
# duplicate comes from the *buffer*, not from disk — duplicating a document you
# have been editing should carry the edits.
Check-Needle 'htmlblock :: command registered' "$root\packages\ui\src\shell.ts" "id: 'insert.htmlBlock'," -Literal
Check-Needle 'duplicate :: command registered' "$root\packages\ui\src\shell.ts" "id: 'file.duplicate'," -Literal
Check-Needle 'duplicate :: copies the buffer' "$root\packages\ui\src\shell.ts" 'await host.fs.write(target, current.content)' -Literal
# A duplicate that eats an existing document is not recoverable.
Check-Needle 'duplicate :: refuses to overwrite' "$root\packages\ui\src\shell.ts" 'if (exists) {' -Literal
Check-Needle 'duplicate :: menu entry' "$root\packages\host-api\src\menu.json" 'file.duplicate' -Literal

# --- 重命名 / 移动到 ---
# Order matters: write the new copy first, remove the original second. The other
# way round would lose the document whenever the write failed.
Check-Needle 'rename :: command registered' "$root\packages\ui\src\shell.ts" "id: 'file.rename'," -Literal
Check-Needle 'rename :: write before delete' "$root\packages\ui\src\shell.ts" 'await doc.save(target)' -Literal
# `doc.save(target)` also repoints the tab and recents, so nothing else has to
# learn about the new path.
Check-Needle 'rename :: a leftover original is not a failed move' "$root\packages\ui\src\shell.ts" '已移动到新位置，但原文件未能删除' -Literal
Check-Needle 'rename :: menu entry' "$root\packages\host-api\src\menu.json" 'file.rename' -Literal

# --- 选择编码重新打开 ---
# Decoding in the renderer through `TextDecoder` means no new host API: readBase64
# already hands over the bytes, and the platform is the authority on encodings.
# `fatal: true` on purpose — a wrong encoding must report rather than quietly fill
# the document with replacement characters the next save would write back.
Check-Needle 'encoding :: command registered' "$root\packages\ui\src\shell.ts" "id: 'file.reopenEncoding'," -Literal
Check-Needle 'encoding :: fatal decode' "$root\packages\ui\src\shell.ts" 'new TextDecoder(label, { fatal: true })' -Literal
Check-Needle 'encoding :: reuses readBase64' "$root\packages\ui\src\shell.ts" 'dataUrlBytes(await host.fs.readBase64(current.path))' -Literal
Check-Needle 'encoding :: menu entry' "$root\packages\host-api\src\menu.json" 'file.reopenEncoding' -Literal

# --- Markdown 变体 ---
# A *name* handed to pandoc, not a dialect this app implements — passed through
# as-is so a user can name any format their pandoc knows. `gfm` is the default
# because it is what keeps this renderer's own tables/footnotes/task lists
# working through a round trip.
Check-Needle 'mdvariant :: format is config-driven' "$root\packages\ui\src\shell.ts" 'const markdownFormat = (): string =>' -Literal
Check-Needle 'mdvariant :: config field' "$root\packages\host-api\src\types.ts" 'converterMarkdownFormat?: string' -Literal
Check-Needle 'mdvariant :: settings select' "$root\packages\ui\src\ui\settings.ts" "'Markdown 变体（导入 / 导出用）'" -Literal
Check-Needle 'mdvariant :: both directions read it' "$root\packages\ui\src\shell.ts" 'to: markdownFormat(),' -Literal
Check-Needle 'mdvariant :: config survives Tauri write-back' "$root\apps\tauri\src-tauri\src\lib.rs" 'converter_markdown_format: Option<String>' -Literal
Check-Needle 'mdvariant :: config survives Wails write-back' "$root\apps\wails\services\host.go" 'json:"converterMarkdownFormat,omitempty"' -Literal

# --- 复制公式（Tex / MathML）---
# `$` is context-sensitive, so the scanner is the substance: an escaped `\$`, a
# `$` in a fence or inline code, and a lone `$` used as currency must all be
# ruled out. And the lookup is in the *markdown*, not the DOM — the three views
# render math differently, and the source is where they agree.
Check-Needle 'mathcopy :: scanner' "$root\packages\core\src\mathSource.ts" 'export function collectMathSpans(' -Literal
# Display math routinely starts with a newline; inline math may not start with a
# space. Applying one rule to both would reject `$$\n…\n$$`.
Check-Needle 'mathcopy :: non-space rule is inline-only' "$root\packages\core\src\mathSource.ts" 'if (block || (after !== undefined' -Literal
Check-Needle 'mathcopy :: MathML via KaTeX' "$root\packages\core\src\mathSource.ts" 'export function latexToMathML(' -Literal
Check-Needle 'mathcopy :: command registered' "$root\packages\ui\src\shell.ts" "id: 'edit.copyMathMl'," -Literal
Check-Needle 'mathcopy :: mathml goes on as html' "$root\packages\ui\src\shell.ts" 'await writeClipboardHtml(mathml, latex)' -Literal
Check-Needle 'mathcopy :: menu entries' "$root\packages\host-api\src\menu.json" 'edit.copyMathTex' -Literal
Check-Needle 'mathcopy :: core smoke wired' "$root\packages\core\package.json" 'pm-mathsrc.mts' -Literal

# --- Emoji 自动补全 ---
# Rides the existing smart-input hook rather than adding a fourth one. The
# closing colon is the character being typed, so it is not part of `before`; and
# an emoji outside the BMP is two UTF-16 units, so the caret offset is not 1.
Check-Needle 'emoji :: table' "$root\packages\core\src\emoji.ts" 'export const EMOJI: Readonly<Record<string, string>>' -Literal
Check-Needle 'emoji :: shortcode lookup' "$root\packages\core\src\emoji.ts" 'export function emojiForShortcode(' -Literal
Check-Needle 'emoji :: rides the smart-input rule' "$root\packages\core\src\smartInput.ts" "if (options.emoji && text === ':') {" -Literal
# An unknown shortcode has to fall through to a literal colon, or `:foo:` could
# never be typed at all.
Check-Needle 'emoji :: unknown falls through' "$root\packages\core\src\smartInput.ts" 'if (name && emoji) {' -Literal
Check-Needle 'emoji :: shell passes the setting' "$root\packages\ui\src\shell.ts" 'emoji: next.emojiAutocomplete === true,' -Literal
Check-Needle 'emoji :: config field' "$root\packages\host-api\src\types.ts" 'emojiAutocomplete?: boolean' -Literal
Check-Needle 'emoji :: config survives Tauri write-back' "$root\apps\tauri\src-tauri\src\lib.rs" 'emoji_autocomplete: Option<bool>' -Literal
Check-Needle 'emoji :: config survives Wails write-back' "$root\apps\wails\services\host.go" 'json:"emojiAutocomplete,omitempty"' -Literal
Check-Needle 'emoji :: core smoke wired' "$root\packages\core\package.json" 'pm-emoji.mts' -Literal

# --- 解析时识别 Unicode 标点 ---
# Deliberately narrow: only the Unicode forms that *are* markdown somewhere. A
# full-width comma or full stop is ordinary CJK prose with no markdown role, so
# rewriting it would change what the document says rather than help it parse.
Check-Needle 'unicodepunct :: remap table' "$root\packages\core\src\unicodePunct.ts" 'export const PUNCTUATION_REMAP' -Literal
Check-Needle 'unicodepunct :: escapes win' "$root\packages\core\src\unicodePunct.ts" 'escaped ? escaped : (PUNCTUATION_REMAP[char] ?? char)' -Literal
# It rewrites the *input* before parsing: there is no mdast node for `》` to
# recognise afterwards, so this cannot be a transform.
Check-Needle 'unicodepunct :: applied before parsing' "$root\packages\core\src\pipeline.ts" 'options.remapUnicodePunctuation ? remapUnicodePunctuation(body) : body' -Literal
Check-Needle 'unicodepunct :: config maps onto options' "$root\packages\core\src\pipeline.ts" 'remapUnicodePunctuation: config.remapUnicodePunctuation === true' -Literal
Check-Needle 'unicodepunct :: config field' "$root\packages\host-api\src\types.ts" 'remapUnicodePunctuation?: boolean' -Literal
Check-Needle 'unicodepunct :: settings checkbox' "$root\packages\ui\src\ui\settings.ts" "'解析时识别 Unicode 标点'" -Literal

# --- Typora 偏好设置补齐（除 license 外全量） ---
# Typora「Markdown ▸ 语法偏好」.
Check-Needle 'mdstrict :: settings checkbox' "$root\packages\ui\src\ui\settings.ts" "'严格模式（更贴近 GFM 标准）'" -Literal
Check-Needle 'mdheadingstyle :: settings select' "$root\packages\ui\src\ui\settings.ts" "'标题样式'" -Literal
Check-Needle 'mdbulletchar :: settings select' "$root\packages\ui\src\ui\settings.ts" "'无序列表标记'" -Literal
Check-Needle 'mdorderedchar :: settings select' "$root\packages\ui\src\ui\settings.ts" "'有序列表标记'" -Literal
Check-Needle 'mdcodelinenumbers :: settings checkbox' "$root\packages\ui\src\ui\settings.ts" "'代码块显示行号'" -Literal
Check-Needle 'mdcodeindent :: settings input' "$root\packages\ui\src\ui\settings.ts" "'代码缩进（空格数）'" -Literal
Check-Needle 'mdautonumbermath :: settings checkbox' "$root\packages\ui\src\ui\settings.ts" "'自动添加公式序号'" -Literal
Check-Needle 'mdamsnumbering :: settings checkbox' "$root\packages\ui\src\ui\settings.ts" "'根据 AMS 规则编号'" -Literal
# Typora「编辑器」.
Check-Needle 'editorliverendering :: settings checkbox' "$root\packages\ui\src\ui\settings.ts" "'即时渲染（边打字边解析，而非手动刷新）'" -Literal
Check-Needle 'editorblocksource :: settings checkbox' "$root\packages\ui\src\ui\settings.ts" "'悬停简单块时显示其 Markdown 源码'" -Literal
# Typora「外观 ▸ 窗口样式」.
Check-Needle 'windowstyle :: settings select' "$root\packages\ui\src\ui\settings.ts" "'窗口样式'" -Literal
Check-Needle 'darkseparate :: settings checkbox' "$root\packages\ui\src\ui\settings.ts" "'深色模式下使用独立主题'" -Literal
# Typora「侧边栏」.
Check-Needle 'sidebaroutline :: settings checkbox' "$root\packages\ui\src\ui\settings.ts" "'默认显示大纲视图'" -Literal
Check-Needle 'sidebarcollapsible :: settings checkbox' "$root\packages\ui\src\ui\settings.ts" "'允许折叠和展开侧边栏的大纲视图'" -Literal
# Typora「导出」.
Check-Needle 'exporttheme :: settings input' "$root\packages\ui\src\ui\settings.ts" "'导出时使用的主题（留空则用当前主题）'" -Literal
Check-Needle 'exportincludeoutline :: settings checkbox' "$root\packages\ui\src\ui\settings.ts" "'保留大纲侧边栏'" -Literal
Check-Needle 'exportextensions :: settings input' "$root\packages\ui\src\ui\settings.ts" "'导出文件扩展名（留空则按目标格式自动判）'" -Literal
Check-Needle 'exportargs :: settings input' "$root\packages\ui\src\ui\settings.ts" "'pandoc 额外参数'" -Literal
Check-Needle 'exportyamloverride :: settings checkbox' "$root\packages\ui\src\ui\settings.ts" "'允许 YAML front matter 覆盖当前设置'" -Literal
# Typora「通用 ▸ 启动」.
Check-Needle 'launchnewfile :: settings checkbox' "$root\packages\ui\src\ui\settings.ts" "'启动时打开新文件'" -Literal
Check-Needle 'launchrestorefolders :: settings checkbox' "$root\packages\ui\src\ui\settings.ts" "'重新打开上次使用的目录'" -Literal
Check-Needle 'launchcustomfolder :: settings checkbox' "$root\packages\ui\src\ui\settings.ts" "'打开指定目录'" -Literal
Check-Needle 'launchcustomfolderpath :: settings input' "$root\packages\ui\src\ui\settings.ts" "'指定目录路径'" -Literal
# Typora「保存 & 恢复」.
Check-Needle 'saverecoverdrafts :: settings checkbox' "$root\packages\ui\src\ui\settings.ts" "'恢复未保存的草稿'" -Literal
# Typora「图像 ▸ 上传服务」.
Check-Needle 'imagequality :: settings select' "$root\packages\ui\src\ui\settings.ts" "'图片质量'" -Literal
Check-Needle 'imageuploadcommand :: settings input' "$root\packages\ui\src\ui\settings.ts" "'上传图片命令'" -Literal
Check-Needle 'imagepicgopath :: settings input' "$root\packages\ui\src\ui\settings.ts" "'PicGo 可执行文件路径'" -Literal
# Typora「文件」.
Check-Needle 'filedefaultext :: settings input' "$root\packages\ui\src\ui\settings.ts" "placeholder: '.md'" -Literal
Check-Needle 'filedropaction :: settings select' "$root\packages\ui\src\ui\settings.ts" "'在应用中打开'" -Literal
# 右侧滑入面板（不是居中弹窗）.
Check-Needle 'settings :: right slide-in panel' "$root\packages\ui\src\theme\shell.css" '.settings.is-open' -Literal
Check-Needle 'settings :: panel shares shell-body row' "$root\packages\ui\src\shell.ts" '右侧滑入面板：与侧栏/编辑器同一 flex 行，收起时宽度 0。' -Literal
Check-Needle 'settings :: no backdrop, Esc closes' "$root\packages\ui\src\ui\settings.ts" 'No backdrop: the panel shares the shell-body row with the editor' -Literal
Check-Needle 'settings :: not a modal dialog' "$root\packages\ui\src\ui\settings.ts" "role: 'region'" -Literal
Check-Needle 'unicodepunct :: config survives Tauri write-back' "$root\apps\tauri\src-tauri\src\lib.rs" 'remap_unicode_punctuation: Option<bool>' -Literal
Check-Needle 'unicodepunct :: config survives Wails write-back' "$root\apps\wails\services\host.go" 'json:"remapUnicodePunctuation,omitempty"' -Literal
Check-Needle 'unicodepunct :: core smoke wired' "$root\packages\core\package.json" 'pm-unicodepunct.mts' -Literal
Check-Needle 'outline :: reuses the sidebar extractor' "$root\packages\ui\src\shell.ts" 'extractOutline(editor.getMarkdown())' -Literal
Check-Needle 'outline :: shell wires it' "$root\packages\ui\src\shell.ts" 'const outlinePanel = createOutlinePanel(' -Literal
Check-Needle 'outline :: command registered' "$root\packages\ui\src\shell.ts" "id: 'view.outline'," -Literal
Check-Needle 'outline :: menu entry' "$root\packages\host-api\src\menu.json" '"id": "view.outline"' -Literal
Check-Needle 'outline :: styles' "$root\packages\ui\src\theme\shell.css" '.outline-panel {' -Literal
Check-Needle 'outline :: ui smoke wired' "$root\packages\ui\package.json" 'pm-v-outline.mts' -Literal

# --- 格式化表格源码 ---
# Alignment is a property of the rendered text, not of the string length: a CJK
# character occupies two cells, so padding by `.length` produces a ragged table
# in exactly the documents this feature exists for.
Check-Needle 'tablefmt :: display width' "$root\packages\core\src\tableFormat.ts" 'export function displayWidth(' -Literal
Check-Needle 'tablefmt :: escaped pipes stay in their cell' "$root\packages\core\src\tableFormat.ts" 'text[i + 1] === ' -Literal
Check-Needle 'tablefmt :: alignment markers survive' "$root\packages\core\src\tableFormat.ts" 'function delimiterCell(cell: string, width: number): string {' -Literal
# A no-op must not dirty the document.
Check-Needle 'tablefmt :: aligned table is a no-op' "$root\packages\core\src\tableFormat.ts" 'if (text === markdown.slice(table.from, table.to)) return null' -Literal
Check-Needle 'tablefmt :: command registered' "$root\packages\ui\src\shell.ts" "id: 'format.tableSource'," -Literal
Check-Needle 'tablefmt :: menu entry' "$root\packages\host-api\src\menu.json" 'format.tableSource' -Literal
Check-Needle 'tablefmt :: core smoke wired' "$root\packages\core\package.json" 'pm-tablefmt.mts' -Literal

# --- 打开文件位置 / 高级设置 ---
# Both go through `openExternal` with a `file:` URL — the one primitive every
# shell already has. Unlike 导出后, a failure here *is* reported: nothing else
# happened, so staying silent would look like the command did nothing.
Check-Needle 'reveal :: shared helper' "$root\packages\ui\src\shell.ts" 'const revealFolder = async (folder: string, what: string)' -Literal
# The config root, not a guessed file name: an older build may not have written
# the file yet, and a folder always exists.
Check-Needle 'reveal :: config root not a file' "$root\packages\ui\src\shell.ts" "host.app.getPath?.('userData')" -Literal
Check-Needle 'reveal :: unsaved doc says so' "$root\packages\ui\src\shell.ts" "'当前文档尚未保存'" -Literal
Check-Needle 'reveal :: menu entries' "$root\packages\host-api\src\menu.json" 'file.revealInFolder' -Literal
Check-Needle 'reveal :: settings entry' "$root\packages\host-api\src\menu.json" 'settings.advancedConfig' -Literal

# --- 复制内容并简化格式 / 搜索 ---
# Drop presentation (inline styles, <style> blocks), keep meaning (classes and
# structure) — a fragment that lost its callout or checkbox would be a worse
# outcome than one that kept a class nobody styles.
Check-Needle 'htmlcopy :: stripper' "$root\packages\core\src\htmlCopy.ts" 'export function stripHtmlFormatting(' -Literal
# Detection has to agree with the stripper, or a caller skips work that was needed.
Check-Needle 'htmlcopy :: detection' "$root\packages\core\src\htmlCopy.ts" 'export function hasInlineFormatting(' -Literal
Check-Needle 'htmlcopy :: command registered' "$root\packages\ui\src\shell.ts" "id: 'edit.copyAsCleanHtml'," -Literal
Check-Needle 'search :: command registered' "$root\packages\ui\src\shell.ts" "id: 'search.google'," -Literal
Check-Needle 'search :: needs a selection' "$root\packages\ui\src\shell.ts" "'请先选中要搜索的内容'" -Literal
Check-Needle 'htmlcopy :: menu entries' "$root\packages\host-api\src\menu.json" 'edit.copyAsCleanHtml' -Literal
Check-Needle 'htmlcopy :: core smoke wired' "$root\packages\core\package.json" 'pm-htmlcopy.mts' -Literal

# --- document conversion (导入文档 / 导出为…: pandoc primary, carta fallback) ---
# Markup never bundles a converter: it resolves `pandoc` then `carta` from PATH,
# or uses an explicit path from 设置 ▸ 导出 ▸ 文档转换. These needles pin the seams that
# have to stay wired across the five shells.
Check-Needle 'convert :: host API (locate)' "$root\packages\host-api\src\types.ts" 'converter?(): Promise<ConverterInfo | null>' -Literal
Check-Needle 'convert :: host API (convert)' "$root\packages\host-api\src\types.ts" 'convert?(request: ConvertRequest): Promise<ConvertResult>' -Literal
Check-Needle 'convert :: config field (single source)' "$root\packages\host-api\src\types.ts" 'converterPath?: string' -Literal
Check-Needle 'convert :: config survives Tauri write-back' "$root\apps\tauri\src-tauri\src\lib.rs" 'converter_path: Option<String>' -Literal
Check-Needle 'convert :: config survives Wails write-back' "$root\apps\wails\services\host.go" 'json:"converterPath,omitempty"' -Literal
Check-File   'convert :: electron impl' "$root\apps\electron\src\main\converter.ts"
Check-File   'convert :: tauri impl' "$root\apps\tauri\src-tauri\src\converter.rs"
Check-File   'convert :: wails impl' "$root\apps\wails\services\converter.go"
Check-File   'convert :: electrobun impl' "$root\apps\electrobun\src\bun\converter.ts"
Check-Needle 'convert :: electron host exposes it' "$root\apps\electron\src\preload\preload.ts" 'convert: (request: ConvertRequest)' -Literal
Check-Needle 'convert :: tauri host exposes it' "$root\apps\tauri\frontend\src\main.ts" "invoke('convert_document'" -Literal
Check-Needle 'convert :: wails host exposes it' "$root\apps\wails\frontend\src\main.ts" 'ConvertDocument' -Literal
Check-Needle 'convert :: electrobun host exposes it' "$root\apps\electrobun\frontend\src\main.ts" 'appConvert(request)' -Literal
Check-Needle 'convert :: menu has import' "$root\packages\host-api\src\menu.json" 'file.import' -Literal
Check-Needle 'convert :: menu has docx export' "$root\packages\host-api\src\menu.json" 'file.exportDocx' -Literal
Check-Needle 'convert :: settings path field' "$root\packages\ui\src\ui\settings.ts" 'converterPath' -Literal

# --- settings panel layout (aligned with Typora's preferences: 通用/外观/编辑器/Markdown/图像/导出) ---
# The type union is the single declaration of the built-in panel set; the shell's
# per-panel commands and the `view` panel removal below are both keyed off it.
Check-Needle 'settings :: panel set' "$root\packages\ui\src\ui\settings.ts" "'general' | 'appearance' | 'editor' | 'markdown' | 'image' | 'export'" -Literal
Check-Needle 'settings :: general panel' "$root\packages\ui\src\ui\settings.ts" "'data-tab-panel': 'general'" -Literal
Check-Needle 'settings :: markdown panel' "$root\packages\ui\src\ui\settings.ts" "'data-tab-panel': 'markdown'" -Literal
Check-Needle 'settings :: image panel' "$root\packages\ui\src\ui\settings.ts" "'data-tab-panel': 'image'" -Literal
Check-Needle 'settings :: export panel' "$root\packages\ui\src\ui\settings.ts" "'data-tab-panel': 'export'" -Literal
Check-Needle 'settings :: converter lives on export' "$root\packages\ui\src\shell.ts" "settings.open('export')" -Literal
# `视图` was dissolved into 通用/编辑器. Asserting the new panels exist is not enough:
# a leftover `view` panel would leave both the old and the new grouping in place.
Check-Absent 'settings :: old view panel is gone' "$root\packages\ui\src\ui\settings.ts" "'data-tab-panel': 'view'" -Literal
# `gfm`, not `markdown`: measured against pandoc 3.12.1, it is the one name that
# keeps pipe tables, `[^1]` footnotes and task lists all at once.
Check-Needle 'convert :: gfm is the round-trip format' "$root\packages\ui\src\shell.ts" "const DEFAULT_MARKDOWN_FORMAT = 'gfm'" -Literal
Check-Needle 'convert :: media extracted portably' "$root\packages\ui\src\shell.ts" 'mediaDir' -Literal
Check-Needle 'convert :: media dir never orphans a folder' "$root\packages\ui\src\shell.ts" 'existsAtTarget ? {}' -Literal

# --- dialog filters reach the native picker ---------------------------------
# Tauri used to hardcode a Markdown filter in open_dialog/save_dialog and its
# option structs had no `filters` field, so serde dropped the renderer's list
# and every picker — insert a model/video/XMind file, import a .docx, export
# HTML/PDF — offered only .md. Assert the field exists *and* that the hardcoded
# filter is gone: the positive assertion alone would still pass if the old
# constant were left in place.
Check-Needle 'dialog :: tauri option structs carry filters' "$root\apps\tauri\src-tauri\src\lib.rs" 'filters: Option<Vec<FileFilter>>' -Literal
Check-Needle 'dialog :: tauri filter row type' "$root\apps\tauri\src-tauri\src\lib.rs" 'struct FileFilter {' -Literal
Check-Needle 'dialog :: tauri applies the renderer filters' "$root\apps\tauri\src-tauri\src\lib.rs" 'fn add_filters(' -Literal
Check-Needle 'dialog :: tauri honours defaultPath' "$root\apps\tauri\src-tauri\src\lib.rs" 'fn apply_default_path(' -Literal
Check-Absent 'dialog :: tauri Markdown filter no longer hardcoded' "$root\apps\tauri\src-tauri\src\lib.rs" '.add_filter("Markdown"' -Literal
Check-Needle 'dialog :: electron save handler is SaveDialogOptions' "$root\apps\electron\src\main\main.ts" 'dlSave, async (_event, options: SaveDialogOptions)' -Literal

# --- Typora Markdown syntax support (上标/下标/高亮/下划线 + GitHub alerts) ---
# One mdast transform serves every consumer: the remark pipeline behind export,
# and (via a separate OverType hook) 分屏. `singleTilde: false` is the load-
# bearing choice — it is what frees the lone `~` for subscript while keeping
# `~~x~~` the only strikethrough, matching Typora. Undo it and subscript
# silently stops working everywhere.
Check-Needle 'mdsyntax :: mdast transform' "$root\packages\core\src\mdSyntax.ts" 'export function mdSyntax(' -Literal
Check-Needle 'mdsyntax :: single tilde is subscript' "$root\packages\core\src\mdSyntax.ts" '(?<!~)~([^~\s]' -Literal
Check-Needle 'mdsyntax :: pipeline opts out of single-tilde strike' "$root\packages\core\src\pipeline.ts" 'singleTilde: false' -Literal
Check-Needle 'mdsyntax :: pipeline installs it' "$root\packages\core\src\pipeline.ts" '.use(mdSyntax' -Literal
Check-Needle 'mdsyntax :: config maps onto options' "$root\packages\core\src\pipeline.ts" 'export function pipelineOptionsFromConfig' -Literal
Check-File   'mdsyntax :: github alerts' "$root\packages\core\src\mdAlerts.ts"
Check-Needle 'mdsyntax :: pipeline installs alerts' "$root\packages\core\src\pipeline.ts" '.use(mdAlerts)' -Literal
Check-Needle 'mdsyntax :: export honours the toggles' "$root\packages\core\src\exportHtml.ts" 'pipeline: PipelineOptions' -Literal
# 分屏 is OverType, not remark, so it needs the same rules replayed over HTML
# OverType already produced. Without the hook the three views disagree.
Check-File   'mdsyntax :: overtype (split view) hook' "$root\packages\core\src\overtypeSyntax.ts"
Check-Needle 'mdsyntax :: shell installs the overtype hook' "$root\packages\ui\src\shell.ts" 'setOvertypeSyntax(mdSyntaxOptionsFromConfig(next))' -Literal
# Inline formats: `strike` existed in the engine but had no command, and the
# four new ones needed both the marker table and a registered command.
Check-Needle 'mdsyntax :: marker table' "$root\packages\core\src\textFormat.ts" "underline: { open: '<u>', close: '</u>' }" -Literal
Check-Needle 'mdsyntax :: strike command registered' "$root\packages\ui\src\shell.ts" "id: 'format.strike'" -Literal
Check-Needle 'mdsyntax :: sub command registered' "$root\packages\ui\src\shell.ts" "id: 'format.sub'" -Literal
Check-Needle 'mdsyntax :: menu exposes the inline formats' "$root\packages\host-api\src\menu.json" 'format.highlight' -Literal
Check-Needle 'mdsyntax :: config survives Tauri write-back' "$root\apps\tauri\src-tauri\src\lib.rs" 'md_inline_math: Option<bool>' -Literal
Check-Needle 'mdsyntax :: config survives Wails write-back' "$root\apps\wails\services\host.go" 'json:"mdInlineMath,omitempty"' -Literal

Write-Output "---- needle: $hits HIT / $misses MISS ----"
if ($misses -gt 0) { exit 1 }
