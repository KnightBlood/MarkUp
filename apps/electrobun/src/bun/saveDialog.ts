/**
 * Native Windows "Save As" dialog for the Electrobun shell.
 *
 * Electrobun's core FFI only exposes `openFileDialog` (there is no
 * `saveFileDialog` anywhere in the devkit), so `HostAPI.dialog.save` is served
 * through `comdlg32!GetSaveFileNameW` directly — the classic OPENFILENAMEW
 * dialog, which is what the other shells' native save dialogs amount to on
 * Windows.
 *
 * Everything is wrapped so a failure (missing symbol, non-Windows host,
 * dialog error) degrades to `null`, which the app already treats as "the user
 * cancelled" (same as the `web` shell).
 */
import { dlopen, ptr, type Pointer } from 'bun:ffi'

const OFN_OVERWRITEPROMPT = 0x0000_0002
const OFN_NOCHANGEDIR = 0x0000_0008
const OFN_PATHMUSTEXIST = 0x0000_0800
const OFN_EXPLORER = 0x0008_0000

/** sizeof(OPENFILENAMEW) on x64 with default packing. */
const OPENFILENAME_SIZE = 152
/** OFN.lpstrFile capacity, in UTF-16 code units (the Win32 `nMaxFile` limit). */
const FILE_BUFFER_CHARS = 32_768

/** Only the slice of `Library<>` this file uses; keeps the call site typed. */
interface SaveLibrary {
  symbols: { GetSaveFileNameW: (arg: Pointer) => boolean }
}

let library: SaveLibrary | null | undefined

function comdlg(): SaveLibrary | null {
  if (library !== undefined) return library
  library = null
  if (process.platform !== 'win32') return library
  try {
    library = dlopen('comdlg32.dll', {
      GetSaveFileNameW: { args: ['ptr'], returns: 'bool' },
    }) as unknown as SaveLibrary
  } catch (error) {
    console.warn('[markup] comdlg32 unavailable, save dialog disabled:', error)
  }
  return library
}

/** NUL-terminated UTF-16LE buffer; `ptr()` must stay valid for the call. */
function utf16z(value: string): Uint8Array {
  const bytes = new Uint8Array((value.length + 1) * 2)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < value.length; index += 1) {
    view.setUint16(index * 2, value.charCodeAt(index), true)
  }
  return bytes
}

function readUtf16z(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let result = ''
  for (let offset = 0; offset + 1 < bytes.byteLength; offset += 2) {
    const unit = view.getUint16(offset, true)
    if (unit === 0) break
    result += String.fromCharCode(unit)
  }
  return result
}

export interface SaveDialogOptions {
  defaultPath?: string
  defaultExt?: string
  filters?: Array<{ name: string; extensions: string[] }>
}

/**
 * Show a native save dialog. Resolves to the picked absolute path, or `null`
 * when the user cancels or the dialog cannot be shown.
 */
export function saveFileDialog(options: SaveDialogOptions = {}): string | null {
  const lib = comdlg()
  if (!lib) return null

  try {
    const defaultPath = options.defaultPath ?? ''
    const extension = (options.defaultExt ?? '').replace(/^\./, '')

    const filterParts: string[] = []
    for (const filter of options.filters ?? []) {
      const patterns = filter.extensions.map((ext) => `*.${ext.replace(/^\./, '')}`)
      if (patterns.length > 0) filterParts.push(`${filter.name}\0${patterns.join(';')}\0`)
    }
    filterParts.push('All files (*.*)\0*.*\0')
    const filter = utf16z(filterParts.join('') + '\0')

    const title = utf16z('保存为')
    const defExt = utf16z(extension)
    const fileBuffer = new Uint8Array(FILE_BUFFER_CHARS * 2)
    fileBuffer.set(utf16z(defaultPath))

    const struct = new Uint8Array(OPENFILENAME_SIZE)
    const view = new DataView(struct.buffer)
    const at = (offset: number, value: Pointer | bigint | number): void => {
      view.setBigUint64(offset, BigInt(value), true)
    }
    view.setUint32(0, OPENFILENAME_SIZE, true) // lStructSize
    at(8, 0) // hwndOwner — the webview owns no stable HWND
    at(16, 0) // hInstance
    at(24, ptr(filter)) // lpstrFilter
    at(32, 0) // lpstrCustomFilter
    view.setUint32(40, 0, true) // nMaxCustFilter
    view.setUint32(44, 1, true) // nFilterIndex (1-based)
    at(48, ptr(fileBuffer)) // lpstrFile
    view.setUint32(56, FILE_BUFFER_CHARS, true) // nMaxFile
    at(64, 0) // lpstrFileTitle
    view.setUint32(72, 0, true) // nMaxFileTitle
    at(80, 0) // lpstrInitialDir
    at(88, ptr(title)) // lpstrTitle
    view.setUint32(
      96,
      OFN_OVERWRITEPROMPT | OFN_NOCHANGEDIR | OFN_PATHMUSTEXIST | OFN_EXPLORER,
      true, // Flags
    )
    view.setUint16(100, 0, true) // nFileOffset
    view.setUint16(102, 0, true) // nFileExtension
    at(104, defExt ? ptr(defExt) : 0) // lpstrDefExt (no leading dot)
    at(112, 0) // lCustData
    at(120, 0) // lpfnHook
    at(128, 0) // lpTemplateName
    at(136, 0) // pvReserved
    view.setUint32(144, 0, true) // dwReserved
    view.setUint32(148, 0, true) // FlagsEx

    const picked = lib.symbols.GetSaveFileNameW(ptr(struct))
    if (!picked) return null

    const path = readUtf16z(fileBuffer)
    return path.length > 0 ? path : null
  } catch (error) {
    console.warn('[markup] save dialog failed:', error)
    return null
  }
}
