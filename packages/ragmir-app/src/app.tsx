import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Progress,
  Textarea,
} from "@jcode.labs/ragmir-ui"
import {
  Activity,
  Brain,
  CheckCircle2,
  Cloud,
  Database,
  Download,
  ExternalLink,
  FileSearch,
  FolderOpen,
  FolderPlus,
  HardDrive,
  KeyRound,
  LockKeyhole,
  MessageSquareText,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Volume2,
} from "lucide-react"
import { type DragEvent, type FormEvent, useEffect, useRef, useState } from "react"
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
  type AskResult,
  type DoctorReport,
  runAsk,
  runAudioSummary,
  runDoctor,
  runIngest,
  runModelsPull,
  runSecurityAudit,
  runStatus,
  type SecurityAuditReport,
  type StatusReport,
} from "./lib/ragmir-sidecar.js"

type View = "projects" | "retrieval" | "privacy" | "license"

const EMPTY_LICENSE_VALIDATION: LicenseValidation = {
  status: "empty",
  message: "No license key is installed.",
}
const AUTO_INGEST_POLL_MS = 30_000
const AUTO_INGEST_INTERVAL_MS = 5 * 60 * 1000

export function App(): React.JSX.Element {
  const [view, setView] = useState<View>("projects")
  const [projects, setProjects] = useState<RagmirProject[]>(() => loadProjects())
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => loadActiveProjectId())
  const [projectRoot, setProjectRoot] = useState("")
  const [googleDriveRoot, setGoogleDriveRoot] = useState("")
  const [dropStatus, setDropStatus] = useState("Drop a folder or paste its local path.")
  const [runtimeMessage, setRuntimeMessage] = useState("Native Ragmir runtime is idle.")
  const [isRunning, setIsRunning] = useState(false)
  const [question, setQuestion] = useState("")
  const [askResult, setAskResult] = useState<AskResult | null>(null)
  const [securityReport, setSecurityReport] = useState<SecurityAuditReport | null>(null)
  const [statusReport, setStatusReport] = useState<StatusReport | null>(null)
  const [licenseKeyInput, setLicenseKeyInput] = useState(() => loadLicenseKey())
  const [licenseValidation, setLicenseValidation] =
    useState<LicenseValidation>(EMPTY_LICENSE_VALIDATION)
  const [isLicenseChecking, setIsLicenseChecking] = useState(false)
  const projectsRef = useRef(projects)
  const isRunningRef = useRef(isRunning)
  const autoIngestRunnerRef = useRef<(project: RagmirProject) => Promise<void>>(async () => {})
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null
  autoIngestRunnerRef.current = runAutoIngestProject

  useEffect(() => {
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
    isRunningRef.current = isRunning
  }, [isRunning])

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
    setProjectRoot("")
    setGoogleDriveRoot("")
    setDropStatus(
      sourceKind === "google-drive"
        ? `${project.name} is connected as an opt-in Google Drive sync folder.`
        : `${project.name} is registered locally.`,
    )
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
      setRuntimeMessage("Google Drive sync folder connected. Auto-ingest is enabled locally.")
    } catch (error) {
      setDropStatus(
        error instanceof Error ? error.message : "Google Drive folder path is required.",
      )
    }
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>): void {
    event.preventDefault()
    const droppedPath = droppedProjectPath(event.dataTransfer)
    if (droppedPath) {
      try {
        registerProject(droppedPath)
      } catch (error) {
        setDropStatus(error instanceof Error ? error.message : "Dropped project path is invalid.")
      }
      return
    }

    const itemCount = event.dataTransfer.items.length || event.dataTransfer.files.length
    setDropStatus(
      itemCount > 0
        ? `${itemCount} local item${itemCount === 1 ? "" : "s"} detected. Paste the absolute folder path if the native shell did not expose it.`
        : "Paste the absolute folder path when the native shell does not expose drag-drop paths.",
    )
  }

  function handleRemoveProject(projectId: string): void {
    if (projectId === activeProjectId) {
      setAskResult(null)
      setSecurityReport(null)
      setStatusReport(null)
    }
    setProjects((currentProjects) => removeProject(currentProjects, projectId))
  }

  function selectProject(projectId: string): void {
    setActiveProjectId(projectId)
    setAskResult(null)
    setSecurityReport(null)
    setStatusReport(null)
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
    await runProjectCommand("Refreshing project status", project, async () => {
      const [report, status] = await Promise.all([
        runDoctor(project.projectRoot),
        runStatus(project.projectRoot),
      ])
      updateProjectFromDoctor(project, report)
      setStatusReport(status)
      setRuntimeMessage(
        report.ready ? "Project is ready." : (report.nextSteps.at(0) ?? "Review project status."),
      )
    })
  }

  async function handleRepairProject(project: RagmirProject): Promise<void> {
    await runProjectCommand("Running safe repair", project, async () => {
      const report = await runDoctor(project.projectRoot, true)
      const status = await runStatus(project.projectRoot)
      updateProjectFromDoctor(project, report)
      setStatusReport(status)
      setRuntimeMessage(
        report.ready
          ? "Repair complete. Project is ready."
          : (report.nextSteps.at(0) ?? "Repair complete."),
      )
    })
  }

  async function handleIngestProject(project: RagmirProject): Promise<void> {
    replaceProject({ ...project, status: "indexing", progress: Math.max(project.progress, 35) })
    await runProjectCommand("Ingesting project documents", project, async () => {
      const ingestResult = await runIngest(project.projectRoot)
      const [report, status] = await Promise.all([
        runDoctor(project.projectRoot),
        runStatus(project.projectRoot),
      ])
      updateProjectFromDoctor(project, report)
      setStatusReport(status)
      setRuntimeMessage(
        `Ingest complete: ${ingestResult.indexedFiles} indexed files, ${ingestResult.chunks} chunks.`,
      )
    })
  }

  async function runAutoIngestProject(project: RagmirProject): Promise<void> {
    const startedAt = new Date().toISOString()
    const watchedProject = {
      ...project,
      status: "indexing" as const,
      progress: Math.max(project.progress, 35),
      lastAutoIngestAt: startedAt,
    }
    replaceProject(watchedProject)
    await runProjectCommand("Auto-ingesting watched folder", watchedProject, async () => {
      const ingestResult = await runIngest(project.projectRoot)
      const [report, status] = await Promise.all([
        runDoctor(project.projectRoot),
        runStatus(project.projectRoot),
      ])
      updateProjectFromDoctor(watchedProject, report, { lastAutoIngestAt: startedAt })
      setStatusReport(status)
      setRuntimeMessage(
        `Watched folder indexed: ${ingestResult.indexedFiles} indexed files, ${ingestResult.chunks} chunks.`,
      )
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
        ? `${project.name} will auto-ingest local changes every 5 minutes.`
        : `${project.name} auto-ingest is disabled.`,
    )
  }

  async function handleAskSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!activeProject) {
      setRuntimeMessage("Select a project before asking Ragmir.")
      return
    }

    const trimmedQuestion = question.trim()
    if (!trimmedQuestion) {
      setRuntimeMessage("Question is required.")
      return
    }

    await runProjectCommand("Running retrieval", activeProject, async () => {
      const result = await runAsk(activeProject.projectRoot, trimmedQuestion)
      setAskResult(result)
      setRuntimeMessage(
        `Retrieved ${result.sources.length} cited source${result.sources.length === 1 ? "" : "s"}.`,
      )
    })
  }

  function handleExportMarkdown(): void {
    if (!activeProject || !askResult) {
      setRuntimeMessage("Run retrieval before exporting a Markdown report.")
      return
    }

    downloadTextFile(
      `${safeFilename(activeProject.name)}-retrieval-report.md`,
      retrievalReportMarkdown(activeProject, askResult),
      "text/markdown;charset=utf-8",
    )
    setRuntimeMessage("Markdown report exported from the current retrieval.")
  }

  async function handleRenderAudio(): Promise<void> {
    if (!activeProject || !askResult) {
      setRuntimeMessage("Run retrieval before rendering an audio report.")
      return
    }

    await runProjectCommand("Rendering offline audio report", activeProject, async () => {
      const result = await runAudioSummary(
        activeProject.projectRoot,
        retrievalReportMarkdown(activeProject, askResult),
      )
      setRuntimeMessage(`Audio report written to ${result.outputPath}.`)
    })
  }

  async function handlePullModels(): Promise<void> {
    if (!activeProject) {
      setRuntimeMessage("Select a project before preloading the embedding model.")
      return
    }

    await runProjectCommand("Preloading embedding model", activeProject, async () => {
      const model = await runModelsPull(activeProject.projectRoot)
      const status = await runStatus(activeProject.projectRoot)
      setStatusReport(status)
      setRuntimeMessage(`Semantic embeddings enabled: ${model.embeddingModel}.`)
    })
  }

  async function handleSecurityAudit(): Promise<void> {
    if (!activeProject) {
      setRuntimeMessage("Select a project before running the privacy audit.")
      return
    }

    await runProjectCommand("Running privacy audit", activeProject, async () => {
      const [report, status] = await Promise.all([
        runSecurityAudit(activeProject.projectRoot),
        runStatus(activeProject.projectRoot),
      ])
      setSecurityReport(report)
      setStatusReport(status)
      setRuntimeMessage(
        report.warnings.length === 0
          ? "Privacy audit passed."
          : `Privacy audit found ${report.warnings.length} warning${report.warnings.length === 1 ? "" : "s"}.`,
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
    <main className="desktop-shell min-h-screen p-3 text-foreground md:p-5">
      <div className="mx-auto grid min-h-[calc(100vh-2.5rem)] max-w-7xl gap-4 lg:grid-cols-[18rem_1fr]">
        <aside className="rounded-lg border border-border bg-card/90 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <HardDrive className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-lg font-black leading-none">Ragmir</p>
              <p className="text-xs text-muted-foreground">Local workspace</p>
            </div>
          </div>

          <nav className="mt-6 space-y-2" aria-label="Workspace">
            <Button
              className="w-full justify-start"
              variant={view === "projects" ? "secondary" : "ghost"}
              onClick={() => setView("projects")}
            >
              <Database aria-hidden="true" />
              Knowledge bases
            </Button>
            <Button
              className="w-full justify-start"
              variant={view === "retrieval" ? "secondary" : "ghost"}
              onClick={() => setView("retrieval")}
            >
              <FileSearch aria-hidden="true" />
              Retrieval
            </Button>
            <Button
              className="w-full justify-start"
              variant={view === "privacy" ? "secondary" : "ghost"}
              onClick={() => setView("privacy")}
            >
              <ShieldCheck aria-hidden="true" />
              Privacy audit
            </Button>
            <Button
              className="w-full justify-start"
              variant={view === "license" ? "secondary" : "ghost"}
              onClick={() => setView("license")}
            >
              <KeyRound aria-hidden="true" />
              License
            </Button>
          </nav>

          <div className="mt-6 rounded-lg border border-border bg-background p-4">
            <p className="text-sm font-semibold">Runtime</p>
            <div className="mt-3 space-y-3">
              <Badge variant={activeProject ? statusBadge(activeProject.status) : "outline"}>
                {activeProject ? projectStatusLabel(activeProject.status) : "No project"}
              </Badge>
              <Progress value={activeProject?.progress ?? 0} aria-label="Index freshness" />
              <p className="text-xs leading-5 text-muted-foreground">
                {activeProject?.storageDir ?? "Select a local project to create a workspace."}
              </p>
              <p className="text-xs leading-5 text-muted-foreground" aria-live="polite">
                {runtimeMessage}
              </p>
            </div>
          </div>
        </aside>

        <section className="grid gap-4 lg:grid-rows-[auto_1fr]">
          <header className="rounded-lg border border-border bg-card/90 p-4 shadow-sm">
            <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <Badge variant="outline">Desktop + mobile shell</Badge>
                <h1 className="mt-3 text-3xl font-black leading-tight md:text-4xl">
                  Local dossiers, cited retrieval.
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  {activeProject
                    ? `${activeProject.name} keeps generated state under ${activeProject.storageDir}.`
                    : "Project state stays under the selected workspace."}
                </p>
              </div>
              <Button onClick={() => setView("projects")}>
                <Plus aria-hidden="true" />
                Add project
              </Button>
            </div>
          </header>

          {view === "projects" ? (
            <ProjectsView
              activeProjectId={activeProjectId}
              activeProject={activeProject}
              dropStatus={dropStatus}
              isRunning={isRunning}
              onDrop={handleDrop}
              googleDriveRoot={googleDriveRoot}
              onIngestProject={handleIngestProject}
              onGoogleDriveRootChange={setGoogleDriveRoot}
              onGoogleDriveSubmit={handleGoogleDriveSubmit}
              onPullModels={handlePullModels}
              onProjectRootChange={setProjectRoot}
              onProjectSubmit={handleProjectSubmit}
              onRefreshProject={handleRefreshProject}
              onRemoveProject={handleRemoveProject}
              onRepairProject={handleRepairProject}
              onSelectProject={selectProject}
              onToggleAutoIngest={handleToggleAutoIngest}
              projectRoot={projectRoot}
              projects={projects}
              statusReport={statusReport}
            />
          ) : null}
          {view === "retrieval" ? (
            <RetrievalView
              activeProject={activeProject}
              askResult={askResult}
              isRunning={isRunning}
              onExportMarkdown={handleExportMarkdown}
              onRenderAudio={handleRenderAudio}
              onAskSubmit={handleAskSubmit}
              onQuestionChange={setQuestion}
              question={question}
            />
          ) : null}
          {view === "privacy" ? (
            <PrivacyView
              activeProject={activeProject}
              isRunning={isRunning}
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

interface ProjectsViewProps {
  activeProjectId: string | null
  activeProject: RagmirProject | null
  dropStatus: string
  googleDriveRoot: string
  isRunning: boolean
  onDrop: (event: DragEvent<HTMLButtonElement>) => void
  onGoogleDriveRootChange: (projectRoot: string) => void
  onGoogleDriveSubmit: (event: FormEvent<HTMLFormElement>) => void
  onIngestProject: (project: RagmirProject) => Promise<void>
  onPullModels: () => Promise<void>
  onProjectRootChange: (projectRoot: string) => void
  onProjectSubmit: (event: FormEvent<HTMLFormElement>) => void
  onRefreshProject: (project: RagmirProject) => Promise<void>
  onRemoveProject: (projectId: string) => void
  onRepairProject: (project: RagmirProject) => Promise<void>
  onSelectProject: (projectId: string) => void
  onToggleAutoIngest: (project: RagmirProject) => void
  projectRoot: string
  projects: RagmirProject[]
  statusReport: StatusReport | null
}

function ProjectsView({
  activeProjectId,
  activeProject,
  dropStatus,
  googleDriveRoot,
  isRunning,
  onDrop,
  onGoogleDriveRootChange,
  onGoogleDriveSubmit,
  onIngestProject,
  onPullModels,
  onProjectRootChange,
  onProjectSubmit,
  onRefreshProject,
  onRemoveProject,
  onRepairProject,
  onSelectProject,
  onToggleAutoIngest,
  projectRoot,
  projects,
  statusReport,
}: ProjectsViewProps): React.JSX.Element {
  const modelRows = modelStatusRows(statusReport)

  return (
    <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle>Projects</CardTitle>
          <CardDescription>Local knowledge bases stored per workspace.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {projects.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-background p-5 text-sm text-muted-foreground">
              Add the root folder of a Ragmir workspace to start tracking it here.
            </div>
          ) : null}

          {projects.map((project) => (
            <div className="rounded-md border border-border bg-background p-3" key={project.id}>
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <button
                  type="button"
                  className="min-w-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onSelectProject(project.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <p className="truncate font-semibold">{project.name}</p>
                        <Badge variant="outline">{projectSourceLabel(project.sourceKind)}</Badge>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {project.projectRoot}
                      </p>
                    </div>
                    <Badge
                      variant={
                        project.id === activeProjectId ? "success" : statusBadge(project.status)
                      }
                    >
                      {project.id === activeProjectId
                        ? "Active"
                        : projectStatusLabel(project.status)}
                    </Badge>
                  </div>
                </button>
                <Button
                  aria-label={`Remove ${project.name}`}
                  size="icon"
                  type="button"
                  variant="ghost"
                  onClick={() => onRemoveProject(project.id)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
              <div className="mt-3 grid gap-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{project.filesIndexed} files</span>
                  <span>{project.chunksIndexed} chunks</span>
                </div>
                <Progress value={project.progress} />
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={isRunning}
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() => onRefreshProject(project)}
                  >
                    <RefreshCw aria-hidden="true" />
                    Refresh
                  </Button>
                  <Button
                    disabled={isRunning}
                    size="sm"
                    type="button"
                    variant="secondary"
                    onClick={() => onRepairProject(project)}
                  >
                    <CheckCircle2 aria-hidden="true" />
                    Setup
                  </Button>
                  <Button
                    disabled={isRunning}
                    size="sm"
                    type="button"
                    onClick={() => onIngestProject(project)}
                  >
                    <FolderPlus aria-hidden="true" />
                    Ingest
                  </Button>
                  <label className="flex min-h-8 items-center gap-2 rounded-full border border-border bg-card px-3 text-xs font-semibold text-muted-foreground">
                    <input
                      checked={project.autoIngestEnabled}
                      className="size-3.5 accent-primary"
                      disabled={isRunning}
                      onChange={() => onToggleAutoIngest(project)}
                      type="checkbox"
                    />
                    Watch
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">{autoIngestLabel(project)}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle>Intake</CardTitle>
          <CardDescription>Folders become local Ragmir workspaces.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="grid gap-3 md:grid-cols-[1fr_auto]" onSubmit={onProjectSubmit}>
            <Input
              aria-label="Project root"
              onChange={(event) => onProjectRootChange(event.currentTarget.value)}
              placeholder="/Users/me/Projects/client-rfp"
              value={projectRoot}
            />
            <Button type="submit">
              <FolderPlus aria-hidden="true" />
              Add
            </Button>
          </form>

          <button
            type="button"
            className="flex min-h-36 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-background p-6 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
          >
            <FolderOpen className="size-8 text-muted-foreground" aria-hidden="true" />
            <p className="font-semibold">Drop a local folder</p>
            <p className="max-w-sm text-sm leading-6 text-muted-foreground" aria-live="polite">
              {dropStatus}
            </p>
          </button>

          <div className="rounded-lg border border-border bg-background p-4">
            <div className="grid gap-3 md:grid-cols-[auto_1fr]">
              <div className="flex size-10 items-center justify-center rounded-full bg-card text-muted-foreground">
                <Cloud className="size-5" aria-hidden="true" />
              </div>
              <div>
                <p className="font-semibold">Google Drive local sync</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Connect the local folder created by Google Drive for desktop. Ragmir indexes only
                  the files available on this machine and enables local auto-ingest for that folder.
                </p>
              </div>
            </div>
            <form
              className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]"
              onSubmit={onGoogleDriveSubmit}
            >
              <Input
                aria-label="Google Drive local sync folder"
                onChange={(event) => onGoogleDriveRootChange(event.currentTarget.value)}
                placeholder="/Users/me/Library/CloudStorage/GoogleDrive-me@example.com/My Drive/client-rfp"
                value={googleDriveRoot}
              />
              <Button disabled={isRunning} type="submit" variant="outline">
                <Cloud aria-hidden="true" />
                Connect
              </Button>
            </form>
          </div>

          <div className="rounded-lg border border-border bg-background p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">Embedding model</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {activeProject
                    ? "Preload the configured Transformers.js model and enable semantic retrieval."
                    : "Select a project to inspect and preload its configured model."}
                </p>
              </div>
              <Button
                disabled={!activeProject || isRunning}
                size="sm"
                type="button"
                variant="outline"
                onClick={onPullModels}
              >
                <Download aria-hidden="true" />
                Preload
              </Button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {modelRows.map((row) => (
                <div className="rounded-md border border-border bg-card p-3" key={row.label}>
                  <p className="text-xs text-muted-foreground">{row.label}</p>
                  <p className="mt-1 truncate font-semibold">{row.value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{row.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

interface ProjectPanelProps {
  activeProject: RagmirProject | null
}

interface RetrievalViewProps extends ProjectPanelProps {
  askResult: AskResult | null
  isRunning: boolean
  onExportMarkdown: () => void
  onRenderAudio: () => Promise<void>
  onAskSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
  onQuestionChange: (question: string) => void
  question: string
}

function RetrievalView({
  activeProject,
  askResult,
  isRunning,
  onExportMarkdown,
  onRenderAudio,
  onAskSubmit,
  onQuestionChange,
  question,
}: RetrievalViewProps): React.JSX.Element {
  const retrievedContext =
    askResult?.answer ??
    (activeProject
      ? `No retrieval has been run for ${activeProject.name} in this app session.`
      : "Select a local project before running retrieval.")

  return (
    <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
      <Card className="bg-card/90">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Ask</CardTitle>
              <CardDescription>Retrieval context with source citations.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!activeProject || !askResult || isRunning}
                size="sm"
                type="button"
                variant="outline"
                onClick={onExportMarkdown}
              >
                <Download aria-hidden="true" />
                Export .md
              </Button>
              <Button
                disabled={!activeProject || !askResult || isRunning}
                size="sm"
                type="button"
                variant="outline"
                onClick={onRenderAudio}
              >
                <Volume2 aria-hidden="true" />
                Audio
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="grid gap-3 md:grid-cols-[1fr_auto]" onSubmit={onAskSubmit}>
            <Input
              aria-label="Question"
              disabled={!activeProject || isRunning}
              onChange={(event) => onQuestionChange(event.currentTarget.value)}
              placeholder="What proves offline operation?"
              value={question}
            />
            <Button disabled={!activeProject || isRunning} type="submit">
              <MessageSquareText aria-hidden="true" />
              Ask
            </Button>
          </form>
          <Textarea aria-label="Retrieved context" readOnly value={retrievedContext} />
        </CardContent>
      </Card>

      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle>Evidence</CardTitle>
          <CardDescription>Ranked passages from the active knowledge base.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {askResult && askResult.sources.length > 0 ? (
            askResult.sources.map((source, index) => {
              const sourceUrl = activeProject ? sourceFileUrl(activeProject, source) : null

              return (
                <div
                  className="rounded-md border border-border bg-background p-4"
                  key={`${source.relativePath}-${source.chunkIndex}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    {sourceUrl ? (
                      <a
                        className="flex min-w-0 items-center gap-2 truncate text-sm font-semibold outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
                        href={sourceUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <span className="truncate">
                          [{index + 1}] {source.relativePath}
                        </span>
                        <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                      </a>
                    ) : (
                      <p className="truncate text-sm font-semibold">
                        [{index + 1}] {source.relativePath}
                      </p>
                    )}
                    <Badge variant="outline">chunk {source.chunkIndex}</Badge>
                  </div>
                  <p className="mt-3 line-clamp-5 text-sm leading-6 text-muted-foreground">
                    {source.text}
                  </p>
                </div>
              )
            })
          ) : (
            <div className="rounded-md border border-dashed border-border bg-background p-5 text-sm text-muted-foreground">
              {activeProject
                ? `${activeProject.rawDir} is ready for cited passages after the first retrieval run.`
                : "No project selected."}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

interface PrivacyViewProps extends ProjectPanelProps {
  isRunning: boolean
  onRunSecurityAudit: () => Promise<void>
  securityReport: SecurityAuditReport | null
  statusReport: StatusReport | null
}

function PrivacyView({
  activeProject,
  isRunning,
  onRunSecurityAudit,
  securityReport,
  statusReport,
}: PrivacyViewProps): React.JSX.Element {
  const auditRows = privacyRows(activeProject, securityReport)

  return (
    <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
      <Card className="bg-card/90">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Privacy audit</CardTitle>
              <CardDescription>Current posture for the selected workspace.</CardDescription>
            </div>
            <Button disabled={!activeProject || isRunning} size="sm" onClick={onRunSecurityAudit}>
              <ShieldCheck aria-hidden="true" />
              Run audit
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {auditRows.map((row) => (
            <div
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-background p-3"
              key={row.label}
            >
              <div className="flex items-center gap-3">
                {row.state === "ok" ? (
                  <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                ) : (
                  <TriangleAlert className="size-4 text-accent" aria-hidden="true" />
                )}
                <div>
                  <p className="font-semibold">{row.label}</p>
                  <p className="text-xs text-muted-foreground">{row.value}</p>
                </div>
              </div>
              <Badge variant={row.state === "ok" ? "success" : "outline"}>
                {row.state === "ok" ? "Ready" : "Review"}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle>Controls</CardTitle>
          <CardDescription>Visible local controls for the active workspace.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
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
          <ControlTile icon={<RefreshCw aria-hidden="true" />} title="Ingest" value="Incremental" />
          <ControlTile
            icon={<Brain aria-hidden="true" />}
            title="Models"
            value={
              statusReport
                ? `${modelProviderLabel(statusReport.embeddingProvider)} / ${statusReport.embeddingModel}`
                : (securityReport?.providers.embeddingModel ?? "Explicit preload")
            }
          />
          <ControlTile
            icon={<Activity aria-hidden="true" />}
            title="Network"
            value={modelNetworkLabel(statusReport, securityReport)}
          />
          <ControlTile
            icon={<Activity aria-hidden="true" />}
            title="Access log"
            value={securityReport ? accessLogLabel(securityReport) : "Metadata only"}
          />
          <ControlTile
            icon={<HardDrive aria-hidden="true" />}
            title="Workspace"
            value={activeProject?.projectRoot ?? "Not selected"}
          />
          <ControlTile
            icon={<Cloud aria-hidden="true" />}
            title="Source"
            value={activeProject ? projectSourceLabel(activeProject.sourceKind) : "Local folder"}
          />
        </CardContent>
      </Card>
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
      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle>Activation</CardTitle>
          <CardDescription>Local license validation for the desktop client.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-background p-4">
            <div className="flex items-start gap-3">
              {validation.status === "valid" ? (
                <CheckCircle2 className="mt-1 size-4 text-success" aria-hidden="true" />
              ) : (
                <TriangleAlert className="mt-1 size-4 text-accent" aria-hidden="true" />
              )}
              <div>
                <p className="font-semibold">{licenseStatusLabel(validation)}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{validation.message}</p>
              </div>
            </div>
            <Badge variant={validation.status === "valid" ? "success" : "outline"}>
              {validation.status}
            </Badge>
          </div>

          <form className="space-y-3" onSubmit={onSubmit}>
            <Textarea
              aria-label="License key"
              onChange={(event) => onLicenseKeyChange(event.currentTarget.value)}
              placeholder="RAGMIR1.payload.signature"
              value={licenseKey}
            />
            <div className="flex flex-wrap gap-2">
              <Button disabled={isChecking} type="submit">
                <KeyRound aria-hidden="true" />
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

      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle>License details</CardTitle>
          <CardDescription>Per-major license metadata stored only in this app.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {licenseDetailRows(validation).map((row) => (
            <div className="rounded-md border border-border bg-background p-3" key={row.label}>
              <p className="text-xs text-muted-foreground">{row.label}</p>
              <p className="mt-1 truncate font-semibold">{row.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{row.detail}</p>
            </div>
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
    <div className="rounded-md border border-border bg-background p-3">
      <div className="flex items-center gap-2 text-muted-foreground [&_svg]:size-4">{icon}</div>
      <p className="mt-3 font-semibold">{title}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{value}</p>
    </div>
  )
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
        value: project ? projectSourceLabel(project.sourceKind) : "No project selected",
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
      value: project ? projectSourceLabel(project.sourceKind) : "No project selected",
      state: project?.sourceKind === "google-drive" ? "warn" : "ok",
    },
    { label: "Telemetry", value: "Off", state: "ok" },
    { label: "Remote models", value: "Disabled by default", state: "ok" },
    { label: "Redaction", value: "Before indexing", state: "ok" },
    {
      label: "Generated state",
      value: project ? project.storageDir : "No project selected",
      state: project ? "ok" : "warn",
    },
    { label: "Unsupported files", value: "Awaiting audit", state: "warn" },
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
    return "Manual ingest only."
  }
  const source =
    project.sourceKind === "google-drive" ? "Google Drive sync folder" : "Watched folder"
  return project.lastAutoIngestAt
    ? `${source}, last auto-ingest ${formatDate(project.lastAutoIngestAt)}.`
    : `${source}, first auto-ingest pending.`
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

function modelStatusRows(report: StatusReport | null): Array<{
  label: string
  value: string
  detail: string
}> {
  if (!report) {
    return [
      { label: "Provider", value: "Awaiting status", detail: "Run Refresh on the active project." },
      { label: "Embedding model", value: "Configured per project", detail: ".ragmir/config.json" },
      { label: "Model cache", value: ".ragmir/models", detail: "Ignored local Ragmir state." },
      { label: "Remote loading", value: "Disabled by default", detail: "Enable only to preload." },
    ]
  }

  return [
    {
      label: "Provider",
      value: modelProviderLabel(report.embeddingProvider),
      detail:
        report.embeddingProvider === "transformers" ? "Semantic retrieval" : "Lexical fallback",
    },
    { label: "Embedding model", value: report.embeddingModel, detail: "Configured model ID" },
    { label: "Model cache", value: report.embeddingModelPath, detail: "Local model path" },
    {
      label: "Remote loading",
      value: report.transformersAllowRemoteModels ? "Allowed" : "Disabled",
      detail: report.transformersAllowRemoteModels
        ? "Review for confidential indexing"
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

function retrievalReportMarkdown(project: RagmirProject, result: AskResult): string {
  const lines = [
    "# Ragmir Retrieval Report",
    "",
    `Project: ${project.name}`,
    `Project root: ${project.projectRoot}`,
    `Question: ${result.query}`,
    "",
    "## Retrieval Context",
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

function projectSourceLabel(sourceKind: ProjectSourceKind): string {
  return sourceKind === "google-drive" ? "Google Drive sync" : "Local folder"
}

function statusBadge(status: ProjectStatus): "success" | "outline" {
  return status === "ready" ? "success" : "outline"
}
