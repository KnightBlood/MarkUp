package services

// Document conversion for 导入文档 / 导出为….
//
// Markup never bundles a converter: this file picks a program and passes the
// four flags pandoc and carta both accept. The renderer names formats only.
//
// Two facts here were measured against pandoc 3.12.1 rather than assumed:
//
//   - pandoc refuses to write docx/odt/epub to a terminal unless `-o -` is
//     given, so export always passes `-o <path>` and lets the host own the
//     file. Import reads text back off stdout, where writing is fine.
//   - `--extract-media` emits absolute paths for an absolute directory and
//     relative ones for a relative directory resolved against `cwd`. Import
//     therefore passes a relative mediaDir with cwd set to the source file's
//     folder, so the markdown keeps portable `<name>_files/...` links.

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Tried in order when 设置 ▸ 编辑 ▸ 文档转换 has no path of its own.
var converterCandidates = []string{"pandoc", "carta"}

const (
	probeTimeout   = 15 * time.Second
	convertTimeout = 5 * time.Minute
)

type ConverterInfo struct {
	Path    string `json:"path"`
	Kind    string `json:"kind"`
	Version string `json:"version,omitempty"`
}

type ConvertRequest struct {
	From string `json:"from"`
	To   string `json:"to"`
	// InputPath and Text are mutually exclusive: a file in means markdown
	// text comes back, text in means a file is written.
	InputPath  string `json:"inputPath,omitempty"`
	Text       string `json:"text,omitempty"`
	OutputPath string `json:"outputPath,omitempty"`
	MediaDir   string `json:"mediaDir,omitempty"`
	Cwd        string `json:"cwd,omitempty"`
}

type ConvertResult struct {
	Text       string `json:"text,omitempty"`
	OutputPath string `json:"outputPath,omitempty"`
	Program    string `json:"program"`
}

// The two programs are told apart by their own banner, never by their name.
func kindOf(version string) string {
	if strings.Contains(strings.ToLower(version), "carta") {
		return "carta"
	}
	return "pandoc"
}

// --version is the probe: it validates a hand-typed path and a PATH lookup
// alike, for the cost of one short-lived process.
func probeConverter(program string) (string, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), probeTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, program, "--version").Output()
	if err != nil {
		return "", false
	}
	line := strings.TrimSpace(strings.SplitN(string(out), "\n", 2)[0])
	if line == "" {
		return "", false
	}
	return line, true
}

// resolveConverter locates the converter. A path from 设置 ▸ 编辑 ▸ 文档转换 is
// authoritative: if it does not run, this returns nil instead of silently
// swapping in some other program, so a typo can never make Markup convert
// with the wrong tool.
func resolveConverter(configured string) *ConverterInfo {
	if custom := strings.TrimSpace(configured); custom != "" {
		version, ok := probeConverter(custom)
		if !ok {
			return nil
		}
		return &ConverterInfo{Path: custom, Kind: kindOf(version), Version: version}
	}
	for _, program := range converterCandidates {
		if version, ok := probeConverter(program); ok {
			return &ConverterInfo{Path: program, Kind: kindOf(version), Version: version}
		}
	}
	return nil
}

// runConverter returns stdout as raw bytes — the export direction carries a
// zip, so decoding to text would corrupt it. Go's exec.Cmd drains stdout and
// stderr on their own goroutines, which is what keeps a document larger than
// the 64 KB pipe buffer from deadlocking the child.
func runConverter(program string, args []string, cwd, stdinText string, useStdin bool) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), convertTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, program, args...)
	if cwd != "" {
		cmd.Dir = cwd
	}
	if useStdin {
		cmd.Stdin = strings.NewReader(stdinText)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return nil, fmt.Errorf("转换超时（%s）：%s", convertTimeout, program)
	}
	if err != nil {
		detail := strings.TrimSpace(stderr.String())
		if detail == "" {
			detail = fmt.Sprintf("%s 退出码：%v", program, err)
		}
		return nil, errors.New(detail)
	}
	return stdout.Bytes(), nil
}

func (s *HostService) configuredConverterPath() string {
	cfg, err := s.GetConfig()
	if err != nil || cfg == nil || cfg.ConverterPath == nil {
		return ""
	}
	return *cfg.ConverterPath
}

// ConverterInfo backs host.app.converter(): null means no converter is
// configured yet, which is the normal first-run state and not an error.
func (s *HostService) ConverterInfo() (*ConverterInfo, error) {
	return resolveConverter(s.configuredConverterPath()), nil
}

// ConvertDocument backs host.app.convert().
func (s *HostService) ConvertDocument(request ConvertRequest) (*ConvertResult, error) {
	info := resolveConverter(s.configuredConverterPath())
	if info == nil {
		return nil, errors.New("没有找到 pandoc 或 carta —— 请在 设置 ▸ 编辑 ▸ 文档转换 里填写它的路径。")
	}

	args := []string{"-f", request.From, "-t", request.To}

	if request.InputPath != "" {
		cwd := request.Cwd
		if cwd == "" {
			cwd = filepath.Dir(request.InputPath)
		}
		if request.MediaDir != "" {
			args = append(args, "--extract-media="+request.MediaDir)
		}
		args = append(args, request.InputPath)
		out, err := runConverter(info.Path, args, cwd, "", false)
		if err != nil {
			return nil, err
		}
		return &ConvertResult{Text: string(out), Program: info.Path}, nil
	}

	if request.OutputPath == "" {
		return nil, errors.New("convert: 需要 inputPath 或 outputPath")
	}
	cwd := request.Cwd
	if cwd == "" {
		cwd = filepath.Dir(request.OutputPath)
	}
	args = append(args, "-o", request.OutputPath)
	if _, err := runConverter(info.Path, args, cwd, request.Text, true); err != nil {
		return nil, err
	}
	return &ConvertResult{OutputPath: request.OutputPath, Program: info.Path}, nil
}
