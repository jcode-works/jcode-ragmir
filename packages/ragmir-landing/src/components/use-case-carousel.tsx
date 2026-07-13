import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Bot,
  Braces,
  CodeXml,
  FileCheck2,
  FileText,
  MessageSquareQuote,
  ServerCog,
  Workflow,
} from "lucide-react"
import { useState } from "react"
import { Button } from "./ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs"

type UseCaseId = "spec" | "hermes" | "n8n" | "api"

interface UseCaseDefinition {
  id: UseCaseId
  icon: typeof FileText
  tabKey: string
  eyebrowKey: string
  titleKey: string
  descriptionKey: string
  requestKey: string
  consumerKey: string
  resultKey: string
  citationKey: string
  interfaceLabel: string
  files: readonly string[]
}

interface UseCaseCarouselProps {
  translations: Record<string, string>
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
    resultKey: "use_case_hermes_result",
    citationKey: "use_case_hermes_citation",
    interfaceLabel: "stdio MCP",
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
    resultKey: "use_case_n8n_result",
    citationKey: "use_case_n8n_citation",
    interfaceLabel: "TypeScript API",
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
    resultKey: "use_case_api_result",
    citationKey: "use_case_api_citation",
    interfaceLabel: "TypeScript API",
    files: ["docs/api-contract.pdf", "docs/auth-decisions.md"],
  },
]

function isUseCaseId(value: string): value is UseCaseId {
  return USE_CASES.some((useCase) => useCase.id === value)
}

function FlowArrow(): React.JSX.Element {
  return (
    <div className="flex items-center justify-center text-muted-foreground" aria-hidden="true">
      <ArrowDown className="lg:hidden" />
      <ArrowRight className="hidden lg:block" />
    </div>
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
    <Tabs className="gap-6" value={activeId} onValueChange={handleValueChange}>
      <TabsList
        className="grid h-auto w-full grid-cols-2 justify-start gap-x-4 gap-y-2 group-data-[orientation=horizontal]/tabs:h-auto sm:flex sm:w-fit sm:max-w-full"
        variant="line"
        aria-label={t("use_cases_tabs_label")}
      >
        {USE_CASES.map((useCase) => {
          const Icon = useCase.icon
          return (
            <TabsTrigger
              className="min-w-0 justify-start sm:min-w-fit sm:justify-center"
              key={useCase.id}
              value={useCase.id}
            >
              <Icon aria-hidden="true" />
              {t(useCase.tabKey)}
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
              <Card className="h-full overflow-hidden">
                <CardHeader className="gap-5 md:grid md:grid-cols-[1fr_auto] md:items-start">
                  <div className="flex min-w-0 flex-col gap-3">
                    <div className="flex items-center gap-3 text-violet-400">
                      <Icon aria-hidden="true" />
                      <p className="text-xs font-bold uppercase tracking-[0.16em]">
                        {t(useCase.eyebrowKey)}
                      </p>
                    </div>
                    <CardTitle className="max-w-2xl">{t(useCase.titleKey)}</CardTitle>
                    <CardDescription className="max-w-2xl">
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

                <CardContent className="flex flex-col gap-6 pt-5">
                  <div className="grid gap-4 border-b border-border pb-6 md:grid-cols-[minmax(0,0.38fr)_minmax(0,1fr)] md:items-start">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <MessageSquareQuote aria-hidden="true" />
                      <p className="font-bold text-xs uppercase tracking-[0.14em]">
                        {t("use_cases_request_label")}
                      </p>
                    </div>
                    <blockquote className="font-semibold text-base leading-7 md:text-lg">
                      “{t(useCase.requestKey)}”
                    </blockquote>
                  </div>

                  <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,0.72fr)_auto_minmax(0,1.1fr)] lg:items-center">
                    <section className="flex min-w-0 flex-col gap-4">
                      <div className="flex items-center gap-2">
                        <FileText className="text-muted-foreground" aria-hidden="true" />
                        <p className="font-bold text-xs uppercase tracking-[0.14em]">
                          01 · {t("use_cases_sources_label")}
                        </p>
                      </div>
                      <ul className="flex flex-col gap-3">
                        {useCase.files.map((file) => (
                          <li className="flex min-w-0 items-center gap-3" key={file} title={file}>
                            <FileText
                              className="shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                            <code className="truncate text-sm">{file}</code>
                          </li>
                        ))}
                      </ul>
                    </section>

                    <FlowArrow />

                    <section className="flex flex-col items-start gap-3 lg:items-center lg:text-center">
                      <ServerCog className="text-primary" aria-hidden="true" />
                      <div>
                        <p className="font-bold text-xs uppercase tracking-[0.14em]">02 · Ragmir</p>
                        <p className="mt-2 text-muted-foreground text-sm">
                          {t("use_cases_retrieval_label")}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 font-mono text-xs">
                        <Braces aria-hidden="true" />
                        <span>{useCase.interfaceLabel}</span>
                      </div>
                    </section>

                    <FlowArrow />

                    <section className="flex min-w-0 flex-col gap-4">
                      <div className="flex items-center gap-2">
                        <Icon className="text-muted-foreground" aria-hidden="true" />
                        <p className="font-bold text-xs uppercase tracking-[0.14em]">
                          03 · {t("use_cases_handoff_label")}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-base">{t(useCase.consumerKey)}</p>
                        <p className="mt-2 text-muted-foreground text-sm leading-6">
                          {t(useCase.resultKey)}
                        </p>
                      </div>
                      <p className="flex items-center gap-2 text-sm">
                        <FileCheck2 className="text-primary" aria-hidden="true" />
                        <span>{t(useCase.citationKey)}</span>
                      </p>
                    </section>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          )
        })}
      </div>
    </Tabs>
  )
}
