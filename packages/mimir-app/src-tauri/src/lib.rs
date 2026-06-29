use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MimirCommandRequest {
    project_root: String,
    command: MimirCommandKind,
    query: Option<String>,
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

    let cli_bin = std::env::var("MIMIR_CLI_BIN").unwrap_or_else(|_| "mimir".into());
    let args = mimir_args(&request, project_root)?;
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
            args.extend(["models".into(), "pull".into(), "--json".into()]);
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
