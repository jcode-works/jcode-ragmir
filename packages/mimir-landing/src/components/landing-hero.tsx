import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  MimirBackground,
} from "@jcode.labs/mimir-ui"
import {
  ArrowRight,
  Bot,
  Building2,
  ClipboardCheck,
  FileSearch,
  GitBranch,
  HardDrive,
  LockKeyhole,
  Scale,
} from "lucide-react"

interface LandingHeroProps {
  locale: string
  localizedHomeUrl: string
  localizedLibraryUrl: string
  localizedUseCasesUrl: string
  localizedDesktopUrl: string
  alternateLocales: Array<{ locale: string; label: string; href: string }>
  translations: Record<string, string>
}

export function LandingHero({
  alternateLocales,
  locale,
  localizedDesktopUrl,
  localizedHomeUrl,
  localizedLibraryUrl,
  localizedUseCasesUrl,
  translations,
}: LandingHeroProps): React.JSX.Element {
  const t = (key: string): string => translations[key] ?? key

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

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <MimirBackground
        height="100dvh"
        className="inset-0 min-h-[110dvh]"
        behindContent={false}
        overlay={false}
      />

      <section className="relative z-10 mx-auto flex min-h-[92dvh] w-full max-w-7xl flex-col px-5 py-4 md:px-8">
        <nav className="flex items-center justify-between gap-4 rounded-full border border-border bg-background/50 px-4 py-3 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <a className="text-lg font-black tracking-tight text-foreground" href={localizedHomeUrl}>
            Mimir
          </a>

          <div className="hidden items-center gap-6 text-sm font-semibold text-muted-foreground md:flex">
            <a className="transition hover:text-foreground" href={localizedHomeUrl}>
              {t("nav_home")}
            </a>
            <a className="transition hover:text-foreground" href={localizedLibraryUrl}>
              {t("nav_library")}
            </a>
            <a className="transition hover:text-foreground" href={localizedUseCasesUrl}>
              {t("nav_use_cases")}
            </a>
            <a className="transition hover:text-foreground" href={localizedDesktopUrl}>
              {t("nav_desktop")}
            </a>
          </div>

          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="mimir-locale">
              {t("language_label")}
            </label>
            <select
              id="mimir-locale"
              className="h-10 rounded-full border border-border bg-background/60 px-3 text-xs font-semibold text-foreground outline-none backdrop-blur transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              defaultValue={locale}
              onChange={(event) => {
                const href = alternateLocales.find(
                  (entry) => entry.locale === event.currentTarget.value,
                )?.href
                if (href) {
                  try {
                    window.localStorage.setItem("mimir-locale", event.currentTarget.value)
                  } catch {
                    // Ignore blocked storage; navigation still applies the selected locale.
                  }
                  window.location.href = href
                }
              }}
            >
              {alternateLocales.map((entry) => (
                <option
                  className="bg-background text-foreground"
                  key={entry.locale}
                  value={entry.locale}
                >
                  {entry.label}
                </option>
              ))}
            </select>

            <Button asChild size="sm" variant="ghost" className="hidden md:inline-flex">
              <a href="https://github.com/jcode-works/jcode-mimir">
                <GitBranch aria-hidden="true" data-icon="inline-start" />
                {t("nav_github")}
              </a>
            </Button>
            <Button asChild size="sm">
              <a href="https://github.com/jcode-works/jcode-mimir">
                {t("nav_primary")}
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </a>
            </Button>
          </div>
        </nav>

        <div className="grid flex-1 items-center gap-10 py-8 lg:grid-cols-[1.02fr_0.98fr]">
          <div className="max-w-5xl">
            <Badge variant="outline" className="mb-6">
              {t("hero_badge")}
            </Badge>
            <h1 className="display-title max-w-6xl text-[clamp(2.9rem,5.6vw,5.1rem)] font-black leading-[0.9] tracking-tight">
              <span>{t("hero_title_line_1")}</span>
              <span className="block text-foreground/82">{t("hero_title_line_2")}</span>
              <span className="block text-foreground/52">{t("hero_title_line_3")}</span>
            </h1>
            <p className="mt-6 max-w-2xl text-base font-medium leading-7 text-muted-foreground">
              {t("hero_description")}
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <a href="https://github.com/jcode-works/jcode-mimir">
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
                  <p className="text-muted-foreground">$ {t("terminal_command_1")}</p>
                  <p className="text-success">{t("terminal_output_1")}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">$ {t("terminal_command_2")}</p>
                  <p className="mt-2 rounded-lg border border-border bg-muted p-3 text-foreground/78">
                    {t("terminal_output_2")}
                    <br />
                    {t("terminal_output_3")}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <section
        className="relative z-10 border-y border-border bg-background/80 backdrop-blur-xl"
        id="library"
      >
        <div className="mx-auto grid max-w-7xl gap-4 px-5 py-12 md:grid-cols-3 md:px-8">
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

      <section className="relative z-10 mx-auto grid max-w-7xl gap-5 px-5 py-16 md:grid-cols-2 md:px-8">
        <Card>
          <CardHeader className="gap-5 p-6 md:p-8">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
              {t("library_eyebrow")}
            </p>
            <CardTitle className="text-3xl font-black leading-none">{t("library_title")}</CardTitle>
            <CardDescription className="text-sm leading-6">{t("library_text")}</CardDescription>
          </CardHeader>
          <CardContent className="font-mono text-xs leading-6 md:text-sm">
            <p className="text-muted-foreground">$ {t("library_install_command")}</p>
            <p>$ {t("library_setup_command")}</p>
            <p>$ {t("library_search_command")}</p>
          </CardContent>
        </Card>
        <Card id="desktop">
          <CardHeader className="gap-5 p-6 md:p-8">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
              {t("desktop_eyebrow")}
            </p>
            <CardTitle className="text-3xl font-black leading-none">{t("desktop_title")}</CardTitle>
            <CardDescription className="text-sm leading-6">{t("desktop_text")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <a href="https://github.com/jcode-works/jcode-mimir">
                {t("desktop_cta")}
                <GitBranch aria-hidden="true" data-icon="inline-end" />
              </a>
            </Button>
          </CardContent>
        </Card>
      </section>

      <section id="use-cases" className="relative z-10 mx-auto max-w-7xl px-5 pb-16 md:px-8">
        <div className="mb-7 max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
            {t("use_cases_eyebrow")}
          </p>
          <h2 className="mt-4 text-3xl font-black leading-none md:text-4xl">
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

      <section className="relative z-10 mx-auto max-w-7xl px-5 pb-16 md:px-8">
        <Card className="bg-primary p-6 text-primary-foreground shadow-2xl shadow-black/40 md:p-8">
          <CardHeader className="gap-5 p-6 md:p-8">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
              {t("closing_eyebrow")}
            </p>
            <CardTitle className="text-3xl font-black leading-none">{t("closing_title")}</CardTitle>
            <CardDescription className="text-sm leading-6 text-primary-foreground/70">
              {t("closing_text")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row">
            <Button asChild variant="secondary">
              <a href="https://github.com/jcode-works/jcode-mimir">
                {t("closing_primary_cta")}
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </a>
            </Button>
            <Button asChild variant="outline">
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
