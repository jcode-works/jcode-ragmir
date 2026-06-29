import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  MimirBackground,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@jcode.labs/mimir-ui"
import { cn } from "@jcode.labs/mimir-ui/utils"
import {
  ArrowRight,
  Bot,
  Building2,
  ChevronDown,
  ClipboardCheck,
  Code2,
  Download,
  FileSearch,
  GitBranch,
  Globe2,
  HardDrive,
  LockKeyhole,
  Monitor,
  Plug,
  Scale,
  ShieldCheck,
} from "lucide-react"
import { useEffect, useState } from "react"

interface LandingHeroProps {
  locale: string
  localizedHomeUrl: string
  localizedAgentsUrl: string
  localizedLibraryUrl: string
  localizedUseCasesUrl: string
  localizedDesktopUrl: string
  alternateLocales: Array<{ locale: string; label: string; href: string }>
  translations: Record<string, string>
}

interface InstallCommand {
  label: string
  command: string
}

interface AgentStep {
  title: string
  text: string
  command?: string
  commands?: InstallCommand[]
}

type ProductTab = "library" | "agents" | "desktop"

export function LandingHero({
  alternateLocales,
  locale,
  localizedAgentsUrl,
  localizedDesktopUrl,
  localizedHomeUrl,
  localizedLibraryUrl,
  localizedUseCasesUrl,
  translations,
}: LandingHeroProps): React.JSX.Element {
  const t = (key: string): string => translations[key] ?? key
  const [hasScrolled, setHasScrolled] = useState(false)
  const [activeProductTab, setActiveProductTab] = useState<ProductTab>("library")

  useEffect(() => {
    const handleScroll = () => setHasScrolled(window.scrollY > 12)
    handleScroll()
    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  useEffect(() => {
    const syncTabFromHash = () => {
      const productTab = productTabFromHash(window.location.hash)
      if (productTab) setActiveProductTab(productTab)
    }

    syncTabFromHash()
    window.addEventListener("hashchange", syncTabFromHash)
    return () => window.removeEventListener("hashchange", syncTabFromHash)
  }, [])

  const proofPoints = [
    {
      icon: LockKeyhole,
      title: t("proof_local_title"),
      text: t("proof_local_text"),
    },
    {
      icon: FileSearch,
      title: t("proof_cited_title"),
      text: t("proof_cited_text"),
    },
    {
      icon: Bot,
      title: t("proof_agent_title"),
      text: t("proof_agent_text"),
    },
  ]

  const useCases = [
    {
      icon: Scale,
      eyebrow: t("use_case_legal_eyebrow"),
      title: t("use_case_legal_title"),
      text: t("use_case_legal_text"),
    },
    {
      icon: ClipboardCheck,
      eyebrow: t("use_case_rfp_eyebrow"),
      title: t("use_case_rfp_title"),
      text: t("use_case_rfp_text"),
    },
    {
      icon: Building2,
      eyebrow: t("use_case_company_eyebrow"),
      title: t("use_case_company_title"),
      text: t("use_case_company_text"),
    },
    {
      icon: FileSearch,
      eyebrow: t("use_case_research_eyebrow"),
      title: t("use_case_research_title"),
      text: t("use_case_research_text"),
    },
  ]

  const installCommands: InstallCommand[] = [
    {
      label: t("install_pnpm_label"),
      command: t("install_pnpm_command"),
    },
    {
      label: t("install_npm_label"),
      command: t("install_npm_command"),
    },
    {
      label: t("install_yarn_label"),
      command: t("install_yarn_command"),
    },
    {
      label: t("install_mise_label"),
      command: t("install_mise_command"),
    },
  ]

  const agentSteps: AgentStep[] = [
    {
      title: t("agents_step_install_title"),
      text: t("agents_step_install_text"),
      commands: installCommands,
    },
    {
      title: t("agents_step_setup_title"),
      text: t("agents_step_setup_text"),
      command: t("agents_step_setup_command"),
    },
    {
      title: t("agents_step_connect_title"),
      text: t("agents_step_connect_text"),
      command: t("agents_step_connect_command"),
    },
  ]

  const agentTargets = [
    {
      name: "Claude",
      text: t("agents_claude_text"),
    },
    {
      name: "Codex",
      text: t("agents_codex_text"),
    },
    {
      name: "Kimi",
      text: t("agents_kimi_text"),
    },
    {
      name: "OpenCode / Cline",
      text: t("agents_other_text"),
    },
  ]

  const desktopTeasers = [
    {
      icon: Monitor,
      title: t("desktop_teaser_workspace_title"),
      text: t("desktop_teaser_workspace_text"),
    },
    {
      icon: Download,
      title: t("desktop_teaser_download_title"),
      text: t("desktop_teaser_download_text"),
    },
    {
      icon: ShieldCheck,
      title: t("desktop_teaser_private_title"),
      text: t("desktop_teaser_private_text"),
    },
  ]

  const faqItems = [
    {
      question: t("faq_private_question"),
      answer: t("faq_private_answer"),
    },
    {
      question: t("faq_formats_question"),
      answer: t("faq_formats_answer"),
    },
    {
      question: t("faq_desktop_question"),
      answer: t("faq_desktop_answer"),
    },
  ]

  const externalLinkProps = {
    target: "_blank",
    rel: "noopener noreferrer",
  } as const

  function handleProductTabChange(value: string) {
    if (isProductTab(value)) setActiveProductTab(value)
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <MimirBackground height="100dvh" className="inset-0 min-h-[110dvh]" behindContent={false} />

      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-30 h-28 bg-linear-to-b from-background via-background/82 to-transparent"
      />
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-40 px-4 py-3 transition-all duration-300 md:px-6",
          hasScrolled && "bg-linear-to-b from-background via-background/88 to-transparent",
        )}
      >
        <nav className="mx-auto flex h-12 max-w-7xl items-center justify-between gap-3 rounded-full border border-border/80 bg-background/58 px-4 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <a className="font-black text-base text-foreground md:text-lg" href={localizedHomeUrl}>
            Mimir
          </a>

          <div className="hidden items-center gap-6 text-sm font-semibold text-muted-foreground md:flex">
            <a className="transition hover:text-foreground" href={localizedHomeUrl}>
              {t("nav_home")}
            </a>
            <a
              className="transition hover:text-foreground"
              href={localizedLibraryUrl}
              onClick={() => setActiveProductTab("library")}
            >
              {t("nav_library")}
            </a>
            <a
              className="transition hover:text-foreground"
              href={localizedAgentsUrl}
              onClick={() => setActiveProductTab("agents")}
            >
              {t("nav_agents")}
            </a>
            <a className="transition hover:text-foreground" href={localizedUseCasesUrl}>
              {t("nav_use_cases")}
            </a>
            <a
              className="transition hover:text-foreground"
              href={localizedDesktopUrl}
              onClick={() => setActiveProductTab("desktop")}
            >
              {t("nav_desktop")}
            </a>
          </div>

          <div className="flex items-center gap-2">
            <LanguageSwitcher
              alternateLocales={alternateLocales}
              currentLocale={locale}
              label={t("language_label")}
            />

            <Button asChild size="sm" variant="ghost" className="hidden md:inline-flex">
              <a href="https://github.com/jcode-works/jcode-mimir" {...externalLinkProps}>
                <GitBranch aria-hidden="true" data-icon="inline-start" />
                {t("nav_github")}
              </a>
            </Button>
            <Button asChild size="sm">
              <a href="https://github.com/jcode-works/jcode-mimir" {...externalLinkProps}>
                {t("nav_primary")}
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </a>
            </Button>
          </div>
        </nav>
      </header>

      <section className="relative z-10 mx-auto flex min-h-[94dvh] w-full max-w-7xl flex-col px-5 pt-24 pb-8 md:px-8 md:pt-28">
        <div className="grid flex-1 items-center gap-12 py-10 lg:grid-cols-[1.02fr_0.98fr]">
          <div className="max-w-5xl">
            <Badge variant="outline" className="mb-6">
              {t("hero_badge")}
            </Badge>
            <h1 className="display-title max-w-5xl font-black text-4xl leading-[0.96] sm:text-5xl lg:text-6xl">
              <span>{t("hero_title_line_1")}</span>
              <span className="block text-foreground/82">{t("hero_title_line_2")}</span>
              <span className="block text-foreground/52">{t("hero_title_line_3")}</span>
            </h1>
            <p className="mt-6 max-w-2xl font-medium text-muted-foreground text-sm leading-6 md:text-base md:leading-7">
              {t("hero_description")}
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <a href="https://github.com/jcode-works/jcode-mimir" {...externalLinkProps}>
                  {t("hero_primary_cta")}
                  <ArrowRight aria-hidden="true" data-icon="inline-end" />
                </a>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href={localizedUseCasesUrl}>{t("hero_secondary_cta")}</a>
              </Button>
            </div>
          </div>

          <div className="relative">
            <Card className="relative overflow-hidden shadow-2xl shadow-black/60 backdrop-blur-2xl">
              <CardHeader className="flex-row items-center justify-between border-b border-border">
                <CardTitle className="text-sm font-bold">{t("terminal_label")}</CardTitle>
                <HardDrive aria-hidden="true" className="size-5 text-muted-foreground" />
              </CardHeader>
              <CardContent className="flex flex-col gap-5 font-mono text-xs leading-6 md:text-sm md:leading-7">
                <div>
                  <p className="text-muted-foreground">{t("terminal_install_prompt")}</p>
                  <CommandList commands={installCommands} />
                  <p className="text-success">{t("terminal_install_output")}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">$ {t("terminal_setup_command")}</p>
                  <p className="text-success">{t("terminal_setup_output")}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">$ {t("terminal_ask_command")}</p>
                  <p className="mt-2 rounded-lg border border-border bg-muted p-3 text-foreground/78">
                    {t("terminal_ask_output_1")}
                    <br />
                    {t("terminal_ask_output_2")}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <section className="relative z-10 border-y border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto grid max-w-7xl gap-4 px-5 py-14 md:grid-cols-3 md:px-8 md:py-16">
          {proofPoints.map((point) => (
            <Card key={point.title} className="shadow-xl shadow-black/20">
              <CardHeader>
                <point.icon className="size-5 text-muted-foreground" aria-hidden="true" />
                <CardTitle>{point.title}</CardTitle>
                <CardDescription className="leading-6">{point.text}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-7xl px-5 py-16 md:px-8 md:py-20" id="library">
        <span aria-hidden="true" className="block scroll-mt-28" id="agents" />
        <span aria-hidden="true" className="block scroll-mt-28" id="desktop" />
        <div className="mb-6 max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
            {t("library_eyebrow")}
          </p>
          <h2 className="mt-4 font-black text-2xl leading-tight md:text-3xl">
            {t("library_title")}
          </h2>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">{t("library_text")}</p>
        </div>

        <Tabs className="gap-5" onValueChange={handleProductTabChange} value={activeProductTab}>
          <TabsList className="grid h-auto w-full max-w-xl grid-cols-3 rounded-full border border-border bg-card/82 p-1 shadow-xl shadow-black/20 backdrop-blur-xl">
            <TabsTrigger className="rounded-full py-2.5" value="library">
              {t("nav_library")}
            </TabsTrigger>
            <TabsTrigger className="rounded-full py-2.5" value="agents">
              {t("nav_agents")}
            </TabsTrigger>
            <TabsTrigger className="rounded-full py-2.5" value="desktop">
              {t("nav_desktop")}
            </TabsTrigger>
          </TabsList>

          <TabsContent className="mt-4" value="library">
            <Card>
              <CardHeader className="gap-4 p-6 md:p-8">
                <CardTitle className="font-black text-2xl leading-tight md:text-3xl">
                  {t("library_title")}
                </CardTitle>
                <CardDescription className="text-sm leading-6">{t("library_text")}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5 font-mono text-xs leading-6 md:grid-cols-[1.1fr_0.9fr] md:text-sm">
                <CommandList commands={installCommands} />
                <div className="rounded-lg border border-border bg-muted/50 p-4">
                  <p className="text-muted-foreground">$ {t("library_setup_command")}</p>
                  <p>$ {t("library_agent_command")}</p>
                  <p>$ {t("library_search_command")}</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent className="mt-4" value="agents">
            <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
              <Card>
                <CardHeader className="gap-4 p-6 md:p-8">
                  <div className="flex items-center gap-3">
                    <Plug aria-hidden="true" className="size-5 text-muted-foreground" />
                    <CardTitle className="font-black text-2xl leading-tight md:text-3xl">
                      {t("agents_steps_title")}
                    </CardTitle>
                  </div>
                  <CardDescription className="text-sm leading-6">
                    {t("agents_steps_text")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-3">
                  {agentSteps.map((step) => (
                    <div
                      className="rounded-lg border border-border bg-muted/50 p-4"
                      key={step.title}
                    >
                      <p className="font-bold text-sm">{step.title}</p>
                      <p className="mt-1 text-muted-foreground text-sm leading-6">{step.text}</p>
                      {step.commands ? (
                        <CommandList commands={step.commands} />
                      ) : (
                        <p className="mt-3 overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-xs text-foreground/78">
                          $ {step.command}
                        </p>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="gap-4 p-6 md:p-8">
                  <CardTitle className="font-black text-2xl leading-tight md:text-3xl">
                    {t("agents_title")}
                  </CardTitle>
                  <CardDescription className="text-sm leading-6">
                    {t("agents_text")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  {agentTargets.map((agent) => (
                    <div
                      className="rounded-lg border border-border bg-muted/45 p-4"
                      key={agent.name}
                    >
                      <div className="flex items-center gap-3">
                        <Code2 aria-hidden="true" className="size-5 text-muted-foreground" />
                        <p className="font-bold text-sm">{agent.name}</p>
                      </div>
                      <p className="mt-2 text-muted-foreground text-sm leading-6">{agent.text}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent className="mt-4" value="desktop">
            <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
              <Card>
                <CardHeader className="gap-5 p-6 md:p-8">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    {t("desktop_teaser_eyebrow")}
                  </p>
                  <CardTitle className="font-black text-2xl leading-tight md:text-3xl">
                    {t("desktop_teaser_title")}
                  </CardTitle>
                  <CardDescription className="text-sm leading-6">
                    {t("desktop_teaser_text")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild variant="outline">
                    <a href="https://github.com/jcode-works/jcode-mimir" {...externalLinkProps}>
                      {t("desktop_cta")}
                      <GitBranch aria-hidden="true" data-icon="inline-end" />
                    </a>
                  </Button>
                </CardContent>
              </Card>

              <Card className="overflow-hidden shadow-2xl shadow-black/40">
                <CardHeader className="border-b border-border">
                  <div className="flex items-center justify-between gap-4">
                    <CardTitle className="font-black text-xl leading-tight">
                      {t("desktop_teaser_mock_title")}
                    </CardTitle>
                    <Badge variant="outline">{t("desktop_teaser_badge")}</Badge>
                  </div>
                  <CardDescription className="leading-6">
                    {t("desktop_teaser_mock_text")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 p-5 md:p-6">
                  {desktopTeasers.map((item) => (
                    <div
                      className="grid gap-3 rounded-lg border border-border bg-muted/45 p-4 sm:grid-cols-[auto_1fr]"
                      key={item.title}
                    >
                      <item.icon aria-hidden="true" className="size-5 text-muted-foreground" />
                      <div>
                        <p className="font-bold text-sm">{item.title}</p>
                        <p className="mt-1 text-muted-foreground text-sm leading-6">{item.text}</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </section>

      <section
        id="use-cases"
        className="relative z-10 mx-auto max-w-7xl px-5 py-8 pb-20 md:px-8 md:pb-24"
      >
        <div className="mb-8 max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
            {t("use_cases_eyebrow")}
          </p>
          <h2 className="mt-4 font-black text-2xl leading-tight md:text-3xl">
            {t("use_cases_title")}
          </h2>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">{t("use_cases_text")}</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {useCases.map((useCase) => (
            <Card key={useCase.title}>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <useCase.icon className="size-5 text-muted-foreground" aria-hidden="true" />
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    {useCase.eyebrow}
                  </p>
                </div>
                <CardTitle>{useCase.title}</CardTitle>
                <CardDescription className="leading-6">{useCase.text}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-7xl px-5 py-8 pb-20 md:px-8 md:pb-24">
        <div className="mb-8 max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
            {t("faq_eyebrow")}
          </p>
          <h2 className="mt-4 font-black text-2xl leading-tight md:text-3xl">{t("faq_title")}</h2>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">{t("faq_text")}</p>
        </div>

        <div className="grid gap-3">
          {faqItems.map((item) => (
            <details
              key={item.question}
              className="group rounded-lg border border-border bg-card/82 p-5 shadow-xl shadow-black/20 backdrop-blur-xl open:bg-card"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {item.question}
                <ChevronDown
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground transition group-open:rotate-180"
                />
              </summary>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-7xl px-5 pt-4 pb-20 md:px-8 md:pb-24">
        <Card className="overflow-hidden bg-card/88 p-6 shadow-2xl shadow-black/40 backdrop-blur-xl md:p-8">
          <CardHeader className="gap-5 p-6 md:p-8">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
              {t("closing_eyebrow")}
            </p>
            <CardTitle className="font-black text-2xl leading-tight md:text-3xl">
              {t("closing_title")}
            </CardTitle>
            <CardDescription className="text-sm leading-6">{t("closing_text")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild className="w-full sm:w-auto">
              <a href="https://github.com/jcode-works/jcode-mimir" {...externalLinkProps}>
                {t("closing_primary_cta")}
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </a>
            </Button>
            <Button asChild className="w-full sm:w-auto" variant="outline">
              <a href={localizedLibraryUrl}>
                {t("closing_secondary_cta")}
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </a>
            </Button>
          </CardContent>
        </Card>
      </section>

      <footer className="relative z-10 border-border border-t px-5 py-8 text-center text-xs font-medium text-muted-foreground md:px-8">
        {t("footer_text")}
      </footer>
    </main>
  )
}

function CommandList({ commands }: { commands: InstallCommand[] }): React.JSX.Element {
  return (
    <div className="mt-3 flex flex-col gap-2">
      {commands.map((entry) => (
        <div
          className="grid gap-2 rounded-md border border-border bg-background p-3 sm:grid-cols-[5rem_1fr]"
          key={entry.label}
        >
          <Badge className="w-fit uppercase" variant="outline">
            {entry.label}
          </Badge>
          <code className="overflow-x-auto text-foreground/78 text-xs">$ {entry.command}</code>
        </div>
      ))}
    </div>
  )
}

function isProductTab(value: string): value is ProductTab {
  return value === "library" || value === "agents" || value === "desktop"
}

function productTabFromHash(hash: string): ProductTab | undefined {
  const normalizedHash = hash.replace(/^#/, "")
  return isProductTab(normalizedHash) ? normalizedHash : undefined
}

function LanguageSwitcher({
  alternateLocales,
  currentLocale,
  label,
}: {
  alternateLocales: Array<{ locale: string; label: string; href: string }>
  currentLocale: string
  label: string
}): React.JSX.Element {
  const currentLabel =
    alternateLocales.find((entry) => entry.locale === currentLocale)?.label ?? currentLocale

  function handleLocaleClick(
    locale: string,
    href: string,
    event: React.MouseEvent<HTMLAnchorElement>,
  ) {
    try {
      window.localStorage.setItem("mimir-locale", locale)
      window.localStorage.setItem("i18nextLng", locale)
    } catch {
      // Navigation still applies the selected locale when storage is blocked.
    }

    const suffix = `${window.location.search}${window.location.hash}`
    if (!suffix) return

    event.preventDefault()
    const url = new URL(href, window.location.origin)
    url.search = window.location.search
    url.hash = window.location.hash
    window.location.href = url.toString()
  }

  return (
    <details className="group relative">
      <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-full border border-border bg-background/60 px-3 text-xs font-bold text-foreground outline-none backdrop-blur transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
        <Globe2 aria-hidden="true" className="size-4 text-muted-foreground" />
        <span className="sr-only">{label}</span>
        <span className="hidden sm:inline">{currentLabel}</span>
        <span className="uppercase sm:hidden">{currentLocale}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-3.5 text-muted-foreground transition group-open:rotate-180"
        />
      </summary>
      <div className="absolute right-0 mt-2 grid min-w-36 gap-1 rounded-lg border border-border bg-card p-1.5 shadow-2xl shadow-black/50">
        {alternateLocales.map((entry) => (
          <a
            aria-current={entry.locale === currentLocale ? "page" : undefined}
            className="rounded-md px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
            href={entry.href}
            key={entry.locale}
            onClick={(event) => handleLocaleClick(entry.locale, entry.href, event)}
          >
            {entry.label}
          </a>
        ))}
      </div>
    </details>
  )
}
