import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Boxes,
  Clapperboard,
  Cloud,
  FileCheck2,
  FileInput,
  FolderGit2,
  ListChecks,
  type LucideIcon,
  MessageSquareQuote,
  Search,
  ServerCog,
  TerminalSquare,
} from "lucide-react"
import { Fragment, useState } from "react"
import { Button } from "./ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs"

type UseCaseId = "spec" | "monorepo" | "drive" | "youtube" | "visa"

interface UseCaseDefinition {
  id: UseCaseId
  icon: LucideIcon
  tabKey: string
  titleKey: string
  descriptionKey: string
  evidence?: WorkflowEvidenceDefinition
  steps: readonly WorkflowStepDefinition[]
}

interface WorkflowEvidenceDefinition {
  code: string
  targetStepId: string
  titleKey: string
}

interface WorkflowStepDefinition {
  accent?: "primary" | "success"
  code: string
  icon: LucideIcon
  id: string
  labelKey: string
  titleKey: string
}

interface UseCaseCarouselProps {
  translations: Record<string, string>
}

interface WorkflowNodeProps {
  accent?: "primary" | "success"
  code?: string
  icon: LucideIcon
  label: string
  nodeId?: string
  ports?: readonly WorkflowPort[]
  title: string
}

type WorkflowPort = "top" | "right" | "bottom" | "left"

const PORT_CLASS_NAMES: Record<WorkflowPort, string> = {
  top: "-top-1.5 left-1/2 -translate-x-1/2",
  right: "top-1/2 -right-1.5 -translate-y-1/2",
  bottom: "-bottom-1.5 left-1/2 -translate-x-1/2",
  left: "top-1/2 -left-1.5 -translate-y-1/2",
}

const DESKTOP_NODE_MIN_WIDTH_REM = 11.75
const DESKTOP_CONNECTOR_WIDTH_REM = 2
const DESKTOP_CANVAS_HORIZONTAL_PADDING_REM = 3

const USE_CASES: readonly UseCaseDefinition[] = [
  {
    id: "spec",
    icon: FileCheck2,
    tabKey: "use_case_spec_tab",
    titleKey: "use_case_spec_title",
    descriptionKey: "use_case_spec_description",
    evidence: {
      code: "private/specification.docx · private/acceptance-criteria.docx",
      targetStepId: "retrieval",
      titleKey: "use_case_spec_evidence",
    },
    steps: [
      {
        code: "Codex",
        icon: MessageSquareQuote,
        id: "request",
        labelKey: "use_cases_trigger_label",
        titleKey: "use_case_spec_request",
      },
      {
        accent: "primary",
        code: "ragmir_search · topK 5",
        icon: ServerCog,
        id: "retrieval",
        labelKey: "use_cases_retrieval_step_label",
        titleKey: "use_case_spec_retrieval",
      },
      {
        accent: "success",
        code: "code + E2E",
        icon: FileCheck2,
        id: "result",
        labelKey: "use_cases_result_label",
        titleKey: "use_case_spec_result",
      },
    ],
  },
  {
    id: "monorepo",
    icon: Boxes,
    tabKey: "use_case_monorepo_tab",
    titleKey: "use_case_monorepo_title",
    descriptionKey: "use_case_monorepo_description",
    steps: [
      {
        code: "Codex · onboarding question",
        icon: MessageSquareQuote,
        id: "question",
        labelKey: "use_cases_trigger_label",
        titleKey: "use_case_monorepo_question",
      },
      {
        accent: "primary",
        code: "root + package knowledge bases",
        icon: FolderGit2,
        id: "retrieval",
        labelKey: "use_cases_retrieval_step_label",
        titleKey: "use_case_monorepo_retrieval",
      },
      {
        accent: "success",
        code: "cited onboarding map",
        icon: FileCheck2,
        id: "result",
        labelKey: "use_cases_result_label",
        titleKey: "use_case_monorepo_result",
      },
    ],
  },
  {
    id: "drive",
    icon: Cloud,
    tabKey: "use_case_drive_tab",
    titleKey: "use_case_drive_title",
    descriptionKey: "use_case_drive_description",
    evidence: {
      code: "roadmap.pdf · stories.xlsx · architecture.docx",
      targetStepId: "retrieval",
      titleKey: "use_case_drive_evidence",
    },
    steps: [
      {
        code: "Codex · feature brief",
        icon: MessageSquareQuote,
        id: "request",
        labelKey: "use_cases_trigger_label",
        titleKey: "use_case_drive_request",
      },
      {
        accent: "primary",
        code: "ragmir_search · topK 5",
        icon: Search,
        id: "retrieval",
        labelKey: "use_cases_retrieval_step_label",
        titleKey: "use_case_drive_retrieval",
      },
      {
        code: "cited implementation plan",
        icon: ListChecks,
        id: "plan",
        labelKey: "use_cases_consumer_label",
        titleKey: "use_case_drive_plan",
      },
      {
        accent: "success",
        code: "code + tests + citations",
        icon: FileCheck2,
        id: "result",
        labelKey: "use_cases_result_label",
        titleKey: "use_case_drive_result",
      },
    ],
  },
  {
    id: "youtube",
    icon: Clapperboard,
    tabKey: "use_case_youtube_tab",
    titleKey: "use_case_youtube_title",
    descriptionKey: "use_case_youtube_description",
    evidence: {
      code: "library/*.pdf · channel/voice.md",
      targetStepId: "retrieval",
      titleKey: "use_case_youtube_evidence",
    },
    steps: [
      {
        code: "node scripts/draft-episode.mjs",
        icon: TerminalSquare,
        id: "topic",
        labelKey: "use_cases_trigger_label",
        titleKey: "use_case_youtube_request",
      },
      {
        accent: "primary",
        code: 'rgr research "$TOPIC" --compact',
        icon: BookOpen,
        id: "retrieval",
        labelKey: "use_cases_retrieval_step_label",
        titleKey: "use_case_youtube_retrieval",
      },
      {
        accent: "success",
        code: "drafts/episode.md · review required",
        icon: Clapperboard,
        id: "draft",
        labelKey: "use_cases_result_label",
        titleKey: "use_case_youtube_result",
      },
    ],
  },
  {
    id: "visa",
    icon: ListChecks,
    tabKey: "use_case_visa_tab",
    titleKey: "use_case_visa_title",
    descriptionKey: "use_case_visa_description",
    steps: [
      {
        code: "node scripts/update-project-plan.mjs",
        icon: FileInput,
        id: "evidence",
        labelKey: "use_cases_trigger_label",
        titleKey: "use_case_visa_request",
      },
      {
        accent: "primary",
        code: 'rgr research "$QUERY" --compact',
        icon: ServerCog,
        id: "retrieval",
        labelKey: "use_cases_retrieval_step_label",
        titleKey: "use_case_visa_retrieval",
      },
      {
        accent: "success",
        code: ".ragmir/reports/action-plan.md",
        icon: ListChecks,
        id: "plan",
        labelKey: "use_cases_result_label",
        titleKey: "use_case_visa_result",
      },
    ],
  },
]

function isUseCaseId(value: string): value is UseCaseId {
  return USE_CASES.some((useCase) => useCase.id === value)
}

function WorkflowNode({
  accent,
  code,
  icon: Icon,
  label,
  nodeId,
  ports = ["left", "right"],
  title,
}: WorkflowNodeProps): React.JSX.Element {
  return (
    <article
      data-workflow-node={nodeId}
      className={`relative flex h-full min-h-36 flex-col rounded-xl border bg-card/95 p-4 shadow-xl shadow-black/20 ${
        accent === "primary"
          ? "border-primary/70 ring-1 ring-primary/20"
          : accent === "success"
            ? "border-emerald-400/50 ring-1 ring-emerald-400/10"
            : "border-border"
      }`}
    >
      {ports.map((port) => (
        <span
          aria-hidden="true"
          className={`absolute z-20 size-3 rounded-full border border-border bg-background ${PORT_CLASS_NAMES[port]}`}
          data-workflow-port={`${nodeId ?? "node"}-${port}`}
          key={port}
        />
      ))}

      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/55">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <p className="text-[0.65rem] font-bold uppercase tracking-[0.14em]">{label}</p>
      </div>
      <h4 className="mt-4 text-sm font-bold leading-5 text-foreground">{title}</h4>
      {code ? (
        <code
          className="mt-auto block truncate pt-4 font-mono text-[0.68rem] text-foreground/80"
          title={code}
        >
          {code}
        </code>
      ) : null}
    </article>
  )
}

function HorizontalConnector({ id }: { id: string }): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className="relative flex h-full items-center text-muted-foreground/75"
      data-workflow-connector={id}
    >
      <span className="h-px w-full bg-current" />
      <span className="absolute left-1/2 top-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center bg-background">
        <ArrowRight className="size-4" />
      </span>
    </div>
  )
}

function VerticalConnector({ id }: { id: string }): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className="relative flex h-full justify-center text-muted-foreground/75"
      data-workflow-connector={id}
    >
      <span className="h-full w-px bg-current" />
      <span className="absolute left-1/2 top-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center bg-background">
        <ArrowDown className="size-4" />
      </span>
    </div>
  )
}

function DesktopWorkflow({
  translations,
  useCase,
}: {
  translations: Record<string, string>
  useCase: UseCaseDefinition
}): React.JSX.Element {
  const t = (key: string): string => translations[key] ?? key
  const trackTemplate = useCase.steps
    .flatMap((_, index) =>
      index === useCase.steps.length - 1
        ? [`${DESKTOP_NODE_MIN_WIDTH_REM}rem`]
        : [`${DESKTOP_NODE_MIN_WIDTH_REM}rem`, `${DESKTOP_CONNECTOR_WIDTH_REM}rem`],
    )
    .join(" ")
  const canvasMinWidth = `${
    useCase.steps.length * DESKTOP_NODE_MIN_WIDTH_REM +
    (useCase.steps.length - 1) * DESKTOP_CONNECTOR_WIDTH_REM +
    DESKTOP_CANVAS_HORIZONTAL_PADDING_REM
  }rem`
  const evidenceTargetIndex = useCase.evidence
    ? useCase.steps.findIndex((step) => step.id === useCase.evidence?.targetStepId)
    : -1
  const evidenceNodeColumn = evidenceTargetIndex * 2 + 1
  const evidenceColumnStart = Math.max(1, evidenceNodeColumn - 1)

  const flowRow = (
    <div
      className="grid min-h-[10.5rem] w-full items-stretch justify-center"
      style={{ gridTemplateColumns: trackTemplate }}
    >
      {useCase.steps.map((step, index) => {
        const ports: WorkflowPort[] = []
        if (index > 0) ports.push("left")
        if (index < useCase.steps.length - 1) ports.push("right")
        if (index === evidenceTargetIndex) ports.push("top")

        return (
          <Fragment key={step.id}>
            <div style={{ gridColumn: index * 2 + 1 }}>
              <WorkflowNode
                accent={step.accent}
                code={step.code}
                icon={step.icon}
                label={`${String(index + 1).padStart(2, "0")} · ${t(step.labelKey)}`}
                nodeId={step.id}
                ports={ports}
                title={t(step.titleKey)}
              />
            </div>
            {index < useCase.steps.length - 1 ? (
              <div style={{ gridColumn: index * 2 + 2 }}>
                <HorizontalConnector id={`${step.id}-to-${useCase.steps[index + 1]?.id}`} />
              </div>
            ) : null}
          </Fragment>
        )
      })}
    </div>
  )

  return (
    <section
      aria-label={t(useCase.titleKey)}
      className="relative hidden h-[29rem] w-full min-w-0 max-w-full overflow-auto bg-background/75 [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent lg:block"
      data-workflow-canvas={useCase.id}
      data-workflow-scroll-region="true"
      /* biome-ignore lint/a11y/noNoninteractiveTabindex: The overflow canvas must be keyboard-scrollable. */
      tabIndex={0}
    >
      <div
        className="relative h-full"
        style={{ minWidth: canvasMinWidth, width: `max(100%, ${canvasMinWidth})` }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(circle, color-mix(in oklab, var(--border) 75%, transparent) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_20%,var(--background)_88%)] opacity-75" />

        {useCase.evidence && evidenceTargetIndex >= 0 ? (
          <div
            className="relative z-10 grid h-full w-full content-center p-6 xl:p-8"
            style={{ gridTemplateRows: "10.5rem 2.5rem 10.5rem" }}
          >
            <div className="grid justify-center" style={{ gridTemplateColumns: trackTemplate }}>
              <div
                style={{
                  gridColumn: `${evidenceColumnStart} / span 3`,
                }}
              >
                <WorkflowNode
                  code={useCase.evidence.code}
                  icon={FileInput}
                  label={t("use_cases_evidence_label")}
                  nodeId="evidence"
                  ports={["bottom"]}
                  title={t(useCase.evidence.titleKey)}
                />
              </div>
            </div>
            <div className="grid justify-center" style={{ gridTemplateColumns: trackTemplate }}>
              <div style={{ gridColumn: evidenceNodeColumn }}>
                <VerticalConnector id={`evidence-to-${useCase.evidence.targetStepId}`} />
              </div>
            </div>
            {flowRow}
          </div>
        ) : (
          <div className="relative z-10 flex h-full w-full items-center justify-center p-6 xl:p-8">
            {flowRow}
          </div>
        )}
      </div>
    </section>
  )
}

function MobileWorkflow({
  translations,
  useCase,
}: {
  translations: Record<string, string>
  useCase: UseCaseDefinition
}): React.JSX.Element {
  const t = (key: string): string => translations[key] ?? key
  const nodes: (WorkflowNodeProps & { nodeId: string })[] = useCase.steps.map((step, index) => ({
    accent: step.accent,
    code: step.code,
    icon: step.icon,
    label: `${String(index + 1).padStart(2, "0")} · ${t(step.labelKey)}`,
    nodeId: step.id,
    title: t(step.titleKey),
  }))

  if (useCase.evidence) {
    const targetIndex = useCase.steps.findIndex(
      (step) => step.id === useCase.evidence?.targetStepId,
    )
    if (targetIndex >= 0) {
      nodes.splice(targetIndex, 0, {
        code: useCase.evidence.code,
        icon: FileInput,
        label: t("use_cases_evidence_label"),
        nodeId: "evidence",
        title: t(useCase.evidence.titleKey),
      })
    }
  }

  return (
    <ol
      className="flex w-full flex-col bg-background/50 p-4 lg:hidden"
      data-workflow-canvas={useCase.id}
    >
      {nodes.map((node, index) => {
        const ports: readonly WorkflowPort[] =
          index === 0 ? ["bottom"] : index === nodes.length - 1 ? ["top"] : ["top", "bottom"]

        return (
          <li className="flex flex-col" key={`${useCase.id}-${node.label}`}>
            <WorkflowNode {...node} ports={ports} />
            {index < nodes.length - 1 ? (
              <div className="h-10">
                <VerticalConnector id={`${node.nodeId}-to-${nodes[index + 1]?.nodeId ?? "next"}`} />
              </div>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

export function UseCaseCarousel({ translations }: UseCaseCarouselProps): React.JSX.Element {
  const t = (key: string): string => translations[key] ?? key
  const [activeId, setActiveId] = useState<UseCaseId>(USE_CASES[0]?.id ?? "spec")
  const activeIndex = USE_CASES.findIndex((useCase) => useCase.id === activeId)

  const move = (offset: number): void => {
    const nextIndex = (activeIndex + offset + USE_CASES.length) % USE_CASES.length
    const nextCase = USE_CASES[nextIndex]
    if (nextCase) setActiveId(nextCase.id)
  }

  const handleValueChange = (value: string): void => {
    if (isUseCaseId(value)) setActiveId(value)
  }

  return (
    <Tabs className="w-full min-w-0 gap-5" value={activeId} onValueChange={handleValueChange}>
      <TabsList
        className="flex h-auto w-full snap-x snap-mandatory touch-pan-x flex-nowrap justify-start gap-1 overflow-x-auto overscroll-x-contain scroll-smooth rounded-xl border border-border bg-card/80 p-1.5 [scrollbar-width:none] group-data-[orientation=horizontal]/tabs:h-auto [&::-webkit-scrollbar]:hidden"
        aria-label={t("use_cases_tabs_label")}
      >
        {USE_CASES.map((useCase) => {
          const Icon = useCase.icon
          return (
            <TabsTrigger
              className="min-w-max shrink-0 snap-start px-4 py-2.5 sm:min-w-0 sm:flex-1 sm:px-2"
              key={useCase.id}
              value={useCase.id}
            >
              <Icon aria-hidden="true" />
              <span className="truncate">{t(useCase.tabKey)}</span>
            </TabsTrigger>
          )
        })}
      </TabsList>

      <div className="grid w-full min-w-0">
        {USE_CASES.map((useCase, index) => {
          return (
            <TabsContent
              className="col-start-1 row-start-1 mt-0 w-full min-w-0 data-[state=inactive]:hidden data-[state=inactive]:pointer-events-none lg:data-[state=inactive]:block lg:data-[state=inactive]:invisible"
              forceMount
              key={useCase.id}
              value={useCase.id}
            >
              <Card className="w-full min-w-0 overflow-hidden bg-card/90 lg:h-full">
                <CardHeader className="gap-4 border-b border-border md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-center lg:h-[5.5rem] lg:py-4">
                  <div className="flex min-w-0 flex-col gap-2">
                    <CardTitle className="max-w-2xl text-xl leading-tight">
                      {t(useCase.titleKey)}
                    </CardTitle>
                    <CardDescription className="max-w-2xl leading-5">
                      {t(useCase.descriptionKey)}
                    </CardDescription>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      aria-label={t("use_cases_previous")}
                      onClick={() => move(-1)}
                      size="icon"
                      type="button"
                      variant="outline"
                    >
                      <ArrowLeft data-icon="inline-start" aria-hidden="true" />
                    </Button>
                    <p
                      className="min-w-14 text-center text-muted-foreground text-xs"
                      aria-live="polite"
                    >
                      {t("use_cases_counter")
                        .replace("{current}", String(index + 1))
                        .replace("{total}", String(USE_CASES.length))}
                    </p>
                    <Button
                      aria-label={t("use_cases_next")}
                      onClick={() => move(1)}
                      size="icon"
                      type="button"
                      variant="outline"
                    >
                      <ArrowRight data-icon="inline-end" aria-hidden="true" />
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="flex w-full min-w-0 flex-col pt-5 lg:flex-1 lg:px-0">
                  <DesktopWorkflow translations={translations} useCase={useCase} />
                  <MobileWorkflow translations={translations} useCase={useCase} />
                </CardContent>
              </Card>
            </TabsContent>
          )
        })}
      </div>
    </Tabs>
  )
}
