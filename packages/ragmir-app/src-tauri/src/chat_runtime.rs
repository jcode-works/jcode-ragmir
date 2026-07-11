use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Channel, State};

#[cfg(test)]
use std::fs;

const CHAT_RUNTIME_ENV: &str = "RAGMIR_CHAT_CLI_BIN";
const CHAT_RUNTIME_COMMAND: &str = "rgr-chat";
const CHAT_RUNTIME_STDERR_LINES: usize = 20;
const CHAT_RUNTIME_SHUTDOWN_POLLS: usize = 20;
const CHAT_RUNTIME_SHUTDOWN_POLL_MS: u64 = 25;

type PendingChannels = Arc<Mutex<HashMap<String, Channel<Value>>>>;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatProfile {
    Lite,
    Fast,
    Quality,
}

impl ChatProfile {
    fn as_str(self) -> &'static str {
        match self {
            Self::Lite => "lite",
            Self::Fast => "fast",
            Self::Quality => "quality",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatThinkingMode {
    Off,
    Standard,
    Deep,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum ChatRole {
    User,
    Assistant,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatHistoryMessage {
    role: ChatRole,
    content: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSource {
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<String>,
    relative_path: String,
    chunk_index: u32,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    distance: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatGenerateRequest {
    project_root: String,
    id: String,
    question: String,
    history: Vec<ChatHistoryMessage>,
    sources: Vec<ChatSource>,
    profile: ChatProfile,
    thinking: ChatThinkingMode,
    max_new_tokens: Option<u32>,
    context_char_limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatCancelRequest {
    id: String,
    target_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatProfileRequest {
    project_root: String,
    profile: ChatProfile,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeGenerateMessage<'a> {
    id: &'a str,
    #[serde(rename = "type")]
    message_type: &'static str,
    question: &'a str,
    history: &'a [ChatHistoryMessage],
    sources: &'a [ChatSource],
    thinking: ChatThinkingMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_new_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    context_char_limit: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeCancelMessage<'a> {
    id: &'a str,
    #[serde(rename = "type")]
    message_type: &'static str,
    target_id: &'a str,
}

#[derive(Debug, Serialize)]
struct RuntimeShutdownMessage {
    id: String,
    #[serde(rename = "type")]
    message_type: &'static str,
}

#[derive(Clone, Debug, PartialEq)]
struct RuntimeIdentity {
    project_root: String,
    profile: ChatProfile,
}

#[derive(Clone)]
struct RuntimeWriter {
    identity: RuntimeIdentity,
    stdin: Arc<Mutex<ChildStdin>>,
}

struct RunningRuntime {
    identity: RuntimeIdentity,
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    healthy: Arc<AtomicBool>,
    reader_thread: Option<thread::JoinHandle<()>>,
}

struct ChatCliInvocation {
    program: String,
    args_prefix: Vec<String>,
}

pub struct RagmirChatRuntimeState {
    process: Arc<Mutex<Option<RunningRuntime>>>,
    writer: Arc<Mutex<Option<RuntimeWriter>>>,
    pending: PendingChannels,
}

impl Default for RagmirChatRuntimeState {
    fn default() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            writer: Arc::new(Mutex::new(None)),
            pending: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl Drop for RagmirChatRuntimeState {
    fn drop(&mut self) {
        if let Ok(mut process) = self.process.lock() {
            if let Some(runtime) = process.as_mut() {
                stop_runtime(runtime);
            }
        }
    }
}

#[tauri::command]
pub async fn generate_ragmir_chat(
    state: State<'_, RagmirChatRuntimeState>,
    request: ChatGenerateRequest,
    on_event: Channel<Value>,
) -> Result<(), String> {
    validate_generate_request(&request)?;
    let process = state.inner().process.clone();
    let writer = state.inner().writer.clone();
    let pending = Arc::clone(&state.inner().pending);

    tauri::async_runtime::spawn_blocking(move || {
        let runtime_writer = ensure_runtime(&process, &writer, &pending, &request)?;
        register_pending_channel(&pending, &request.id, on_event)?;
        let message = RuntimeGenerateMessage {
            id: &request.id,
            message_type: "generate",
            question: &request.question,
            history: &request.history,
            sources: &request.sources,
            thinking: request.thinking,
            max_new_tokens: request.max_new_tokens,
            context_char_limit: request.context_char_limit,
        };
        if let Err(error) = write_runtime_message(&runtime_writer.stdin, &message) {
            remove_pending_channel(&pending, &request.id);
            return Err(error);
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("Unable to join Ragmir Chat runtime task: {error}"))?
}

#[tauri::command]
pub async fn cancel_ragmir_chat(
    state: State<'_, RagmirChatRuntimeState>,
    request: ChatCancelRequest,
) -> Result<(), String> {
    require_non_empty(&request.id, "Cancel request id")?;
    require_non_empty(&request.target_id, "Target request id")?;
    let writer = current_writer(&state.inner().writer)?;
    let message = RuntimeCancelMessage {
        id: &request.id,
        message_type: "cancel",
        target_id: &request.target_id,
    };
    write_runtime_message(&writer.stdin, &message)
}

#[tauri::command]
pub async fn shutdown_ragmir_chat(state: State<'_, RagmirChatRuntimeState>) -> Result<(), String> {
    let mut process = state
        .inner()
        .process
        .lock()
        .map_err(|_| "Ragmir Chat process lock is poisoned.".to_string())?;
    if let Some(runtime) = process.as_mut() {
        stop_runtime(runtime);
    }
    *process = None;
    *state
        .inner()
        .writer
        .lock()
        .map_err(|_| "Ragmir Chat writer lock is poisoned.".to_string())? = None;
    fail_pending(
        &state.inner().pending,
        "RUNTIME_SHUTDOWN",
        "Ragmir Chat runtime stopped.",
    );
    Ok(())
}

#[tauri::command]
pub async fn setup_ragmir_chat(request: ChatProfileRequest) -> Result<Value, String> {
    run_profile_command(request, "setup").await
}

#[tauri::command]
pub async fn doctor_ragmir_chat(request: ChatProfileRequest) -> Result<Value, String> {
    run_profile_command(request, "doctor").await
}

async fn run_profile_command(
    request: ChatProfileRequest,
    command: &'static str,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let project_root = normalized_project_root(&request.project_root)?;
        let invocation = resolve_chat_cli();
        let output = Command::new(&invocation.program)
            .args(invocation.args_prefix)
            .args(profile_command_args(command, request.profile))
            .current_dir(project_root)
            .output()
            .map_err(|error| format!("Unable to run Ragmir Chat {command}: {error}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                format!(
                    "Ragmir Chat {command} exited with status {}.",
                    output.status
                )
            } else {
                stderr
            });
        }
        serde_json::from_slice(&output.stdout)
            .map_err(|error| format!("Ragmir Chat {command} returned invalid JSON: {error}"))
    })
    .await
    .map_err(|error| format!("Unable to join Ragmir Chat {command} task: {error}"))?
}

fn validate_generate_request(request: &ChatGenerateRequest) -> Result<(), String> {
    require_non_empty(&request.id, "Request id")?;
    require_non_empty(&request.question, "Question")?;
    normalized_project_root(&request.project_root)?;
    for message in &request.history {
        require_non_empty(&message.content, "History content")?;
    }
    for source in &request.sources {
        require_non_empty(&source.relative_path, "Source path")?;
        require_non_empty(&source.text, "Source text")?;
    }
    Ok(())
}

fn require_non_empty(value: &str, label: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{label} is required."));
    }
    Ok(())
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

fn ensure_runtime(
    process: &Mutex<Option<RunningRuntime>>,
    writer: &Mutex<Option<RuntimeWriter>>,
    pending: &PendingChannels,
    request: &ChatGenerateRequest,
) -> Result<RuntimeWriter, String> {
    let identity = RuntimeIdentity {
        project_root: normalized_project_root(&request.project_root)?,
        profile: request.profile,
    };
    let mut process_guard = process
        .lock()
        .map_err(|_| "Ragmir Chat process lock is poisoned.".to_string())?;

    if let Some(runtime) = process_guard.as_mut() {
        let exited = runtime
            .child
            .try_wait()
            .map_err(|error| format!("Unable to inspect Ragmir Chat runtime: {error}"))?
            .is_some();
        let unhealthy = !runtime.healthy.load(Ordering::Acquire);
        if exited || unhealthy {
            stop_runtime(runtime);
            *process_guard = None;
            *writer
                .lock()
                .map_err(|_| "Ragmir Chat writer lock is poisoned.".to_string())? = None;
        }
    }

    if let Some(runtime) = process_guard.as_mut() {
        if runtime.identity != identity {
            if has_pending_channels(pending)? {
                return Err(
                    "Cancel the active local answer before changing workspace or model profile."
                        .into(),
                );
            }
            stop_runtime(runtime);
            *process_guard = None;
            *writer
                .lock()
                .map_err(|_| "Ragmir Chat writer lock is poisoned.".to_string())? = None;
        }
    }

    if process_guard.is_none() {
        let runtime = spawn_runtime(identity.clone(), Arc::clone(pending))?;
        let runtime_writer = RuntimeWriter {
            identity: identity.clone(),
            stdin: Arc::clone(&runtime.stdin),
        };
        *writer
            .lock()
            .map_err(|_| "Ragmir Chat writer lock is poisoned.".to_string())? =
            Some(runtime_writer);
        *process_guard = Some(runtime);
    }

    let runtime_writer = writer
        .lock()
        .map_err(|_| "Ragmir Chat writer lock is poisoned.".to_string())?
        .clone()
        .ok_or_else(|| "Ragmir Chat runtime writer is unavailable.".to_string())?;
    if runtime_writer.identity != identity {
        return Err("Ragmir Chat runtime identity changed unexpectedly.".into());
    }
    Ok(runtime_writer)
}

fn spawn_runtime(
    identity: RuntimeIdentity,
    pending: PendingChannels,
) -> Result<RunningRuntime, String> {
    let invocation = resolve_chat_cli();
    let mut child = Command::new(&invocation.program)
        .args(invocation.args_prefix)
        .args(runtime_server_args(identity.profile))
        .current_dir(&identity.project_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Unable to start persistent Ragmir Chat runtime: {error}"))?;

    let stdin =
        Arc::new(Mutex::new(child.stdin.take().ok_or_else(|| {
            "Ragmir Chat runtime stdin is unavailable.".to_string()
        })?));
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Ragmir Chat runtime stdout is unavailable.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Ragmir Chat runtime stderr is unavailable.".to_string())?;
    let stderr_lines = Arc::new(Mutex::new(VecDeque::new()));
    let healthy = Arc::new(AtomicBool::new(true));

    spawn_stderr_reader(stderr, Arc::clone(&stderr_lines));
    let reader_thread = spawn_stdout_reader(stdout, pending, stderr_lines, Arc::clone(&healthy));

    Ok(RunningRuntime {
        identity,
        child,
        stdin,
        healthy,
        reader_thread: Some(reader_thread),
    })
}

fn spawn_stdout_reader(
    stdout: impl std::io::Read + Send + 'static,
    pending: PendingChannels,
    stderr_lines: Arc<Mutex<VecDeque<String>>>,
    healthy: Arc<AtomicBool>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let line = match line {
                Ok(line) => line,
                Err(error) => {
                    healthy.store(false, Ordering::Release);
                    fail_pending(
                        &pending,
                        "RUNTIME_IO",
                        &format!("Unable to read Ragmir Chat runtime output: {error}"),
                    );
                    return;
                }
            };
            if line.trim().is_empty() {
                continue;
            }
            let event: Value = match serde_json::from_str(&line) {
                Ok(event) => event,
                Err(_) => {
                    healthy.store(false, Ordering::Release);
                    fail_pending(
                        &pending,
                        "RUNTIME_PROTOCOL",
                        "Ragmir Chat runtime emitted invalid NDJSON.",
                    );
                    return;
                }
            };
            route_runtime_event(&pending, event);
        }

        healthy.store(false, Ordering::Release);
        let detail = stderr_summary(&stderr_lines);
        let message = if detail.is_empty() {
            "Ragmir Chat runtime closed before completing the active answer.".to_string()
        } else {
            format!("Ragmir Chat runtime closed: {detail}")
        };
        fail_pending(&pending, "RUNTIME_EXITED", &message);
    })
}

fn spawn_stderr_reader(
    stderr: impl std::io::Read + Send + 'static,
    lines: Arc<Mutex<VecDeque<String>>>,
) {
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Ok(mut stored_lines) = lines.lock() {
                stored_lines.push_back(line);
                while stored_lines.len() > CHAT_RUNTIME_STDERR_LINES {
                    stored_lines.pop_front();
                }
            }
        }
    });
}

fn route_runtime_event(pending: &PendingChannels, event: Value) {
    let Some(id) = event.get("id").and_then(Value::as_str) else {
        fail_pending(
            pending,
            "RUNTIME_PROTOCOL",
            "Ragmir Chat runtime emitted an event without an id.",
        );
        return;
    };
    let terminal = matches!(
        event.get("event").and_then(Value::as_str),
        Some("completed" | "cancelled" | "error")
    );
    let Ok(mut channels) = pending.lock() else {
        return;
    };
    if terminal {
        if let Some(channel) = channels.remove(id) {
            let _ = channel.send(event);
        }
    } else if let Some(channel) = channels.get(id) {
        let _ = channel.send(event);
    }
}

fn register_pending_channel(
    pending: &PendingChannels,
    request_id: &str,
    channel: Channel<Value>,
) -> Result<(), String> {
    let mut channels = pending
        .lock()
        .map_err(|_| "Ragmir Chat pending channel lock is poisoned.".to_string())?;
    if channels.contains_key(request_id) {
        return Err("A Ragmir Chat request with this id is already active.".into());
    }
    if !channels.is_empty() {
        return Err("Ragmir Chat is already generating an answer.".into());
    }
    channels.insert(request_id.into(), channel);
    Ok(())
}

fn remove_pending_channel(pending: &PendingChannels, request_id: &str) {
    if let Ok(mut channels) = pending.lock() {
        channels.remove(request_id);
    }
}

fn has_pending_channels(pending: &PendingChannels) -> Result<bool, String> {
    pending
        .lock()
        .map(|channels| !channels.is_empty())
        .map_err(|_| "Ragmir Chat pending channel lock is poisoned.".to_string())
}

fn fail_pending(pending: &PendingChannels, code: &str, message: &str) {
    let Ok(mut channels) = pending.lock() else {
        return;
    };
    for (id, channel) in channels.drain() {
        let _ = channel.send(json!({
            "id": id,
            "event": "error",
            "code": code,
            "message": message,
        }));
    }
}

fn current_writer(writer: &Mutex<Option<RuntimeWriter>>) -> Result<RuntimeWriter, String> {
    writer
        .lock()
        .map_err(|_| "Ragmir Chat writer lock is poisoned.".to_string())?
        .clone()
        .ok_or_else(|| "No persistent Ragmir Chat runtime is active.".to_string())
}

fn write_runtime_message<T: Serialize>(
    stdin: &Arc<Mutex<ChildStdin>>,
    message: &T,
) -> Result<(), String> {
    let mut stdin = stdin
        .lock()
        .map_err(|_| "Ragmir Chat stdin lock is poisoned.".to_string())?;
    serde_json::to_writer(&mut *stdin, message)
        .map_err(|error| format!("Unable to serialize Ragmir Chat request: {error}"))?;
    stdin
        .write_all(b"\n")
        .and_then(|_| stdin.flush())
        .map_err(|error| format!("Unable to write to Ragmir Chat runtime: {error}"))
}

fn stop_runtime(runtime: &mut RunningRuntime) {
    let _ = write_runtime_message(
        &runtime.stdin,
        &RuntimeShutdownMessage {
            id: runtime_control_id("shutdown"),
            message_type: "shutdown",
        },
    );
    let mut exited = false;
    for _ in 0..CHAT_RUNTIME_SHUTDOWN_POLLS {
        if matches!(runtime.child.try_wait(), Ok(Some(_))) {
            exited = true;
            break;
        }
        thread::sleep(Duration::from_millis(CHAT_RUNTIME_SHUTDOWN_POLL_MS));
    }
    if !exited {
        let _ = runtime.child.kill();
        let _ = runtime.child.wait();
    }
    if let Some(reader_thread) = runtime.reader_thread.take() {
        let _ = reader_thread.join();
    }
}

fn runtime_control_id(action: &str) -> String {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("app-{action}-{nonce}")
}

fn stderr_summary(lines: &Arc<Mutex<VecDeque<String>>>) -> String {
    lines
        .lock()
        .map(|lines| lines.iter().cloned().collect::<Vec<_>>().join(" "))
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn resolve_chat_cli() -> ChatCliInvocation {
    if let Ok(cli_bin) = std::env::var(CHAT_RUNTIME_ENV) {
        return invocation_from_path(cli_bin);
    }
    if let Some(local_cli) = find_local_workspace_chat_cli() {
        return invocation_from_path(local_cli.to_string_lossy().into_owned());
    }
    ChatCliInvocation {
        program: CHAT_RUNTIME_COMMAND.into(),
        args_prefix: Vec::new(),
    }
}

fn invocation_from_path(cli_bin: String) -> ChatCliInvocation {
    let cli_path = PathBuf::from(&cli_bin);
    if cli_path
        .extension()
        .and_then(|extension| extension.to_str())
        == Some("js")
    {
        return ChatCliInvocation {
            program: std::env::var("RAGMIR_NODE_BIN").unwrap_or_else(|_| "node".into()),
            args_prefix: vec![cli_bin],
        };
    }
    ChatCliInvocation {
        program: cli_bin,
        args_prefix: Vec::new(),
    }
}

fn find_local_workspace_chat_cli() -> Option<PathBuf> {
    let current_dir = std::env::current_dir().ok()?;
    find_local_workspace_chat_cli_from(&current_dir)
}

fn find_local_workspace_chat_cli_from(start: &Path) -> Option<PathBuf> {
    for ancestor in start.ancestors() {
        let candidate = ancestor
            .join("packages")
            .join("ragmir-chat")
            .join("dist")
            .join("cli.js");
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn runtime_server_args(profile: ChatProfile) -> Vec<&'static str> {
    vec!["serve", "--profile", profile.as_str(), "--offline"]
}

fn profile_command_args(command: &'static str, profile: ChatProfile) -> Vec<&'static str> {
    vec![command, "--profile", profile.as_str(), "--json"]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_message_keeps_history_sources_and_thinking_structured() {
        let history = vec![ChatHistoryMessage {
            role: ChatRole::User,
            content: "Earlier visible question".into(),
        }];
        let sources = vec![ChatSource {
            source: Some("docs/guide.md".into()),
            relative_path: "docs/guide.md".into(),
            chunk_index: 2,
            text: "Visible cited passage".into(),
            distance: Some(0.12),
        }];
        let message = RuntimeGenerateMessage {
            id: "request-1",
            message_type: "generate",
            question: "Latest question only",
            history: &history,
            sources: &sources,
            thinking: ChatThinkingMode::Standard,
            max_new_tokens: None,
            context_char_limit: None,
        };

        let value = serde_json::to_value(message).expect("generate request");

        assert_eq!(value["type"], "generate");
        assert_eq!(value["question"], "Latest question only");
        assert_eq!(value["history"][0]["content"], "Earlier visible question");
        assert_eq!(value["sources"][0]["relativePath"], "docs/guide.md");
        assert_eq!(value["thinking"], "standard");
        assert!(value.get("projectRoot").is_none());
        assert!(value.get("profile").is_none());
    }

    #[test]
    fn cancel_message_targets_the_active_generation() {
        let value = serde_json::to_value(RuntimeCancelMessage {
            id: "cancel-1",
            message_type: "cancel",
            target_id: "request-1",
        })
        .expect("cancel request");

        assert_eq!(value["type"], "cancel");
        assert_eq!(value["targetId"], "request-1");
    }

    #[test]
    fn server_args_are_offline_and_profile_specific() {
        assert_eq!(
            runtime_server_args(ChatProfile::Lite),
            ["serve", "--profile", "lite", "--offline"]
        );
        assert_eq!(
            runtime_server_args(ChatProfile::Fast),
            ["serve", "--profile", "fast", "--offline"]
        );
        assert_eq!(
            runtime_server_args(ChatProfile::Quality),
            ["serve", "--profile", "quality", "--offline"]
        );
    }

    #[test]
    fn setup_and_doctor_args_select_one_profile() {
        assert_eq!(
            profile_command_args("setup", ChatProfile::Lite),
            ["setup", "--profile", "lite", "--json"]
        );
        assert_eq!(
            profile_command_args("setup", ChatProfile::Fast),
            ["setup", "--profile", "fast", "--json"]
        );
        assert_eq!(
            profile_command_args("doctor", ChatProfile::Quality),
            ["doctor", "--profile", "quality", "--json"]
        );
    }

    #[test]
    fn finds_local_workspace_chat_cli_from_nested_tauri_directory() {
        let repo_root = unique_test_dir("workspace-chat-cli");
        let cli_path = repo_root
            .join("packages")
            .join("ragmir-chat")
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
            find_local_workspace_chat_cli_from(&nested_tauri_dir),
            Some(cli_path)
        );

        fs::remove_dir_all(repo_root).expect("cleanup");
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
