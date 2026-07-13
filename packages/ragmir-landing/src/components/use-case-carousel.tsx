import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Bot,
  CodeXml,
  FileCheck2,
  FileInput,
  GitBranch,
  type LucideIcon,
  MessageSquareQuote,
  ServerCog,
  TerminalSquare,
  Workflow,
} from "lucide-react"
import { useState } from "react"
import { Button } from "./ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs"

type UseCaseId = "spec" | "hermes" | "n8n" | "api"

interface UseCaseDefinition {
  id: UseCaseId
  icon: LucideIcon
  tabKey: string
  eyebrowKey: string
  titleKey: string
  descriptionKey: string
  requestKey: string
  consumerKey: string
  consumerDetail: string
  resultTitleKey: string
  resultKey: string
  citationKey: string
  interfaceLabel: string
  files: readonly string[]
}

interface UseCaseCarouselProps {
  translations: Record<string, string>
}

interface WorkflowNodeProps {
  accent?: "primary" | "success"
  code?: string
  detail?: string
  icon: LucideIcon
  label: string
  ports?: "horizontal" | "bottom" | "none"
  title: string
}

const USE_CASES: readonly UseCaseDefinition[] = [
  {
    id: "spec",
    icon: FileCheck2,
    tabKey: "use_case_spec_tab",
    eyebrowKey: "use_case_spec_eyebrow",
    titleKey: "use_case_spec_title",
    descriptionKey: "use_case_spec_description",
    requestKey: "use_case_spec_request",
    consumerKey: "use_case_spec_consumer",
    consumerDetail: "ragmir_search",
    resultTitleKey: "use_case_spec_result_title",
    resultKey: "use_case_spec_result",
    citationKey: "use_case_spec_citation",
    interfaceLabel: "MCP",
    files: ["private/cdc-auth.docx", "private/acceptance-criteria.docx"],
  },
  {
    id: "hermes",
    icon: Bot,
    tabKey: "use_case_hermes_tab",
    eyebrowKey: "use_case_hermes_eyebrow",
    titleKey: "use_case_hermes_title",
    descriptionKey: "use_case_hermes_description",
    requestKey: "use_case_hermes_request",
    consumerKey: "use_case_hermes_consumer",
    consumerDetail: "stdio MCP",
    resultTitleKey: "use_case_hermes_result_title",
    resultKey: "use_case_hermes_result",
    citationKey: "use_case_hermes_citation",
    interfaceLabel: "MCP",
    files: ["runbooks/p1-response.pdf", "ops/escalation-matrix.docx"],
  },
  {
    id: "n8n",
    icon: Workflow,
    tabKey: "use_case_n8n_tab",
    eyebrowKey: "use_case_n8n_eyebrow",
    titleKey: "use_case_n8n_title",
    descriptionKey: "use_case_n8n_description",
    requestKey: "use_case_n8n_request",
    consumerKey: "use_case_n8n_consumer",
    consumerDetail: "renewal-gate.sh",
    resultTitleKey: "use_case_n8n_result_title",
    resultKey: "use_case_n8n_result",
    citationKey: "use_case_n8n_citation",
    interfaceLabel: "rgr search --json",
    files: ["sales/pricing.xlsx", "sales/renewal-policy.pdf"],
  },
  {
    id: "api",
    icon: CodeXml,
    tabKey: "use_case_api_tab",
    eyebrowKey: "use_case_api_eyebrow",
    titleKey: "use_case_api_title",
    descriptionKey: "use_case_api_description",
    requestKey: "use_case_api_request",
    consumerKey: "use_case_api_consumer",
    consumerDetail: "GET /search",
    resultTitleKey: "use_case_api_result_title",
    resultKey: "use_case_api_result",
    citationKey: "use_case_api_citation",
    interfaceLabel: "TypeScript API",
    files: ["docs/api-contract.pdf", "docs/auth-decisions.md"],
  },
]

function isUseCaseId(value: string): value is UseCaseId {
  return USE_CASES.some((useCase) => useCase.id === value)
}

function WorkflowNode({
  accent,
  code,
  detail,
  icon: Icon,
  label,
  ports = "horizontal",
  title,
}: WorkflowNodeProps): React.JSX.Element {
  return (
    <article
      className={`relative flex h-full min-h-40 flex-col rounded-xl border bg-card/95 p-4 shadow-xl shadow-black/20 ${
        accent === "primary"
          ? "border-primary/70 ring-1 ring-primary/20"
          : accent === "success"
            ? "border-emerald-400/50 ring-1 ring-emerald-400/10"
            : "border-border"
      }`}
    >
      {ports === "horizontal" ? (
        <>
          <span className="absolute top-1/2 -left-1.5 size-3 -translate-y-1/2 rounded-full border border-border bg-background" />
          <span className="absolute top-1/2 -right-1.5 size-3 -translate-y-1/2 rounded-full border border-border bg-background" />
        </>
      ) : ports === "bottom" ? (
        <span className="absolute -bottom-1.5 left-1/2 size-3 -translate-x-1/2 rounded-full border border-border bg-background" />
      ) : null}

      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/55">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <p className="text-[0.65rem] font-bold uppercase tracking-[0.14em]">{label}</p>
      </div>
      <h4 className="mt-4 text-sm font-bold leading-5 text-foreground">{title}</h4>
      {detail ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{detail}</p> : null}
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

function DesktopWorkflow({
  translations,
  useCase,
}: {
  translations: Record<string, string>
  useCase: UseCaseDefinition
}): React.JSX.Element {
  const t = (key: string): string => translations[key] ?? key
  const ConsumerIcon = useCase.id === "n8n" ? TerminalSquare : useCase.icon
  const ResultIcon = useCase.id === "n8n" ? GitBranch : FileCheck2
  const markerId = `workflow-arrow-${useCase.id}`

  return (
    <div className="relative hidden min-h-[30rem] overflow-hidden rounded-xl border border-border bg-background/75 lg:block">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(circle, color-mix(in oklab, var(--border) 75%, transparent) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_20%,var(--background)_88%)] opacity-75" />

      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full text-muted-foreground/70"
        preserveAspectRatio="none"
        viewBox="0 0 1000 480"
      >
        <defs>
          <marker id={markerId} markerHeight="7" markerWidth="7" orient="auto" refX="6" refY="3.5">
            <path d="M0,0 L7,3.5 L0,7 Z" fill="currentColor" />
          </marker>
        </defs>
        <path
          d="M232 360 C248 360 256 360 272 360"
          fill="none"
          markerEnd={`url(#${markerId})`}
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M480 360 C496 360 504 360 520 360"
          fill="none"
          markerEnd={`url(#${markerId})`}
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M728 360 C744 360 752 360 768 360"
          fill="none"
          markerEnd={`url(#${markerId})`}
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M624 182 C624 218 624 238 624 270"
          fill="none"
          markerEnd={`url(#${markerId})`}
          stroke="currentColor"
          strokeWidth="2"
        />
      </svg>

      <div className="absolute top-7 left-[52%] w-[20%]">
        <WorkflowNode
          code={`${useCase.files.length} ${t("use_cases_files_label")}`}
          detail={useCase.files.join(" · ")}
          icon={FileInput}
          label={t("use_cases_evidence_label")}
          ports="bottom"
          title={t("use_cases_sources_label")}
        />
      </div>

      <div className="absolute inset-x-6 bottom-8 grid grid-cols-4 items-stretch gap-10">
        <WorkflowNode
          icon={MessageSquareQuote}
          label={`01 · ${t("use_cases_trigger_label")}`}
          title={t(useCase.requestKey)}
        />
        <WorkflowNode
          code={useCase.consumerDetail}
          icon={ConsumerIcon}
          label={`02 · ${t("use_cases_consumer_label")}`}
          title={t(useCase.consumerKey)}
        />
        <WorkflowNode
          accent="primary"
          code={useCase.interfaceLabel}
          detail={t("use_cases_retrieval_label")}
          icon={ServerCog}
          label={`03 · ${t("use_cases_retrieval_step_label")}`}
          title={t("use_cases_ragmir_local_label")}
        />
        <WorkflowNode
          accent="success"
          code={t(useCase.citationKey)}
          detail={t(useCase.resultKey)}
          icon={ResultIcon}
          label={`04 · ${t("use_cases_result_label")}`}
          title={t(useCase.resultTitleKey)}
        />
      </div>
    </div>
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
  const ConsumerIcon = useCase.id === "n8n" ? TerminalSquare : useCase.icon
  const ResultIcon = useCase.id === "n8n" ? GitBranch : FileCheck2
  const nodes: WorkflowNodeProps[] = [
    {
      icon: MessageSquareQuote,
      label: `01 · ${t("use_cases_trigger_label")}`,
      title: t(useCase.requestKey),
    },
    {
      code: useCase.consumerDetail,
      icon: ConsumerIcon,
      label: `02 · ${t("use_cases_consumer_label")}`,
      title: t(useCase.consumerKey),
    },
    {
      code: `${useCase.files.length} ${t("use_cases_files_label")}`,
      detail: useCase.files.join(" · "),
      icon: FileInput,
      label: t("use_cases_evidence_label"),
      title: t("use_cases_sources_label"),
    },
    {
      accent: "primary",
      code: useCase.interfaceLabel,
      detail: t("use_cases_retrieval_label"),
      icon: ServerCog,
      label: `03 · ${t("use_cases_retrieval_step_label")}`,
      title: t("use_cases_ragmir_local_label"),
    },
    {
      accent: "success",
      code: t(useCase.citationKey),
      detail: t(useCase.resultKey),
      icon: ResultIcon,
      label: `04 · ${t("use_cases_result_label")}`,
      title: t(useCase.resultTitleKey),
    },
  ]

  return (
    <ol className="flex flex-col rounded-xl border border-border bg-background/75 p-4 lg:hidden">
      {nodes.map((node, index) => (
        <li className="flex flex-col" key={`${useCase.id}-${node.label}`}>
          <WorkflowNode {...node} ports={index < nodes.length - 1 ? "bottom" : "none"} />
          {index < nodes.length - 1 ? (
            <div
              className="flex h-10 items-center justify-center text-muted-foreground"
              aria-hidden="true"
            >
              <ArrowDown className="size-4" />
            </div>
          ) : null}
        </li>
      ))}
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
    <Tabs className="gap-5" value={activeId} onValueChange={handleValueChange}>
      <TabsList
        className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl border border-border bg-card/80 p-1.5 group-data-[orientation=horizontal]/tabs:h-auto sm:grid-cols-4"
        aria-label={t("use_cases_tabs_label")}
      >
        {USE_CASES.map((useCase) => {
          const Icon = useCase.icon
          return (
            <TabsTrigger className="min-w-0 py-2.5" key={useCase.id} value={useCase.id}>
              <Icon aria-hidden="true" />
              <span className="truncate">{t(useCase.tabKey)}</span>
            </TabsTrigger>
          )
        })}
      </TabsList>

      <div className="grid">
        {USE_CASES.map((useCase, index) => {
          const Icon = useCase.icon
          return (
            <TabsContent
              className="col-start-1 row-start-1 mt-0 data-[state=inactive]:invisible data-[state=inactive]:pointer-events-none"
              forceMount
              key={useCase.id}
              value={useCase.id}
            >
              <Card className="h-full overflow-hidden bg-card/90">
                <CardHeader className="gap-5 border-b border-border md:grid md:grid-cols-[1fr_auto] md:items-start">
                  <div className="flex min-w-0 flex-col gap-3">
                    <div className="flex items-center gap-3 text-violet-400">
                      <Icon aria-hidden="true" />
                      <p className="text-xs font-bold uppercase tracking-[0.16em]">
                        {t(useCase.eyebrowKey)}
                      </p>
                    </div>
                    <CardTitle className="max-w-2xl text-xl leading-tight md:text-2xl">
                      {t(useCase.titleKey)}
                    </CardTitle>
                    <CardDescription className="max-w-2xl leading-6">
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

                <CardContent className="pt-5">
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
