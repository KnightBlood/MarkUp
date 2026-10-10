//! Document conversion for 导入文档 / 导出为….
//!
//! Markup never bundles a converter. This module is process plumbing only —
//! pick a program, pass the four flags pandoc and carta both accept, feed it,
//! and surface the program's own stderr when it refuses.
//!
//! Two facts here were measured against pandoc 3.12.1 rather than assumed:
//!
//! * pandoc refuses to write docx/odt/epub to a terminal unless `-o -` is
//!   given, so export always passes `-o <path>` and lets the host own the
//!   file. Import reads text back off stdout, where writing is fine.
//! * `--extract-media` emits absolute paths for an absolute directory and
//!   relative ones for a relative directory resolved against `cwd`. Import
//!   therefore passes a relative `mediaDir` with `cwd` set to the source
//!   file's folder, so the markdown keeps portable `<name>_files/...` links.

use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

/// Tried in order when 设置 ▸ 编辑 ▸ 文档转换 has no path of its own.
const PATH_CANDIDATES: [&str; 2] = ["pandoc", "carta"];

const PROBE_TIMEOUT: Duration = Duration::from_secs(15);
const CONVERT_TIMEOUT: Duration = Duration::from_secs(5 * 60);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConverterInfo {
    pub path: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertRequest {
    pub from: String,
    pub to: String,
    #[serde(default)]
    pub input_path: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub output_path: Option<String>,
    #[serde(default)]
    pub media_dir: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    pub program: String,
}

/// The two programs are told apart by their own banner, never by their name.
fn kind_of(version_line: &str) -> String {
    if version_line.to_lowercase().contains("carta") {
        "carta".into()
    } else {
        "pandoc".into()
    }
}

/// `--version` is the probe: it validates a hand-typed path and a PATH lookup
/// alike, for the cost of one short-lived process.
fn probe(program: &str) -> Option<String> {
    let mut child = Command::new(program)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let deadline = Instant::now() + PROBE_TIMEOUT;
    let output = loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                break child.stdout.take().and_then(|mut pipe| {
                    let mut buffer = String::new();
                    pipe.read_to_string(&mut buffer).ok()?;
                    buffer.lines().next().map(|line| line.trim().to_string())
                })
            }
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(_) => return None,
        }
    }?;

    if output.is_empty() {
        None
    } else {
        Some(output)
    }
}

/// Locate the converter. A path from 设置 ▸ 编辑 ▸ 文档转换 is authoritative: if it does
/// not run, this returns `None` instead of silently swapping in some other
/// program, so a typo can never make Markup convert with the wrong tool.
pub fn resolve_converter(configured: Option<&str>) -> Option<ConverterInfo> {
    if let Some(custom) = configured.map(str::trim).filter(|value| !value.is_empty()) {
        let version = probe(custom)?;
        return Some(ConverterInfo {
            path: custom.to_string(),
            kind: kind_of(&version),
            version: Some(version),
        });
    }
    for program in PATH_CANDIDATES {
        if let Some(version) = probe(program) {
            return Some(ConverterInfo {
                path: program.to_string(),
                kind: kind_of(&version),
                version: Some(version),
            });
        }
    }
    None
}

/// The document's own folder, so relative image references resolve from it.
fn parent_dir(path: &str) -> Option<String> {
    Path::new(path)
        .parent()
        .map(|parent| parent.to_string_lossy().into_owned())
        .filter(|parent| !parent.is_empty())
}

/// Run the converter once, returning stdout as raw bytes — the export
/// direction carries a zip, so decoding to text would corrupt it.
///
/// stdout and stderr are drained on their own threads: both binaries can fill
/// a 64 KB pipe buffer while still running, and waiting on the child before
/// reading them would deadlock on anything but a trivial document.
fn run(
    program: &str,
    args: &[String],
    cwd: Option<&str>,
    stdin_text: Option<&str>,
) -> Result<Vec<u8>, String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if stdin_text.is_some() {
        command.stdin(Stdio::piped());
    } else {
        command.stdin(Stdio::null());
    }
    if let Some(dir) = cwd {
        command.current_dir(dir);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("启动 {program} 失败：{error}"))?;

    let mut stdout_pipe = child.stdout.take();
    let mut stderr_pipe = child.stderr.take();
    let mut stdin_pipe = child.stdin.take();

    let stdout_reader = thread::spawn(move || {
        let mut buffer = Vec::new();
        if let Some(pipe) = stdout_pipe.as_mut() {
            let _ = pipe.read_to_end(&mut buffer);
        }
        buffer
    });
    let stderr_reader = thread::spawn(move || {
        let mut buffer = Vec::new();
        if let Some(pipe) = stderr_pipe.as_mut() {
            let _ = pipe.read_to_end(&mut buffer);
        }
        buffer
    });

    if let (Some(text), Some(pipe)) = (stdin_text, stdin_pipe.as_mut()) {
        let _ = pipe.write_all(text.as_bytes());
    }
    drop(stdin_pipe);

    let deadline = Instant::now() + CONVERT_TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "转换超时（{} 秒）：{program}",
                    CONVERT_TIMEOUT.as_secs()
                ));
            }
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(error) => return Err(error.to_string()),
        }
    };

    let stdout = stdout_reader.join().unwrap_or_default();
    let stderr = stderr_reader.join().unwrap_or_default();

    if !status.success() {
        let detail = String::from_utf8_lossy(&stderr).trim().to_string();
        return Err(if detail.is_empty() {
            format!("{program} 退出码 {}", status.code().unwrap_or(-1))
        } else {
            detail
        });
    }
    Ok(stdout)
}

pub fn convert(configured: Option<&str>, request: ConvertRequest) -> Result<ConvertResult, String> {
    let info = resolve_converter(configured).ok_or_else(|| {
        "没有找到 pandoc 或 carta —— 请在 设置 ▸ 编辑 ▸ 文档转换 里填写它的路径。".to_string()
    })?;

    let mut args: Vec<String> = vec!["-f".into(), request.from, "-t".into(), request.to];

    if let Some(input_path) = request.input_path {
        let cwd = request.cwd.or_else(|| parent_dir(&input_path));
        if let Some(media_dir) = request.media_dir {
            args.push(format!("--extract-media={media_dir}"));
        }
        args.push(input_path);
        let stdout = run(&info.path, &args, cwd.as_deref(), None)?;
        return Ok(ConvertResult {
            text: Some(String::from_utf8_lossy(&stdout).into_owned()),
            output_path: None,
            program: info.path,
        });
    }

    let output_path = request
        .output_path
        .ok_or_else(|| "convert: 需要 inputPath 或 outputPath".to_string())?;
    let cwd = request.cwd.or_else(|| parent_dir(&output_path));
    args.push("-o".into());
    args.push(output_path.clone());
    run(&info.path, &args, cwd.as_deref(), request.text.as_deref())?;
    Ok(ConvertResult {
        text: None,
        output_path: Some(output_path),
        program: info.path,
    })
}
