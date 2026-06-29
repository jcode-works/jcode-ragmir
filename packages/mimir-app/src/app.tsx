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
} from "@jcode.labs/mimir-ui"
import {
  Activity,
  Brain,
  CheckCircle2,
  Database,
  FileSearch,
  FolderOpen,
  FolderPlus,
  HardDrive,
  LockKeyhole,
  MessageSquareText,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from "lucide-react"
import { type DragEvent, type FormEvent, useEffect, useState } from "react"
import {
  createProject,
  loadActiveProjectId,
  loadProjects,
  type MimirProject,
  normalizeProjectRoot,
  type ProjectStatus,
  removeProject,
  saveActiveProjectId,
  saveProjects,
  upsertProject,
} from "./lib/project-registry.js"

type View = "projects" | "retrieval" | "privacy"

const modelRows = [
  { label: "Provider", value: "Transformers.js", detail: "Semantic retrieval" },
  { label: "Embedding model", value: "Configured per project", detail: ".kb/config.json" },
  { label: "Fallback", value: "Local hash", detail: "No model runtime" },
]

export function App(): React.JSX.Element {
  const [view, setView] = useState<View>("projects")
  const [projects, setProjects] = useState<MimirProject[]>(() => loadProjects())
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => loadActiveProjectId())
  const [projectRoot, setProjectRoot] = useState("")
  const [dropStatus, setDropStatus] = useState("Drop a folder or paste its local path.")
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null

  useEffect(() => {
    saveProjects(projects)
  }, [projects])

  useEffect(() => {
    if (activeProjectId && projects.some((project) => project.id === activeProjectId)) {
      saveActiveProjectId(activeProjectId)
      return
    }

    const firstProjectId = projects.at(0)?.id ?? null
    setActiveProjectId(firstProjectId)
    saveActiveProjectId(firstProjectId)
  }, [activeProjectId, projects])

  function registerProject(root: string): void {
    const normalizedRoot = normalizeProjectRoot(root)
    const existingProject = projects.find((project) => project.projectRoot === normalizedRoot)
    const project = existingProject ?? createProject({ projectRoot: normalizedRoot })
    setProjects((currentProjects) => upsertProject(currentProjects, project))
    setActiveProjectId(project.id)
    setProjectRoot("")
    setDropStatus(`${project.name} is registered locally.`)
  }

  function handleProjectSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    try {
      registerProject(projectRoot)
    } catch (error) {
      setDropStatus(error instanceof Error ? error.message : "Project root is required.")
    }
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>): void {
    event.preventDefault()
    const itemCount = event.dataTransfer.items.length || event.dataTransfer.files.length
    setDropStatus(`${itemCount} local item${itemCount === 1 ? "" : "s"} detected.`)
  }

  function handleRemoveProject(projectId: string): void {
    setProjects((currentProjects) => removeProject(currentProjects, projectId))
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
              <p className="text-lg font-black leading-none">Mimir</p>
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
              dropStatus={dropStatus}
              onDrop={handleDrop}
              onProjectRootChange={setProjectRoot}
              onProjectSubmit={handleProjectSubmit}
              onRemoveProject={handleRemoveProject}
              onSelectProject={setActiveProjectId}
              projectRoot={projectRoot}
              projects={projects}
            />
          ) : null}
          {view === "retrieval" ? <RetrievalView activeProject={activeProject} /> : null}
          {view === "privacy" ? <PrivacyView activeProject={activeProject} /> : null}
        </section>
      </div>
    </main>
  )
}

interface ProjectsViewProps {
  activeProjectId: string | null
  dropStatus: string
  onDrop: (event: DragEvent<HTMLButtonElement>) => void
  onProjectRootChange: (projectRoot: string) => void
  onProjectSubmit: (event: FormEvent<HTMLFormElement>) => void
  onRemoveProject: (projectId: string) => void
  onSelectProject: (projectId: string) => void
  projectRoot: string
  projects: MimirProject[]
}

function ProjectsView({
  activeProjectId,
  dropStatus,
  onDrop,
  onProjectRootChange,
  onProjectSubmit,
  onRemoveProject,
  onSelectProject,
  projectRoot,
  projects,
}: ProjectsViewProps): React.JSX.Element {
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
              Add the root folder of a Mimir workspace to start tracking it here.
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
                      <p className="truncate font-semibold">{project.name}</p>
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
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle>Intake</CardTitle>
          <CardDescription>Folders become local Mimir workspaces.</CardDescription>
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

          <div className="grid gap-3 md:grid-cols-3">
            {modelRows.map((row) => (
              <div className="rounded-md border border-border bg-background p-3" key={row.label}>
                <p className="text-xs text-muted-foreground">{row.label}</p>
                <p className="mt-1 font-semibold">{row.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{row.detail}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

interface ProjectPanelProps {
  activeProject: MimirProject | null
}

function RetrievalView({ activeProject }: ProjectPanelProps): React.JSX.Element {
  const retrievedContext = activeProject
    ? `No retrieval has been run for ${activeProject.name} in this app session.`
    : "Select a local project before running retrieval."

  return (
    <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle>Ask</CardTitle>
          <CardDescription>Retrieval context with source citations.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <Input
              aria-label="Question"
              disabled={!activeProject}
              placeholder="What proves offline operation?"
            />
            <Button disabled={!activeProject}>
              <MessageSquareText aria-hidden="true" />
              Ask
            </Button>
          </div>
          <Textarea aria-label="Retrieved context" readOnly value={retrievedContext} />
        </CardContent>
      </Card>

      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle>Evidence</CardTitle>
          <CardDescription>Ranked passages from the active knowledge base.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md border border-dashed border-border bg-background p-5 text-sm text-muted-foreground">
            {activeProject
              ? `${activeProject.rawDir} is ready for cited passages after the first retrieval run.`
              : "No project selected."}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function PrivacyView({ activeProject }: ProjectPanelProps): React.JSX.Element {
  const auditRows = privacyRows(activeProject)

  return (
    <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle>Privacy audit</CardTitle>
          <CardDescription>Current posture for the selected workspace.</CardDescription>
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
          <CardDescription>Visible defaults before native execution is enabled.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <ControlTile
            icon={<LockKeyhole aria-hidden="true" />}
            title="Local state"
            value={activeProject?.storageDir ?? ".kb/storage"}
          />
          <ControlTile
            icon={<ShieldCheck aria-hidden="true" />}
            title="Redaction"
            value="Built-in patterns"
          />
          <ControlTile icon={<RefreshCw aria-hidden="true" />} title="Ingest" value="Incremental" />
          <ControlTile
            icon={<Brain aria-hidden="true" />}
            title="Models"
            value="Explicit preload"
          />
          <ControlTile
            icon={<Activity aria-hidden="true" />}
            title="Access log"
            value="Metadata only"
          />
          <ControlTile
            icon={<HardDrive aria-hidden="true" />}
            title="Workspace"
            value={activeProject?.projectRoot ?? "Not selected"}
          />
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

function privacyRows(project: MimirProject | null): Array<{
  label: string
  value: string
  state: "ok" | "warn"
}> {
  return [
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

function statusBadge(status: ProjectStatus): "success" | "outline" {
  return status === "ready" ? "success" : "outline"
}
