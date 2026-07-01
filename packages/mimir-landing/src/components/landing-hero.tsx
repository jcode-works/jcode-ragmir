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
  ChevronDown,
  ClipboardCheck,
  Code2,
  Database,
  Download,
  FileSearch,
  GitBranch,
  Globe2,
  Handshake,
  HardDrive,
  LockKeyhole,
  Monitor,
  Plug,
  Scale,
  ShieldCheck,
  UserPlus,
  Users,
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

interface CommandLine {
  label: string
  command: string
}

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

  useEffect(() => {
    const handleScroll = () => setHasScrolled(window.scrollY > 12)
    handleScroll()
    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

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

  const heroMetrics = [
    {
      value: t("hero_metric_private_value"),
      label: t("hero_metric_private_label"),
    },
    {
      value: t("hero_metric_agents_value"),
      label: t("hero_metric_agents_label"),
    },
    {
      value: t("hero_metric_license_value"),
      label: t("hero_metric_license_label"),
    },
  ]

  const workspaceFiles = [
    t("workspace_file_contracts"),
    t("workspace_file_policy"),
    t("workspace_file_research"),
  ]

  const workspaceStatuses = [
    {
      icon: LockKeyhole,
      label: t("workspace_status_redaction"),
    },
    {
      icon: Database,
      label: t("workspace_status_index"),
    },
    {
      icon: Plug,
      label: t("workspace_status_mcp"),
    },
  ]

  const privacyControls = [
    {
      icon: HardDrive,
      title: t("privacy_docs_title"),
      text: t("privacy_docs_text"),
    },
    {
      icon: Database,
      title: t("privacy_index_title"),
      text: t("privacy_index_text"),
    },
    {
      icon: LockKeyhole,
      title: t("privacy_redaction_title"),
      text: t("privacy_redaction_text"),
    },
    {
      icon: ClipboardCheck,
      title: t("privacy_access_title"),
      text: t("privacy_access_text"),
    },
  ]

  const quickStartCommands: CommandLine[] = [
    {
      label: t("quickstart_setup_label"),
      command: t("quickstart_setup_command"),
    },
    {
      label: t("quickstart_agent_label"),
      command: t("quickstart_agent_command"),
    },
    {
      label: t("quickstart_search_label"),
      command: t("quickstart_search_command"),
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

  const useCases = [
    {
      icon: UserPlus,
      eyebrow: t("use_case_onboarding_eyebrow"),
      title: t("use_case_onboarding_title"),
      text: t("use_case_onboarding_text"),
    },
    {
      icon: Users,
      eyebrow: t("use_case_team_eyebrow"),
      title: t("use_case_team_title"),
      text: t("use_case_team_text"),
    },
    {
      icon: Handshake,
      eyebrow: t("use_case_sales_eyebrow"),
      title: t("use_case_sales_title"),
      text: t("use_case_sales_text"),
    },
    {
      icon: ClipboardCheck,
      eyebrow: t("use_case_vendor_eyebrow"),
      title: t("use_case_vendor_title"),
      text: t("use_case_vendor_text"),
    },
    {
      icon: Scale,
      eyebrow: t("use_case_legal_eyebrow"),
      title: t("use_case_legal_title"),
      text: t("use_case_legal_text"),
    },
    {
      icon: FileSearch,
      eyebrow: t("use_case_research_eyebrow"),
      title: t("use_case_research_title"),
      text: t("use_case_research_text"),
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
            <a className="transition hover:text-foreground" href={localizedLibraryUrl}>
              {t("nav_library")}
            </a>
            <a className="transition hover:text-foreground" href={localizedAgentsUrl}>
              {t("nav_agents")}
            </a>
            <a className="transition hover:text-foreground" href={localizedUseCasesUrl}>
              {t("nav_use_cases")}
            </a>
            <a className="transition hover:text-foreground" href={localizedDesktopUrl}>
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

      <section className="relative z-10 mx-auto grid min-h-[86dvh] w-full max-w-7xl items-center gap-10 px-5 pt-24 pb-10 md:px-8 md:pt-28 lg:grid-cols-[0.92fr_1.08fr]">
        <div className="max-w-4xl">
          <Badge variant="outline" className="mb-5">
            {t("hero_badge")}
          </Badge>
          <h1 className="display-title max-w-5xl font-black text-3xl leading-[1.02] sm:text-4xl lg:text-5xl">
            <span>{t("hero_title_line_1")}</span>
            <span className="block text-muted-foreground">{t("hero_title_line_2")}</span>
            <span className="block text-muted-foreground/70">{t("hero_title_line_3")}</span>
          </h1>
          <p className="mt-6 max-w-2xl font-medium text-muted-foreground text-sm leading-6 md:text-base md:leading-7">
            {t("hero_description")}
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <a href={localizedLibraryUrl}>
                {t("hero_primary_cta")}
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={localizedUseCasesUrl}>{t("hero_secondary_cta")}</a>
            </Button>
          </div>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {heroMetrics.map((metric) => (
              <div className="rounded-lg border border-border bg-card/72 p-4" key={metric.label}>
                <p className="font-black text-lg">{metric.value}</p>
                <p className="mt-1 text-muted-foreground text-xs leading-5">{metric.label}</p>
              </div>
            ))}
          </div>
        </div>

        <Card className="overflow-hidden bg-card/82 shadow-2xl shadow-black/55 backdrop-blur-2xl">
          <CardHeader className="gap-4 border-b border-border p-5 md:p-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <HardDrive aria-hidden="true" className="size-5 text-muted-foreground" />
                <h2 className="font-black text-lg leading-none">{t("workspace_title")}</h2>
              </div>
              <Badge variant="secondary">{t("workspace_badge")}</Badge>
            </div>
            <CardDescription className="leading-6">{t("workspace_text")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 p-5 md:p-6">
            <div className="grid gap-2">
              {workspaceFiles.map((file) => (
                <div
                  className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border border-border bg-muted/45 p-3"
                  key={file}
                >
                  <FileSearch aria-hidden="true" className="size-5 text-muted-foreground" />
                  <p className="truncate font-medium text-sm">{file}</p>
                  <Badge variant="outline">{t("workspace_file_badge")}</Badge>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-border bg-background/70 p-4">
              <p className="text-muted-foreground text-xs">{t("workspace_answer_label")}</p>
              <p className="mt-2 text-sm leading-6">{t("workspace_answer_text")}</p>
              <p className="mt-3 font-mono text-muted-foreground text-xs">
                {t("workspace_answer_citations")}
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              {workspaceStatuses.map((status) => (
                <div
                  className="flex items-center gap-2 rounded-lg border border-border bg-muted/35 p-3"
                  key={status.label}
                >
                  <status.icon aria-hidden="true" className="size-4 text-muted-foreground" />
                  <p className="font-semibold text-xs">{status.label}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="relative z-10 border-y border-border bg-background/86 backdrop-blur-xl">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-12 md:px-8 md:py-14 lg:grid-cols-[0.75fr_1.25fr] lg:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
              {t("privacy_eyebrow")}
            </p>
            <h2 className="mt-4 font-black text-2xl leading-tight md:text-3xl">
              {t("privacy_title")}
            </h2>
            <p className="mt-4 text-muted-foreground text-sm leading-6">{t("privacy_text")}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {privacyControls.map((control) => (
              <div
                className="rounded-lg border border-border bg-card/72 p-5 shadow-xl shadow-black/20"
                key={control.title}
              >
                <control.icon aria-hidden="true" className="size-5 text-muted-foreground" />
                <h3 className="mt-4 font-bold text-base">{control.title}</h3>
                <p className="mt-2 text-muted-foreground text-sm leading-6">{control.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        className="relative z-10 mx-auto grid max-w-7xl gap-8 px-5 py-14 md:px-8 md:py-16 lg:grid-cols-[0.82fr_1.18fr] lg:items-start"
        id="library"
      >
        <div className="lg:sticky lg:top-28">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
            {t("library_eyebrow")}
          </p>
          <h2 className="mt-4 font-black text-2xl leading-tight md:text-3xl">
            {t("library_title")}
          </h2>
          <p className="mt-4 text-muted-foreground text-sm leading-6">{t("library_text")}</p>
        </div>

        <Card className="overflow-hidden bg-card/88 shadow-2xl shadow-black/35 backdrop-blur-xl">
          <CardHeader className="gap-3 border-b border-border p-5 md:p-6">
            <div className="flex items-center gap-3">
              <Code2 aria-hidden="true" className="size-5 text-muted-foreground" />
              <CardTitle className="font-black text-xl">{t("quickstart_title")}</CardTitle>
            </div>
            <CardDescription className="leading-6">{t("quickstart_text")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 p-5 md:p-6">
            <InstallCommandTabs commands={installCommands} />
            <div className="grid gap-3">
              {quickStartCommands.map((line) => (
                <CommandLineBlock command={line.command} key={line.label} label={line.label} />
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <section
        id="agents"
        className="relative z-10 mx-auto grid max-w-7xl gap-8 px-5 py-14 md:px-8 md:py-16 lg:grid-cols-[0.9fr_1.1fr] lg:items-start"
      >
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
            {t("agents_eyebrow")}
          </p>
          <h2 className="mt-4 font-black text-2xl leading-tight md:text-3xl">
            {t("agents_title")}
          </h2>
          <p className="mt-4 text-muted-foreground text-sm leading-6">{t("agents_text")}</p>
          <div className="mt-6">
            <CommandLineBlock
              command={t("agents_command")}
              icon={<Plug aria-hidden="true" className="size-4 text-muted-foreground" />}
              label={t("agents_command_label")}
            />
          </div>
        </div>

        <Card className="bg-card/82 shadow-2xl shadow-black/30 backdrop-blur-xl">
          <CardHeader className="gap-3 border-b border-border p-5 md:p-6">
            <CardTitle className="font-black text-xl">{t("agents_targets_title")}</CardTitle>
            <CardDescription className="leading-6">{t("agents_targets_text")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 p-5 sm:grid-cols-2 md:p-6">
            {agentTargets.map((agent) => (
              <div className="rounded-lg border border-border bg-muted/45 p-4" key={agent.name}>
                <div className="flex items-center gap-3">
                  <Bot aria-hidden="true" className="size-5 text-muted-foreground" />
                  <p className="font-bold text-sm">{agent.name}</p>
                </div>
                <p className="mt-2 text-muted-foreground text-sm leading-6">{agent.text}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section
        id="use-cases"
        className="relative z-10 mx-auto max-w-7xl px-5 py-14 md:px-8 md:py-16"
      >
        <div className="mb-8 max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
            {t("use_cases_eyebrow")}
          </p>
          <h2 className="mt-4 font-black text-2xl leading-tight md:text-3xl">
            {t("use_cases_title")}
          </h2>
          <p className="mt-4 text-muted-foreground text-sm leading-6">{t("use_cases_text")}</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {useCases.map((useCase) => (
            <Card className="bg-card/82 shadow-xl shadow-black/20" key={useCase.title}>
              <CardHeader className="gap-3 p-5 md:p-6">
                <div className="flex items-center gap-3">
                  <useCase.icon className="size-5 text-muted-foreground" aria-hidden="true" />
                  <p className="text-muted-foreground text-xs font-bold uppercase tracking-[0.14em]">
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

      <section
        id="desktop"
        className="relative z-10 mx-auto grid max-w-7xl gap-8 px-5 py-14 md:px-8 md:py-16 lg:grid-cols-[1fr_1fr] lg:items-center"
      >
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
            {t("desktop_teaser_eyebrow")}
          </p>
          <h2 className="mt-4 font-black text-2xl leading-tight md:text-3xl">
            {t("desktop_teaser_title")}
          </h2>
          <p className="mt-4 text-muted-foreground text-sm leading-6">{t("desktop_teaser_text")}</p>
          <Button asChild className="mt-6" variant="outline">
            <a href="https://github.com/jcode-works/jcode-mimir" {...externalLinkProps}>
              {t("desktop_cta")}
              <ArrowRight aria-hidden="true" data-icon="inline-end" />
            </a>
          </Button>
        </div>

        <Card className="overflow-hidden bg-card/82 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <CardHeader className="gap-3 border-b border-border p-5 md:p-6">
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="font-black text-xl">{t("desktop_teaser_mock_title")}</CardTitle>
              <Badge variant="outline">{t("desktop_teaser_badge")}</Badge>
            </div>
            <CardDescription className="leading-6">{t("desktop_teaser_mock_text")}</CardDescription>
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
      </section>

      <section className="relative z-10 mx-auto max-w-7xl px-5 py-14 md:px-8 md:py-16">
        <div className="mb-8 max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
            {t("faq_eyebrow")}
          </p>
          <h2 className="mt-4 font-black text-2xl leading-tight md:text-3xl">{t("faq_title")}</h2>
          <p className="mt-4 text-muted-foreground text-sm leading-6">{t("faq_text")}</p>
        </div>

        <div className="grid gap-3">
          {faqItems.map((item) => (
            <details
              key={item.question}
              className="group rounded-lg border border-border bg-card/82 p-5 shadow-xl shadow-black/20 backdrop-blur-xl open:bg-card"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-bold text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {item.question}
                <ChevronDown
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground transition group-open:rotate-180"
                />
              </summary>
              <p className="mt-3 max-w-3xl text-muted-foreground text-sm leading-6">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-7xl px-5 pt-4 pb-20 md:px-8 md:pb-24">
        <Card className="overflow-hidden bg-card/88 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <CardHeader className="gap-4 p-6 md:p-8">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
              {t("closing_eyebrow")}
            </p>
            <CardTitle className="font-black text-2xl leading-tight md:text-3xl">
              {t("closing_title")}
            </CardTitle>
            <CardDescription className="text-sm leading-6">{t("closing_text")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 p-6 pt-0 sm:flex-row sm:items-center md:p-8 md:pt-0">
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

      <footer className="relative z-10 border-border border-t px-5 py-8 text-center font-medium text-muted-foreground text-xs md:px-8">
        {t("footer_text")}
      </footer>
    </main>
  )
}

function CommandLineBlock({
  command,
  icon,
  label,
}: {
  command: string
  icon?: React.ReactNode
  label: string
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-muted/45 p-4">
      <div className="flex items-center gap-2">
        {icon}
        <p className="font-bold text-sm">{label}</p>
      </div>
      <div className="mt-3 overflow-x-auto rounded-md border border-border bg-background p-3">
        <code className="font-mono text-foreground/78 text-xs">$ {command}</code>
      </div>
    </div>
  )
}

function InstallCommandTabs({ commands }: { commands: InstallCommand[] }): React.JSX.Element {
  const defaultValue = commands[0]?.label ?? ""

  return (
    <Tabs className="gap-3" defaultValue={defaultValue}>
      <TabsList className="grid h-auto w-full grid-cols-4 rounded-full border border-border bg-card/82 p-1">
        {commands.map((entry) => (
          <TabsTrigger
            className="rounded-full px-2 py-2 text-xs uppercase"
            key={entry.label}
            value={entry.label}
          >
            {entry.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {commands.map((entry) => (
        <TabsContent
          className="mt-0 overflow-x-auto rounded-md border border-border bg-background p-3"
          key={entry.label}
          value={entry.label}
        >
          <code className="text-foreground/78 text-xs">$ {entry.command}</code>
        </TabsContent>
      ))}
    </Tabs>
  )
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
      <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-full border border-border bg-background/60 px-3 font-bold text-foreground text-xs outline-none backdrop-blur transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
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
            className="rounded-md px-3 py-2 font-semibold text-muted-foreground text-sm transition hover:bg-muted hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
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
