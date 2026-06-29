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
  HardDrive,
  LockKeyhole,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react"
import { type DragEvent, useState } from "react"

type View = "projects" | "retrieval" | "privacy"

const projects = [
  {
    name: "Client RFP",
    files: 128,
    status: "Indexed",
    path: "~/Projects/client-rfp/private",
    progress: 100,
  },
  {
    name: "Architecture notes",
    files: 42,
    status: "Watching",
    path: "~/Projects/architecture/private",
    progress: 78,
  },
  {
    name: "Legal review",
    files: 17,
    status: "Local only",
    path: "~/Projects/legal-review/private",
    progress: 100,
  },
]

const citations = [
  {
    source: "operations-brief.md",
    text: "approved runtime: encrypted disk, local retrieval, no telemetry",
  },
  {
    source: "security-policy.yaml",
    text: "remote model loading disabled; access log stores metadata only",
  },
  {
    source: "dataset-inventory.csv",
    text: "unsupported files are tracked separately before professional review",
  },
]

const auditRows = [
  { label: "Telemetry", value: "Off", state: "ok" },
  { label: "Remote models", value: "Disabled", state: "ok" },
  { label: "Redaction", value: "Before indexing", state: "ok" },
  { label: "Git ignore", value: ".kb/ .mimir/ private/**", state: "ok" },
  { label: "Unsupported files", value: "3 pending review", state: "warn" },
]

const modelRows = [
  { label: "Provider", value: "Transformers.js", detail: "Semantic retrieval" },
  { label: "Embedding model", value: "mixedbread xsmall", detail: "Cached locally" },
  { label: "Fallback", value: "Local hash", detail: "No model runtime" },
]

export function App(): React.JSX.Element {
  const [view, setView] = useState<View>("projects")
  const [dropStatus, setDropStatus] = useState("Drop a folder or choose one from disk.")

  function handleDrop(event: DragEvent<HTMLButtonElement>): void {
    event.preventDefault()
    const itemCount = event.dataTransfer.items.length || event.dataTransfer.files.length
    setDropStatus(`${itemCount} local item${itemCount === 1 ? "" : "s"} ready for sidecar ingest.`)
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
              <Badge variant="success">Sidecar boundary</Badge>
              <Progress value={78} aria-label="Index freshness" />
              <p className="text-xs leading-5 text-muted-foreground">
                `kb` workflows stay isolated until the native sidecar is packaged.
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
                  Project state stays under the selected workspace. Mimir Core remains the tested
                  engine behind the app boundary.
                </p>
              </div>
              <Button>
                <FolderOpen aria-hidden="true" />
                Add folder
              </Button>
            </div>
          </header>

          {view === "projects" ? (
            <ProjectsView dropStatus={dropStatus} onDrop={handleDrop} />
          ) : null}
          {view === "retrieval" ? <RetrievalView /> : null}
          {view === "privacy" ? <PrivacyView /> : null}
        </section>
      </div>
    </main>
  )
}

interface ProjectsViewProps {
  dropStatus: string
  onDrop: (event: DragEvent<HTMLButtonElement>) => void
}

function ProjectsView({ dropStatus, onDrop }: ProjectsViewProps): React.JSX.Element {
  return (
    <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle>Projects</CardTitle>
          <CardDescription>Local knowledge bases stored per workspace.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {projects.map((project) => (
            <div className="rounded-md border border-border bg-background p-3" key={project.name}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{project.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{project.path}</p>
                </div>
                <Badge variant={project.progress === 100 ? "success" : "outline"}>
                  {project.status}
                </Badge>
              </div>
              <div className="mt-3 grid gap-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{project.files} files</span>
                  <span>{project.progress}%</span>
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
          <button
            type="button"
            className="flex min-h-44 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-background p-6 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
          >
            <FolderOpen className="size-8 text-muted-foreground" aria-hidden="true" />
            <p className="font-semibold">Add a local folder</p>
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

function RetrievalView(): React.JSX.Element {
  return (
    <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle>Ask</CardTitle>
          <CardDescription>Retrieval context with source citations.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <Input aria-label="Question" defaultValue="What proves offline operation?" />
            <Button>
              <MessageSquareText aria-hidden="true" />
              Ask
            </Button>
          </div>
          <Textarea
            aria-label="Retrieved context"
            readOnly
            value={citations
              .map((item, index) => `[${index + 1}] ${item.source}: ${item.text}`)
              .join("\n\n")}
          />
        </CardContent>
      </Card>

      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle>Evidence</CardTitle>
          <CardDescription>Ranked passages from the active knowledge base.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {citations.map((citation, index) => (
            <div
              className="rounded-md border border-border bg-background p-3"
              key={citation.source}
            >
              <div className="flex items-center justify-between gap-3">
                <Badge variant="outline">Source {index + 1}</Badge>
                <span className="text-xs text-muted-foreground">{citation.source}</span>
              </div>
              <p className="mt-3 text-sm leading-6">{citation.text}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function PrivacyView(): React.JSX.Element {
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
            value=".kb/ and .mimir/"
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
            title="Storage"
            value="Workspace scoped"
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
      <p className="mt-1 text-xs text-muted-foreground">{value}</p>
    </div>
  )
}
