; Markup (Electrobun shell) — Windows installer.
;
; Electrobun's own Windows "Setup" is a fixed-directory self-extractor: it has
; no directory page and no way to register file associations on Windows
; (`app.fileAssociations` is macOS-only upstream). So this shell ships its own
; NSIS installer around the payload `hutch electrobun build` already produced.
;
; Built by CI after extracting `dist/<channel>-win-x64/Markup-Setup.tar.zst`
; (that archive *is* the installed layout: `Markup/bin/launcher.exe` +
; `Markup/Resources/app/**` + the runtime scripts):
;
;   makensis -DPAYLOAD_DIR=<staging>\Markup -DOUTFILE=<out.exe> \
;            -DVERSION=0.1.0 -DICON=<repo>\apps\electrobun\assets\icon.ico windows.nsi
;
; The payload directory is installed verbatim, so the layout inside it must not
; be reshaped (the launcher resolves `Resources/app` relative to itself).

Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"

!ifndef PAYLOAD_DIR
  !error "PAYLOAD_DIR is required"
!endif
!ifndef OUTFILE
  !error "OUTFILE is required"
!endif
!ifndef VERSION
  !define VERSION "0.1.0"
!endif
!ifndef APP_NAME
  !define APP_NAME "Markup"
!endif
!ifndef APP_ID
  !define APP_ID "dev.markup.editor"
!endif
!ifndef ICON
  !define ICON ""
!endif

!define PROG_ID "${APP_NAME}.markdown"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"

Name "${APP_NAME}"
OutFile "${OUTFILE}"
!if "${ICON}" != ""
  Icon "${ICON}"
  UninstallIcon "${ICON}"
!endif
; Default location, but MUI_PAGE_DIRECTORY below lets the user change it.
InstallDir "$LOCALAPPDATA\Programs\${APP_NAME}"
InstallDirRegKey HKCU "Software\${APP_NAME}" "InstallDir"
; Per-user install: no UAC prompt, and everything it writes is under HKCU.
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show

VIProductVersion "0.0.0.0"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" ""

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

!macro AssociateExtension EXT
  ; Own the extension, and also register as an "Open with" candidate so a user
  ; who later picks another default can still find Markup in the list.
  WriteRegStr HKCU "Software\Classes\.${EXT}" "" "${PROG_ID}"
  WriteRegStr HKCU "Software\Classes\.${EXT}" "Content Type" "text/markdown"
  WriteRegStr HKCU "Software\Classes\.${EXT}\OpenWithProgids" "${PROG_ID}" ""
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.${EXT}\OpenWithProgids" "${PROG_ID}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.${EXT}\OpenWithProgids" "${PROG_ID}" ""
!macroend

!macro UnassociateExtension EXT
  DeleteRegKey HKCU "Software\Classes\.${EXT}\OpenWithProgids"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.${EXT}\OpenWithProgids" "${PROG_ID}"
!macroend

Section "Markup" SEC_MAIN
  SectionIn RO
  SetOutPath "$INSTDIR"
  ; The launcher resolves Resources/app relative to itself, so the payload
  ; layout is installed verbatim.
  File /r "${PAYLOAD_DIR}\*.*"

  ; File association: `.md` / `.markdown` open with the installed launcher,
  ; which reads the path from argv (see apps/electrobun/src/bun/index.ts).
  WriteRegStr HKCU "Software\Classes\${PROG_ID}" "" "Markdown document"
  WriteRegStr HKCU "Software\Classes\${PROG_ID}\DefaultIcon" "" "$INSTDIR\Resources\app.ico"
  WriteRegStr HKCU "Software\Classes\${PROG_ID}\shell\open\command" "" '"$INSTDIR\bin\launcher.exe" "%1"'
  !insertmacro AssociateExtension "md"
  !insertmacro AssociateExtension "markdown"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'

  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\bin\launcher.exe"
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\bin\launcher.exe"

  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "Software\${APP_NAME}" "InstallDir" "$INSTDIR"

  ; Add/Remove Programs entry (HKCU — the install is per-user).
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\bin\launcher.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${APP_NAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" $0
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  RMDir "$SMPROGRAMS\${APP_NAME}"

  !insertmacro UnassociateExtension "md"
  !insertmacro UnassociateExtension "markdown"
  DeleteRegKey HKCU "Software\Classes\${PROG_ID}"
  DeleteRegKey HKCU "Software\${APP_NAME}"
  DeleteRegKey HKCU "${UNINST_KEY}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'

  RMDir /r "$INSTDIR"
SectionEnd
