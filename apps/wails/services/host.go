package services

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type FileResult struct {
	Path     string `json:"path"`
	Content  string `json:"content"`
	Encoding string `json:"encoding"`
	Crlf     bool   `json:"crlf"`
	Bom      bool   `json:"bom"`
}

type DirEntry struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	Kind  string `json:"kind"`
	Size  int64  `json:"size"`
	Mtime int64  `json:"mtime"`
}

type FsEvent struct {
	Kind string `json:"kind"`
	Path string `json:"path"`
}

type PathInfo struct {
	Path string `json:"path"`
}

type MessageResult struct {
	Button string `json:"button"`
}

type AppConfig struct {
	Theme           string            `json:"theme"`
	FontSize        int               `json:"fontSize"`
	LineWidth       int               `json:"lineWidth"`
	RecentDocuments []string          `json:"recentDocuments"`
	AutoSave        *bool             `json:"autoSave,omitempty"`
	AutoSaveDelayMs *int              `json:"autoSaveDelayMs,omitempty"`
	Typewriter      *bool             `json:"typewriter,omitempty"`
	CustomTheme     map[string]string `json:"customTheme,omitempty"`
	LineNumbers     *bool             `json:"lineNumbers,omitempty"`
	ShowStats       *bool             `json:"showStats,omitempty"`
	FocusMode       *bool             `json:"focusMode,omitempty"`
	ImagePaste      *bool             `json:"imagePaste,omitempty"`
	Spellcheck      *bool             `json:"spellcheck,omitempty"`
	DisabledPlugins []string          `json:"disabledPlugins,omitempty"`
	BodyFont        *string           `json:"bodyFont,omitempty"`
	CodeFont        *string           `json:"codeFont,omitempty"`
	Shortcuts       map[string]string `json:"shortcuts,omitempty"`
	RestoreSession  *bool             `json:"restoreSession,omitempty"`
	OpenTabs        []string          `json:"openTabs,omitempty"`
	ActiveTab       *string           `json:"activeTab,omitempty"`
}

func defaultConfig() *AppConfig {
	return &AppConfig{Theme: "system", FontSize: 16, LineWidth: 780, RecentDocuments: []string{}}
}

func configFilePath() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "markup", "config.json"), nil
}

type HostService struct{}

// Window controls — wired from main via SetMainWindow after the window is created.
type WindowControl interface {
	Minimise()
	ToggleMaximise()
	Close()
	OpenDevTools()
}

var mainWindow WindowControl

func SetMainWindow(w WindowControl) {
	mainWindow = w
}

func (s *HostService) WindowMinimize() error {
	if mainWindow == nil {
		return errors.New("window not ready")
	}
	mainWindow.Minimise()
	return nil
}

func (s *HostService) WindowToggleMaximize() error {
	if mainWindow == nil {
		return errors.New("window not ready")
	}
	mainWindow.ToggleMaximise()
	return nil
}

func (s *HostService) WindowClose() error {
	if mainWindow == nil {
		return errors.New("window not ready")
	}
	mainWindow.Close()
	return nil
}

// OpenDevTools opens the webview devtools. The native menu bar is hidden (the
// in-app menu bar is the single menu), so this is how 帮助 → 开发者工具 works.
func (s *HostService) OpenDevTools() error {
	if mainWindow == nil {
		return errors.New("window not ready")
	}
	mainWindow.OpenDevTools()
	return nil
}

func (s *HostService) ReadFile(path string) (*FileResult, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	bom := len(raw) >= 3 && raw[0] == 0xEF && raw[1] == 0xBB && raw[2] == 0xBF
	if bom {
		raw = raw[3:]
	}
	content := string(raw)
	return &FileResult{Path: path, Content: content, Encoding: "utf8", Crlf: strings.Contains(content, "\r\n"), Bom: bom}, nil
}

func (s *HostService) WriteFile(path, content string) error {
	return os.WriteFile(path, []byte(content), 0o644)
}

func (s *HostService) ReadDir(path string) ([]DirEntry, error) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}
	result := make([]DirEntry, 0, len(entries))
	for _, entry := range entries {
		info, infoErr := entry.Info()
		if infoErr != nil {
			continue
		}
		kind := "file"
		if entry.IsDir() {
			kind = "dir"
		}
		result = append(result, DirEntry{
			Name:  entry.Name(),
			Path:  filepath.Join(path, entry.Name()),
			Kind:  kind,
			Size:  info.Size(),
			Mtime: info.ModTime().UnixMilli(),
		})
	}
	return result, nil
}

func embedMimeForPath(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".glb":
		return "model/gltf-binary"
	case ".gltf":
		return "model/gltf+json"
	case ".mp4", ".m4v", ".f4v":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	case ".ogv", ".ogg":
		return "video/ogg"
	case ".mov", ".qt":
		return "video/quicktime"
	case ".mkv":
		return "video/x-matroska"
	case ".avi", ".divx", ".xvid":
		return "video/x-msvideo"
	case ".wmv":
		return "video/x-ms-wmv"
	case ".asf":
		return "video/x-ms-asf"
	case ".flv":
		return "video/x-flv"
	case ".ts", ".mts", ".m2ts":
		return "video/mp2t"
	case ".3gp":
		return "video/3gpp"
	case ".3g2":
		return "video/3gpp2"
	case ".rm":
		return "application/vnd.rn-realmedia"
	case ".rmvb":
		return "application/vnd.rn-realmedia-vbr"
	default:
		return "application/octet-stream"
	}
}

// ReadBase64 reads a binary file as a full data: URL — companion to
// ReadFile (text-only), used by embeds (3D model / video).
func (s *HostService) ReadBase64(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return "data:" + embedMimeForPath(path) + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

// GetPath resolves a well-known app directory ('plugins' creates
// ~/.markup/plugins on demand; 'pluginsLocal' resolves plugins/ next to the
// executable and is never created). Returns nil (JSON null) for unknown names.
func (s *HostService) GetPath(name string) (*string, error) {
	var dir string
	ensure := false
	switch name {
	case "plugins":
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, err
		}
		dir = filepath.Join(home, ".markup", "plugins")
		ensure = true
	case "pluginsLocal":
		exe, err := os.Executable()
		if err != nil {
			return nil, err
		}
		dir = filepath.Join(filepath.Dir(exe), "plugins")
	case "userData":
		base, err := os.UserConfigDir()
		if err != nil {
			return nil, err
		}
		dir = filepath.Join(base, "markup")
		ensure = true
	default:
		return nil, nil
	}
	if ensure {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
	}
	return &dir, nil
}

func (s *HostService) GetConfig() (*AppConfig, error) {
	file, err := configFilePath()
	if err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		return defaultConfig(), nil
	}
	cfg := defaultConfig()
	if jsonErr := json.Unmarshal(raw, cfg); jsonErr != nil {
		return defaultConfig(), nil
	}
	return cfg, nil
}

func (s *HostService) SetConfig(cfg *AppConfig) error {
	file, err := configFilePath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(file, raw, 0o644)
}

func (s *HostService) OpenExternal(url string) error {
	return nil
}

func (s *HostService) OpenFileDialog(options map[string]any) ([]PathInfo, error) {
	// Prefer frontend @wailsio/runtime Dialog; Go path kept as fallback error.
	_ = options
	return nil, errNotImplemented("OpenFileDialog")
}

func (s *HostService) SaveFileDialog(options map[string]any) (*PathInfo, error) {
	_ = options
	return nil, errNotImplemented("SaveFileDialog")
}

func errNotImplemented(name string) error {
	return errors.New(name + " not implemented")
}

// ---- directory watching (hot reload for the plugin folder) ----
// Polling implementation — no fsnotify dependency. The renderer debounces
// fs-changed payloads, so per-tick diffs are fine. Reference-counted: the
// poller stops when every subscriber has unwatched.

type fileSig struct {
	mod   int64
	size  int64
	isDir bool
}

type dirWatch struct {
	refs int
	stop chan struct{}
}

var (
	watchMu    sync.Mutex
	dirWatches = map[string]*dirWatch{}
	// SetEventEmitter injects main()'s window emitter — sends "host-event" {event, payload}.
	emitHostEvent func(event string, payload any)
)

func SetEventEmitter(fn func(event string, payload any)) {
	emitHostEvent = fn
}

// Watch starts (or joins) a polling watcher for path.
func (s *HostService) Watch(path string) error {
	watchMu.Lock()
	defer watchMu.Unlock()
	if w, ok := dirWatches[path]; ok {
		w.refs++
		return nil
	}
	w := &dirWatch{refs: 1, stop: make(chan struct{})}
	dirWatches[path] = w
	go pollDir(path, w)
	return nil
}

// Unwatch drops one reference; the poller stops on the last one.
func (s *HostService) Unwatch(path string) {
	watchMu.Lock()
	defer watchMu.Unlock()
	w, ok := dirWatches[path]
	if !ok {
		return
	}
	w.refs--
	if w.refs <= 0 {
		delete(dirWatches, path)
		close(w.stop)
	}
}

func snapshotDir(root string) map[string]fileSig {
	sigs := make(map[string]fileSig)
	_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d == nil {
			return nil // unreadable entry — skip without aborting the walk
		}
		info, ierr := d.Info()
		if ierr != nil {
			return nil
		}
		sigs[p] = fileSig{mod: info.ModTime().UnixNano(), size: info.Size(), isDir: d.IsDir()}
		return nil
	})
	return sigs
}

func pollDir(path string, w *dirWatch) {
	ticker := time.NewTicker(800 * time.Millisecond)
	defer ticker.Stop()
	var prev map[string]fileSig
	for {
		select {
		case <-w.stop:
			return
		case <-ticker.C:
			cur := snapshotDir(path)
			if prev == nil {
				prev = cur // baseline — first tick is silent
				continue
			}
			emitDirDiff(prev, cur)
			prev = cur
		}
	}
}

func emitDirDiff(prev, cur map[string]fileSig) {
	if emitHostEvent == nil {
		return
	}
	send := func(kind, p string) {
		emitHostEvent("fs-changed", FsEvent{Kind: kind, Path: p})
	}
	for p, sig := range cur {
		old, ok := prev[p]
		if !ok {
			send("create", p)
		} else if old != sig {
			send("change", p)
		}
	}
	for p := range prev {
		if _, ok := cur[p]; !ok {
			send("remove", p)
		}
	}
}