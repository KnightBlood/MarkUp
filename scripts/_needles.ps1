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
Check-Needle 'convert :: gfm is the round-trip format' "$root\packages\ui\src\shell.ts" "const MARKDOWN_FORMAT = 'gfm'" -Literal
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
