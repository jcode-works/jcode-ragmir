use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RagmirCommandRequest {
    project_root: String,
    command: RagmirCommandKind,
    query: Option<String>,
    text: Option<String>,
    rebuild: Option<bool>,
    top_k: Option<u16>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum RagmirCommandKind {
    Doctor,
    DoctorFix,
    Status,
    Ingest,
    Search,
    Ask,
    SecurityAudit,
    AuditUnsupported,
    ModelsPull,
    AudioDoctor,
    AudioPreload,
    AudioSummary,
    Chat,
    ChatSetup,
    ChatDoctor,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RagmirCommandOutput {
    status: i32,
    stdout: String,
    stderr: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RagmirProjectRequest {
    project_root: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RagmirConfigWriteRequest {
    project_root: String,
    content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RagmirConfigFile {
    exists: bool,
    config_path: String,
    content: String,
}

struct RagmirCliInvocation {
    program: String,
    args_prefix: Vec<String>,
}

#[tauri::command]
async fn run_ragmir_command(request: RagmirCommandRequest) -> Result<RagmirCommandOutput, String> {
    tauri::async_runtime::spawn_blocking(move || run_ragmir_command_blocking(request))
        .await
        .map_err(|error| format!("Unable to join Ragmir CLI task: {error}"))?
}

fn run_ragmir_command_blocking(
    request: RagmirCommandRequest,
) -> Result<RagmirCommandOutput, String> {
    let project_root = normalized_project_root(&request.project_root)?;

    let cli = resolve_ragmir_cli();
    let args = ragmir_args(&request, &project_root)?;
    let output = Command::new(&cli.program)
        .args(cli.args_prefix)
        .args(args)
        .output()
        .map_err(|error| format!("Unable to run Ragmir CLI: {error}"))?;

    Ok(RagmirCommandOutput {
        status: output.status.code().unwrap_or(1),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

fn resolve_ragmir_cli() -> RagmirCliInvocation {
    if let Ok(cli_bin) = std::env::var("RAGMIR_CLI_BIN") {
        let cli_path = PathBuf::from(&cli_bin);
        if cli_path
            .extension()
            .and_then(|extension| extension.to_str())
            == Some("js")
        {
            return RagmirCliInvocation {
                program: std::env::var("RAGMIR_NODE_BIN").unwrap_or_else(|_| "node".into()),
                args_prefix: vec![cli_bin],
            };
        }

        return RagmirCliInvocation {
            program: cli_bin,
            args_prefix: Vec::new(),
        };
    }

    if let Some(local_cli) = find_local_workspace_cli() {
        return RagmirCliInvocation {
            program: std::env::var("RAGMIR_NODE_BIN").unwrap_or_else(|_| "node".into()),
            args_prefix: vec![local_cli.to_string_lossy().into_owned()],
        };
    }

    RagmirCliInvocation {
        program: "rgr".into(),
        args_prefix: Vec::new(),
    }
}

fn find_local_workspace_cli() -> Option<PathBuf> {
    let current_dir = std::env::current_dir().ok()?;
    find_local_workspace_cli_from(&current_dir)
}

fn find_local_workspace_cli_from(start: &Path) -> Option<PathBuf> {
    for ancestor in start.ancestors() {
        let candidate = ancestor
            .join("packages")
            .join("ragmir-core")
            .join("dist")
            .join("cli.js");
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    None
}

#[tauri::command]
fn read_ragmir_config(request: RagmirProjectRequest) -> Result<RagmirConfigFile, String> {
    let project_root = normalized_project_root(&request.project_root)?;
    let config_path = ragmir_config_path(&project_root);
    let exists = config_path.is_file();
    let content = if exists {
        fs::read_to_string(&config_path)
            .map_err(|error| format!("Unable to read Ragmir config: {error}"))?
    } else {
        "{}\n".into()
    };

    Ok(RagmirConfigFile {
        exists,
        config_path: config_path.to_string_lossy().into_owned(),
        content,
    })
}

#[tauri::command]
fn write_ragmir_config(request: RagmirConfigWriteRequest) -> Result<RagmirConfigFile, String> {
    let project_root = normalized_project_root(&request.project_root)?;
    let parsed: Value = serde_json::from_str(&request.content)
        .map_err(|error| format!("Config must be valid JSON: {error}"))?;
    if !parsed.is_object() {
        return Err("Config must be a JSON object.".into());
    }

    let config_path = ragmir_config_path(&project_root);
    let config_dir = config_path
        .parent()
        .ok_or_else(|| "Unable to resolve Ragmir config directory.".to_string())?;
    fs::create_dir_all(config_dir)
        .map_err(|error| format!("Unable to create Ragmir config directory: {error}"))?;
    ensure_ragmir_gitignore(Path::new(&project_root))?;

    let content = format!(
        "{}\n",
        serde_json::to_string_pretty(&parsed)
            .map_err(|error| format!("Unable to format Ragmir config: {error}"))?
    );
    fs::write(&config_path, &content)
        .map_err(|error| format!("Unable to write Ragmir config: {error}"))?;

    Ok(RagmirConfigFile {
        exists: true,
        config_path: config_path.to_string_lossy().into_owned(),
        content,
    })
}

fn normalized_project_root(project_root: &str) -> Result<String, String> {
    let project_root = project_root.trim();
    if project_root.is_empty() {
        return Err("Project root is required.".into());
    }
    let project_root_path = PathBuf::from(project_root);
    if !project_root_path.is_absolute() {
        return Err("Project root must be an absolute path.".into());
    }
    if !project_root_path.is_dir() {
        return Err("Project root must be an existing directory.".into());
    }
    Ok(project_root_path.to_string_lossy().into_owned())
}

fn ragmir_config_path(project_root: &str) -> PathBuf {
    PathBuf::from(project_root)
        .join(".ragmir")
        .join("config.json")
}

fn ensure_ragmir_gitignore(project_root: &Path) -> Result<(), String> {
    let gitignore_path = project_root.join(".gitignore");
    let existing = match fs::read_to_string(&gitignore_path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(format!("Unable to read .gitignore: {error}")),
    };

    if existing.lines().any(|line| line.trim() == ".ragmir/") {
        return Ok(());
    }

    let mut next = existing;
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    next.push_str(".ragmir/\n");
    fs::write(&gitignore_path, next)
        .map_err(|error| format!("Unable to update .gitignore: {error}"))
}

fn ragmir_args(request: &RagmirCommandRequest, project_root: &str) -> Result<Vec<String>, String> {
    let mut args = vec!["--project-root".into(), project_root.into()];

    match request.command {
        RagmirCommandKind::Doctor => args.extend(["doctor".into(), "--json".into()]),
        RagmirCommandKind::DoctorFix => {
            args.extend(["doctor".into(), "--fix".into(), "--json".into()])
        }
        RagmirCommandKind::Status => args.extend(["status".into(), "--json".into()]),
        RagmirCommandKind::Ingest => {
            args.extend(["ingest".into(), "--json".into()]);
            if request.rebuild.unwrap_or(false) {
                args.push("--rebuild".into());
            }
        }
        RagmirCommandKind::Search => {
            let query = required_query(request)?;
            args.extend(["search".into(), query, "--json".into()]);
            push_top_k(&mut args, request.top_k);
        }
        RagmirCommandKind::Ask => {
            let query = required_query(request)?;
            args.extend(["ask".into(), query, "--json".into()]);
            push_top_k(&mut args, request.top_k);
        }
        RagmirCommandKind::SecurityAudit => {
            args.extend(["security-audit".into(), "--json".into()]);
        }
        RagmirCommandKind::AuditUnsupported => {
            args.extend(["audit".into(), "--unsupported".into(), "--json".into()]);
        }
        RagmirCommandKind::ModelsPull => {
            args.extend([
                "models".into(),
                "pull".into(),
                "--enable".into(),
                "--json".into(),
            ]);
        }
        RagmirCommandKind::AudioDoctor => {
            args.extend(["audio".into(), "--doctor".into(), "--json".into()]);
        }
        RagmirCommandKind::AudioPreload => {
            let text_file = write_audio_preload_text(request, project_root)?;
            args.extend([
                "audio".into(),
                text_file,
                "--engine".into(),
                "transformers".into(),
                "--allow-remote-models".into(),
                "--json".into(),
            ]);
        }
        RagmirCommandKind::AudioSummary => {
            let text_file = write_audio_summary_text(request, project_root)?;
            args.extend([
                "audio".into(),
                text_file,
                "--offline".into(),
                "--json".into(),
            ]);
        }
        RagmirCommandKind::Chat => {
            let query = required_query(request)?;
            args.extend(["chat".into(), query, "--offline".into(), "--json".into()]);
            push_top_k(&mut args, request.top_k);
        }
        RagmirCommandKind::ChatSetup => {
            args.extend([
                "chat".into(),
                "setup".into(),
                "--allow-remote-models".into(),
                "--json".into(),
            ]);
        }
        RagmirCommandKind::ChatDoctor => {
            args.extend(["chat".into(), "doctor".into(), "--json".into()]);
        }
    }

    Ok(args)
}

fn required_query(request: &RagmirCommandRequest) -> Result<String, String> {
    let query = request.query.as_deref().unwrap_or("").trim();
    if query.is_empty() {
        return Err("Query is required.".into());
    }
    Ok(query.into())
}

fn required_text(request: &RagmirCommandRequest) -> Result<String, String> {
    let text = request.text.as_deref().unwrap_or("").trim();
    if text.is_empty() {
        return Err("Audio text is required.".into());
    }
    Ok(text.into())
}

fn write_audio_summary_text(
    request: &RagmirCommandRequest,
    project_root: &str,
) -> Result<String, String> {
    let text = required_text(request)?;
    let audio_dir = PathBuf::from(project_root).join(".ragmir").join("audio");
    fs::create_dir_all(&audio_dir)
        .map_err(|error| format!("Unable to prepare audio dir: {error}"))?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Unable to create audio timestamp: {error}"))?
        .as_secs();
    let text_file = audio_dir.join(format!("retrieval-report-{timestamp}.txt"));
    fs::write(&text_file, text).map_err(|error| format!("Unable to write audio text: {error}"))?;
    Ok(text_file.to_string_lossy().into_owned())
}

fn write_audio_preload_text(
    request: &RagmirCommandRequest,
    project_root: &str,
) -> Result<String, String> {
    let text = required_text(request)?;
    let audio_dir = PathBuf::from(project_root).join(".ragmir").join("audio");
    fs::create_dir_all(&audio_dir)
        .map_err(|error| format!("Unable to prepare audio dir: {error}"))?;

    let text_file = audio_dir.join("tts-preload.txt");
    fs::write(&text_file, text).map_err(|error| format!("Unable to write audio text: {error}"))?;
    Ok(text_file.to_string_lossy().into_owned())
}

fn push_top_k(args: &mut Vec<String>, top_k: Option<u16>) {
    if let Some(top_k) = top_k {
        args.extend(["--top-k".into(), top_k.to_string()]);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            run_ragmir_command,
            read_ragmir_config,
            write_ragmir_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ragmir")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_setup_explicitly_allows_remote_model_preload() {
        let request = command_request(RagmirCommandKind::ChatSetup);

        let args = ragmir_args(&request, "/tmp/ragmir-project").expect("chat setup args");

        assert_eq!(
            args,
            vec![
                "--project-root",
                "/tmp/ragmir-project",
                "chat",
                "setup",
                "--allow-remote-models",
                "--json"
            ]
        );
    }

    #[test]
    fn audio_preload_writes_non_sensitive_text_and_allows_remote_model_preload() {
        let project_root = unique_test_dir("audio-preload");
        let request = RagmirCommandRequest {
            project_root: project_root.to_string_lossy().into_owned(),
            command: RagmirCommandKind::AudioPreload,
            query: None,
            text: Some("Ragmir offline audio model preload.".into()),
            rebuild: None,
            top_k: None,
        };

        let args = ragmir_args(&request, project_root.to_str().expect("project root"))
            .expect("audio preload args");

        let text_file = project_root
            .join(".ragmir")
            .join("audio")
            .join("tts-preload.txt");
        assert_eq!(
            fs::read_to_string(&text_file).expect("preload text"),
            "Ragmir offline audio model preload."
        );
        assert_eq!(
            args,
            vec![
                "--project-root",
                project_root.to_str().expect("project root"),
                "audio",
                text_file.to_str().expect("text file"),
                "--engine",
                "transformers",
                "--allow-remote-models",
                "--json"
            ]
        );

        fs::remove_dir_all(project_root).expect("cleanup");
    }

    #[test]
    fn finds_local_workspace_cli_from_nested_tauri_directory() {
        let repo_root = unique_test_dir("workspace-cli");
        let cli_path = repo_root
            .join("packages")
            .join("ragmir-core")
            .join("dist")
            .join("cli.js");
        fs::create_dir_all(cli_path.parent().expect("cli parent")).expect("cli parent dir");
        fs::write(&cli_path, "#!/usr/bin/env node\n").expect("cli file");
        let nested_tauri_dir = repo_root
            .join("packages")
            .join("ragmir-app")
            .join("src-tauri");
        fs::create_dir_all(&nested_tauri_dir).expect("nested tauri dir");

        assert_eq!(
            find_local_workspace_cli_from(&nested_tauri_dir),
            Some(cli_path)
        );

        fs::remove_dir_all(repo_root).expect("cleanup");
    }

    fn command_request(command: RagmirCommandKind) -> RagmirCommandRequest {
        RagmirCommandRequest {
            project_root: "/tmp/ragmir-project".into(),
            command,
            query: None,
            text: None,
            rebuild: None,
            top_k: None,
        }
    }

    fn unique_test_dir(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("ragmir-app-{label}-{nonce}"));
        fs::create_dir_all(&dir).expect("test dir");
        dir
    }
}
