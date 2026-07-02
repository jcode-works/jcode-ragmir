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
  Bug,
  Check,
  ChevronDown,
  ClipboardCheck,
  Code2,
  Copy,
  Database,
  Download,
  FileSearch,
  Handshake,
  HardDrive,
  Headphones,
  LockKeyhole,
  Monitor,
  Plug,
  Replace,
  Scale,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { GithubIcon } from "./github-icon"
import { HeroDemo } from "./hero-demo"
import { LandingFooter } from "./landing-footer"
import { LandingNavbar } from "./landing-navbar"

interface LandingHeroProps {
  locale: string
  localizedHomeUrl: string
  localizedAgentsUrl: string
  localizedLibraryUrl: string
  localizedUseCasesUrl: string
  localizedDesktopUrl: string
  localizedTeamUrl: string
  alternateLocales: Array<{ locale: string; label: string; href: string }>
  translations: Record<string, string>
}

interface PackageManager {
  id: string
  label: string
  add: string
  exec: string
}

export function LandingHero({
  alternateLocales,
  locale,
  localizedAgentsUrl,
  localizedDesktopUrl,
  localizedHomeUrl,
  localizedLibraryUrl,
  localizedTeamUrl,
  localizedUseCasesUrl,
  translations,
}: LandingHeroProps): React.JSX.Element {
  const t = (key: string): string => translations[key] ?? key

  const searchQuery = t("quickstart_search_query")
  const packageManagers: PackageManager[] = [
    { id: "pnpm", label: "pnpm", add: "pnpm add -D @jcode.labs/mimir", exec: "pnpm exec" },
    { id: "npm", label: "npm", add: "npm install --save-dev @jcode.labs/mimir", exec: "npm exec" },
    { id: "yarn", label: "yarn", add: "yarn add --dev @jcode.labs/mimir", exec: "yarn exec" },
    {
      id: "mise",
      label: "mise",
      add: "mise exec node@24 -- npm install --save-dev @jcode.labs/mimir",
      exec: "mise exec node@24 -- npm exec",
    },
  ]
  const installSteps = [
    {
      key: "install",
      label: t("quickstart_install_label"),
      build: (manager: PackageManager) => manager.add,
    },
    {
      key: "setup",
      label: t("quickstart_setup_label"),
      build: (manager: PackageManager) => `${manager.exec} mimir setup`,
    },
    {
      key: "agent",
      label: t("quickstart_agent_label"),
      build: (manager: PackageManager) =>
        `${manager.exec} mimir install-agent --agents claude,codex,kimi`,
    },
    {
      key: "search",
      label: t("quickstart_search_label"),
      build: (manager: PackageManager) => `${manager.exec} mimir search "${searchQuery}"`,
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
      icon: Headphones,
      eyebrow: t("use_case_audio_eyebrow"),
      title: t("use_case_audio_title"),
      text: t("use_case_audio_text"),
    },
    {
      icon: Replace,
      eyebrow: t("use_case_refactor_eyebrow"),
      title: t("use_case_refactor_title"),
      text: t("use_case_refactor_text"),
    },
    {
      icon: Bug,
      eyebrow: t("use_case_debug_eyebrow"),
      title: t("use_case_debug_title"),
      text: t("use_case_debug_text"),
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
      question: t("faq_what_question"),
      answer: t("faq_what_answer"),
    },
    {
      question: t("faq_private_question"),
      answer: t("faq_private_answer"),
    },
    {
      question: t("faq_agents_question"),
      answer: t("faq_agents_answer"),
    },
    {
      question: t("faq_offline_question"),
      answer: t("faq_offline_answer"),
    },
    {
      question: t("faq_compare_question"),
      answer: t("faq_compare_answer"),
    },
    {
      question: t("faq_role_question"),
      answer: t("faq_role_answer"),
    },
    {
      question: t("faq_formats_question"),
      answer: t("faq_formats_answer"),
    },
    {
      question: t("faq_license_question"),
      answer: t("faq_license_answer"),
    },
  ]

  const externalLinkProps = {
    target: "_blank",
    rel: "noopener noreferrer",
  } as const

  const ctaLargeClass = "h-14 gap-2 px-8 text-sm font-bold"

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <MimirBackground height="100dvh" className="inset-0 min-h-[110dvh]" behindContent={false} />

      <LandingNavbar
        alternateLocales={alternateLocales}
        locale={locale}
        localizedAgentsUrl={localizedAgentsUrl}
        localizedDesktopUrl={localizedDesktopUrl}
        localizedHomeUrl={localizedHomeUrl}
        localizedLibraryUrl={localizedLibraryUrl}
        localizedTeamUrl={localizedTeamUrl}
        localizedUseCasesUrl={localizedUseCasesUrl}
        translations={translations}
      />

      <section
        id="top"
        aria-labelledby="hero-heading"
        className="relative z-10 mx-auto grid min-h-dvh w-full max-w-7xl items-center gap-10 px-5 pt-24 pb-24 md:px-8 lg:content-center lg:gap-20 lg:pt-16 lg:pb-0 lg:grid-cols-[1fr_0.9fr]"
      >
        <div className="max-w-4xl">
          <Badge variant="outline" className="mb-5">
            {t("hero_badge")}
          </Badge>
          <h1
            id="hero-heading"
            className="display-title max-w-3xl font-black text-3xl leading-[1.06] sm:text-4xl lg:text-5xl"
          >
            <span className="block">{t("hero_title_line_1")}</span>
            <span className="block">{t("hero_title_line_2")}</span>
          </h1>
          <p className="mt-6 max-w-2xl font-medium text-muted-foreground text-sm leading-6 md:text-base md:leading-7">
            {t("hero_description")}
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Button asChild className={ctaLargeClass} size="lg">
              <a href={localizedLibraryUrl}>
                {t("hero_primary_cta")}
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </a>
            </Button>
            <Button asChild className={ctaLargeClass} size="lg" variant="outline">
              <a href={localizedUseCasesUrl}>{t("hero_secondary_cta")}</a>
            </Button>
          </div>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {heroMetrics.map((metric) => (
              <div className="rounded-lg border border-border bg-card p-4" key={metric.label}>
                <p className="font-black text-lg">{metric.value}</p>
                <p className="mt-1 text-muted-foreground text-xs leading-5">{metric.label}</p>
              </div>
            ))}
          </div>
        </div>

        <HeroDemo t={t} />
      </section>

      <section
        id="use-cases"
        aria-labelledby="use-cases-heading"
        className="relative z-10 mx-auto max-w-7xl px-5 py-24 md:px-8 md:py-40"
      >
        <div className="mb-8 max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
            {t("use_cases_eyebrow")}
          </p>
          <h2 id="use-cases-heading" className="mt-4 font-black text-2xl leading-tight md:text-3xl">
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

      <section className="relative z-10" aria-labelledby="privacy-heading">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-24 md:px-8 md:py-40 lg:grid-cols-[1.25fr_0.75fr] lg:items-center">
          <div className="lg:order-2">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
              {t("privacy_eyebrow")}
            </p>
            <h2 id="privacy-heading" className="mt-4 font-black text-2xl leading-tight md:text-3xl">
              {t("privacy_title")}
            </h2>
            <p className="mt-4 text-muted-foreground text-sm leading-6">{t("privacy_text")}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:order-1">
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
        className="relative z-10 mx-auto grid max-w-7xl gap-8 px-5 py-24 md:px-8 md:py-40 lg:grid-cols-[0.82fr_1.18fr] lg:items-center"
        id="library"
        aria-labelledby="library-heading"
      >
        <MimirBackground behindContent className="inset-0" height="100%" />
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
            {t("library_eyebrow")}
          </p>
          <h2 id="library-heading" className="mt-4 font-black text-2xl leading-tight md:text-3xl">
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
            <Tabs className="gap-4" defaultValue={packageManagers[0]?.id ?? "pnpm"}>
              <TabsList className="flex w-full rounded-full border border-border bg-card/82 p-1">
                {packageManagers.map((manager) => (
                  <TabsTrigger
                    className="flex-1 justify-center rounded-full px-2 py-2 text-center text-xs uppercase"
                    key={manager.id}
                    value={manager.id}
                  >
                    {manager.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              {packageManagers.map((manager) => (
                <TabsContent className="mt-0 grid gap-3" key={manager.id} value={manager.id}>
                  {installSteps.map((step) => (
                    <CommandLineBlock
                      command={step.build(manager)}
                      copyLabel={t("copy_command")}
                      key={step.key}
                      label={step.label}
                    />
                  ))}
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      </section>

      <section
        id="agents"
        aria-labelledby="agents-heading"
        className="relative z-10 mx-auto grid max-w-7xl gap-8 px-5 py-24 md:px-8 md:py-40 lg:grid-cols-[1.1fr_0.9fr] lg:items-center"
      >
        <div className="lg:order-2">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
            {t("agents_eyebrow")}
          </p>
          <h2 id="agents-heading" className="mt-4 font-black text-2xl leading-tight md:text-3xl">
            {t("agents_title")}
          </h2>
          <p className="mt-4 text-muted-foreground text-sm leading-6">{t("agents_text")}</p>
          <div className="mt-6">
            <CommandLineBlock
              command={t("agents_command")}
              copyLabel={t("copy_command")}
              icon={<Plug aria-hidden="true" className="size-4 text-muted-foreground" />}
              label={t("agents_command_label")}
            />
          </div>
        </div>

        <Card className="bg-card/82 shadow-2xl shadow-black/30 backdrop-blur-xl lg:order-1">
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
        id="desktop"
        aria-labelledby="desktop-heading"
        className="relative z-10 mx-auto grid max-w-7xl gap-8 px-5 py-24 md:px-8 md:py-40 lg:grid-cols-[1fr_1fr] lg:items-center"
      >
        <MimirBackground behindContent className="inset-0" height="100%" />
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
            {t("desktop_teaser_eyebrow")}
          </p>
          <h2 id="desktop-heading" className="mt-4 font-black text-2xl leading-tight md:text-3xl">
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

      <section
        aria-labelledby="faq-heading"
        className="relative z-10 mx-auto max-w-7xl px-5 py-24 md:px-8 md:py-40"
      >
        <div className="mb-8 max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
            {t("faq_eyebrow")}
          </p>
          <h2 id="faq-heading" className="mt-4 font-black text-2xl leading-tight md:text-3xl">
            {t("faq_title")}
          </h2>
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
            <Button asChild className={cn(ctaLargeClass, "w-full sm:w-auto")} size="lg">
              <a href="https://github.com/jcode-works/jcode-mimir" {...externalLinkProps}>
                <GithubIcon data-icon="inline-start" />
                {t("closing_primary_cta")}
              </a>
            </Button>
            <Button
              asChild
              className={cn(ctaLargeClass, "w-full sm:w-auto")}
              size="lg"
              variant="outline"
            >
              <a href={localizedLibraryUrl}>
                {t("closing_secondary_cta")}
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </a>
            </Button>
          </CardContent>
        </Card>
      </section>

      <LandingFooter localizedHomeUrl={localizedHomeUrl} translations={translations} />

      <CommandCopyToast message={t("command_copied")} />
    </main>
  )
}

const copyToastSubscribers = new Set<() => void>()

function emitCopyToast(): void {
  for (const notify of copyToastSubscribers) notify()
}

function CommandCopyBox({
  command,
  copyLabel,
}: {
  command: string
  copyLabel: string
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const resetTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (resetTimeout.current) clearTimeout(resetTimeout.current)
    }
  }, [])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command)
    } catch {
      return
    }
    setCopied(true)
    emitCopyToast()
    if (resetTimeout.current) clearTimeout(resetTimeout.current)
    resetTimeout.current = setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      aria-label={copyLabel}
      className="group flex w-full items-center justify-between gap-3 rounded-md border border-border bg-background p-3 text-left transition hover:border-foreground/30 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => void handleCopy()}
      type="button"
    >
      <code className="overflow-x-auto font-mono text-foreground/78 text-xs">{command}</code>
      {copied ? (
        <Check aria-hidden="true" className="size-4 shrink-0 text-[var(--accent-title)]" />
      ) : (
        <Copy
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition group-hover:text-foreground"
        />
      )}
    </button>
  )
}

function CommandCopyToast({ message }: { message: string }): React.JSX.Element {
  const [visible, setVisible] = useState(false)
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const notify = () => {
      setVisible(true)
      if (hideTimeout.current) clearTimeout(hideTimeout.current)
      hideTimeout.current = setTimeout(() => setVisible(false), 2000)
    }
    copyToastSubscribers.add(notify)
    return () => {
      copyToastSubscribers.delete(notify)
      if (hideTimeout.current) clearTimeout(hideTimeout.current)
    }
  }, [])

  return (
    <div
      aria-live="polite"
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-6 z-50 mx-auto flex w-fit items-center gap-2 rounded-full border border-border bg-card px-4 py-2 font-semibold text-foreground text-sm shadow-2xl shadow-black/40 transition-all duration-300",
        visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
      )}
      role="status"
    >
      <Check aria-hidden="true" className="size-4 text-[var(--accent-title)]" />
      {message}
    </div>
  )
}

function CommandLineBlock({
  command,
  copyLabel,
  icon,
  label,
}: {
  command: string
  copyLabel: string
  icon?: React.ReactNode
  label: string
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-muted/45 p-4">
      <div className="flex items-center gap-2">
        {icon}
        <p className="font-bold text-sm">{label}</p>
      </div>
      <div className="mt-3">
        <CommandCopyBox command={command} copyLabel={copyLabel} />
      </div>
    </div>
  )
}
