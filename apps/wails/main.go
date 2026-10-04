package main

import (
	"embed"
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/markup/markup-wails/services"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// markdownExtensions are the types the app associates with the OS (mirrors
// `fileAssociations` in build/config.yml and the installers of the other
// shells).
var markdownExtensions = []string{".md", ".markdown"}

// emitHostEvent is assigned once the window exists. The single-instance
// callback and the cold-start argument scan can both run before that, so they
// only queue (see queueFileOpen).
var emitHostEvent func(eventName, payload string)

type fileOpenState struct {
	// ready flips on common:WindowRuntimeReady; the renderer's `file-open`
	// listener only exists after its `boot()`.
	ready   bool
	pending []string
}

var (
	fileOpenMu sync.Mutex
	fileOpen   fileOpenState
)

func isMarkdownPath(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	for _, known := range markdownExtensions {
		if ext == known {
			return true
		}
	}
	return false
}

// queueFileOpen hands an OS-initiated open to the app, or buffers it until the
// webview runtime is ready.
func queueFileOpen(path string) {
	if !isMarkdownPath(path) {
		return
	}
	fileOpenMu.Lock()
	if !fileOpen.ready {
		for _, queued := range fileOpen.pending {
			if queued == path {
				fileOpenMu.Unlock()
				return
			}
		}
		fileOpen.pending = append(fileOpen.pending, path)
		fileOpenMu.Unlock()
		return
	}
	fileOpenMu.Unlock()
	if emitHostEvent != nil {
		emitHostEvent("file-open", path)
	}
}

func flushFileOpen() {
	fileOpenMu.Lock()
	fileOpen.ready = true
	pending := fileOpen.pending
	fileOpen.pending = nil
	fileOpenMu.Unlock()
	for _, path := range pending {
		if emitHostEvent != nil {
			emitHostEvent("file-open", path)
		}
	}
}

// scanArgsForFiles picks the associated files out of a command line — both the
// cold start (os.Args) and a second launch forwarded by SingleInstance.
func scanArgsForFiles(args []string) {
	for _, arg := range args {
		if strings.HasPrefix(arg, "-") {
			continue
		}
		info, err := os.Stat(arg)
		if err != nil || info.IsDir() {
			continue
		}
		queueFileOpen(arg)
	}
}

// Frontend is embedded at build time: build frontend/dist first, then go build.
//go:embed all:frontend/dist
var embeddedDist embed.FS

// 应用图标（artifacts/brand/icon-512.png 的拷贝；窗口/关于框用）
//go:embed build/appicon.png
var appIcon []byte

// Application menu — synced from packages/host-api/src/menu.json by scripts/sync-menu.mjs.
//go:embed menu.json
var embeddedMenu []byte

type menuItemDef struct {
	Kind        string `json:"kind"`
	ID          string `json:"id,omitempty"`
	Label       string `json:"label,omitempty"`
	Accelerator string `json:"accelerator,omitempty"`
	On          string `json:"on,omitempty"`
	Off         string `json:"off,omitempty"`
}

type menuSectionDef struct {
	Label string        `json:"label"`
	Items []menuItemDef `json:"items"`
}

type globalShortcutDef struct {
	CommandID        string `json:"commandId"`
	Accelerator      string `json:"accelerator"`
	WailsAccelerator string `json:"wailsAccelerator"`
}

type hostMenuDef struct {
	Menu            []menuSectionDef    `json:"menu"`
	GlobalShortcuts []globalShortcutDef `json:"globalShortcuts"`
}

type windowControlAdapter struct {
	w *application.WebviewWindow
}

func (a windowControlAdapter) Minimise() {
	a.w.Minimise()
}

func (a windowControlAdapter) ToggleMaximise() {
	a.w.ToggleMaximise()
}

func (a windowControlAdapter) Close() {
	a.w.Close()
}

func (a windowControlAdapter) OpenDevTools() {
	a.w.OpenDevTools()
}

func main() {
	// Strip the "frontend/dist" prefix so URLs map to the dist root.
	dist, err := fs.Sub(embeddedDist, "frontend/dist")
	if err != nil {
		panic(err)
	}
	app := application.New(application.Options{
		Name:        "Markup",
		Description: "Typora-like markdown editor",
		Icon:        appIcon,
		// A second launch (double-clicking another `.md` while Markup runs)
		// hands its arguments to this instance instead of opening a second
		// editor that would lose the session.
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "dev.markup.editor",
			OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
				scanArgsForFiles(data.Args)
			},
		},
		Services: []application.Service{
			application.NewService(&services.HostService{}),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(dist),
		},
	})

	// Window must exist before menu callbacks capture it.
	// UseApplicationMenu is required for Windows/Linux to inherit the application menu.
	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:              "Markup",
		Width:              1200,
		Height:             800,
		URL:                "/",
		UseApplicationMenu: true,
	})
	// The in-app menu bar (renderer) is the single menu. On Windows
	// HideMenuBar() detaches the native menu (SetMenu(hwnd, 0)), so its
	// accelerators stop firing — quit/reload/devtools are registered as
	// renderer commands instead (shell.ts + HostService.OpenDevTools).
	window.HideMenuBar()

	emitHostEvent = func(eventName, payload string) {
		window.EmitEvent("host-event", map[string]any{
			"event":   eventName,
			"payload": payload,
		})
	}
	// File association: `.md` paths arrive as command-line arguments (cold
	// start) or through SingleInstance (already running). They stay buffered
	// until the runtime is ready, since the renderer's `file-open` listener
	// only exists once `boot()` ran.
	window.OnWindowEvent(events.Common.WindowRuntimeReady, func(_ *application.WindowEvent) {
		flushFileOpen()
	})
	scanArgsForFiles(os.Args[1:])
	// Services (fs watch) emit through the same channel with a structured payload.
	services.SetEventEmitter(func(event string, payload any) {
		window.EmitEvent("host-event", map[string]any{
			"event":   event,
			"payload": payload,
		})
	})
	var menuDef hostMenuDef
	if err := json.Unmarshal(embeddedMenu, &menuDef); err != nil {
		panic("menu.json: " + err.Error())
	}

	// Keyboard shortcuts for command items are handled in the renderer via attachKeydown;
	// only action items (quit/reload/devtools) carry accelerators in the OS menu.
	onClick := func(commandID string) func(*application.Context) {
		return func(_ *application.Context) {
			emitHostEvent("menu-command", commandID)
		}
	}

	// Application menu built from menu.json (single source shared with Electron/Tauri).
	sections := make([]*application.MenuItem, 0, len(menuDef.Menu))
	for _, section := range menuDef.Menu {
		items := make([]*application.MenuItem, 0, len(section.Items))
		for i := range section.Items {
			item := &section.Items[i]
			switch item.Kind {
			case "separator":
				items = append(items, application.NewMenuItemSeparator())
			case "command":
				items = append(items, application.NewMenuItem(item.Label).OnClick(onClick(item.ID)))
			case "checkbox":
				on, off := item.On, item.Off
				items = append(items, application.NewMenuItemCheckbox(item.Label, false).OnClick(func(ctx *application.Context) {
					if ctx.ClickedMenuItem().Checked() {
						emitHostEvent("menu-command", on)
						return
					}
					emitHostEvent("menu-command", off)
				}))
			case "action":
				label, accel := item.Label, item.Accelerator
				switch item.ID {
				case "quit":
					items = append(items, application.NewMenuItem(label).SetAccelerator(accel).OnClick(func(_ *application.Context) {
						app.Quit()
					}))
				case "reload":
					items = append(items, application.NewMenuItem(label).SetAccelerator(accel).OnClick(func(_ *application.Context) {
						window.Reload()
					}))
				default: // devtools
					items = append(items, application.NewMenuItem(label).SetAccelerator(accel).OnClick(func(_ *application.Context) {
						window.OpenDevTools()
					}))
				}
			}
		}
		if len(items) == 0 {
			continue
		}
		sections = append(sections, application.NewSubmenu(section.Label, application.NewMenuFromItems(items[0], items[1:]...)))
	}

	// Set the application menu before Run so the window inherits it.
	if len(sections) > 0 {
		app.Menu.SetApplicationMenu(application.NewMenuFromItems(sections[0], sections[1:]...))
	}

	// OS-level shortcuts (work when unfocused). Payload = command id.
	for _, gs := range menuDef.GlobalShortcuts {
		accel, commandID := gs.WailsAccelerator, gs.CommandID
		if err := app.GlobalShortcut.Register(accel, func() {
			window.Focus()
			emitHostEvent("global-shortcut", commandID)
		}); err != nil {
			// Another app may own the binding; continue so the rest still register.
			println("[markup] global shortcut failed:", accel, err.Error())
		}
	}

	window.Show()
	// Adapt *WebviewWindow (Minimise returns Window) to services.WindowControl.
	services.SetMainWindow(windowControlAdapter{window})

	app.Run()
}
