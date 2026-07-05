use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
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
    AudioSummary,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RagmirCommandOutput {
    status: i32,
    stdout: String,
    stderr: String,
}

#[tauri::command]
fn run_ragmir_command(request: RagmirCommandRequest) -> Result<RagmirCommandOutput, String> {
    let project_root = request.project_root.trim();
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
    let project_root = project_root_path.to_string_lossy().into_owned();

    let cli_bin = std::env::var("RAGMIR_CLI_BIN").unwrap_or_else(|_| "rgr".into());
    let args = ragmir_args(&request, &project_root)?;
    let output = Command::new(cli_bin)
        .args(args)
        .output()
        .map_err(|error| format!("Unable to run Ragmir CLI: {error}"))?;

    Ok(RagmirCommandOutput {
        status: output.status.code().unwrap_or(1),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
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
        RagmirCommandKind::AudioSummary => {
            let text_file = write_audio_summary_text(request, project_root)?;
            args.extend(["audio".into(), text_file, "--offline".into(), "--json".into()]);
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

fn push_top_k(args: &mut Vec<String>, top_k: Option<u16>) {
    if let Some(top_k) = top_k {
        args.extend(["--top-k".into(), top_k.to_string()]);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![run_ragmir_command])
        .run(tauri::generate_context!())
        .expect("error while running Ragmir")
}
