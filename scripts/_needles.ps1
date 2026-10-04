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
Check-Needle 'wails packaging :: nsis directory page' "$root\apps\wails\build\nsis\project.nsi" 'MUI_PAGE_DIRECTORY' -Literal
Check-Needle 'wails packaging :: nsis associate macro' "$root\apps\wails\build\nsis\project.nsi" 'wails.associateFiles' -Literal
Check-Needle 'wails packaging :: linux mime type' "$root\apps\wails\build\Taskfile.linux.yml" 'MimeType=text/markdown' -Literal
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

Write-Output "---- needle: $hits HIT / $misses MISS ----"
if ($misses -gt 0) { exit 1 }
