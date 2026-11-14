import {
  ArrowUpRight,
  BookOpen,
  Bot,
  Briefcase,
  ChevronRight,
  CircleHelp,
  Download,
  FileCode,
  Gauge,
  History,
  Layers,
  type LucideIcon,
  Menu,
  Puzzle,
  Rocket,
  Scale,
  Server,
  Sparkles,
  Tag,
  Users,
  X,
} from "lucide-react"
import { useCallback, useEffect, useId, useRef, useState } from "react"
import {
  GITHUB_URL,
  NPM_URL,
  PROJECT_LINK_LABEL_KEYS,
  PROJECT_LINKS,
  type ProjectLinkKey,
} from "../lib/project-links"
import { cn } from "../lib/utils"
import { GithubIcon } from "./github-icon"
import { NpmIcon } from "./npm-icon"
import { Button } from "./ui/button"

interface AlternateLocale {
  locale: string
  label: string
  href: string
}

interface LandingNavbarProps {
  translations: Record<string, string>
  locale: string
  alternateLocales: AlternateLocale[]
  localizedHomeUrl: string
  localizedUseCasesUrl: string
  localizedLibraryUrl: string
  localizedFeaturesUrl: string
  localizedAgentsUrl: string
  localizedDeployUrl: string
  localizedFaqUrl: string
  localizedTeamUrl: string
  /** Path of the page on screen, so the drawer can light its own row. */
  currentPath?: string
}

const externalLinkProps = {
  target: "_blank",
  rel: "noopener noreferrer",
} as const

interface DrawerLink {
  href: string
  label: string
  icon: LucideIcon
  external?: boolean
}

/** The drawer's sections under the pages card: documentation first, then the project's records. */
const DRAWER_SECTIONS: ReadonlyArray<{
  titleKey: string
  links: ReadonlyArray<{ key: ProjectLinkKey; icon: LucideIcon }>
}> = [
  {
    titleKey: "nav_section_docs",
    links: [
      { key: "docs", icon: BookOpen },
      { key: "apiReference", icon: FileCode },
      { key: "serverGuide", icon: Server },
      { key: "pythonGuide", icon: FileCode },
      { key: "benchmarks", icon: Gauge },
    ],
  },
  {
    titleKey: "nav_section_project",
    links: [
      { key: "releases", icon: Tag },
      { key: "changelog", icon: History },
      { key: "license", icon: Scale },
      { key: "commercialLicense", icon: Briefcase },
    ],
  },
]

/** One drawer row: a grey icon, the label, then a chevron, or an arrow for a link that leaves the site. */
const DRAWER_ROW_CLASS_NAME =
  "flex min-h-11 items-center gap-3 px-4 font-semibold text-foreground text-sm transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-foreground/10"

/** GitHub and npm in the bar: bare icons, like the social icons of the WorkoutGen bar. */
const HEADER_ICON_CLASS_NAME =
  "flex size-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

const DRAWER_SECTION_TITLE_CLASS_NAME =
  "mb-2 font-black text-foreground text-sm uppercase tracking-tight"

/** One card of the drawer: rows one under the other, the page on screen lit. */
function DrawerLinkList({
  links,
  currentPath,
  onNavigate,
  tabIndex,
}: {
  links: readonly DrawerLink[]
  currentPath: string | undefined
  onNavigate: () => void
  tabIndex: number
}): React.JSX.Element {
  return (
    <ul className="overflow-hidden rounded-2xl bg-card">
      {links.map(({ href, label, icon: Icon, external }) => {
        const current = !external && currentPath !== undefined && href === currentPath
        return (
          <li className="border-foreground/[0.06] border-b last:border-b-0" key={href}>
            <a
              aria-current={current ? "page" : undefined}
              className={cn(DRAWER_ROW_CLASS_NAME, current && "bg-foreground/[0.06] font-bold")}
              href={href}
              onClick={external ? undefined : onNavigate}
              tabIndex={tabIndex}
              {...(external ? externalLinkProps : {})}
            >
              <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">{label}</span>
              {external ? (
                <ArrowUpRight
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
              ) : (
                <ChevronRight
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
              )}
            </a>
          </li>
        )
      })}
    </ul>
  )
}

/** One titled group of the drawer: the section title over a card of rows. */
function DrawerSection({
  title,
  links,
  currentPath,
  onNavigate,
  tabIndex,
}: {
  title: string
  links: readonly DrawerLink[]
  currentPath: string | undefined
  onNavigate: () => void
  tabIndex: number
}): React.JSX.Element {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="mt-6">
      <h2 className={DRAWER_SECTION_TITLE_CLASS_NAME} id={titleId}>
        {title}
      </h2>
      <DrawerLinkList
        currentPath={currentPath}
        links={links}
        onNavigate={onNavigate}
        tabIndex={tabIndex}
      />
    </section>
  )
}

export function RagmirLogo(): React.JSX.Element {
  return (
    <span
      className="logo-stack font-black text-2xl text-foreground leading-none tracking-tight md:text-3xl"
      data-logo-text="Ragmir"
    >
      <span className="logo-index-1 logo-text">Ragmir</span>
    </span>
  )
}

export function LandingNavbar({
  translations,
  locale,
  alternateLocales,
  localizedHomeUrl,
  localizedUseCasesUrl,
  localizedLibraryUrl,
  localizedFeaturesUrl,
  localizedAgentsUrl,
  localizedDeployUrl,
  localizedFaqUrl,
  localizedTeamUrl,
  currentPath,
}: LandingNavbarProps): React.JSX.Element {
  const t = (key: string): string => translations[key] ?? key
  const version = import.meta.env.PUBLIC_RAGMIR_VERSION?.trim()
  const [hasScrolled, setHasScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const headerRef = useRef<HTMLElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const lastScrollY = useRef(0)
  const isHidden = useRef(false)

  const localizedIntegrationsUrl = localizedLibraryUrl.replace(/#library$/u, "#integrations")
  const drawerPageLinks: DrawerLink[] = [
    { href: localizedUseCasesUrl, label: t("nav_use_cases"), icon: Layers },
    { href: localizedLibraryUrl, label: t("nav_library"), icon: Download },
    { href: localizedIntegrationsUrl, label: t("nav_integrations"), icon: Puzzle },
    { href: localizedAgentsUrl, label: t("nav_agents"), icon: Bot },
    { href: localizedDeployUrl, label: t("nav_deploy"), icon: Rocket },
    { href: localizedFeaturesUrl, label: t("nav_features"), icon: Sparkles },
    { href: localizedFaqUrl, label: t("nav_faq"), icon: CircleHelp },
    { href: localizedTeamUrl, label: t("nav_team"), icon: Users },
  ]
  const drawerSections = DRAWER_SECTIONS.map((section) => ({
    title: t(section.titleKey),
    links: section.links.map(
      ({ key, icon }): DrawerLink => ({
        href: PROJECT_LINKS[key],
        label: t(PROJECT_LINK_LABEL_KEYS[key]),
        icon,
        external: true,
      }),
    ),
  }))
  const drawerTabIndex = menuOpen ? 0 : -1

  const closeMenu = useCallback(() => {
    menuTriggerRef.current?.focus()
    setMenuOpen(false)
  }, [])

  useEffect(() => {
    const header = headerRef.current
    if (!header) return

    // Hide-on-scroll: hide the header when scrolling down, reveal when scrolling up.
    const handleScroll = () => {
      const currentScrollY = window.scrollY
      const scrollThreshold = 50
      setHasScrolled(currentScrollY > 0)

      if (currentScrollY < scrollThreshold) {
        if (isHidden.current) {
          header.style.transform = "translateY(0)"
          isHidden.current = false
        }
        lastScrollY.current = currentScrollY
        return
      }

      const scrollDelta = currentScrollY - lastScrollY.current
      if (scrollDelta > 5 && !isHidden.current) {
        header.style.transform = "translateY(-100%)"
        isHidden.current = true
        lastScrollY.current = currentScrollY
      } else if (scrollDelta < -5 && isHidden.current) {
        header.style.transform = "translateY(0)"
        isHidden.current = false
        lastScrollY.current = currentScrollY
      } else if ((scrollDelta > 0 && isHidden.current) || (scrollDelta < 0 && !isHidden.current)) {
        lastScrollY.current = currentScrollY
      }
    }

    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu()
    }
    document.addEventListener("keydown", onKeyDown)
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.body.style.overflow = ""
    }
  }, [menuOpen, closeMenu])

  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-30 h-28 bg-linear-to-b from-background via-background/82 to-transparent"
      />
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-40 transition-all duration-300",
          hasScrolled && "bg-linear-to-b from-background via-background to-transparent",
        )}
        ref={headerRef}
      >
        <div className="container-navbar flex h-16 items-center justify-between px-5 md:px-8">
          <div className="flex items-center">
            <a
              aria-label="Ragmir"
              className="flex items-center transition hover:opacity-80"
              href={localizedHomeUrl}
            >
              <RagmirLogo />
            </a>
            {version && (
              <a
                href={NPM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 text-[0.7rem] font-medium text-muted-foreground/60 no-underline transition hover:text-muted-foreground"
              >
                v{version}
              </a>
            )}
          </div>

          <div className="flex items-center gap-1">
            <a
              aria-label={t("hero_github_cta")}
              className={HEADER_ICON_CLASS_NAME}
              href={GITHUB_URL}
              {...externalLinkProps}
            >
              <GithubIcon className="size-[18px]" />
            </a>
            <a
              aria-label={t("hero_npm_cta")}
              className={HEADER_ICON_CLASS_NAME}
              href={NPM_URL}
              {...externalLinkProps}
            >
              <NpmIcon className="size-[18px]" />
            </a>
            <button
              aria-expanded={menuOpen}
              aria-label={t("nav_menu")}
              className="ml-1 flex h-10 items-center gap-2 rounded-full bg-card px-3 font-bold text-foreground text-sm transition-colors hover:bg-[#1f1f1f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] sm:px-4"
              onClick={() => setMenuOpen(true)}
              ref={menuTriggerRef}
              type="button"
            >
              <Menu aria-hidden="true" className="size-5" />
              <span aria-hidden="true" className="hidden sm:inline">
                {t("nav_menu")}
              </span>
            </button>
          </div>
        </div>
      </header>

      <div
        aria-hidden={!menuOpen}
        className={cn(
          "fixed inset-0 z-50",
          menuOpen ? "pointer-events-auto" : "pointer-events-none",
        )}
      >
        <button
          aria-label={t("nav_menu_close")}
          className={cn(
            "absolute inset-0 bg-background/80 backdrop-blur-sm transition-opacity duration-300",
            menuOpen ? "opacity-100" : "opacity-0",
          )}
          onClick={closeMenu}
          tabIndex={menuOpen ? 0 : -1}
          type="button"
        />
        <div
          className={cn(
            "absolute inset-y-0 right-0 flex w-[88%] max-w-sm flex-col bg-background shadow-2xl shadow-black/60 transition-transform duration-300 ease-out",
            menuOpen ? "translate-x-0" : "translate-x-full",
          )}
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-background px-5 pt-3 pb-3">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-full h-4 bg-linear-to-b from-background to-transparent"
              />
              <a
                aria-label="Ragmir"
                className="flex items-center transition hover:opacity-80"
                href={localizedHomeUrl}
                onClick={closeMenu}
                tabIndex={drawerTabIndex}
              >
                <RagmirLogo />
              </a>
              <div className="flex items-center gap-2">
                <nav
                  aria-label={t("language_label")}
                  className="flex items-center gap-1 rounded-full bg-card p-1"
                >
                  {alternateLocales.map((entry) => (
                    <a
                      aria-current={entry.locale === locale ? "page" : undefined}
                      className="rounded-full px-3 py-1.5 font-bold text-muted-foreground text-xs uppercase transition-colors hover:text-foreground aria-[current=page]:bg-foreground aria-[current=page]:text-background"
                      href={entry.href}
                      hrefLang={entry.locale}
                      key={entry.locale}
                      tabIndex={drawerTabIndex}
                    >
                      {entry.locale}
                    </a>
                  ))}
                </nav>
                <button
                  aria-label={t("nav_menu_close")}
                  className="flex size-10 items-center justify-center rounded-full text-foreground transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={closeMenu}
                  tabIndex={drawerTabIndex}
                  type="button"
                >
                  <X aria-hidden="true" className="size-5" />
                </button>
              </div>
            </div>

            <nav aria-label={t("nav_aria_label")} className="px-5 pb-6">
              <DrawerLinkList
                currentPath={currentPath}
                links={drawerPageLinks}
                onNavigate={closeMenu}
                tabIndex={drawerTabIndex}
              />

              {drawerSections.map((section) => (
                <DrawerSection
                  currentPath={currentPath}
                  key={section.title}
                  links={section.links}
                  onNavigate={closeMenu}
                  tabIndex={drawerTabIndex}
                  title={section.title}
                />
              ))}

              <div className="mt-7 flex items-center justify-end gap-3">
                {version && (
                  <a
                    className="font-medium text-muted-foreground text-xs no-underline transition hover:text-foreground"
                    href={NPM_URL}
                    tabIndex={drawerTabIndex}
                    {...externalLinkProps}
                  >
                    Ragmir v{version}
                  </a>
                )}
              </div>
            </nav>
          </div>

          <div className="grid gap-2 border-border border-t bg-background px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button asChild className="h-11 w-full font-bold text-sm">
              <a href={GITHUB_URL} {...externalLinkProps} tabIndex={drawerTabIndex}>
                <GithubIcon data-icon="inline-start" />
                {t("hero_github_cta")}
              </a>
            </Button>
            <Button asChild className="h-11 w-full font-bold text-sm" variant="outline">
              <a href={NPM_URL} {...externalLinkProps} tabIndex={drawerTabIndex}>
                <NpmIcon data-icon="inline-start" />
                {t("hero_npm_cta")}
              </a>
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
