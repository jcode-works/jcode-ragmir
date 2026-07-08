import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  Input,
  Progress,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@jcode.labs/ragmir-ui"
import { convertFileSrc } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import {
  Activity,
  ArrowUp,
  BookOpenCheck,
  CheckCircle2,
  Cloud,
  Copy,
  Download,
  ExternalLink,
  FileSearch,
  FolderOpen,
  FolderPlus,
  HardDrive,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  MessageSquareText,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  TriangleAlert,
  Volume2,
  Wand2,
  WifiOff,
} from "lucide-react"
import { type DragEvent, type FormEvent, lazy, Suspense, useEffect, useRef, useState } from "react"
import type { Components } from "react-markdown"
import {
  clearLicenseKey,
  type LicenseValidation,
  loadLicenseKey,
  saveLicenseKey,
  validateLicenseKey,
} from "./lib/license.js"
import {
  createProject,
  joinProjectPath,
  loadActiveProjectId,
  loadProjects,
  normalizeProjectRoot,
  type ProjectSourceKind,
  type ProjectStatus,
  type RagmirProject,
  removeProject,
  saveActiveProjectId,
  saveProjects,
  upsertProject,
} from "./lib/project-registry.js"
import {
  type AudioDoctorReport,
  type AudioRenderResult,
  type ChatDoctorReport,
  type ChatResult,
  type DoctorReport,
  type IngestResult,
  type RagmirConfigFile,
  readRagmirConfig,
  runAudioDoctor,
  runAudioPreload,
  runAudioSummary,
  runChat,
  runChatDoctor,
  runChatSetup,
  runDoctor,
  runIngest,
  runModelsPull,
  runSecurityAudit,
  runStatus,
  type SecurityAuditReport,
  type StatusReport,
  writeRagmirConfig,
} from "./lib/ragmir-sidecar.js"

type View = "chat" | "config" | "privacy" | "license"
type SetupStepId = "initialize" | "semantic" | "chat" | "tts" | "index" | "verify"
type SetupStepStatus = "idle" | "running" | "done" | "error"
type ChatMessageRole = "user" | "assistant"
type ChatMessageStatus = "done" | "thinking" | "streaming" | "error"
type ChatMessageAudioStatus = "rendering" | "ready" | "playing" | "paused" | "error"
type ChatRuntime = "local" | "codex" | "claude" | "other-agent"
type ChatSource = ChatResult["sources"][number]

const EMPTY_LICENSE_VALIDATION: LicenseValidation = {
  status: "empty",
  message: "No license key is installed.",
}
const AUTO_INGEST_POLL_MS = 30_000
const AUTO_INGEST_INTERVAL_MS = 5 * 60 * 1000
const CHAT_TOP_K = 6
const CHAT_HISTORY_MESSAGE_LIMIT = 8
const CHAT_HISTORY_CHAR_LIMIT = 2400
const CHAT_HISTORY_MESSAGE_CHAR_LIMIT = 420
const CHAT_AUDIO_SOURCE_LIMIT = 3
const ASSISTANT_STREAM_CHUNK_SIZE = 5
const ASSISTANT_STREAM_DELAY_MS = 24
const EMPTY_WORKSPACE_MESSAGE = "Add a project to create a private Ragmir workspace."
const CHAT_THREADS_STORAGE_KEY = "ragmir.chatThreads.v1"
const ACTIVE_CHAT_ID_STORAGE_KEY = "ragmir.activeChatId.v1"
const CHAT_RUNTIME_STORAGE_KEY = "ragmir.chatRuntime.v1"

const Markdown = lazy(() => import("react-markdown"))

const CHAT_MARKDOWN_COMPONENTS: Components = {
  a({ children, href }) {
    return (
      <a
        className="font-semibold text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        href={href}
        rel="noreferrer"
        target="_blank"
      >
        {children}
      </a>
    )
  },
  blockquote({ children }) {
    return (
      <blockquote className="my-3 border-l-2 border-border pl-3 text-muted-foreground">
        {children}
      </blockquote>
    )
  },
  code({ children, className }) {
    return (
      <code
        className={cn(
          "rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[0.86em]",
          className,
        )}
      >
        {children}
      </code>
    )
  },
  h1({ children }) {
    return <h2 className="mb-2 mt-3 text-base font-semibold first:mt-0">{children}</h2>
  },
  h2({ children }) {
    return <h3 className="mb-2 mt-3 text-sm font-semibold first:mt-0">{children}</h3>
  },
  h3({ children }) {
    return <h4 className="mb-2 mt-3 text-sm font-semibold first:mt-0">{children}</h4>
  },
  li({ children }) {
    return <li className="pl-1">{children}</li>
  },
  ol({ children }) {
    return <ol className="my-2 flex list-decimal flex-col gap-1 pl-5">{children}</ol>
  },
  p({ children }) {
    return <p className="mb-2 last:mb-0">{children}</p>
  },
  pre({ children }) {
    return (
      <pre className="my-3 overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-xs leading-5">
        {children}
      </pre>
    )
  },
  ul({ children }) {
    return <ul className="my-2 flex list-disc flex-col gap-1 pl-5">{children}</ul>
  },
}

interface SetupStep {
  id: SetupStepId
  label: string
  detail: string
  status: SetupStepStatus
}

interface ChatMessage {
  id: string
  role: ChatMessageRole
  content: string
  createdAt: string
  audio?: ChatMessageAudio
  result?: ChatResult
  status?: ChatMessageStatus
  statusLabel?: string
}

interface ChatMessageAudio {
  status: ChatMessageAudioStatus
  outputPath?: string
  outputFormat?: AudioRenderResult["outputFormat"]
  engine?: AudioRenderResult["engine"]
  model?: string
  renderedAt?: string
  error?: string
}

type ChatMessageAudioPatch = Partial<Omit<ChatMessageAudio, "error">> & {
  error?: string | null
}

type ChatMessagePatch = Partial<Omit<ChatMessage, "audio" | "statusLabel">> & {
  audio?: ChatMessageAudio | null
  statusLabel?: string | null
}

interface ChatThread {
  id: string
  projectId: string
  title: string
  createdAt: string
  updatedAt: string
  messages: ChatMessage[]
}

const SETUP_STEP_DEFINITIONS: Array<Omit<SetupStep, "status">> = [
  {
    id: "initialize",
    label: "Initialize local workspace",
    detail: "Create ignored .ragmir state and safety defaults.",
  },
  {
    id: "semantic",
    label: "Prepare semantic search",
    detail: "Download the local Transformers embedding model once.",
  },
  {
    id: "chat",
    label: "Prepare local chat",
    detail: "Preload the Transformers chat model for offline answers.",
  },
  {
    id: "tts",
    label: "Prepare offline audio",
    detail: "Preload the local TTS model with a non-sensitive sample.",
  },
  {
    id: "index",
    label: "Index documents",
    detail: "Rebuild the private index with semantic embeddings.",
  },
  {
    id: "verify",
    label: "Verify privacy and readiness",
    detail: "Check config, index, chat, and local privacy posture.",
  },
]

type EmbeddingProvider = "local-hash" | "transformers"

interface ConfigFormState {
  rawDir: string
  sourcesText: string
  embeddingProvider: EmbeddingProvider
  transformersAllowRemoteModels: boolean
  redactionEnabled: boolean
  redactionBuiltIn: boolean
  accessLog: boolean
  baseConfig: Record<string, unknown>
}

type ConfigFormPatch = Partial<Omit<ConfigFormState, "baseConfig">>

const DEFAULT_CONFIG_FORM: ConfigFormState = {
  rawDir: ".ragmir/raw",
  sourcesText: "",
  embeddingProvider: "transformers",
  transformersAllowRemoteModels: false,
  redactionEnabled: true,
  redactionBuiltIn: true,
  accessLog: true,
  baseConfig: {},
}

const DIRECT_FOLDER_CONFIG_PATCH: ConfigFormPatch = {
  rawDir: ".ragmir/raw",
  sourcesText: ".",
  embeddingProvider: "transformers",
  transformersAllowRemoteModels: false,
  redactionEnabled: true,
  redactionBuiltIn: true,
  accessLog: true,
}

export function App(): React.JSX.Element {
  const [view, setView] = useState<View>("chat")
  const [projects, setProjects] = useState<RagmirProject[]>(() => loadProjects())
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => loadActiveProjectId())
  const [chatThreads, setChatThreads] = useState<ChatThread[]>(() => loadChatThreads())
  const [activeChatId, setActiveChatId] = useState<string | null>(() => loadActiveChatId())
  const [chatRuntime, setChatRuntime] = useState<ChatRuntime>(() => loadChatRuntime())
  const [projectRoot, setProjectRoot] = useState("")
  const [googleDriveRoot, setGoogleDriveRoot] = useState("")
  const [dropStatus, setDropStatus] = useState("Add a project folder or drop it here.")
  const [runtimeMessage, setRuntimeMessage] = useState(EMPTY_WORKSPACE_MESSAGE)
  const [isRunning, setIsRunning] = useState(false)
  const [isChoosingFolder, setIsChoosingFolder] = useState(false)
  const [setupSteps, setSetupSteps] = useState<SetupStep[]>(() => createSetupSteps())
  const [question, setQuestion] = useState("")
  const [chatResult, setChatResult] = useState<ChatResult | null>(null)
  const [securityReport, setSecurityReport] = useState<SecurityAuditReport | null>(null)
  const [statusReport, setStatusReport] = useState<StatusReport | null>(null)
  const [chatDoctorReport, setChatDoctorReport] = useState<ChatDoctorReport | null>(null)
  const [audioDoctorReport, setAudioDoctorReport] = useState<AudioDoctorReport | null>(null)
  const [audioRenderingMessageId, setAudioRenderingMessageId] = useState<string | null>(null)
  const [playingAudioMessageId, setPlayingAudioMessageId] = useState<string | null>(null)
  const [configFile, setConfigFile] = useState<RagmirConfigFile | null>(null)
  const [configForm, setConfigForm] = useState<ConfigFormState>(DEFAULT_CONFIG_FORM)
  const [licenseKeyInput, setLicenseKeyInput] = useState(() => loadLicenseKey())
  const [licenseValidation, setLicenseValidation] =
    useState<LicenseValidation>(EMPTY_LICENSE_VALIDATION)
  const [isLicenseChecking, setIsLicenseChecking] = useState(false)
  const projectsRef = useRef(projects)
  const isRunningRef = useRef(isRunning)
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null)
  const playingAudioTargetRef = useRef<{ chatId: string; messageId: string } | null>(null)
  const autoIngestRunnerRef = useRef<(project: RagmirProject) => Promise<void>>(async () => {})
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null
  const activeProjectChats = activeProject
    ? chatThreads.filter((thread) => thread.projectId === activeProject.id)
    : []
  const activeChat =
    activeProjectChats.find((thread) => thread.id === activeChatId) ??
    activeProjectChats.at(0) ??
    null
  const activeChatResult = lastThreadResult(activeChat) ?? chatResult
  autoIngestRunnerRef.current = runAutoIngestProject

  useEffect(() => {
    document.documentElement.classList.add("dark")
    let isCurrent = true
    validateLicenseKey(loadLicenseKey()).then((validation) => {
      if (isCurrent) {
        setLicenseValidation(validation)
      }
    })
    return () => {
      isCurrent = false
    }
  }, [])

  useEffect(() => {
    saveProjects(projects)
    projectsRef.current = projects
  }, [projects])

  useEffect(() => {
    saveChatThreads(chatThreads)
  }, [chatThreads])

  useEffect(() => {
    saveChatRuntime(chatRuntime)
  }, [chatRuntime])

  useEffect(() => {
    isRunningRef.current = isRunning
  }, [isRunning])

  useEffect(
    () => () => {
      audioPlayerRef.current?.pause()
      audioPlayerRef.current = null
      playingAudioTargetRef.current = null
    },
    [],
  )

  useEffect(() => {
    const timerId = window.setInterval(() => {
      if (isRunningRef.current) {
        return
      }
      const project = projectsRef.current.find(shouldAutoIngestProject)
      if (project) {
        void autoIngestRunnerRef.current(project)
      }
    }, AUTO_INGEST_POLL_MS)

    return () => window.clearInterval(timerId)
  }, [])

  useEffect(() => {
    if (activeProjectId && projects.some((project) => project.id === activeProjectId)) {
      saveActiveProjectId(activeProjectId)
      return
    }

    const firstProjectId = projects.at(0)?.id ?? null
    setActiveProjectId(firstProjectId)
    saveActiveProjectId(firstProjectId)
  }, [activeProjectId, projects])

  useEffect(() => {
    if (!activeProject) {
      setActiveChatId(null)
      saveActiveChatId(null)
      return
    }

    const chatBelongsToProject = chatThreads.some(
      (thread) => thread.projectId === activeProject.id && thread.id === activeChatId,
    )
    if (chatBelongsToProject) {
      saveActiveChatId(activeChatId)
      return
    }

    const nextChatId =
      chatThreads.find((thread) => thread.projectId === activeProject.id)?.id ?? null
    setActiveChatId(nextChatId)
    saveActiveChatId(nextChatId)
  }, [activeProject, activeChatId, chatThreads])

  useEffect(() => {
    if (activeProject && runtimeMessage === EMPTY_WORKSPACE_MESSAGE) {
      setRuntimeMessage(
        `${activeProject.name} selected. Run Prepare workspace before asking questions.`,
      )
    }
  }, [activeProject, runtimeMessage])

  function registerProject(
    root: string,
    sourceKind: ProjectSourceKind = "local-folder",
    autoIngestEnabled = false,
  ): void {
    const normalizedRoot = normalizeProjectRoot(root)
    const existingProject = projects.find((project) => project.projectRoot === normalizedRoot)
    const now = new Date().toISOString()
    const project = existingProject
      ? {
          ...existingProject,
          sourceKind,
          autoIngestEnabled: autoIngestEnabled || existingProject.autoIngestEnabled,
          updatedAt: now,
        }
      : createProject({ projectRoot: normalizedRoot, sourceKind, autoIngestEnabled })
    setProjects((currentProjects) => upsertProject(currentProjects, project))
    selectProject(project.id)
    setView("chat")
    setProjectRoot("")
    setGoogleDriveRoot("")
    setDropStatus(
      sourceKind === "google-drive"
        ? `${project.name} is connected as a local Google Drive folder.`
        : `${project.name} is ready to prepare.`,
    )
    setRuntimeMessage(`${project.name} added. Run Prepare workspace before asking questions.`)
    setSetupSteps(createSetupSteps())
  }

  async function handleChooseFolder(sourceKind: ProjectSourceKind = "local-folder"): Promise<void> {
    setIsChoosingFolder(true)
    setDropStatus("Opening native folder picker...")
    setRuntimeMessage("Opening native folder picker...")
    try {
      const selectedPath = await chooseProjectFolder()
      if (!selectedPath) {
        setDropStatus("Folder selection cancelled.")
        setRuntimeMessage("Folder selection cancelled.")
        return
      }
      registerProject(selectedPath, sourceKind, sourceKind === "google-drive")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to open the folder picker."
      setDropStatus(message)
      setRuntimeMessage(message)
    } finally {
      setIsChoosingFolder(false)
    }
  }

  function handleProjectSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    try {
      registerProject(projectRoot)
    } catch (error) {
      setDropStatus(error instanceof Error ? error.message : "Project root is required.")
    }
  }

  function handleGoogleDriveSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    try {
      registerProject(googleDriveRoot, "google-drive", true)
      setRuntimeMessage("Google Drive folder connected. Auto-indexing is enabled locally.")
    } catch (error) {
      setDropStatus(
        error instanceof Error ? error.message : "Google Drive folder path is required.",
      )
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>): void {
    event.preventDefault()
    const droppedPath = droppedProjectPath(event.dataTransfer)
    if (droppedPath) {
      try {
        registerProject(droppedPath)
      } catch (error) {
        setDropStatus(error instanceof Error ? error.message : "Dropped folder path is invalid.")
      }
      return
    }

    const itemCount = event.dataTransfer.items.length || event.dataTransfer.files.length
    setDropStatus(
      itemCount > 0
        ? `${itemCount} local item${itemCount === 1 ? "" : "s"} detected. Use Add project if the OS did not expose the path.`
        : "Use Add project when drag and drop does not expose the path.",
    )
  }

  function handleRemoveProject(projectId: string): void {
    if (projectId === activeProjectId) {
      setChatResult(null)
      setSecurityReport(null)
      setStatusReport(null)
      setChatDoctorReport(null)
      setAudioDoctorReport(null)
      setConfigFile(null)
      setConfigForm(DEFAULT_CONFIG_FORM)
    }
    setChatThreads((currentThreads) =>
      currentThreads.filter((thread) => thread.projectId !== projectId),
    )
    setProjects((currentProjects) => removeProject(currentProjects, projectId))
  }

  function selectProject(projectId: string): void {
    setActiveProjectId(projectId)
    setChatResult(null)
    setSecurityReport(null)
    setStatusReport(null)
    setChatDoctorReport(null)
    setAudioDoctorReport(null)
    setConfigFile(null)
    setConfigForm(DEFAULT_CONFIG_FORM)
    setSetupSteps(createSetupSteps())
    setView("chat")
  }

  function handleNewChat(): void {
    if (!activeProject) {
      setRuntimeMessage("Choose a project before creating a chat.")
      return
    }

    const thread = createChatThread(activeProject.id)
    setChatThreads((currentThreads) => [thread, ...currentThreads])
    setActiveChatId(thread.id)
    setQuestion("")
    setChatResult(null)
    setView("chat")
    setRuntimeMessage(`New chat created in ${activeProject.name}.`)
  }

  function handleSelectChat(chatId: string): void {
    const thread = chatThreads.find((entry) => entry.id === chatId)
    if (!thread) {
      return
    }
    setActiveChatId(chatId)
    setQuestion("")
    setChatResult(lastThreadResult(thread))
    setView("chat")
  }

  async function handleLicenseSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setIsLicenseChecking(true)
    try {
      const validation = await validateLicenseKey(licenseKeyInput)
      setLicenseValidation(validation)
      if (validation.status === "valid") {
        saveLicenseKey(licenseKeyInput.trim())
      }
      setRuntimeMessage(validation.message)
    } finally {
      setIsLicenseChecking(false)
    }
  }

  function handleClearLicense(): void {
    clearLicenseKey()
    setLicenseKeyInput("")
    setLicenseValidation(EMPTY_LICENSE_VALIDATION)
    setRuntimeMessage("License removed from local app storage.")
  }

  async function handleRefreshProject(project: RagmirProject): Promise<void> {
    await runProjectCommand("Checking workspace", project, async () => {
      const [report, status, chatDoctor, audioDoctor] = await Promise.all([
        runDoctor(project.projectRoot),
        runStatus(project.projectRoot),
        runChatDoctor(project.projectRoot),
        runAudioDoctor(project.projectRoot),
      ])
      updateProjectFromDoctor(project, report)
      setStatusReport(status)
      setChatDoctorReport(chatDoctor)
      setAudioDoctorReport(audioDoctor)
      setRuntimeMessage(
        report.ready
          ? "Workspace is ready."
          : (report.nextSteps.at(0) ?? "Review workspace status."),
      )
    })
  }

  async function handlePrepareProject(project: RagmirProject): Promise<void> {
    replaceProject({ ...project, status: "indexing", progress: Math.max(project.progress, 25) })
    setSetupSteps(createSetupSteps())
    await runProjectCommand("Preparing workspace", project, async () => {
      await runSetupStep("initialize", async () => {
        await ensureProjectConfigForPrepare(project, true)
        const setupReport = await runDoctor(project.projectRoot, true)
        updateProjectFromDoctor(project, setupReport)
      })

      await runSetupStep("semantic", async () => {
        const model = await runModelsPull(project.projectRoot)
        setRuntimeMessage(`Semantic search model ready: ${model.embeddingModel}.`)
      })

      await runSetupStep("chat", async () => {
        const setupResult = await runChatSetup(project.projectRoot)
        const doctor = await runChatDoctor(project.projectRoot)
        setChatDoctorReport(doctor)
        setRuntimeMessage(`Local chat model ready: ${setupResult.model}.`)
      })

      await runSetupStep("tts", async () => {
        const preloadResult = await runAudioPreload(project.projectRoot)
        const doctor = await runAudioDoctor(project.projectRoot)
        setAudioDoctorReport(doctor)
        setRuntimeMessage(`Offline audio model ready: ${preloadResult.model}.`)
      })

      let ingestResult: IngestResult | null = null
      await runSetupStep("index", async () => {
        ingestResult = await runIngest(project.projectRoot, true)
      })

      await runSetupStep("verify", async () => {
        const [report, status, chatDoctor, audioDoctor, security] = await Promise.all([
          runDoctor(project.projectRoot),
          runStatus(project.projectRoot),
          runChatDoctor(project.projectRoot),
          runAudioDoctor(project.projectRoot),
          runSecurityAudit(project.projectRoot),
        ])
        updateProjectFromDoctor(project, report)
        setStatusReport(status)
        setChatDoctorReport(chatDoctor)
        setAudioDoctorReport(audioDoctor)
        setSecurityReport(security)
      })

      if (ingestResult) {
        setRuntimeMessage(preparedMessage(ingestResult))
      } else {
        setRuntimeMessage("Workspace prepared.")
      }
    })
  }

  async function runSetupStep(stepId: SetupStepId, action: () => Promise<void>): Promise<void> {
    const step = SETUP_STEP_DEFINITIONS.find((entry) => entry.id === stepId)
    setSetupSteps((currentSteps) => updateSetupStep(currentSteps, stepId, "running"))
    setRuntimeMessage(step ? `${step.label}...` : "Preparing workspace...")
    try {
      await action()
      setSetupSteps((currentSteps) => updateSetupStep(currentSteps, stepId, "done"))
    } catch (error) {
      setSetupSteps((currentSteps) => updateSetupStep(currentSteps, stepId, "error"))
      throw error
    }
  }

  async function handleIngestProject(project: RagmirProject): Promise<void> {
    replaceProject({ ...project, status: "indexing", progress: Math.max(project.progress, 40) })
    await runProjectCommand("Indexing new documents", project, async () => {
      await ensureProjectConfigForPrepare(project)
      const ingestResult = await runIngest(project.projectRoot)
      const [report, status] = await Promise.all([
        runDoctor(project.projectRoot),
        runStatus(project.projectRoot),
      ])
      updateProjectFromDoctor(project, report)
      setStatusReport(status)
      setRuntimeMessage(preparedMessage(ingestResult))
    })
  }

  async function runAutoIngestProject(project: RagmirProject): Promise<void> {
    const startedAt = new Date().toISOString()
    const watchedProject = {
      ...project,
      status: "indexing" as const,
      progress: Math.max(project.progress, 40),
      lastAutoIngestAt: startedAt,
    }
    replaceProject(watchedProject)
    await runProjectCommand("Auto-indexing watched folder", watchedProject, async () => {
      await ensureProjectConfigForPrepare(watchedProject)
      const ingestResult = await runIngest(project.projectRoot)
      const [report, status] = await Promise.all([
        runDoctor(project.projectRoot),
        runStatus(project.projectRoot),
      ])
      updateProjectFromDoctor(watchedProject, report, { lastAutoIngestAt: startedAt })
      setStatusReport(status)
      setRuntimeMessage(preparedMessage(ingestResult))
    })
  }

  function handleToggleAutoIngest(project: RagmirProject): void {
    const autoIngestEnabled = !project.autoIngestEnabled
    replaceProject({
      ...project,
      autoIngestEnabled,
      lastAutoIngestAt: autoIngestEnabled ? project.lastAutoIngestAt : null,
      updatedAt: new Date().toISOString(),
    })
    setRuntimeMessage(
      autoIngestEnabled
        ? `${project.name} will re-index local changes every 5 minutes.`
        : `${project.name} auto-indexing is disabled.`,
    )
  }

  async function handlePrepareChat(): Promise<void> {
    if (!activeProject) {
      setRuntimeMessage("Choose a workspace before preparing local chat.")
      return
    }

    await runProjectCommand("Preparing local chat model", activeProject, async () => {
      const setupResult = await runChatSetup(activeProject.projectRoot)
      const doctor = await runChatDoctor(activeProject.projectRoot)
      setChatDoctorReport(doctor)
      setRuntimeMessage(`Local chat model ready: ${setupResult.model}.`)
    })
  }

  async function handlePrepareAudio(): Promise<void> {
    if (!activeProject) {
      setRuntimeMessage("Choose a workspace before preparing offline audio.")
      return
    }

    await runProjectCommand("Preparing offline audio model", activeProject, async () => {
      const preloadResult = await runAudioPreload(activeProject.projectRoot)
      const doctor = await runAudioDoctor(activeProject.projectRoot)
      setAudioDoctorReport(doctor)
      setRuntimeMessage(`Offline audio model ready: ${preloadResult.model}.`)
    })
  }

  async function handlePullModels(): Promise<void> {
    if (!activeProject) {
      setRuntimeMessage("Choose a workspace before preparing semantic search.")
      return
    }

    await runProjectCommand("Preparing semantic search model", activeProject, async () => {
      const model = await runModelsPull(activeProject.projectRoot)
      const status = await runStatus(activeProject.projectRoot)
      setStatusReport(status)
      setRuntimeMessage(`Semantic search model ready: ${model.embeddingModel}.`)
    })
  }

  async function ensureProjectConfigForPrepare(
    project: RagmirProject,
    resetTransformersProvider = false,
  ): Promise<void> {
    const config = await readRagmirConfig(project.projectRoot)
    const configState = createConfigFormState(config.content)
    const hasSources = splitConfigLines(configState.sourcesText).length > 0
    const shouldResetProvider =
      resetTransformersProvider && configState.embeddingProvider === "transformers"
    const shouldUseBootstrapProvider = shouldResetProvider || !hasSources
    if (config.exists && hasSources && !shouldResetProvider) {
      return
    }

    const directConfigState: ConfigFormState = {
      ...configState,
      rawDir: DIRECT_FOLDER_CONFIG_PATCH.rawDir ?? configState.rawDir,
      sourcesText: hasSources
        ? configState.sourcesText
        : (DIRECT_FOLDER_CONFIG_PATCH.sourcesText ?? "."),
      embeddingProvider: shouldUseBootstrapProvider ? "local-hash" : configState.embeddingProvider,
      transformersAllowRemoteModels: false,
      redactionEnabled: configState.redactionEnabled,
      redactionBuiltIn: configState.redactionBuiltIn,
      accessLog: configState.accessLog,
    }
    const savedConfig = await writeRagmirConfig(
      project.projectRoot,
      serializeConfigFormState(directConfigState),
    )
    setConfigFile(savedConfig)
    setConfigForm(createConfigFormState(savedConfig.content))
  }

  async function handleLoadConfig(): Promise<void> {
    if (!activeProject) {
      setRuntimeMessage("Choose a workspace before loading Ragmir config.")
      return
    }

    await runProjectCommand("Loading Ragmir config", activeProject, async () => {
      const config = await readRagmirConfig(activeProject.projectRoot)
      setConfigFile(config)
      setConfigForm(createConfigFormState(config.content))
      setRuntimeMessage(
        config.exists
          ? `Loaded ${config.configPath}.`
          : "No config exists yet. Initialize the folder or save a config draft.",
      )
    })
  }

  async function handleSaveConfig(): Promise<void> {
    if (!activeProject) {
      setRuntimeMessage("Choose a workspace before saving Ragmir config.")
      return
    }

    await runProjectCommand("Saving Ragmir config", activeProject, async () => {
      const config = await writeRagmirConfig(
        activeProject.projectRoot,
        serializeConfigFormState(configForm),
      )
      const report = await runDoctor(activeProject.projectRoot)
      updateProjectFromDoctor(activeProject, report)
      setConfigFile(config)
      setConfigForm(createConfigFormState(config.content))
      setRuntimeMessage("Config saved locally. Re-index if source or retrieval settings changed.")
    })
  }

  async function handleInitializeConfigFolder(): Promise<void> {
    if (!activeProject) {
      setRuntimeMessage("Add or select a project before initializing Ragmir.")
      return
    }

    await runProjectCommand("Initializing Ragmir folder", activeProject, async () => {
      const report = await runDoctor(activeProject.projectRoot, true)
      const [status, config] = await Promise.all([
        runStatus(activeProject.projectRoot),
        readRagmirConfig(activeProject.projectRoot),
      ])
      updateProjectFromDoctor(activeProject, report)
      setStatusReport(status)
      setConfigFile(config)
      setConfigForm(createConfigFormState(config.content))
      setRuntimeMessage("Folder initialized. Config is ready to edit locally.")
    })
  }

  function handleUseDirectFolderConfig(): void {
    setConfigForm((currentConfig) => ({ ...currentConfig, ...DIRECT_FOLDER_CONFIG_PATCH }))
    setRuntimeMessage('Config form updated to index the selected folder directly with source ".".')
  }

  function handleConfigFormChange(patch: ConfigFormPatch): void {
    setConfigForm((currentConfig) => ({ ...currentConfig, ...patch }))
  }

  async function handleAskSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!activeProject) {
      setRuntimeMessage("Choose a workspace before asking Ragmir.")
      return
    }

    const trimmedQuestion = question.trim()
    if (!trimmedQuestion) {
      setRuntimeMessage("Write a question before asking Ragmir.")
      return
    }

    const targetThread = activeChat ?? createChatThread(activeProject.id, trimmedQuestion)
    const userMessage = createChatMessage("user", trimmedQuestion, undefined, { status: "done" })
    const assistantMessage = createChatMessage("assistant", "", undefined, {
      status: "thinking",
      statusLabel: "Searching local context",
    })
    const initialThread: ChatThread = {
      ...targetThread,
      title:
        targetThread.messages.length === 0
          ? chatTitleFromQuestion(trimmedQuestion)
          : targetThread.title,
      messages: [...targetThread.messages, userMessage, assistantMessage],
      updatedAt: assistantMessage.createdAt,
    }
    const contextualQuestion = buildContextualChatQuestion(targetThread.messages, trimmedQuestion)

    setActiveChatId(initialThread.id)
    setQuestion("")
    setChatThreads((currentThreads) => upsertChatThread(currentThreads, initialThread))
    setView("chat")
    setIsRunning(true)
    setRuntimeMessage("Searching local Ragmir context...")

    try {
      const rawResult = await runChat(activeProject.projectRoot, contextualQuestion, CHAT_TOP_K)
      const result = normalizeChatResultForDisplay(rawResult, trimmedQuestion)
      setRuntimeMessage("Writing the answer...")
      await streamAssistantMessage(initialThread.id, assistantMessage.id, result)
      setChatResult(result)
      setRuntimeMessage(
        result.emptyContext
          ? "No relevant local context found. Add or index documents, then ask again."
          : `Answered from ${result.sources.length} cited source${result.sources.length === 1 ? "" : "s"} with recent chat context.`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : "Local chat failed."
      setChatThreads((currentThreads) =>
        updateChatMessage(currentThreads, initialThread.id, assistantMessage.id, {
          content: `I could not complete the local answer.\n\n${message}`,
          status: "error",
          statusLabel: "Failed",
        }),
      )
      setRuntimeMessage(message)
    } finally {
      setIsRunning(false)
    }
  }

  async function streamAssistantMessage(
    chatId: string,
    messageId: string,
    result: ChatResult,
  ): Promise<void> {
    setChatThreads((currentThreads) =>
      updateChatMessage(currentThreads, chatId, messageId, {
        content: "",
        status: "streaming",
        statusLabel: "Writing answer",
      }),
    )

    const chunks = chunkMarkdownForStream(result.answer)
    let streamedContent = ""
    for (const chunk of chunks) {
      streamedContent += chunk
      setChatThreads((currentThreads) =>
        updateChatMessage(currentThreads, chatId, messageId, {
          content: streamedContent,
          status: "streaming",
          statusLabel: "Writing answer",
        }),
      )
      await sleep(ASSISTANT_STREAM_DELAY_MS)
    }

    setChatThreads((currentThreads) =>
      updateChatMessage(currentThreads, chatId, messageId, {
        content: result.answer,
        result,
        status: "done",
        statusLabel: null,
      }),
    )
  }

  function handleExportMarkdown(): void {
    if (!activeProject || !activeChatResult) {
      setRuntimeMessage("Ask Ragmir before exporting a Markdown report.")
      return
    }

    downloadTextFile(
      `${safeFilename(activeProject.name)}-ragmir-answer.md`,
      retrievalReportMarkdown(activeProject, activeChatResult),
      "text/markdown;charset=utf-8",
    )
    setRuntimeMessage("Markdown report exported from the current answer.")
  }

  async function handleRenderMessageAudio(
    chatId: string,
    messageId: string,
    autoplay = false,
  ): Promise<void> {
    if (!activeProject) {
      setRuntimeMessage("Choose a workspace before rendering audio.")
      return
    }

    const message = findChatMessage(chatThreads, chatId, messageId)
    if (message?.role !== "assistant" || !message.content.trim()) {
      setRuntimeMessage("Choose a completed Ragmir answer before rendering audio.")
      return
    }

    const audioText = chatMessageTtsText(activeProject, message)
    setAudioRenderingMessageId(messageId)
    setChatThreads((currentThreads) =>
      updateChatMessage(currentThreads, chatId, messageId, {
        audio: { status: "rendering" },
      }),
    )
    setRuntimeMessage("Rendering local offline audio for this answer...")

    try {
      const result: AudioRenderResult = await runAudioSummary(activeProject.projectRoot, audioText)
      const audio = chatAudioFromRenderResult(result)
      setChatThreads((currentThreads) =>
        updateChatMessage(currentThreads, chatId, messageId, { audio }),
      )
      setRuntimeMessage(`Audio ready: ${audio.outputPath}.`)
      if (autoplay) {
        await playChatMessageAudio(chatId, messageId, audio)
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Offline audio rendering failed."
      setChatThreads((currentThreads) =>
        updateChatMessage(currentThreads, chatId, messageId, {
          audio: {
            status: "error",
            error: audioErrorMessage(messageText),
          },
        }),
      )
      setRuntimeMessage(audioErrorMessage(messageText))
    } finally {
      setAudioRenderingMessageId(null)
    }
  }

  async function handleToggleMessageAudio(chatId: string, messageId: string): Promise<void> {
    const message = findChatMessage(chatThreads, chatId, messageId)
    if (!message) {
      setRuntimeMessage("Audio target message was not found.")
      return
    }

    if (playingAudioMessageId === messageId) {
      stopActiveAudio("paused")
      return
    }

    if (message.audio?.outputPath) {
      await playChatMessageAudio(chatId, messageId, message.audio)
      return
    }

    await handleRenderMessageAudio(chatId, messageId, true)
  }

  async function playChatMessageAudio(
    chatId: string,
    messageId: string,
    audio: ChatMessageAudio,
  ): Promise<void> {
    if (!audio.outputPath) {
      setRuntimeMessage("Render audio before playing this answer.")
      return
    }

    stopActiveAudio("paused")
    const player = new Audio(audioFileUrl(audio.outputPath))
    audioPlayerRef.current = player
    playingAudioTargetRef.current = { chatId, messageId }
    setPlayingAudioMessageId(messageId)
    setChatThreads((currentThreads) =>
      updateChatMessageAudio(currentThreads, chatId, messageId, {
        status: "playing",
        error: null,
      }),
    )

    player.addEventListener(
      "ended",
      () => {
        audioPlayerRef.current = null
        playingAudioTargetRef.current = null
        setPlayingAudioMessageId(null)
        setChatThreads((currentThreads) =>
          updateChatMessageAudio(currentThreads, chatId, messageId, { status: "ready" }),
        )
      },
      { once: true },
    )
    player.addEventListener(
      "error",
      () => {
        audioPlayerRef.current = null
        playingAudioTargetRef.current = null
        setPlayingAudioMessageId(null)
        setChatThreads((currentThreads) =>
          updateChatMessageAudio(currentThreads, chatId, messageId, {
            status: "error",
            error: "The generated audio file could not be loaded by the desktop webview.",
          }),
        )
      },
      { once: true },
    )

    try {
      await player.play()
      setRuntimeMessage("Playing the local audio answer.")
    } catch (error) {
      audioPlayerRef.current = null
      playingAudioTargetRef.current = null
      setPlayingAudioMessageId(null)
      const messageText =
        error instanceof Error ? error.message : "The audio player could not start."
      setChatThreads((currentThreads) =>
        updateChatMessageAudio(currentThreads, chatId, messageId, {
          status: "ready",
          error: messageText,
        }),
      )
      setRuntimeMessage(`${messageText} Use Play again now that the file is ready.`)
    }
  }

  function stopActiveAudio(nextStatus: Extract<ChatMessageAudioStatus, "paused" | "ready">): void {
    const target = playingAudioTargetRef.current
    audioPlayerRef.current?.pause()
    audioPlayerRef.current = null
    playingAudioTargetRef.current = null
    setPlayingAudioMessageId(null)
    if (target) {
      setChatThreads((currentThreads) =>
        updateChatMessageAudio(currentThreads, target.chatId, target.messageId, {
          status: nextStatus,
        }),
      )
    }
  }

  async function handleSecurityAudit(): Promise<void> {
    if (!activeProject) {
      setRuntimeMessage("Choose a workspace before running the privacy check.")
      return
    }

    await runProjectCommand("Checking privacy posture", activeProject, async () => {
      const [report, status] = await Promise.all([
        runSecurityAudit(activeProject.projectRoot),
        runStatus(activeProject.projectRoot),
      ])
      setSecurityReport(report)
      setStatusReport(status)
      setRuntimeMessage(
        report.warnings.length === 0
          ? "Privacy check passed."
          : `Privacy check found ${report.warnings.length} warning${report.warnings.length === 1 ? "" : "s"}.`,
      )
    })
  }

  async function runProjectCommand(
    label: string,
    project: RagmirProject,
    action: () => Promise<void>,
  ): Promise<void> {
    setIsRunning(true)
    setRuntimeMessage(`${label}...`)
    try {
      await action()
    } catch (error) {
      replaceProject({ ...project, status: "needs-review", progress: project.progress })
      setRuntimeMessage(error instanceof Error ? error.message : "Native Ragmir runtime failed.")
    } finally {
      setIsRunning(false)
    }
  }

  function updateProjectFromDoctor(
    project: RagmirProject,
    report: DoctorReport,
    updates: Partial<Pick<RagmirProject, "lastAutoIngestAt">> = {},
  ): void {
    replaceProject({
      ...project,
      ...updates,
      rawDir: report.rawDir,
      storageDir: report.storageDir,
      filesIndexed: report.indexedFiles,
      chunksIndexed: report.chunksIndexed,
      progress: projectProgress(report),
      status: projectStatusFromDoctor(report),
      updatedAt: new Date().toISOString(),
    })
  }

  function replaceProject(project: RagmirProject): void {
    setProjects((currentProjects) =>
      currentProjects.map((entry) => (entry.id === project.id ? project : entry)),
    )
  }

  return (
    <main className="ragmir-app-frame h-dvh min-h-dvh overflow-hidden bg-background text-sm text-foreground">
      <div className="grid h-full min-h-0 w-full grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[18.5rem_minmax(0,1fr)] lg:grid-rows-none">
        <AppSidebar
          activeProject={activeProject}
          activeProjectId={activeProjectId}
          activeChatId={activeChat?.id ?? null}
          activeProjectChats={activeProjectChats}
          isRunning={isRunning}
          isChoosingFolder={isChoosingFolder}
          licenseValidation={licenseValidation}
          onChooseFolder={() => void handleChooseFolder()}
          onNewChat={handleNewChat}
          onRemoveProject={handleRemoveProject}
          onSelectProject={selectProject}
          onSelectChat={handleSelectChat}
          onViewChange={setView}
          projects={projects}
          runtimeMessage={runtimeMessage}
          view={view}
        />

        <section className="flex min-w-0 flex-col gap-3 overflow-y-auto px-3 py-3 sm:px-4 lg:min-h-0 lg:px-6">
          {view !== "chat" ? (
            <WorkspaceTopBar
              activeProject={activeProject}
              isChoosingFolder={isChoosingFolder}
              isRunning={isRunning}
              onChooseFolder={() => void handleChooseFolder()}
              onPrepareProject={handlePrepareProject}
              runtimeMessage={runtimeMessage}
              view={view}
            />
          ) : null}

          {view === "chat" ? (
            <ProjectChatView
              activeChat={activeChat}
              activeProject={activeProject}
              audioRenderingMessageId={audioRenderingMessageId}
              audioDoctorReport={audioDoctorReport}
              chatRuntime={chatRuntime}
              chatResult={activeChatResult}
              chatDoctorReport={chatDoctorReport}
              dropStatus={dropStatus}
              googleDriveRoot={googleDriveRoot}
              isChoosingFolder={isChoosingFolder}
              isRunning={isRunning}
              onChooseFolder={() => void handleChooseFolder()}
              onChooseGoogleDriveFolder={() => void handleChooseFolder("google-drive")}
              onDrop={handleDrop}
              onGoogleDriveRootChange={setGoogleDriveRoot}
              onGoogleDriveSubmit={handleGoogleDriveSubmit}
              onIngestProject={handleIngestProject}
              onExportMarkdown={handleExportMarkdown}
              onNewChat={handleNewChat}
              onPrepareAudio={handlePrepareAudio}
              onPrepareChat={handlePrepareChat}
              onPrepareProject={handlePrepareProject}
              onProjectRootChange={setProjectRoot}
              onProjectSubmit={handleProjectSubmit}
              onRefreshProject={handleRefreshProject}
              onRenderMessageAudio={handleRenderMessageAudio}
              onStopMessageAudio={() => stopActiveAudio("paused")}
              onToggleAutoIngest={handleToggleAutoIngest}
              onToggleMessageAudio={handleToggleMessageAudio}
              onAskSubmit={handleAskSubmit}
              onQuestionChange={setQuestion}
              onChatRuntimeChange={setChatRuntime}
              onViewChange={setView}
              playingAudioMessageId={playingAudioMessageId}
              projectRoot={projectRoot}
              question={question}
              runtimeMessage={runtimeMessage}
              setupSteps={setupSteps}
              statusReport={statusReport}
            />
          ) : null}

          {view === "config" ? (
            <ConfigView
              activeProject={activeProject}
              configFile={configFile}
              configForm={configForm}
              isRunning={isRunning}
              onConfigFormChange={handleConfigFormChange}
              onInitializeConfigFolder={handleInitializeConfigFolder}
              onLoadConfig={handleLoadConfig}
              onSaveConfig={handleSaveConfig}
              onUseDirectFolderConfig={handleUseDirectFolderConfig}
              statusReport={statusReport}
            />
          ) : null}

          {view === "privacy" ? (
            <PrivacyView
              activeProject={activeProject}
              chatDoctorReport={chatDoctorReport}
              isRunning={isRunning}
              onPullModels={handlePullModels}
              onRunSecurityAudit={handleSecurityAudit}
              securityReport={securityReport}
              statusReport={statusReport}
            />
          ) : null}

          {view === "license" ? (
            <LicenseView
              isChecking={isLicenseChecking}
              licenseKey={licenseKeyInput}
              onClear={handleClearLicense}
              onLicenseKeyChange={setLicenseKeyInput}
              onSubmit={handleLicenseSubmit}
              validation={licenseValidation}
            />
          ) : null}
        </section>
      </div>
    </main>
  )
}

interface AppSidebarProps {
  activeProject: RagmirProject | null
  activeProjectId: string | null
  activeChatId: string | null
  activeProjectChats: ChatThread[]
  isRunning: boolean
  isChoosingFolder: boolean
  licenseValidation: LicenseValidation
  onChooseFolder: () => void
  onNewChat: () => void
  onRemoveProject: (projectId: string) => void
  onSelectProject: (projectId: string) => void
  onSelectChat: (chatId: string) => void
  onViewChange: (view: View) => void
  projects: RagmirProject[]
  runtimeMessage: string
  view: View
}

function AppSidebar({
  activeProject,
  activeProjectId,
  activeChatId,
  activeProjectChats,
  isRunning,
  isChoosingFolder,
  licenseValidation,
  onChooseFolder,
  onNewChat,
  onRemoveProject,
  onSelectProject,
  onSelectChat,
  onViewChange,
  projects,
  runtimeMessage,
  view,
}: AppSidebarProps): React.JSX.Element {
  const navItems: Array<{ view: View; label: string; icon: React.ReactNode }> = [
    { view: "chat", label: "Chat", icon: <MessageSquareText aria-hidden="true" /> },
    { view: "config", label: "Settings", icon: <FileSearch aria-hidden="true" /> },
    { view: "privacy", label: "Privacy", icon: <ShieldCheck aria-hidden="true" /> },
    { view: "license", label: "License", icon: <KeyRound aria-hidden="true" /> },
  ]

  return (
    <aside className="ragmir-sidebar-surface flex max-h-[42dvh] min-h-0 flex-col overflow-y-auto border-b px-3 py-4 backdrop-blur-xl lg:h-full lg:max-h-none lg:overflow-hidden lg:border-r lg:border-b-0">
      <div className="flex shrink-0 items-center gap-3 px-1 py-1">
        <div className="flex size-8 items-center justify-center rounded-md border border-[var(--ragmir-app-active-line)] bg-[var(--ragmir-app-active)] text-primary">
          <HardDrive className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p
            aria-hidden="true"
            className="logo-stack display-title truncate text-sm font-black leading-tight"
            data-logo-text="Ragmir"
          >
            <span className="logo-index-1 logo-text">Ragmir</span>
          </p>
          <span className="sr-only">Ragmir</span>
          <p className="truncate text-xs text-muted-foreground">Private local RAG</p>
        </div>
      </div>

      <div className="mt-5 flex flex-col lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="text-[11px] font-semibold uppercase text-muted-foreground">Projects</p>
            <Badge variant="outline">{projects.length}</Badge>
          </div>
          <Button
            aria-label="Add project"
            disabled={isChoosingFolder || isRunning}
            size="icon"
            type="button"
            variant="ghost"
            onClick={onChooseFolder}
          >
            <FolderPlus aria-hidden="true" />
          </Button>
        </div>

        {projects.length === 0 ? (
          <p className="px-1 py-6 text-xs leading-5 text-muted-foreground">
            Add a project folder to create a local Ragmir workspace.
          </p>
        ) : null}

        <div className="flex flex-col gap-1.5">
          {projects.map((project) => (
            <SidebarProject
              isActive={project.id === activeProjectId}
              isRunning={isRunning}
              key={project.id}
              onRemoveProject={onRemoveProject}
              onSelectProject={onSelectProject}
              project={project}
            />
          ))}
        </div>

        {activeProject ? (
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <div className="flex min-w-0 items-center gap-2">
                <p className="text-[11px] font-semibold uppercase text-muted-foreground">Chats</p>
                <Badge variant="outline">{activeProjectChats.length}</Badge>
              </div>
              <Button
                aria-label="New chat"
                disabled={isRunning}
                size="icon"
                type="button"
                variant="ghost"
                onClick={onNewChat}
              >
                <MessageSquareText aria-hidden="true" />
              </Button>
            </div>
            {activeProjectChats.length === 0 ? (
              <p className="px-1 py-3 text-xs leading-5 text-muted-foreground">
                No chats yet. Ask a question to create one.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {activeProjectChats.map((thread) => (
                  <SidebarChat
                    isActive={thread.id === activeChatId}
                    key={thread.id}
                    onSelectChat={onSelectChat}
                    thread={thread}
                  />
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <nav className="mt-3 flex shrink-0 flex-col gap-1" aria-label="Ragmir sections">
        {navItems.map((item) => (
          <Button
            aria-current={view === item.view ? "page" : undefined}
            className={cn("w-full justify-start px-2", view === item.view && "ragmir-active-nav")}
            key={item.view}
            size="sm"
            type="button"
            variant="ghost"
            onClick={() => onViewChange(item.view)}
          >
            {item.icon}
            {item.label}
          </Button>
        ))}
      </nav>

      <div className="ragmir-card-surface mt-3 flex shrink-0 flex-col gap-3 rounded-lg border p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold">Active workspace</p>
          {isRunning ? (
            <Badge variant="outline">Running</Badge>
          ) : (
            <Badge variant={activeProject ? statusBadge(activeProject.status) : "outline"}>
              {activeProject ? projectStatusLabel(activeProject.status) : "None"}
            </Badge>
          )}
        </div>
        <Progress value={activeProject?.progress ?? 0} aria-label="Workspace readiness" />
        <p className="break-words text-xs leading-5 text-muted-foreground">
          {activeProject?.name ?? "No project selected yet."}
        </p>
        <p className="break-words text-xs leading-5 text-muted-foreground" aria-live="polite">
          {runtimeMessage}
        </p>
      </div>

      <div className="mt-3 flex shrink-0 flex-col gap-2 px-1">
        <StatusLine label="Local first" value="No hosted document storage" />
        <StatusLine
          label="Activation"
          value={licenseValidation.status === "valid" ? "Licensed" : "Local trial state"}
        />
      </div>
    </aside>
  )
}

interface SidebarProjectProps {
  isActive: boolean
  isRunning: boolean
  onRemoveProject: (projectId: string) => void
  onSelectProject: (projectId: string) => void
  project: RagmirProject
}

function SidebarProject({
  isActive,
  isRunning,
  onRemoveProject,
  onSelectProject,
  project,
}: SidebarProjectProps): React.JSX.Element {
  return (
    <div
      className={cn(
        "group grid grid-cols-[1fr_auto] items-center gap-1 rounded-md border p-2",
        isActive
          ? "border-[var(--ragmir-app-active-line)] bg-[var(--ragmir-app-active)]"
          : "border-transparent hover:bg-white/[0.04]",
      )}
    >
      <button
        className="min-w-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        type="button"
        onClick={() => onSelectProject(project.id)}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              project.status === "ready" ? "bg-success" : "bg-muted-foreground",
            )}
          />
          <span className="truncate text-xs font-semibold">{project.name}</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>{project.filesIndexed} files</span>
          <span>{project.progress}%</span>
        </div>
      </button>
      <Button
        aria-label={`Remove ${project.name}`}
        className="opacity-70 group-hover:opacity-100"
        disabled={isRunning}
        size="icon"
        type="button"
        variant="ghost"
        onClick={() => onRemoveProject(project.id)}
      >
        <Trash2 aria-hidden="true" />
      </Button>
    </div>
  )
}

interface SidebarChatProps {
  isActive: boolean
  onSelectChat: (chatId: string) => void
  thread: ChatThread
}

function SidebarChat({ isActive, onSelectChat, thread }: SidebarChatProps): React.JSX.Element {
  const messageCount = thread.messages.length

  return (
    <button
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "grid min-h-11 grid-cols-[auto_1fr] items-center gap-2 rounded-md border px-2 py-1.5 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
        isActive
          ? "border-[var(--ragmir-app-active-line)] bg-[var(--ragmir-app-active)]"
          : "border-transparent hover:bg-white/[0.04]",
      )}
      type="button"
      onClick={() => onSelectChat(thread.id)}
    >
      <MessageSquareText className="size-3.5 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold">{thread.title}</span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
          {messageCount} message{messageCount === 1 ? "" : "s"} · {formatDate(thread.updatedAt)}
        </span>
      </span>
    </button>
  )
}

interface StatusLineProps {
  label: string
  value: string
}

function StatusLine({ label, value }: StatusLineProps): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-semibold">{value}</span>
    </div>
  )
}

interface WorkspaceTopBarProps {
  activeProject: RagmirProject | null
  isChoosingFolder: boolean
  isRunning: boolean
  onChooseFolder: () => void
  onPrepareProject: (project: RagmirProject) => Promise<void>
  runtimeMessage: string
  view: View
}

function WorkspaceTopBar({
  activeProject,
  isChoosingFolder,
  isRunning,
  onChooseFolder,
  onPrepareProject,
  runtimeMessage,
  view,
}: WorkspaceTopBarProps): React.JSX.Element {
  return (
    <header className="ragmir-topbar-surface rounded-xl border px-3 py-2 backdrop-blur-xl">
      <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="display-title font-black text-foreground">{viewTitle(view)}</span>
            <Badge variant={activeProject ? statusBadge(activeProject.status) : "outline"}>
              {activeProject ? projectStatusLabel(activeProject.status) : "No workspace"}
            </Badge>
            {activeProject ? (
              <Badge variant="outline">{projectSourceLabel(activeProject.sourceKind)}</Badge>
            ) : null}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground" aria-live="polite">
            {activeProject ? activeProject.projectRoot : runtimeMessage}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 lg:justify-end">
          <Button
            disabled={isChoosingFolder || isRunning}
            variant="outline"
            size="sm"
            type="button"
            onClick={onChooseFolder}
          >
            <FolderOpen data-icon="inline-start" />
            Add project
          </Button>
          <Button
            disabled={!activeProject || isRunning}
            variant="outline"
            size="sm"
            type="button"
            onClick={() => activeProject && void onPrepareProject(activeProject)}
          >
            <Wand2 data-icon="inline-start" />
            Prepare
          </Button>
        </div>
      </div>
    </header>
  )
}

interface ProjectChatViewProps {
  activeChat: ChatThread | null
  activeProject: RagmirProject | null
  audioRenderingMessageId: string | null
  audioDoctorReport: AudioDoctorReport | null
  chatRuntime: ChatRuntime
  chatResult: ChatResult | null
  chatDoctorReport: ChatDoctorReport | null
  dropStatus: string
  googleDriveRoot: string
  isChoosingFolder: boolean
  isRunning: boolean
  onChooseFolder: () => void
  onChooseGoogleDriveFolder: () => void
  onDrop: (event: DragEvent<HTMLElement>) => void
  onGoogleDriveRootChange: (projectRoot: string) => void
  onGoogleDriveSubmit: (event: FormEvent<HTMLFormElement>) => void
  onIngestProject: (project: RagmirProject) => Promise<void>
  onExportMarkdown: () => void
  onNewChat: () => void
  onPrepareAudio: () => Promise<void>
  onPrepareChat: () => Promise<void>
  onPrepareProject: (project: RagmirProject) => Promise<void>
  onProjectRootChange: (projectRoot: string) => void
  onProjectSubmit: (event: FormEvent<HTMLFormElement>) => void
  onRefreshProject: (project: RagmirProject) => Promise<void>
  onRenderMessageAudio: (chatId: string, messageId: string) => Promise<void>
  onStopMessageAudio: () => void
  onToggleAutoIngest: (project: RagmirProject) => void
  onToggleMessageAudio: (chatId: string, messageId: string) => Promise<void>
  onAskSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
  onQuestionChange: (question: string) => void
  onChatRuntimeChange: (runtime: ChatRuntime) => void
  onViewChange: (view: View) => void
  playingAudioMessageId: string | null
  projectRoot: string
  question: string
  runtimeMessage: string
  setupSteps: SetupStep[]
  statusReport: StatusReport | null
}

function ProjectChatView({
  activeChat,
  activeProject,
  audioRenderingMessageId,
  audioDoctorReport,
  chatRuntime,
  chatResult,
  chatDoctorReport,
  dropStatus,
  googleDriveRoot,
  isChoosingFolder,
  isRunning,
  onChooseFolder,
  onChooseGoogleDriveFolder,
  onDrop,
  onGoogleDriveRootChange,
  onGoogleDriveSubmit,
  onIngestProject,
  onExportMarkdown,
  onNewChat,
  onPrepareAudio,
  onPrepareChat,
  onPrepareProject,
  onProjectRootChange,
  onProjectSubmit,
  onRefreshProject,
  onRenderMessageAudio,
  onStopMessageAudio,
  onToggleAutoIngest,
  onToggleMessageAudio,
  onAskSubmit,
  onQuestionChange,
  onChatRuntimeChange,
  onViewChange,
  playingAudioMessageId,
  projectRoot,
  question,
  runtimeMessage,
  setupSteps,
  statusReport,
}: ProjectChatViewProps): React.JSX.Element {
  const messages = activeChat?.messages ?? []
  const currentChatTitle = activeChat?.title ?? "New chat"
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" })
  })

  if (!activeProject) {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-3xl items-center px-1 py-8">
        <Card className="ragmir-card-surface w-full">
          <CardHeader>
            <CardTitle>Add a project</CardTitle>
            <CardDescription>
              Select a local repo or folder. Ragmir will keep its index and chats local.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form
              className="grid gap-3 md:grid-cols-[1fr_auto]"
              onDragOver={(event) => event.preventDefault()}
              onDrop={onDrop}
              onSubmit={onProjectSubmit}
            >
              <Input
                aria-label="Paste an absolute project path"
                name="projectRoot"
                onChange={(event) => onProjectRootChange(event.currentTarget.value)}
                placeholder="/Users/me/Repos/client-app"
                value={projectRoot}
              />
              <Button disabled={isRunning} type="submit" variant="outline">
                <FolderPlus data-icon="inline-start" />
                Add path
              </Button>
            </form>

            <div className="flex flex-wrap gap-2">
              <Button
                disabled={isChoosingFolder || isRunning}
                type="button"
                onClick={onChooseFolder}
              >
                <FolderOpen data-icon="inline-start" />
                Add project
              </Button>
              <Button
                disabled={isChoosingFolder || isRunning}
                type="button"
                variant="outline"
                onClick={onChooseGoogleDriveFolder}
              >
                <Cloud data-icon="inline-start" />
                Synced folder
              </Button>
            </div>

            <details className="ragmir-soft-surface rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-semibold text-muted-foreground">
                Add a local Google Drive folder path
              </summary>
              <form
                className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]"
                onSubmit={onGoogleDriveSubmit}
              >
                <Input
                  aria-label="Google Drive local sync folder"
                  name="googleDriveRoot"
                  onChange={(event) => onGoogleDriveRootChange(event.currentTarget.value)}
                  placeholder="/Users/me/Library/CloudStorage/GoogleDrive-me@example.com/My Drive"
                  value={googleDriveRoot}
                />
                <Button disabled={isRunning} type="submit" variant="outline">
                  <Cloud data-icon="inline-start" />
                  Connect
                </Button>
              </form>
            </details>

            <p className="text-xs text-muted-foreground" aria-live="polite">
              {dropStatus}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="grid min-h-full gap-3 xl:grid-cols-[minmax(0,1fr)_20.5rem]">
      <Card className="ragmir-card-surface flex min-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden">
        <CardHeader className="border-b border-border">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="truncate">{currentChatTitle}</CardTitle>
              <CardDescription className="truncate">
                {activeProject.name} · {activeProject.projectRoot}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant={statusBadge(activeProject.status)}>
                {projectStatusLabel(activeProject.status)}
              </Badge>
              <Button
                disabled={isRunning}
                size="sm"
                type="button"
                variant="outline"
                onClick={onNewChat}
              >
                <MessageSquareText data-icon="inline-start" />
                New chat
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <EmptyPanel
                icon={
                  chatRuntime === "local" ? (
                    <MessageSquareText aria-hidden="true" />
                  ) : (
                    <Terminal aria-hidden="true" />
                  )
                }
                title={
                  chatRuntime === "local"
                    ? "Start with one question"
                    : `Use Ragmir with ${chatRuntimeMeta(chatRuntime).title}`
                }
                description={
                  chatRuntime === "local"
                    ? "Ask Ragmir about this project, its docs, specs, sources, or local private files."
                    : "Keep the actual conversation in your coding agent and wire Ragmir as local MCP context."
                }
              />
            ) : (
              <div className="flex flex-col gap-3">
                {activeChat
                  ? messages.map((message) => (
                      <ChatMessageBubble
                        audioRenderingMessageId={audioRenderingMessageId}
                        chatId={activeChat.id}
                        key={message.id}
                        message={message}
                        onRenderAudio={onRenderMessageAudio}
                        onStopAudio={onStopMessageAudio}
                        onToggleAudio={onToggleMessageAudio}
                        playingAudioMessageId={playingAudioMessageId}
                        project={activeProject}
                      />
                    ))
                  : null}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          <div className="border-t border-border p-3">
            <ChatRuntimeChooser onRuntimeChange={onChatRuntimeChange} runtime={chatRuntime} />
            {chatRuntime === "local" ? (
              <form className="mt-3" onSubmit={onAskSubmit}>
                <ChatContextSummary
                  chatDoctorReport={chatDoctorReport}
                  isRunning={isRunning}
                  messages={messages}
                />
                <Textarea
                  aria-label="Question for Ragmir"
                  className="mt-3 min-h-20 resize-none rounded-lg"
                  disabled={isRunning}
                  name="projectQuestion"
                  onChange={(event) => onQuestionChange(event.currentTarget.value)}
                  placeholder="Ask about a spec, contract, feature, report, or source file..."
                  value={question}
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={isRunning}
                      size="sm"
                      type="button"
                      variant="outline"
                      onClick={onPrepareChat}
                    >
                      <Sparkles data-icon="inline-start" />
                      Prepare chat
                    </Button>
                    <Button
                      disabled={!chatResult || isRunning}
                      size="sm"
                      type="button"
                      variant="outline"
                      onClick={onExportMarkdown}
                    >
                      <Download data-icon="inline-start" />
                      Export
                    </Button>
                    <Button
                      disabled={isRunning}
                      size="sm"
                      type="button"
                      variant="outline"
                      onClick={onPrepareAudio}
                    >
                      <Volume2 data-icon="inline-start" />
                      Prepare audio
                    </Button>
                  </div>
                  <Button disabled={isRunning || !question.trim()} size="sm" type="submit">
                    {isRunning ? (
                      <LoaderCircle className="animate-spin" data-icon="inline-start" />
                    ) : (
                      <ArrowUp data-icon="inline-start" />
                    )}
                    {isRunning ? "Thinking" : "Send"}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
                  {runtimeMessage}
                </p>
              </form>
            ) : (
              <ExternalAgentHandoffPanel
                activeProject={activeProject}
                isRunning={isRunning}
                onPrepareProject={onPrepareProject}
                runtime={chatRuntime}
              />
            )}
          </div>
        </CardContent>
      </Card>

      <ProjectInspectorPanel
        activeProject={activeProject}
        audioDoctorReport={audioDoctorReport}
        chatDoctorReport={chatDoctorReport}
        isRunning={isRunning}
        onIngestProject={onIngestProject}
        onPrepareAudio={onPrepareAudio}
        onPrepareChat={onPrepareChat}
        onPrepareProject={onPrepareProject}
        onRefreshProject={onRefreshProject}
        onToggleAutoIngest={onToggleAutoIngest}
        onViewChange={onViewChange}
        setupSteps={setupSteps}
        statusReport={statusReport}
      />
    </div>
  )
}

interface ChatRuntimeChooserProps {
  onRuntimeChange: (runtime: ChatRuntime) => void
  runtime: ChatRuntime
}

function ChatRuntimeChooser({
  onRuntimeChange,
  runtime,
}: ChatRuntimeChooserProps): React.JSX.Element {
  const mode = chatRuntimeMeta(runtime)

  return (
    <div className="ragmir-soft-surface flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Badge variant={mode.isLocal ? "success" : "outline"}>{mode.badge}</Badge>
        <span className="text-sm font-semibold">{mode.title}</span>
        <span className="hidden max-w-[30rem] truncate text-xs text-muted-foreground sm:inline">
          {mode.description}
        </span>
      </div>
      <Field>
        <FieldLabel htmlFor="chat-runtime" className="sr-only">
          Chat runtime
        </FieldLabel>
        <Select
          onValueChange={(value) => {
            if (isChatRuntime(value)) {
              onRuntimeChange(value)
            }
          }}
          value={runtime}
        >
          <SelectTrigger id="chat-runtime" className="w-44">
            <SelectValue placeholder="Choose runtime" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="local">Local private chat</SelectItem>
              <SelectItem value="codex">Use with Codex</SelectItem>
              <SelectItem value="claude">Use with Claude</SelectItem>
              <SelectItem value="other-agent">Other MCP agent</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
    </div>
  )
}

interface ExternalAgentHandoffPanelProps {
  activeProject: RagmirProject
  isRunning: boolean
  onPrepareProject: (project: RagmirProject) => Promise<void>
  runtime: Exclude<ChatRuntime, "local">
}

function ExternalAgentHandoffPanel({
  activeProject,
  isRunning,
  onPrepareProject,
  runtime,
}: ExternalAgentHandoffPanelProps): React.JSX.Element {
  const handoff = externalAgentHandoff(activeProject, runtime)

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="ragmir-soft-surface flex flex-wrap items-center justify-between gap-3 rounded-md border p-2.5">
        <div className="flex min-w-0 items-start gap-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">{handoff.title}</p>
              <Badge variant="outline">Not fully local</Badge>
            </div>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
              Ragmir keeps its index and MCP server local, but the external agent conversation is
              controlled by {handoff.agentName}. Prompts, retrieved snippets, and pasted
              confidential content may leave this machine through that agent.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            disabled={isRunning}
            size="sm"
            type="button"
            onClick={() => void onPrepareProject(activeProject)}
          >
            <Wand2 data-icon="inline-start" />
            Prepare
          </Button>
          <Button
            size="sm"
            type="button"
            variant="outline"
            onClick={() => void copyCommand(handoff.starterPrompt)}
          >
            <Copy data-icon="inline-start" />
            Copy prompt
          </Button>
        </div>
      </div>

      <div className="grid gap-1.5">
        {handoff.commands.map((command) => (
          <CommandCopyCard command={command.command} key={command.label} label={command.label} />
        ))}
      </div>
    </div>
  )
}

interface CommandCopyCardProps {
  command: string
  label: string
}

function CommandCopyCard({ command, label }: CommandCopyCardProps): React.JSX.Element {
  return (
    <div className="ragmir-soft-surface grid grid-cols-[minmax(7rem,10rem)_minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-2.5 py-2">
      <p className="truncate text-xs font-semibold">{label}</p>
      <code className="block truncate font-mono text-[11px] text-muted-foreground">{command}</code>
      <Button
        aria-label={`Copy ${label}`}
        size="icon"
        type="button"
        variant="ghost"
        onClick={() => void copyCommand(command)}
      >
        <Copy aria-hidden="true" />
      </Button>
    </div>
  )
}

interface ChatMessageBubbleProps {
  audioRenderingMessageId: string | null
  chatId: string
  message: ChatMessage
  onRenderAudio: (chatId: string, messageId: string) => Promise<void>
  onStopAudio: () => void
  onToggleAudio: (chatId: string, messageId: string) => Promise<void>
  playingAudioMessageId: string | null
  project: RagmirProject
}

interface ChatContextSummaryProps {
  chatDoctorReport: ChatDoctorReport | null
  isRunning: boolean
  messages: ChatMessage[]
}

function ChatContextSummary({
  chatDoctorReport,
  isRunning,
  messages,
}: ChatContextSummaryProps): React.JSX.Element {
  const historyMessages = chatContextMessages(messages)
  const chatModelReady = chatDoctorReport?.localModelPathExists ?? false

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <Badge variant={chatModelReady ? "success" : "outline"}>
        {chatModelReady ? "Local model ready" : "Local model explicit setup"}
      </Badge>
      <Badge variant="outline">Project index + top {CHAT_TOP_K} passages</Badge>
      <Badge variant="outline">
        {historyMessages.length > 0
          ? `${historyMessages.length} recent message${historyMessages.length === 1 ? "" : "s"}`
          : "No chat memory yet"}
      </Badge>
      {isRunning ? (
        <span className="inline-flex items-center gap-2">
          <TypingDots />
          Local answer running
        </span>
      ) : null}
    </div>
  )
}

function ChatMessageBubble({
  audioRenderingMessageId,
  chatId,
  message,
  onRenderAudio,
  onStopAudio,
  onToggleAudio,
  playingAudioMessageId,
  project,
}: ChatMessageBubbleProps): React.JSX.Element {
  const isUser = message.role === "user"
  const isWorking = message.status === "thinking" || message.status === "streaming"
  const isError = message.status === "error"
  const isAudioRendering =
    audioRenderingMessageId === message.id || message.audio?.status === "rendering"
  const isAudioPlaying = playingAudioMessageId === message.id || message.audio?.status === "playing"
  const sources = message.result?.sources ?? []

  return (
    <article className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[min(44rem,86%)] rounded-lg border px-3 py-2",
          isError
            ? "border-destructive/50 bg-destructive/10"
            : isUser
              ? "border-[var(--ragmir-app-active-line)] bg-[var(--ragmir-app-active)]"
              : "ragmir-soft-surface",
        )}
      >
        <div className="mb-1 flex items-center gap-2">
          <Badge variant={isError ? "outline" : isUser ? "outline" : "secondary"}>
            {isUser ? "You" : "Ragmir"}
          </Badge>
          <span className="text-[11px] text-muted-foreground">{formatDate(message.createdAt)}</span>
          {message.statusLabel ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              {isWorking ? <TypingDots /> : null}
              {message.statusLabel}
            </span>
          ) : null}
        </div>
        {message.content ? (
          <ChatMarkdown content={message.content} />
        ) : (
          <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
            <TypingDots />
            Searching citations and preparing a local answer...
          </div>
        )}
        {sources.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {sources.slice(0, 4).map((source, index) => (
              <a
                className="inline-flex max-w-64 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                href={sourceFileUrl(project, source)}
                key={`${source.relativePath}-${source.chunkIndex}`}
                rel="noreferrer"
                target="_blank"
              >
                <span className="truncate">
                  [{index + 1}] {source.relativePath}
                </span>
                <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
              </a>
            ))}
          </div>
        ) : null}
        {!isUser && message.content.trim() ? (
          <ChatAudioControls
            audio={message.audio}
            isPlaying={isAudioPlaying}
            isRendering={isAudioRendering}
            onRender={() => void onRenderAudio(chatId, message.id)}
            onStop={onStopAudio}
            onToggle={() => void onToggleAudio(chatId, message.id)}
          />
        ) : null}
      </div>
    </article>
  )
}

interface ChatAudioControlsProps {
  audio: ChatMessageAudio | undefined
  isPlaying: boolean
  isRendering: boolean
  onRender: () => void
  onStop: () => void
  onToggle: () => void
}

function ChatAudioControls({
  audio,
  isPlaying,
  isRendering,
  onRender,
  onStop,
  onToggle,
}: ChatAudioControlsProps): React.JSX.Element {
  const hasAudioFile = Boolean(audio?.outputPath)
  const statusLabel = audioStatusLabel(audio, isRendering, isPlaying)

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge
            variant={audio?.status === "error" ? "outline" : hasAudioFile ? "success" : "outline"}
          >
            {statusLabel}
          </Badge>
          {audio?.outputPath ? (
            <span className="max-w-72 truncate text-[11px] text-muted-foreground">
              {audio.outputFormat?.toUpperCase() ?? "AUDIO"} · {audio.outputPath}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              Local TTS, rendered under .ragmir/audio
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            aria-label={isPlaying ? "Pause local audio answer" : "Listen to local audio answer"}
            disabled={isRendering}
            size="sm"
            type="button"
            variant={hasAudioFile ? "secondary" : "outline"}
            onClick={onToggle}
          >
            {isRendering ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : isPlaying ? (
              <Pause data-icon="inline-start" />
            ) : (
              <Play data-icon="inline-start" />
            )}
            {audioActionLabel(audio, isRendering, isPlaying)}
          </Button>
          {isPlaying ? (
            <Button size="sm" type="button" variant="outline" onClick={onStop}>
              <Pause data-icon="inline-start" />
              Stop
            </Button>
          ) : null}
          {hasAudioFile ? (
            <Button
              disabled={isRendering}
              size="sm"
              type="button"
              variant="ghost"
              onClick={onRender}
            >
              <RefreshCw data-icon="inline-start" />
              Re-render
            </Button>
          ) : null}
        </div>
      </div>
      {audio?.error ? <p className="mt-2 text-xs text-destructive">{audio.error}</p> : null}
    </div>
  )
}

interface ChatMarkdownProps {
  content: string
}

function ChatMarkdown({ content }: ChatMarkdownProps): React.JSX.Element {
  return (
    <div className="ragmir-chat-markdown text-sm leading-6 text-foreground/90">
      <Suspense fallback={<p className="whitespace-pre-wrap">{content}</p>}>
        <Markdown components={CHAT_MARKDOWN_COMPONENTS}>{content}</Markdown>
      </Suspense>
    </div>
  )
}

function TypingDots(): React.JSX.Element {
  return (
    <span className="ragmir-typing-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  )
}

interface ProjectInspectorPanelProps {
  activeProject: RagmirProject
  audioDoctorReport: AudioDoctorReport | null
  chatDoctorReport: ChatDoctorReport | null
  isRunning: boolean
  onIngestProject: (project: RagmirProject) => Promise<void>
  onPrepareAudio: () => Promise<void>
  onPrepareChat: () => Promise<void>
  onPrepareProject: (project: RagmirProject) => Promise<void>
  onRefreshProject: (project: RagmirProject) => Promise<void>
  onToggleAutoIngest: (project: RagmirProject) => void
  onViewChange: (view: View) => void
  setupSteps: SetupStep[]
  statusReport: StatusReport | null
}

function ProjectInspectorPanel({
  activeProject,
  audioDoctorReport,
  chatDoctorReport,
  isRunning,
  onIngestProject,
  onPrepareAudio,
  onPrepareChat,
  onPrepareProject,
  onRefreshProject,
  onToggleAutoIngest,
  onViewChange,
  setupSteps,
  statusReport,
}: ProjectInspectorPanelProps): React.JSX.Element {
  const modelRows = modelStatusRows(statusReport, chatDoctorReport, audioDoctorReport)

  return (
    <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto">
      <Card className="ragmir-card-surface">
        <CardHeader className="border-b border-border p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="truncate">{activeProject.name}</CardTitle>
              <CardDescription className="truncate">{activeProject.projectRoot}</CardDescription>
            </div>
            <Badge variant={statusBadge(activeProject.status)}>
              {projectStatusLabel(activeProject.status)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 p-4">
          <Progress value={activeProject.progress} aria-label="Project readiness" />
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            <InfoTile
              label="Indexed"
              value={`${activeProject.filesIndexed} files`}
              detail={`${activeProject.chunksIndexed} chunks`}
            />
            <InfoTile
              label="Mode"
              value={projectSourceLabel(activeProject.sourceKind)}
              detail={activeProject.autoIngestEnabled ? "Auto-index enabled" : "Manual indexing"}
            />
          </div>

          <div className="grid gap-1">
            <QuickActionRow
              icon={<Wand2 aria-hidden="true" />}
              title="Prepare everything"
              detail="Setup, models, index, checks"
              action="Run"
              disabled={isRunning}
              onClick={() => void onPrepareProject(activeProject)}
            />
            <QuickActionRow
              icon={<RefreshCw aria-hidden="true" />}
              title="Re-index"
              detail="Index changed files"
              action="Run"
              disabled={isRunning}
              onClick={() => void onIngestProject(activeProject)}
            />
            <QuickActionRow
              icon={<BookOpenCheck aria-hidden="true" />}
              title="Check status"
              detail="Doctor, chat, audio"
              action="Check"
              disabled={isRunning}
              onClick={() => void onRefreshProject(activeProject)}
            />
            <QuickActionRow
              icon={<Sparkles aria-hidden="true" />}
              title="Prepare chat model"
              detail="Local chat preload"
              action="Setup"
              disabled={isRunning}
              onClick={() => void onPrepareChat()}
            />
            <QuickActionRow
              icon={<Volume2 aria-hidden="true" />}
              title="Prepare audio model"
              detail="Offline TTS preload"
              action="Setup"
              disabled={isRunning}
              onClick={() => void onPrepareAudio()}
            />
            <QuickActionRow
              icon={<Activity aria-hidden="true" />}
              title={activeProject.autoIngestEnabled ? "Disable auto-index" : "Enable auto-index"}
              detail={autoIngestLabel(activeProject)}
              action={activeProject.autoIngestEnabled ? "Disable" : "Enable"}
              disabled={isRunning}
              onClick={() => onToggleAutoIngest(activeProject)}
            />
          </div>

          <div className="grid gap-2">
            {modelRows.map((row) => (
              <InfoTile key={row.label} label={row.label} value={row.value} detail={row.detail} />
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={() => onViewChange("config")}
            >
              <FileSearch data-icon="inline-start" />
              Settings
            </Button>
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={() => onViewChange("privacy")}
            >
              <ShieldCheck data-icon="inline-start" />
              Privacy
            </Button>
          </div>
        </CardContent>
      </Card>

      <SetupProgressPanel steps={setupSteps} />
      <CommandCoveragePanel activeProject={activeProject} />
    </aside>
  )
}

interface QuickActionRowProps {
  action: string
  detail: string
  disabled: boolean
  icon: React.ReactNode
  onClick: () => void
  title: string
}

function QuickActionRow({
  action,
  detail,
  disabled,
  icon,
  onClick,
  title,
}: QuickActionRowProps): React.JSX.Element {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border py-2 text-muted-foreground last:border-b-0">
      <span className="[&_svg]:size-3.5">{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground/85" title={detail}>
          {title}
        </p>
      </div>
      <Button
        className="min-w-14"
        disabled={disabled}
        size="sm"
        title={detail}
        type="button"
        variant="ghost"
        onClick={onClick}
      >
        {action}
      </Button>
    </div>
  )
}

interface CommandCoveragePanelProps {
  activeProject: RagmirProject | null
}

interface CommandCoverageEntry {
  command: string
  label: string
  status: "automated" | "app" | "cli"
}

interface CommandCoverageGroup {
  description: string
  entries: CommandCoverageEntry[]
  title: string
}

function CommandCoveragePanel({ activeProject }: CommandCoveragePanelProps): React.JSX.Element {
  const commandPrefix = `rgr --project-root ${
    activeProject ? shellQuote(activeProject.projectRoot) : "<folder>"
  }`
  const groups: CommandCoverageGroup[] = [
    {
      title: "Core workspace",
      description: "Initialize, diagnose, configure sources, and prepare semantic retrieval.",
      entries: [
        { label: "Full setup", command: `${commandPrefix} setup --semantic`, status: "automated" },
        { label: "Repair", command: `${commandPrefix} doctor --fix`, status: "automated" },
        { label: "Doctor", command: `${commandPrefix} doctor`, status: "app" },
        { label: "Status", command: `${commandPrefix} status`, status: "app" },
        { label: "Sources", command: `${commandPrefix} sources list`, status: "app" },
        {
          label: "Semantic model",
          command: `${commandPrefix} models pull --enable`,
          status: "automated",
        },
      ],
    },
    {
      title: "Retrieval",
      description: "Index local files, search citations, ask without an LLM, and evaluate recall.",
      entries: [
        { label: "Index", command: `${commandPrefix} ingest`, status: "app" },
        { label: "Rebuild", command: `${commandPrefix} ingest --rebuild`, status: "automated" },
        { label: "Search", command: `${commandPrefix} search "question"`, status: "cli" },
        { label: "Ask", command: `${commandPrefix} ask "question"`, status: "app" },
        { label: "Research", command: `${commandPrefix} research "topic"`, status: "cli" },
        {
          label: "Evaluate",
          command: `${commandPrefix} evaluate --golden golden.json --fail-under 0.8`,
          status: "cli",
        },
        { label: "Route prompt", command: `${commandPrefix} route-prompt "prompt"`, status: "cli" },
      ],
    },
    {
      title: "Privacy and agents",
      description: "Audit local posture and expose Ragmir safely to coding agents.",
      entries: [
        {
          label: "Unsupported files",
          command: `${commandPrefix} audit --unsupported`,
          status: "app",
        },
        {
          label: "Security audit",
          command: `${commandPrefix} security-audit --strict`,
          status: "app",
        },
        { label: "Usage report", command: `${commandPrefix} usage-report --days 7`, status: "cli" },
        { label: "MCP server", command: `${commandPrefix} serve-mcp`, status: "cli" },
        { label: "Skill path", command: `${commandPrefix} skill-path`, status: "cli" },
        {
          label: "Install agents",
          command: `${commandPrefix} install-agent --agents claude,codex,kimi,opencode,cline`,
          status: "cli",
        },
      ],
    },
    {
      title: "Chat and TTS",
      description: "Preload local models once, then answer and render audio offline.",
      entries: [
        { label: "Chat setup", command: `${commandPrefix} chat setup`, status: "automated" },
        { label: "Chat doctor", command: `${commandPrefix} chat doctor`, status: "app" },
        {
          label: "Chat answer",
          command: `${commandPrefix} chat "question" --offline`,
          status: "app",
        },
        { label: "TTS doctor", command: `${commandPrefix} audio --doctor`, status: "app" },
        {
          label: "TTS preload",
          command: `${commandPrefix} audio preload.txt --engine transformers --allow-remote-models`,
          status: "automated",
        },
        {
          label: "Offline audio",
          command: `${commandPrefix} audio narration.txt --offline`,
          status: "app",
        },
      ],
    },
  ]

  return (
    <details className="ragmir-card-surface rounded-lg border p-3 backdrop-blur-xl">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex min-w-0 items-center gap-2">
          <Terminal className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-semibold">Exact command coverage</span>
        </span>
        <Badge variant="outline">Advanced</Badge>
      </summary>
      <div className="mt-3 grid gap-2 xl:grid-cols-2">
        {groups.map((group) => (
          <div className="ragmir-soft-surface rounded-md border p-2.5" key={group.title}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{group.title}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{group.description}</p>
              </div>
            </div>
            <div className="mt-2 grid gap-1.5">
              {group.entries.map((entry) => (
                <CommandCoverageRow entry={entry} key={`${group.title}-${entry.label}`} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </details>
  )
}

interface CommandCoverageRowProps {
  entry: CommandCoverageEntry
}

function CommandCoverageRow({ entry }: CommandCoverageRowProps): React.JSX.Element {
  return (
    <div className="ragmir-soft-surface grid grid-cols-[1fr_auto] items-center gap-2 rounded-md border px-2.5 py-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold">{entry.label}</span>
          <Badge variant={commandStatusBadge(entry.status)}>
            {commandStatusLabel(entry.status)}
          </Badge>
        </div>
        <code className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">
          {entry.command}
        </code>
      </div>
      <Button
        aria-label={`Copy ${entry.label} command`}
        size="icon"
        type="button"
        variant="ghost"
        onClick={() => void copyCommand(entry.command)}
      >
        <Copy aria-hidden="true" />
      </Button>
    </div>
  )
}

interface SetupProgressPanelProps {
  steps: SetupStep[]
}

function SetupProgressPanel({ steps }: SetupProgressPanelProps): React.JSX.Element {
  const activeStep = steps.find((step) => step.status === "running")

  return (
    <div className="ragmir-card-surface rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold">Workspace preparation</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {activeStep ? activeStep.detail : "Prepare everything runs the local setup end to end."}
          </p>
        </div>
        <Badge variant={steps.every((step) => step.status === "done") ? "success" : "outline"}>
          {setupProgressLabel(steps)}
        </Badge>
      </div>

      <div className="mt-3 grid gap-1.5">
        {steps.map((step) => (
          <div
            className="ragmir-soft-surface grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-md border px-2.5 py-2"
            key={step.id}
          >
            <SetupStepDot status={step.status} />
            <div className="min-w-0" title={step.detail}>
              <p className="truncate text-sm font-semibold">{step.label}</p>
            </div>
            <Badge variant={setupStepBadge(step.status)}>{setupStepLabel(step.status)}</Badge>
          </div>
        ))}
      </div>
    </div>
  )
}

interface SetupStepDotProps {
  status: SetupStepStatus
}

function SetupStepDot({ status }: SetupStepDotProps): React.JSX.Element {
  if (status === "done") {
    return <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
  }
  if (status === "error") {
    return <TriangleAlert className="size-4 text-destructive" aria-hidden="true" />
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-3 rounded-full border border-muted-foreground/40",
        status === "running" ? "animate-pulse bg-primary" : "bg-muted",
      )}
    />
  )
}

interface ProjectPanelProps {
  activeProject: RagmirProject | null
}

interface ConfigViewProps extends ProjectPanelProps {
  configFile: RagmirConfigFile | null
  configForm: ConfigFormState
  isRunning: boolean
  onConfigFormChange: (patch: ConfigFormPatch) => void
  onInitializeConfigFolder: () => Promise<void>
  onLoadConfig: () => Promise<void>
  onSaveConfig: () => Promise<void>
  onUseDirectFolderConfig: () => void
  statusReport: StatusReport | null
}

function ConfigView({
  activeProject,
  configFile,
  configForm,
  isRunning,
  onConfigFormChange,
  onInitializeConfigFolder,
  onLoadConfig,
  onSaveConfig,
  onUseDirectFolderConfig,
  statusReport,
}: ConfigViewProps): React.JSX.Element {
  const disabled = !activeProject || isRunning
  const sourceEntries = splitConfigLines(configForm.sourcesText)
  const customPatternCount = customRedactionPatternCount(configForm.baseConfig)

  return (
    <div className="mx-auto w-full max-w-6xl">
      <Card className="ragmir-card-surface backdrop-blur-xl">
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle>Workspace config</CardTitle>
              <CardDescription>
                Sources, retrieval quality, and local safety defaults in one place.
              </CardDescription>
            </div>
            <Badge variant={configFile?.exists ? "success" : "outline"}>
              {configFile?.exists ? "Config loaded" : "Config not loaded"}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={disabled} size="sm" type="button" onClick={onLoadConfig}>
              <RefreshCw data-icon="inline-start" />
              Load
            </Button>
            <Button disabled={disabled} size="sm" type="button" onClick={onSaveConfig}>
              <CheckCircle2 data-icon="inline-start" />
              Save
            </Button>
            <Button
              disabled={disabled}
              size="sm"
              type="button"
              variant="outline"
              onClick={onInitializeConfigFolder}
            >
              <Wand2 data-icon="inline-start" />
              Init
            </Button>
            <Button
              disabled={disabled}
              size="sm"
              type="button"
              variant="outline"
              onClick={onUseDirectFolderConfig}
            >
              <FolderPlus data-icon="inline-start" />
              Use folder
            </Button>
          </div>
        </CardHeader>

        <CardContent className="grid gap-4">
          {!activeProject ? (
            <EmptyPanel
              icon={<FileSearch aria-hidden="true" />}
              title="No workspace selected"
              description="Choose an existing Ragmir repo or any local folder before editing config."
            />
          ) : null}

          <div className="grid gap-3 md:grid-cols-4">
            <InfoTile
              label="Root"
              value={activeProject?.name ?? "None"}
              detail={activeProject?.projectRoot ?? "Add a project first."}
            />
            <InfoTile
              label="Config"
              value={configFile?.exists ? "Loaded" : "Not loaded"}
              detail={configFile?.configPath ?? "Load or initialize config."}
            />
            <InfoTile
              label="Provider"
              value={configForm.embeddingProvider}
              detail={
                configForm.transformersAllowRemoteModels ? "Remote downloads allowed" : "Offline"
              }
            />
            <InfoTile
              label="Index"
              value={`${statusReport?.chunksIndexed ?? 0} chunks`}
              detail={`${sourceEntries.length} extra sources, ${customPatternCount} custom patterns`}
            />
          </div>

          <div className="grid gap-3 xl:grid-cols-[1.05fr_0.95fr]">
            <FieldSet className="ragmir-soft-surface rounded-md border p-3">
              <FieldLegend>Sources</FieldLegend>
              <FieldDescription>
                Add folders, files, globs, or exclusions. One source per line.
              </FieldDescription>
              <FieldGroup className="mt-3">
                <Field data-disabled={disabled}>
                  <FieldLabel htmlFor="config-raw-dir">Raw folder</FieldLabel>
                  <Input
                    disabled={disabled}
                    id="config-raw-dir"
                    onChange={(event) => onConfigFormChange({ rawDir: event.currentTarget.value })}
                    value={configForm.rawDir}
                  />
                </Field>

                <Field data-disabled={disabled}>
                  <FieldLabel htmlFor="config-sources">Sources</FieldLabel>
                  <Textarea
                    className="min-h-36 rounded-lg font-mono text-xs leading-5"
                    disabled={disabled}
                    id="config-sources"
                    onChange={(event) =>
                      onConfigFormChange({ sourcesText: event.currentTarget.value })
                    }
                    placeholder={"docs/**/*.md\n../shared/specs\n!**/private/**"}
                    spellCheck={false}
                    value={configForm.sourcesText}
                  />
                </Field>

                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">Raw: {configForm.rawDir || "not set"}</Badge>
                  {sourceEntries.length > 0 ? (
                    sourceEntries.map((source) => (
                      <Badge key={source} variant="outline">
                        {source}
                      </Badge>
                    ))
                  ) : (
                    <Badge variant="outline">No extra sources</Badge>
                  )}
                </div>
              </FieldGroup>
            </FieldSet>

            <FieldSet className="ragmir-soft-surface rounded-md border p-3">
              <FieldLegend>Retrieval and privacy</FieldLegend>
              <FieldDescription>
                Keep remote downloads off for confidential work after model preload.
              </FieldDescription>
              <FieldGroup className="mt-3">
                <Field data-disabled={disabled}>
                  <FieldLabel htmlFor="config-embedding-provider">Embedding provider</FieldLabel>
                  <Select
                    disabled={disabled}
                    onValueChange={(value) => {
                      if (isEmbeddingProvider(value)) {
                        onConfigFormChange({ embeddingProvider: value })
                      }
                    }}
                    value={configForm.embeddingProvider}
                  >
                    <SelectTrigger id="config-embedding-provider" className="w-full">
                      <SelectValue placeholder="Choose provider" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="local-hash">Local hash, no model download</SelectItem>
                        <SelectItem value="transformers">
                          Transformers semantic embeddings
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                <ConfigSwitchField
                  checked={configForm.transformersAllowRemoteModels}
                  description="Only for intentional one-time model preload."
                  disabled={disabled}
                  id="config-allow-remote-models"
                  label="Allow remote model downloads"
                  onCheckedChange={(checked) =>
                    onConfigFormChange({ transformersAllowRemoteModels: checked })
                  }
                />
                <ConfigSwitchField
                  checked={configForm.redactionEnabled}
                  description="Run before indexing."
                  disabled={disabled}
                  id="config-redaction-enabled"
                  label="Enable redaction"
                  onCheckedChange={(checked) => onConfigFormChange({ redactionEnabled: checked })}
                />
                <ConfigSwitchField
                  checked={configForm.redactionBuiltIn}
                  description="Preserves existing custom patterns."
                  disabled={disabled || !configForm.redactionEnabled}
                  id="config-redaction-built-in"
                  label="Built-in redaction patterns"
                  onCheckedChange={(checked) => onConfigFormChange({ redactionBuiltIn: checked })}
                />
                <ConfigSwitchField
                  checked={configForm.accessLog}
                  description="Metadata-only local logs."
                  disabled={disabled}
                  id="config-access-log"
                  label="Access log"
                  onCheckedChange={(checked) => onConfigFormChange({ accessLog: checked })}
                />
              </FieldGroup>
            </FieldSet>
          </div>

          <details className="ragmir-soft-surface rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-semibold text-muted-foreground">
              Connection modes and preserved advanced settings
            </summary>
            <div className="mt-3 grid gap-3 text-xs leading-5 text-muted-foreground md:grid-cols-3">
              <p>
                <span className="font-semibold text-foreground">Existing repo:</span> load the
                existing local config, edit it, then re-index.
              </p>
              <p>
                <span className="font-semibold text-foreground">Plain folder:</span> use the
                selected folder as source to index it directly.
              </p>
              <p>
                <span className="font-semibold text-foreground">Synced folder:</span> Google Drive,
                Dropbox, iCloud, or cloned repos work when files exist on disk.
              </p>
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
  )
}

interface ConfigSwitchFieldProps {
  checked: boolean
  description: string
  disabled: boolean
  id: string
  label: string
  onCheckedChange: (checked: boolean) => void
}

function ConfigSwitchField({
  checked,
  description,
  disabled,
  id,
  label,
  onCheckedChange,
}: ConfigSwitchFieldProps): React.JSX.Element {
  return (
    <Field data-disabled={disabled} orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
      <Switch
        checked={checked}
        disabled={disabled}
        id={id}
        onCheckedChange={onCheckedChange}
        size="sm"
      />
    </Field>
  )
}

interface PrivacyViewProps extends ProjectPanelProps {
  chatDoctorReport: ChatDoctorReport | null
  isRunning: boolean
  onPullModels: () => Promise<void>
  onRunSecurityAudit: () => Promise<void>
  securityReport: SecurityAuditReport | null
  statusReport: StatusReport | null
}

function PrivacyView({
  activeProject,
  chatDoctorReport,
  isRunning,
  onPullModels,
  onRunSecurityAudit,
  securityReport,
  statusReport,
}: PrivacyViewProps): React.JSX.Element {
  const auditRows = privacyRows(activeProject, securityReport)

  return (
    <div className="mx-auto w-full max-w-6xl">
      <Card className="ragmir-card-surface backdrop-blur-xl">
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Local privacy posture</CardTitle>
              <CardDescription>
                Audit results and model/network controls for the selected workspace.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!activeProject || isRunning} size="sm" onClick={onRunSecurityAudit}>
                <ShieldCheck data-icon="inline-start" />
                Run check
              </Button>
              <Button
                disabled={!activeProject || isRunning}
                size="sm"
                variant="outline"
                onClick={onPullModels}
              >
                <Download data-icon="inline-start" />
                Semantic model
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="grid gap-2">
            {auditRows.map((row) => (
              <AuditRow key={row.label} row={row} />
            ))}
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <ControlTile
              icon={<LockKeyhole aria-hidden="true" />}
              title="Local state"
              value={activeProject?.storageDir ?? ".ragmir/storage"}
            />
            <ControlTile
              icon={<ShieldCheck aria-hidden="true" />}
              title="Redaction"
              value={securityReport ? redactionLabel(securityReport) : "Built-in patterns"}
            />
            <ControlTile
              icon={<BookOpenCheck aria-hidden="true" />}
              title="Search"
              value={
                statusReport
                  ? `${modelProviderLabel(statusReport.embeddingProvider)} / ${statusReport.embeddingModel}`
                  : "Local hash by default"
              }
            />
            <ControlTile
              icon={<WifiOff aria-hidden="true" />}
              title="Network"
              value={modelNetworkLabel(statusReport, securityReport)}
            />
            <ControlTile
              icon={<Activity aria-hidden="true" />}
              title="Access log"
              value={securityReport ? accessLogLabel(securityReport) : "Metadata only"}
            />
            <ControlTile
              icon={<Sparkles aria-hidden="true" />}
              title="Chat model"
              value={chatDoctorReport?.localModelPathExists ? "Prepared locally" : "Explicit setup"}
            />
            <ControlTile
              icon={<RefreshCw aria-hidden="true" />}
              title="Indexing"
              value="Incremental"
            />
            <ControlTile
              icon={<Cloud aria-hidden="true" />}
              title="Source"
              value={activeProject ? projectSourceLabel(activeProject.sourceKind) : "Local folder"}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

interface AuditRowProps {
  row: {
    label: string
    value: string
    state: "ok" | "warn"
  }
}

function AuditRow({ row }: AuditRowProps): React.JSX.Element {
  return (
    <div className="ragmir-soft-surface flex items-center justify-between gap-3 rounded-md border px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-3">
        {row.state === "ok" ? (
          <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
        ) : (
          <TriangleAlert className="size-4 shrink-0 text-accent" aria-hidden="true" />
        )}
        <div className="min-w-0">
          <p className="font-semibold">{row.label}</p>
          <p className="truncate text-xs text-muted-foreground">{row.value}</p>
        </div>
      </div>
      <Badge variant={row.state === "ok" ? "success" : "outline"}>
        {row.state === "ok" ? "Ready" : "Review"}
      </Badge>
    </div>
  )
}

interface LicenseViewProps {
  isChecking: boolean
  licenseKey: string
  onClear: () => void
  onLicenseKeyChange: (licenseKey: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
  validation: LicenseValidation
}

function LicenseView({
  isChecking,
  licenseKey,
  onClear,
  onLicenseKeyChange,
  onSubmit,
  validation,
}: LicenseViewProps): React.JSX.Element {
  return (
    <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <Card className="ragmir-card-surface backdrop-blur-xl">
        <CardHeader>
          <CardTitle>Activation</CardTitle>
          <CardDescription>Local license validation for direct-download builds.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="ragmir-soft-surface flex items-start justify-between gap-3 rounded-md border p-3">
            <div className="flex min-w-0 items-start gap-3">
              {validation.status === "valid" ? (
                <CheckCircle2 className="mt-1 size-4 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <TriangleAlert className="mt-1 size-4 shrink-0 text-accent" aria-hidden="true" />
              )}
              <div className="min-w-0">
                <p className="font-semibold">{licenseStatusLabel(validation)}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{validation.message}</p>
              </div>
            </div>
            <Badge variant={validation.status === "valid" ? "success" : "outline"}>
              {validation.status}
            </Badge>
          </div>

          <form className="flex flex-col gap-3" onSubmit={onSubmit}>
            <Textarea
              aria-label="License key"
              className="rounded-md"
              name="licenseKey"
              onChange={(event) => onLicenseKeyChange(event.currentTarget.value)}
              placeholder="RAGMIR1.payload.signature"
              value={licenseKey}
            />
            <div className="flex flex-wrap gap-2">
              <Button disabled={isChecking} type="submit">
                <KeyRound data-icon="inline-start" />
                Activate
              </Button>
              <Button
                disabled={isChecking || !licenseKey}
                type="button"
                variant="outline"
                onClick={onClear}
              >
                Clear
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="ragmir-card-surface backdrop-blur-xl">
        <CardHeader>
          <CardTitle>License details</CardTitle>
          <CardDescription>
            Stored locally. No hosted account is required at runtime.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-2">
          {licenseDetailRows(validation).map((row) => (
            <InfoTile key={row.label} label={row.label} value={row.value} detail={row.detail} />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

interface ControlTileProps {
  icon: React.ReactNode
  title: string
  value: string
}

function ControlTile({ icon, title, value }: ControlTileProps): React.JSX.Element {
  return (
    <div className="ragmir-soft-surface grid grid-cols-[auto_1fr] items-center gap-2 rounded-md border px-2.5 py-2">
      <div className="text-muted-foreground [&_svg]:size-3.5">{icon}</div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{value}</p>
      </div>
    </div>
  )
}

interface InfoTileProps {
  detail: string
  label: string
  value: string
}

function InfoTile({ detail, label, value }: InfoTileProps): React.JSX.Element {
  return (
    <div className="ragmir-soft-surface rounded-md border px-2.5 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-semibold">{value}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}

interface EmptyPanelProps {
  description: string
  icon: React.ReactNode
  title: string
}

function EmptyPanel({ description, icon, title }: EmptyPanelProps): React.JSX.Element {
  return (
    <div className="ragmir-soft-surface flex min-h-28 flex-col items-center justify-center gap-2 rounded-md border border-dashed p-5 text-center">
      <div className="text-muted-foreground [&_svg]:size-5">{icon}</div>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

async function chooseProjectFolder(): Promise<string | null> {
  if (!isTauriRuntime()) {
    throw new Error(
      "Folder picker is only available in the Tauri app. Run pnpm dev:app or paste an absolute path.",
    )
  }
  const selected = await open({ directory: true, multiple: false })
  if (typeof selected === "string") {
    return selected
  }
  return null
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

function createSetupSteps(): SetupStep[] {
  return SETUP_STEP_DEFINITIONS.map((step) => ({ ...step, status: "idle" }))
}

function updateSetupStep(
  steps: SetupStep[],
  stepId: SetupStepId,
  status: SetupStepStatus,
): SetupStep[] {
  return steps.map((step) => (step.id === stepId ? { ...step, status } : step))
}

function setupProgressLabel(steps: SetupStep[]): string {
  if (steps.some((step) => step.status === "error")) {
    return "Needs review"
  }
  const doneCount = steps.filter((step) => step.status === "done").length
  if (doneCount === steps.length) {
    return "Ready"
  }
  if (steps.some((step) => step.status === "running")) {
    return `${doneCount}/${steps.length}`
  }
  return "Not started"
}

function setupStepLabel(status: SetupStepStatus): string {
  switch (status) {
    case "done":
      return "Done"
    case "running":
      return "Running"
    case "error":
      return "Review"
    case "idle":
      return "Pending"
  }
}

function setupStepBadge(status: SetupStepStatus): "success" | "outline" | "secondary" {
  switch (status) {
    case "done":
      return "success"
    case "running":
      return "secondary"
    case "error":
    case "idle":
      return "outline"
  }
}

function commandStatusLabel(status: CommandCoverageEntry["status"]): string {
  switch (status) {
    case "automated":
      return "Prepare"
    case "app":
      return "App"
    case "cli":
      return "CLI"
  }
}

function commandStatusBadge(status: CommandCoverageEntry["status"]): "success" | "outline" {
  return status === "automated" ? "success" : "outline"
}

async function copyCommand(command: string): Promise<void> {
  await navigator.clipboard?.writeText(command)
}

function chatRuntimeMeta(runtime: ChatRuntime): {
  badge: string
  description: string
  isLocal: boolean
  title: string
} {
  switch (runtime) {
    case "local":
      return {
        badge: "Private",
        description: "Answers run through Ragmir Chat with local retrieval and offline generation.",
        isLocal: true,
        title: "Local private chat",
      }
    case "codex":
      return {
        badge: "Cloud agent",
        description: "Use Ragmir as local MCP context from the Codex interface.",
        isLocal: false,
        title: "Codex",
      }
    case "claude":
      return {
        badge: "Cloud agent",
        description: "Use Ragmir as local MCP context from Claude Code.",
        isLocal: false,
        title: "Claude",
      }
    case "other-agent":
      return {
        badge: "External agent",
        description: "Use Ragmir through a generic MCP-compatible coding agent.",
        isLocal: false,
        title: "Other agent",
      }
  }
}

function externalAgentHandoff(
  project: RagmirProject,
  runtime: Exclude<ChatRuntime, "local">,
): {
  agentName: string
  commands: Array<{ command: string; label: string }>
  starterPrompt: string
  title: string
} {
  const commandPrefix = `rgr --project-root ${shellQuote(project.projectRoot)}`
  const mcpConfigPath = shellQuote(joinProjectPath(project.projectRoot, ".ragmir", "mcp.json"))
  const starterPrompt = [
    "Use Ragmir for this workspace before answering.",
    "Query the local Ragmir MCP tools for cited context, do not guess from memory, and tell me when the answer uses retrieved snippets.",
    "If the repo contains confidential specs or private documents, remind me that this external agent conversation is not fully local.",
  ].join(" ")

  if (runtime === "codex") {
    const codexConfigPath = shellQuote(
      joinProjectPath(project.projectRoot, ".ragmir", "codex-mcp.toml"),
    )
    return {
      agentName: "Codex",
      title: "Codex handoff",
      starterPrompt,
      commands: [
        {
          label: "Generate Codex helper",
          command: `${commandPrefix} setup --agents codex --semantic`,
        },
        {
          label: "Show Codex MCP snippet",
          command: `cat ${codexConfigPath}`,
        },
        {
          label: "Install Codex skill",
          command: `${commandPrefix} install-agent --agents codex --scope project`,
        },
      ],
    }
  }

  if (runtime === "claude") {
    return {
      agentName: "Claude",
      title: "Claude handoff",
      starterPrompt,
      commands: [
        {
          label: "Generate Claude helper",
          command: `${commandPrefix} setup --agents claude --semantic`,
        },
        {
          label: "Register Claude MCP",
          command: `cd ${shellQuote(project.projectRoot)} && claude mcp add-json --scope local ragmir "$(cat .ragmir/claude-mcp-server.json)"`,
        },
        {
          label: "Install Claude skill",
          command: `${commandPrefix} install-agent --agents claude --scope project`,
        },
      ],
    }
  }

  return {
    agentName: "the selected external agent",
    title: "Generic MCP handoff",
    starterPrompt,
    commands: [
      {
        label: "Generate MCP helper",
        command: `${commandPrefix} setup --agents all --semantic`,
      },
      {
        label: "Show generic MCP config",
        command: `cat ${mcpConfigPath}`,
      },
      {
        label: "Run MCP server manually",
        command: `${commandPrefix} serve-mcp`,
      },
    ],
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function privacyRows(
  project: RagmirProject | null,
  report: SecurityAuditReport | null,
): Array<{
  label: string
  value: string
  state: "ok" | "warn"
}> {
  if (report) {
    return [
      {
        label: "Source",
        value: project ? projectSourceLabel(project.sourceKind) : "No workspace selected",
        state: project?.sourceKind === "google-drive" ? "warn" : "ok",
      },
      { label: "Telemetry", value: "Off", state: report.zeroTelemetry ? "ok" : "warn" },
      {
        label: "Remote models",
        value: report.providers.transformersAllowRemoteModels ? "Allowed" : "Disabled",
        state: report.providers.transformersAllowRemoteModels ? "warn" : "ok",
      },
      {
        label: "Redaction",
        value: redactionLabel(report),
        state: report.redaction.enabled && report.redaction.builtIn ? "ok" : "warn",
      },
      {
        label: "Generated state",
        value: report.storage.path,
        state: report.storage.gitIgnored ? "ok" : "warn",
      },
      {
        label: "Warnings",
        value: report.warnings.length === 0 ? "None" : report.warnings.join("; "),
        state: report.warnings.length === 0 ? "ok" : "warn",
      },
    ]
  }

  return [
    {
      label: "Source",
      value: project ? projectSourceLabel(project.sourceKind) : "No workspace selected",
      state: project?.sourceKind === "google-drive" ? "warn" : "ok",
    },
    { label: "Telemetry", value: "Off", state: "ok" },
    { label: "Remote models", value: "Disabled by default", state: "ok" },
    { label: "Redaction", value: "Before indexing", state: "ok" },
    {
      label: "Generated state",
      value: project ? project.storageDir : "No workspace selected",
      state: project ? "ok" : "warn",
    },
    { label: "Unsupported files", value: "Awaiting check", state: "warn" },
  ]
}

function projectProgress(report: DoctorReport): number {
  if (report.ready) return 100
  if (!report.initialized) return 0
  if (report.chunksIndexed > 0) return 75
  if (report.supportedFiles > 0) return 45
  return 20
}

function projectStatusFromDoctor(report: DoctorReport): ProjectStatus {
  if (!report.initialized) return "needs-setup"
  if (report.ready) return "ready"
  return "needs-review"
}

function redactionLabel(report: SecurityAuditReport): string {
  if (report.redaction.enabled && report.redaction.builtIn) return "Built-in patterns"
  if (report.redaction.enabled) return "Custom only"
  return "Disabled"
}

function accessLogLabel(report: SecurityAuditReport): string {
  if (!report.accessLog.enabled) return "Disabled"
  return report.accessLog.storesRawQueries ? "Review raw query storage" : "Metadata only"
}

function shouldAutoIngestProject(project: RagmirProject): boolean {
  if (!project.autoIngestEnabled || project.status === "indexing") {
    return false
  }
  if (!project.lastAutoIngestAt) {
    return true
  }
  return Date.now() - new Date(project.lastAutoIngestAt).getTime() >= AUTO_INGEST_INTERVAL_MS
}

function autoIngestLabel(project: RagmirProject): string {
  if (!project.autoIngestEnabled) {
    return "Manual indexing only."
  }
  const source =
    project.sourceKind === "google-drive" ? "Google Drive sync folder" : "Watched folder"
  return project.lastAutoIngestAt
    ? `${source}, last auto-index ${formatDate(project.lastAutoIngestAt)}.`
    : `${source}, first auto-index pending.`
}

function licenseStatusLabel(validation: LicenseValidation): string {
  switch (validation.status) {
    case "valid":
      return validation.updatesExpired ? "Activated, updates expired" : "Activated"
    case "expired":
      return "Expired"
    case "unconfigured":
      return "Validation key missing"
    case "invalid":
      return "Invalid"
    case "empty":
      return "No license"
  }
}

function licenseDetailRows(validation: LicenseValidation): Array<{
  label: string
  value: string
  detail: string
}> {
  if (validation.status !== "valid" && validation.status !== "expired") {
    return [
      { label: "Product", value: "Ragmir Desktop", detail: "Per-major local validation" },
      {
        label: "Public key",
        value: "Build-time config",
        detail: "VITE_RAGMIR_LICENSE_PUBLIC_KEY_JWK",
      },
      { label: "Storage", value: "Local app storage", detail: "No hosted account required" },
      { label: "Mode", value: "Offline first", detail: "Signature check happens locally" },
    ]
  }

  const payload = validation.payload
  return [
    { label: "Holder", value: payload.holder, detail: payload.licenseId },
    { label: "Tier", value: payload.tier, detail: "Licensed plan" },
    { label: "Major", value: String(payload.majorVersion), detail: "Per-major activation" },
    {
      label: "Updates until",
      value: formatDate(payload.updatesUntil),
      detail: "Included update window",
    },
    {
      label: "Expiration",
      value: payload.expiresAt ? formatDate(payload.expiresAt) : "Perpetual",
      detail: payload.expiresAt ? "Subscription-style validity" : "No runtime expiration",
    },
    { label: "Issued", value: formatDate(payload.issuedAt), detail: "Signed license metadata" },
  ]
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(value))
}

function droppedProjectPath(dataTransfer: DataTransfer): string | null {
  for (const file of Array.from(dataTransfer.files)) {
    const path = (file as File & { path?: unknown }).path
    if (typeof path === "string" && path.trim()) {
      return path
    }
  }
  return null
}

function preparedMessage(result: IngestResult): string {
  return `Workspace indexed: ${result.indexedFiles} files, ${result.chunks} chunks, ${result.sensitiveFiles} sensitive file${result.sensitiveFiles === 1 ? "" : "s"} skipped.`
}

function modelStatusRows(
  report: StatusReport | null,
  chatReport: ChatDoctorReport | null,
  audioReport: AudioDoctorReport | null,
): Array<{
  label: string
  value: string
  detail: string
}> {
  if (!report) {
    return [
      { label: "Search", value: "Awaiting check", detail: "Run Check on the active workspace." },
      {
        label: "Embedding model",
        value: "Configured per workspace",
        detail: ".ragmir/config.json",
      },
      {
        label: "Chat model",
        value: chatReport?.localModelPathExists ? "Prepared" : "Not prepared",
        detail: chatReport?.defaultModel ?? "Run Prepare local chat when needed.",
      },
      {
        label: "Audio model",
        value: audioReport?.transformersAvailable ? "Available" : "Awaiting check",
        detail: audioReport?.defaultModel ?? "Run Prepare to preload offline TTS.",
      },
      { label: "Remote loading", value: "Disabled by default", detail: "Explicit setup only." },
    ]
  }

  return [
    {
      label: "Search",
      value: modelProviderLabel(report.embeddingProvider),
      detail:
        report.embeddingProvider === "transformers" ? "Semantic retrieval" : "Local hash retrieval",
    },
    { label: "Embedding model", value: report.embeddingModel, detail: "Configured model ID" },
    {
      label: "Chat model",
      value: chatReport?.localModelPathExists ? "Prepared" : "Not prepared",
      detail: chatReport?.defaultModel ?? "Optional local generator",
    },
    {
      label: "Audio model",
      value: audioReport?.transformersAvailable ? "Available" : "Awaiting check",
      detail: audioReport?.defaultModel ?? "Offline TTS add-on",
    },
    {
      label: "Remote loading",
      value: report.transformersAllowRemoteModels ? "Allowed" : "Disabled",
      detail: report.transformersAllowRemoteModels
        ? "Review before confidential indexing"
        : "Offline after explicit preload",
    },
  ]
}

function modelProviderLabel(provider: "local-hash" | "transformers"): string {
  return provider === "transformers" ? "Transformers.js" : "Local hash"
}

function modelNetworkLabel(
  statusReport: StatusReport | null,
  securityReport: SecurityAuditReport | null,
): string {
  if (statusReport) {
    return statusReport.transformersAllowRemoteModels ? "Remote model loading allowed" : "Offline"
  }
  if (securityReport) {
    return securityReport.providers.transformersAllowRemoteModels
      ? "Remote model loading allowed"
      : "Offline"
  }
  return "Offline by default"
}

function sourceFileUrl(project: RagmirProject, source: { relativePath: string }): string {
  return localFileUrl(joinProjectPath(project.projectRoot, source.relativePath))
}

function retrievalReportMarkdown(project: RagmirProject, result: ChatResult): string {
  const lines = [
    "# Ragmir Local Answer",
    "",
    `Workspace: ${project.name}`,
    `Workspace root: ${project.projectRoot}`,
    `Question: ${result.query}`,
    `Model: ${result.model}`,
    "",
    "## Answer",
    "",
    result.answer,
    "",
    "## Sources",
    "",
  ]

  for (const [index, source] of result.sources.entries()) {
    lines.push(
      `### [${index + 1}] ${source.relativePath}`,
      "",
      `- File: ${sourceFileUrl(project, source)}`,
      `- Chunk: ${source.chunkIndex}`,
      `- Distance: ${source.distance === null ? "n/a" : source.distance.toFixed(4)}`,
      "",
      "```text",
      source.text,
      "```",
      "",
    )
  }

  return `${lines.join("\n").trim()}\n`
}

function chatMessageTtsText(project: RagmirProject, message: ChatMessage): string {
  const result = message.result
  const answer = stripMarkdownForSpeech(result?.answer ?? message.content)
  const sourceLines =
    result?.sources.slice(0, CHAT_AUDIO_SOURCE_LIMIT).map((source, index) => {
      return `Source ${index + 1}: ${source.relativePath}.`
    }) ?? []

  return [
    `Ragmir answer for ${project.name}.`,
    answer,
    sourceLines.length > 0 ? `Cited local sources. ${sourceLines.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
}

function stripMarkdownForSpeech(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/gu, " Code block omitted for audio. ")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/^[\s>*-]+/gmu, "")
    .replace(/\s+/gu, " ")
    .trim()
}

function chatAudioFromRenderResult(result: AudioRenderResult): ChatMessageAudio {
  return {
    status: "ready",
    outputPath: result.outputPath,
    outputFormat: result.outputFormat,
    engine: result.engine,
    model: result.model,
    renderedAt: new Date().toISOString(),
  }
}

function audioFileUrl(path: string): string {
  return convertFileSrc(path)
}

function audioErrorMessage(message: string): string {
  if (
    /remote model|local model|model files|offline|not found|no such file|ENOENT|cache/iu.test(
      message,
    )
  ) {
    return `${message} Run Prepare audio once with non-sensitive preload text, then render this answer again.`
  }
  return message
}

function audioStatusLabel(
  audio: ChatMessageAudio | undefined,
  isRendering: boolean,
  isPlaying: boolean,
): string {
  if (isRendering) {
    return "Rendering audio"
  }
  if (isPlaying) {
    return "Playing"
  }
  switch (audio?.status) {
    case "ready":
      return "Audio ready"
    case "paused":
      return "Paused"
    case "error":
      return "Audio failed"
    case "rendering":
      return "Rendering audio"
    case "playing":
      return "Playing"
    default:
      return "Audio not rendered"
  }
}

function audioActionLabel(
  audio: ChatMessageAudio | undefined,
  isRendering: boolean,
  isPlaying: boolean,
): string {
  if (isRendering) {
    return "Rendering"
  }
  if (isPlaying) {
    return "Pause"
  }
  return audio?.outputPath ? "Play" : "Listen"
}

function downloadTextFile(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function safeFilename(input: string): string {
  return (
    input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "") || "ragmir"
  )
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function loadChatThreads(): ChatThread[] {
  if (typeof window === "undefined") {
    return []
  }

  try {
    const storedThreads = window.localStorage.getItem(CHAT_THREADS_STORAGE_KEY)
    const parsedThreads = storedThreads ? (JSON.parse(storedThreads) as unknown) : []
    return Array.isArray(parsedThreads)
      ? parsedThreads
          .map(readChatThread)
          .filter((thread): thread is ChatThread => thread !== null)
          .sort(sortChatsByUpdatedAt)
      : []
  } catch {
    return []
  }
}

function saveChatThreads(threads: ChatThread[]): void {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(CHAT_THREADS_STORAGE_KEY, JSON.stringify(threads))
}

function loadActiveChatId(): string | null {
  if (typeof window === "undefined") {
    return null
  }
  return window.localStorage.getItem(ACTIVE_CHAT_ID_STORAGE_KEY)
}

function saveActiveChatId(chatId: string | null): void {
  if (typeof window === "undefined") {
    return
  }
  if (chatId) {
    window.localStorage.setItem(ACTIVE_CHAT_ID_STORAGE_KEY, chatId)
    return
  }
  window.localStorage.removeItem(ACTIVE_CHAT_ID_STORAGE_KEY)
}

function loadChatRuntime(): ChatRuntime {
  if (typeof window === "undefined") {
    return "local"
  }
  const value = window.localStorage.getItem(CHAT_RUNTIME_STORAGE_KEY)
  return isChatRuntime(value) ? value : "local"
}

function saveChatRuntime(runtime: ChatRuntime): void {
  if (typeof window === "undefined") {
    return
  }
  window.localStorage.setItem(CHAT_RUNTIME_STORAGE_KEY, runtime)
}

function createChatThread(projectId: string, seedTitle = "New chat"): ChatThread {
  const now = new Date().toISOString()
  return {
    id: createLocalId("chat"),
    projectId,
    title: chatTitleFromQuestion(seedTitle),
    createdAt: now,
    updatedAt: now,
    messages: [],
  }
}

function createChatMessage(
  role: ChatMessageRole,
  content: string,
  result?: ChatResult,
  options: Pick<ChatMessage, "status" | "statusLabel"> = {},
): ChatMessage {
  return {
    id: createLocalId("message"),
    role,
    content,
    createdAt: new Date().toISOString(),
    ...(result ? { result } : {}),
    ...(options.status ? { status: options.status } : {}),
    ...(options.statusLabel ? { statusLabel: options.statusLabel } : {}),
  }
}

function createLocalId(prefix: string): string {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${id}`
}

function chatTitleFromQuestion(question: string): string {
  const title = question.trim().replace(/\s+/gu, " ")
  if (!title) {
    return "New chat"
  }
  return title.length > 56 ? `${title.slice(0, 53).trim()}...` : title
}

function upsertChatThread(threads: ChatThread[], thread: ChatThread): ChatThread[] {
  return [thread, ...threads.filter((entry) => entry.id !== thread.id)].sort(sortChatsByUpdatedAt)
}

function updateChatMessage(
  threads: ChatThread[],
  chatId: string,
  messageId: string,
  patch: ChatMessagePatch,
): ChatThread[] {
  return threads
    .map((thread) => {
      if (thread.id !== chatId) {
        return thread
      }

      const messages = thread.messages.map((message) =>
        message.id === messageId ? mergeChatMessage(message, patch) : message,
      )
      return {
        ...thread,
        messages,
        updatedAt: new Date().toISOString(),
      }
    })
    .sort(sortChatsByUpdatedAt)
}

function updateChatMessageAudio(
  threads: ChatThread[],
  chatId: string,
  messageId: string,
  patch: ChatMessageAudioPatch,
): ChatThread[] {
  const { error, ...audioPatch } = patch
  return threads
    .map((thread) => {
      if (thread.id !== chatId) {
        return thread
      }

      const messages = thread.messages.map((message) => {
        if (message.id !== messageId || !message.audio) {
          return message
        }
        const nextAudio = {
          ...message.audio,
          ...audioPatch,
        }
        if (error === null) {
          delete nextAudio.error
        } else if (error !== undefined) {
          nextAudio.error = error
        }
        return {
          ...message,
          audio: nextAudio,
        }
      })
      return {
        ...thread,
        messages,
        updatedAt: new Date().toISOString(),
      }
    })
    .sort(sortChatsByUpdatedAt)
}

function mergeChatMessage(message: ChatMessage, patch: ChatMessagePatch): ChatMessage {
  const { audio, statusLabel, ...messagePatch } = patch
  const nextMessage = { ...message, ...messagePatch }
  if (audio === null) {
    delete nextMessage.audio
  } else if (audio !== undefined) {
    nextMessage.audio = audio
  }
  if (statusLabel === null) {
    delete nextMessage.statusLabel
  } else if (statusLabel !== undefined) {
    nextMessage.statusLabel = statusLabel
  }
  return nextMessage
}

function findChatMessage(
  threads: ChatThread[],
  chatId: string,
  messageId: string,
): ChatMessage | null {
  return (
    threads
      .find((thread) => thread.id === chatId)
      ?.messages.find((message) => message.id === messageId) ?? null
  )
}

function lastThreadResult(thread: ChatThread | null): ChatResult | null {
  if (!thread) {
    return null
  }
  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const message = thread.messages[index]
    if (!message) {
      continue
    }
    if (message.role === "assistant" && message.result) {
      return message.result
    }
  }
  return null
}

function sortChatsByUpdatedAt(first: ChatThread, second: ChatThread): number {
  return new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime()
}

function buildContextualChatQuestion(previousMessages: ChatMessage[], question: string): string {
  const history = chatContextMessages(previousMessages)
  if (history.length === 0) {
    return question
  }

  const formattedHistory = history
    .map(
      (message) =>
        `${message.role === "user" ? "User" : "Ragmir"}: ${compactChatContent(message.content)}`,
    )
    .join("\n\n")
    .slice(0, CHAT_HISTORY_CHAR_LIMIT)

  return [
    "Use this recent local chat history only for continuity. The cited Ragmir passages remain the source of truth.",
    "",
    "Recent chat history:",
    formattedHistory,
    "",
    "Latest user question:",
    question,
  ].join("\n")
}

function chatContextMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter(
      (message) =>
        message.status !== "thinking" &&
        message.status !== "streaming" &&
        message.status !== "error" &&
        message.content.trim().length > 0,
    )
    .slice(-CHAT_HISTORY_MESSAGE_LIMIT)
}

function compactChatContent(content: string): string {
  const compacted = content.trim().replace(/\s+/gu, " ")
  return compacted.length > CHAT_HISTORY_MESSAGE_CHAR_LIMIT
    ? `${compacted.slice(0, CHAT_HISTORY_MESSAGE_CHAR_LIMIT - 3).trim()}...`
    : compacted
}

function normalizeChatResultForDisplay(result: ChatResult, question: string): ChatResult {
  return {
    ...result,
    query: question,
    question,
  }
}

function chunkMarkdownForStream(markdown: string): string[] {
  const tokens = markdown.match(/\S+\s*/gu) ?? [markdown]
  const chunks: string[] = []
  for (let index = 0; index < tokens.length; index += ASSISTANT_STREAM_CHUNK_SIZE) {
    chunks.push(tokens.slice(index, index + ASSISTANT_STREAM_CHUNK_SIZE).join(""))
  }
  return chunks.length > 0 ? chunks : [markdown]
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function readChatThread(value: unknown): ChatThread | null {
  if (!isPlainRecord(value)) {
    return null
  }
  const messages = Array.isArray(value.messages)
    ? value.messages
        .map(readChatMessage)
        .filter((message): message is ChatMessage => message !== null)
    : []
  const id = readRequiredString(value.id)
  const projectId = readRequiredString(value.projectId)
  const title = readRequiredString(value.title)
  const createdAt = readRequiredString(value.createdAt)
  const updatedAt = readRequiredString(value.updatedAt)
  if (!id || !projectId || !title || !createdAt || !updatedAt) {
    return null
  }
  return { id, projectId, title, createdAt, updatedAt, messages }
}

function readChatMessage(value: unknown): ChatMessage | null {
  if (!isPlainRecord(value)) {
    return null
  }
  const id = readRequiredString(value.id)
  const role = readChatMessageRole(value.role)
  const content = typeof value.content === "string" ? value.content : null
  const createdAt = readRequiredString(value.createdAt)
  if (!id || !role || content === null || !createdAt) {
    return null
  }
  const result = readChatResult(value.result)
  const audio = readChatMessageAudio(value.audio)
  const status = readChatMessageStatus(value.status)
  const statusLabel = readOptionalString(value.statusLabel)
  return {
    id,
    role,
    content,
    createdAt,
    ...(audio ? { audio } : {}),
    ...(result ? { result } : {}),
    ...(status ? { status } : {}),
    ...(statusLabel ? { statusLabel } : {}),
  }
}

function readChatMessageRole(value: unknown): ChatMessageRole | null {
  return value === "user" || value === "assistant" ? value : null
}

function readChatMessageStatus(value: unknown): ChatMessageStatus | null {
  return value === "done" || value === "thinking" || value === "streaming" || value === "error"
    ? value
    : null
}

function isChatRuntime(value: unknown): value is ChatRuntime {
  return value === "local" || value === "codex" || value === "claude" || value === "other-agent"
}

function readChatMessageAudio(value: unknown): ChatMessageAudio | undefined {
  if (!isPlainRecord(value)) {
    return undefined
  }
  const status = readChatMessageAudioStatus(value.status)
  const outputPath = readOptionalString(value.outputPath)
  const error = readOptionalString(value.error)
  if (status === "error") {
    return { status, ...(error ? { error } : {}) }
  }
  if (!outputPath) {
    return undefined
  }

  const stableStatus: ChatMessageAudioStatus =
    status === "paused" || status === "ready" ? status : "ready"
  const outputFormat = readAudioOutputFormat(value.outputFormat)
  const engine = readAudioEngine(value.engine)
  const model = readOptionalString(value.model)
  const renderedAt = readOptionalString(value.renderedAt)
  return {
    status: stableStatus,
    outputPath,
    ...(outputFormat ? { outputFormat } : {}),
    ...(engine ? { engine } : {}),
    ...(model ? { model } : {}),
    ...(renderedAt ? { renderedAt } : {}),
    ...(error ? { error } : {}),
  }
}

function readChatMessageAudioStatus(value: unknown): ChatMessageAudioStatus | null {
  return value === "rendering" ||
    value === "ready" ||
    value === "playing" ||
    value === "paused" ||
    value === "error"
    ? value
    : null
}

function readAudioOutputFormat(value: unknown): AudioRenderResult["outputFormat"] | undefined {
  return value === "mp3" || value === "wav" ? value : undefined
}

function readAudioEngine(value: unknown): AudioRenderResult["engine"] | undefined {
  return value === "edge" || value === "transformers" ? value : undefined
}

function readChatResult(value: unknown): ChatResult | undefined {
  if (!isPlainRecord(value)) {
    return undefined
  }
  const query = readRequiredString(value.query)
  const answer = readRequiredString(value.answer)
  const model = readRequiredString(value.model)
  if (!query || !answer || !model) {
    return undefined
  }
  return {
    query,
    question: readString(value.question, query),
    answer,
    sources: readChatSources(value.sources),
    model,
    modelPath: readString(value.modelPath, ""),
    allowRemoteModels: readBoolean(value.allowRemoteModels, false),
    maxNewTokens: readNumber(value.maxNewTokens, 0),
    contextCharLimit: readNumber(value.contextCharLimit, 0),
    emptyContext: readBoolean(value.emptyContext, false),
  }
}

function readChatSources(value: unknown): ChatSource[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map(readChatSource).filter((source): source is ChatSource => source !== null)
}

function readChatSource(value: unknown): ChatSource | null {
  if (!isPlainRecord(value)) {
    return null
  }
  const relativePath = readRequiredString(value.relativePath)
  const text = readRequiredString(value.text)
  if (!relativePath || !text) {
    return null
  }
  return {
    source: readString(value.source, relativePath),
    relativePath,
    chunkIndex: readNumber(value.chunkIndex, 0),
    text,
    distance: typeof value.distance === "number" ? value.distance : null,
  }
}

function readRequiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function createConfigFormState(content: string): ConfigFormState {
  const raw = content.trim() ? (JSON.parse(content) as unknown) : {}
  if (!isPlainRecord(raw)) {
    throw new Error("Ragmir config must be a JSON object.")
  }

  const redaction = isPlainRecord(raw.redaction) ? raw.redaction : {}

  return {
    rawDir: readString(raw.rawDir, DEFAULT_CONFIG_FORM.rawDir),
    sourcesText: readStringArray(raw.sources).join("\n"),
    embeddingProvider: readEmbeddingProvider(raw.embeddingProvider),
    transformersAllowRemoteModels: readBoolean(
      raw.transformersAllowRemoteModels,
      DEFAULT_CONFIG_FORM.transformersAllowRemoteModels,
    ),
    redactionEnabled: readBoolean(redaction.enabled, DEFAULT_CONFIG_FORM.redactionEnabled),
    redactionBuiltIn: readBoolean(redaction.builtIn, DEFAULT_CONFIG_FORM.redactionBuiltIn),
    accessLog: readBoolean(raw.accessLog, DEFAULT_CONFIG_FORM.accessLog),
    baseConfig: raw,
  }
}

function serializeConfigFormState(config: ConfigFormState): string {
  const redaction = isPlainRecord(config.baseConfig.redaction) ? config.baseConfig.redaction : {}
  const patterns = Array.isArray(redaction.patterns) ? redaction.patterns : []
  const nextConfig = {
    ...config.baseConfig,
    rawDir: config.rawDir.trim() || DEFAULT_CONFIG_FORM.rawDir,
    sources: splitConfigLines(config.sourcesText),
    embeddingProvider: config.embeddingProvider,
    transformersAllowRemoteModels: config.transformersAllowRemoteModels,
    redaction: {
      ...redaction,
      enabled: config.redactionEnabled,
      builtIn: config.redactionBuiltIn,
      patterns,
    },
    accessLog: config.accessLog,
  }

  return `${JSON.stringify(nextConfig, null, 2)}\n`
}

function splitConfigLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function customRedactionPatternCount(config: Record<string, unknown>): number {
  const redaction = isPlainRecord(config.redaction) ? config.redaction : {}
  return Array.isArray(redaction.patterns) ? redaction.patterns.length : 0
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : []
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function readEmbeddingProvider(value: unknown): EmbeddingProvider {
  return isEmbeddingProvider(value) ? value : DEFAULT_CONFIG_FORM.embeddingProvider
}

function isEmbeddingProvider(value: unknown): value is EmbeddingProvider {
  return value === "local-hash" || value === "transformers"
}

function localFileUrl(path: string): string {
  const normalized = path.replace(/\\/gu, "/")
  const segments = normalized.split("/").map((segment, index) => {
    if (index === 0 && /^[A-Za-z]:$/u.test(segment)) {
      return segment
    }
    return encodeURIComponent(segment)
  })
  const encodedPath = segments.join("/")
  return normalized.startsWith("/") ? `file://${encodedPath}` : `file:///${encodedPath}`
}

function projectStatusLabel(status: ProjectStatus): string {
  switch (status) {
    case "ready":
      return "Ready"
    case "indexing":
      return "Indexing"
    case "needs-review":
      return "Review"
    case "needs-setup":
      return "Needs setup"
  }
}

function viewTitle(view: View): string {
  switch (view) {
    case "chat":
      return "Chat"
    case "config":
      return "Settings"
    case "privacy":
      return "Privacy"
    case "license":
      return "License"
  }
}

function projectSourceLabel(sourceKind: ProjectSourceKind): string {
  return sourceKind === "google-drive" ? "Google Drive sync" : "Local folder"
}

function statusBadge(status: ProjectStatus): "success" | "outline" {
  return status === "ready" ? "success" : "outline"
}
