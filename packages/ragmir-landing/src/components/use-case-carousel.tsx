import {
  ArrowDown,
  ArrowRight,
  Bot,
  Bug,
  FileCheck2,
  type LucideIcon,
  PackageCheck,
} from "lucide-react"
import { useState } from "react"
import { cn } from "../lib/utils"
import { TabIndicator } from "./tab-indicator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs"

type UseCaseId = "feature" | "incident" | "product" | "local"

interface UseCaseStep {
  id: string
  labelKey: string
  titleKey: string
  /** `ragmir` marks the retrieval step, `result` the step that returns the cited outcome. */
  accent?: "ragmir" | "result"
}

interface UseCaseDefinition {
  id: UseCaseId
  icon: LucideIcon
  tabKey: string
  titleKey: string
  descriptionKey: string
  steps: readonly UseCaseStep[]
}

interface UseCaseCarouselProps {
  translations: Record<string, string>
}

/** The same four stories as the hero terminal: two coding-agent tasks, an AI product, a local chat. */
export const USE_CASES: readonly UseCaseDefinition[] = [
  {
    id: "feature",
    icon: FileCheck2,
    tabKey: "use_case_feature_tab",
    titleKey: "use_case_feature_title",
    descriptionKey: "use_case_feature_description",
    steps: [
      { id: "request", labelKey: "use_cases_trigger_label", titleKey: "use_case_feature_request" },
      {
        id: "evidence",
        labelKey: "use_cases_evidence_label",
        titleKey: "use_case_feature_evidence",
      },
      {
        id: "retrieval",
        labelKey: "use_cases_retrieval_step_label",
        titleKey: "use_case_feature_retrieval",
        accent: "ragmir",
      },
      {
        id: "result",
        labelKey: "use_cases_result_label",
        titleKey: "use_case_feature_result",
        accent: "result",
      },
    ],
  },
  {
    id: "incident",
    icon: Bug,
    tabKey: "use_case_incident_tab",
    titleKey: "use_case_incident_title",
    descriptionKey: "use_case_incident_description",
    steps: [
      { id: "request", labelKey: "use_cases_trigger_label", titleKey: "use_case_incident_request" },
      {
        id: "evidence",
        labelKey: "use_cases_evidence_label",
        titleKey: "use_case_incident_evidence",
      },
      {
        id: "retrieval",
        labelKey: "use_cases_retrieval_step_label",
        titleKey: "use_case_incident_retrieval",
        accent: "ragmir",
      },
      {
        id: "result",
        labelKey: "use_cases_result_label",
        titleKey: "use_case_incident_result",
        accent: "result",
      },
    ],
  },
  {
    id: "product",
    icon: PackageCheck,
    tabKey: "use_case_product_tab",
    titleKey: "use_case_product_title",
    descriptionKey: "use_case_product_description",
    steps: [
      { id: "request", labelKey: "use_cases_trigger_label", titleKey: "use_case_product_request" },
      {
        id: "evidence",
        labelKey: "use_cases_evidence_label",
        titleKey: "use_case_product_evidence",
      },
      {
        id: "retrieval",
        labelKey: "use_cases_retrieval_step_label",
        titleKey: "use_case_product_retrieval",
        accent: "ragmir",
      },
      {
        id: "result",
        labelKey: "use_cases_result_label",
        titleKey: "use_case_product_result",
        accent: "result",
      },
    ],
  },
  {
    id: "local",
    icon: Bot,
    tabKey: "use_case_local_tab",
    titleKey: "use_case_local_title",
    descriptionKey: "use_case_local_description",
    steps: [
      { id: "evidence", labelKey: "use_cases_evidence_label", titleKey: "use_case_local_evidence" },
      {
        id: "retrieval",
        labelKey: "use_cases_retrieval_step_label",
        titleKey: "use_case_local_retrieval",
        accent: "ragmir",
      },
      { id: "model", labelKey: "use_cases_model_label", titleKey: "use_case_local_model" },
      {
        id: "answer",
        labelKey: "use_cases_result_label",
        titleKey: "use_case_local_answer",
        accent: "result",
      },
    ],
  },
]

const ACCENT_DOT_CLASS_NAMES = {
  ragmir: "bg-[var(--syntax-program)]",
  result: "bg-emerald-400",
} as const

const ACCENT_LABEL_CLASS_NAMES = {
  ragmir: "text-[var(--syntax-program)]",
  result: "text-emerald-300",
} as const

function isUseCaseId(value: string): value is UseCaseId {
  return USE_CASES.some((useCase) => useCase.id === value)
}

/** One numbered step on the darker inset, with the arrow to the next step in the gap after it. */
function WorkflowStep({
  isLast,
  label,
  position,
  step,
  title,
}: {
  isLast: boolean
  label: string
  position: number
  step: UseCaseStep
  title: string
}): React.JSX.Element {
  return (
    <li
      className="relative flex min-h-28 flex-col rounded-xl bg-background p-4 transition-[opacity,transform] duration-300 ease-[var(--ease-out-expo)] group-data-[state=active]/panel:delay-[calc(var(--step)*50ms)] group-data-[state=inactive]/panel:translate-y-1.5 group-data-[state=inactive]/panel:opacity-0 group-data-[state=inactive]/panel:duration-150 md:p-5 lg:min-h-36"
      data-motion="step"
      style={{ "--step": position - 1 } as React.CSSProperties}
    >
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em]">
        <span className="tnum text-muted-foreground">{String(position).padStart(2, "0")}</span>
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 rounded-full",
            step.accent ? ACCENT_DOT_CLASS_NAMES[step.accent] : "bg-foreground/30",
          )}
        />
        <span
          className={step.accent ? ACCENT_LABEL_CLASS_NAMES[step.accent] : "text-muted-foreground"}
        >
          {label}
        </span>
      </div>
      <p className="mt-3 font-semibold text-foreground text-sm leading-6 lg:mt-5">{title}</p>
      {!isLast && (
        <span
          aria-hidden="true"
          className="absolute -bottom-5 left-1/2 flex size-4 -translate-x-1/2 items-center justify-center text-muted-foreground/70 lg:top-1/2 lg:-right-5 lg:bottom-auto lg:left-auto lg:translate-x-0 lg:-translate-y-1/2"
        >
          <ArrowDown className="size-4 lg:hidden" />
          <ArrowRight className="hidden size-4 lg:block" />
        </span>
      )}
    </li>
  )
}

export function UseCaseCarousel({ translations }: UseCaseCarouselProps): React.JSX.Element {
  const t = (key: string): string => translations[key] ?? key
  const [activeId, setActiveId] = useState<UseCaseId>(USE_CASES[0]?.id ?? "feature")

  const handleTabsWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    const tabList = event.currentTarget
    const maxScrollLeft = tabList.scrollWidth - tabList.clientWidth
    if (maxScrollLeft <= 0) return

    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    const nextScrollLeft = Math.min(maxScrollLeft, Math.max(0, tabList.scrollLeft + delta))
    if (nextScrollLeft === tabList.scrollLeft) return

    event.preventDefault()
    tabList.scrollLeft = nextScrollLeft
  }

  const handleValueChange = (value: string): void => {
    if (isUseCaseId(value)) setActiveId(value)
  }

  return (
    <Tabs
      className="w-full min-w-0 gap-0 rounded-xl bg-card p-3 sm:p-4 md:p-6"
      onValueChange={handleValueChange}
      value={activeId}
    >
      <TabsList
        aria-label={t("use_cases_tabs_label")}
        className="relative flex h-auto w-full flex-nowrap justify-start gap-1 overflow-x-auto overscroll-x-contain rounded-full bg-background p-1 [scrollbar-width:none] group-data-[orientation=horizontal]/tabs:h-auto [&::-webkit-scrollbar]:hidden"
        onWheel={handleTabsWheel}
      >
        <TabIndicator activeSelector='[data-state="active"]' />
        {USE_CASES.map((useCase) => {
          const Icon = useCase.icon
          return (
            <TabsTrigger
              className="h-9 min-w-max shrink-0 px-4 font-semibold text-xs lg:min-w-0 lg:flex-1"
              key={useCase.id}
              value={useCase.id}
            >
              <Icon aria-hidden="true" />
              <span className="truncate">{t(useCase.tabKey)}</span>
            </TabsTrigger>
          )
        })}
      </TabsList>

      {/* Every panel stays mounted in one grid cell, so switching tabs never shifts the page. */}
      <div className="mt-6 grid w-full min-w-0 md:mt-8">
        {USE_CASES.map((useCase) => (
          <TabsContent
            className="group/panel col-start-1 row-start-1 mt-0 w-full min-w-0 transition-[opacity,visibility] duration-300 ease-[var(--ease-out-expo)] data-[state=inactive]:pointer-events-none data-[state=inactive]:invisible data-[state=inactive]:opacity-0 data-[state=inactive]:duration-150"
            forceMount
            key={useCase.id}
            value={useCase.id}
          >
            <div className="px-1 md:px-2">
              <h3 className="text-balance font-black text-xl leading-tight md:text-2xl">
                {t(useCase.titleKey)}
              </h3>
              <p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-6">
                {t(useCase.descriptionKey)}
              </p>
            </div>
            <ol className="mt-6 grid gap-6 lg:grid-cols-4">
              {useCase.steps.map((step, index) => (
                <WorkflowStep
                  isLast={index === useCase.steps.length - 1}
                  key={step.id}
                  label={t(step.labelKey)}
                  position={index + 1}
                  step={step}
                  title={t(step.titleKey)}
                />
              ))}
            </ol>
          </TabsContent>
        ))}
      </div>
    </Tabs>
  )
}
