use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MimirCommandRequest {
    project_root: String,
    command: MimirCommandKind,
    query: Option<String>,
    text: Option<String>,
    rebuild: Option<bool>,
    top_k: Option<u16>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum MimirCommandKind {
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
struct MimirCommandOutput {
    status: i32,
    stdout: String,
    stderr: String,
}

#[tauri::command]
fn run_mimir_command(request: MimirCommandRequest) -> Result<MimirCommandOutput, String> {
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

    let cli_bin = std::env::var("MIMIR_CLI_BIN").unwrap_or_else(|_| "mimir".into());
    let args = mimir_args(&request, &project_root)?;
    let output = Command::new(cli_bin)
        .args(args)
        .output()
        .map_err(|error| format!("Unable to run Mimir CLI: {error}"))?;

    Ok(MimirCommandOutput {
        status: output.status.code().unwrap_or(1),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

fn mimir_args(request: &MimirCommandRequest, project_root: &str) -> Result<Vec<String>, String> {
    let mut args = vec!["--project-root".into(), project_root.into()];

    match request.command {
        MimirCommandKind::Doctor => args.extend(["doctor".into(), "--json".into()]),
        MimirCommandKind::DoctorFix => {
            args.extend(["doctor".into(), "--fix".into(), "--json".into()])
        }
        MimirCommandKind::Status => args.extend(["status".into(), "--json".into()]),
        MimirCommandKind::Ingest => {
            args.extend(["ingest".into(), "--json".into()]);
            if request.rebuild.unwrap_or(false) {
                args.push("--rebuild".into());
            }
        }
        MimirCommandKind::Search => {
            let query = required_query(request)?;
            args.extend(["search".into(), query, "--json".into()]);
            push_top_k(&mut args, request.top_k);
        }
        MimirCommandKind::Ask => {
            let query = required_query(request)?;
            args.extend(["ask".into(), query, "--json".into()]);
            push_top_k(&mut args, request.top_k);
        }
        MimirCommandKind::SecurityAudit => {
            args.extend(["security-audit".into(), "--json".into()]);
        }
        MimirCommandKind::AuditUnsupported => {
            args.extend(["audit".into(), "--unsupported".into(), "--json".into()]);
        }
        MimirCommandKind::ModelsPull => {
            args.extend([
                "models".into(),
                "pull".into(),
                "--enable".into(),
                "--json".into(),
            ]);
        }
        MimirCommandKind::AudioSummary => {
            let text_file = write_audio_summary_text(request, project_root)?;
            args.extend(["audio".into(), text_file, "--offline".into(), "--json".into()]);
        }
    }

    Ok(args)
}

fn required_query(request: &MimirCommandRequest) -> Result<String, String> {
    let query = request.query.as_deref().unwrap_or("").trim();
    if query.is_empty() {
        return Err("Query is required.".into());
    }
    Ok(query.into())
}

fn required_text(request: &MimirCommandRequest) -> Result<String, String> {
    let text = request.text.as_deref().unwrap_or("").trim();
    if text.is_empty() {
        return Err("Audio text is required.".into());
    }
    Ok(text.into())
}

fn write_audio_summary_text(
    request: &MimirCommandRequest,
    project_root: &str,
) -> Result<String, String> {
    let text = required_text(request)?;
    let audio_dir = PathBuf::from(project_root).join(".mimir").join("audio");
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
        .invoke_handler(tauri::generate_handler![run_mimir_command])
        .run(tauri::generate_context!())
        .expect("error while running Mimir")
}
