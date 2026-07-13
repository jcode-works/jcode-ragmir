import { ChevronDown, Globe2, Menu, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "../lib/utils"
import { GithubIcon } from "./github-icon"
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
  localizedTeamUrl: string
}

const externalLinkProps = {
  target: "_blank",
  rel: "noopener noreferrer",
} as const

const GITHUB_URL = "https://github.com/jcode-works/jcode-ragmir"

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

export function LanguageSwitcher({
  alternateLocales,
  currentLocale,
  label,
}: {
  alternateLocales: AlternateLocale[]
  currentLocale: string
  label: string
}): React.JSX.Element {
  const currentLabel =
    alternateLocales.find((entry) => entry.locale === currentLocale)?.label ?? currentLocale

  function handleLocaleClick(href: string, event: React.MouseEvent<HTMLAnchorElement>) {
    // Preserve the current query string and hash when switching locale.
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
      <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-full border border-border px-3 font-bold text-foreground text-xs outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
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
            onClick={(event) => handleLocaleClick(entry.href, event)}
          >
            {entry.label}
          </a>
        ))}
      </div>
    </details>
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
  localizedTeamUrl,
}: LandingNavbarProps): React.JSX.Element {
  const t = (key: string): string => translations[key] ?? key
  const [hasScrolled, setHasScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const headerRef = useRef<HTMLElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const lastScrollY = useRef(0)
  const isHidden = useRef(false)

  const navLinks = [
    { href: localizedUseCasesUrl, label: t("nav_use_cases") },
    { href: localizedLibraryUrl, label: t("nav_library") },
    { href: localizedFeaturesUrl, label: t("nav_features") },
    { href: localizedAgentsUrl, label: t("nav_agents") },
    { href: localizedTeamUrl, label: t("nav_team") },
  ]

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
            <a
              href="https://www.npmjs.com/package/@jcode.labs/ragmir"
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 text-[0.7rem] font-medium text-muted-foreground/60 no-underline transition hover:text-muted-foreground"
            >
              v{import.meta.env.PUBLIC_RAGMIR_VERSION}
            </a>
          </div>

          <div className="hidden items-center gap-7 md:flex">
            <nav aria-label={t("nav_aria_label")} className="flex items-center gap-7">
              {navLinks.map((link) => (
                <a
                  className="whitespace-nowrap font-bold text-muted-foreground text-sm transition hover:text-foreground"
                  href={link.href}
                  key={link.href}
                >
                  {link.label}
                </a>
              ))}
            </nav>

            <LanguageSwitcher
              alternateLocales={alternateLocales}
              currentLocale={locale}
              label={t("language_label")}
            />

            <Button asChild size="sm" variant="ghost">
              <a href={GITHUB_URL} {...externalLinkProps}>
                <GithubIcon data-icon="inline-start" />
                {t("nav_github")}
              </a>
            </Button>
          </div>

          <div className="flex items-center gap-2 md:hidden">
            <LanguageSwitcher
              alternateLocales={alternateLocales}
              currentLocale={locale}
              label={t("language_label")}
            />
            <button
              aria-expanded={menuOpen}
              aria-label={t("nav_menu")}
              className="flex size-10 items-center justify-center rounded-full border border-border text-foreground transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setMenuOpen(true)}
              ref={menuTriggerRef}
              type="button"
            >
              <Menu aria-hidden="true" className="size-5" />
            </button>
          </div>
        </div>
      </header>

      <div
        aria-hidden={!menuOpen}
        className={cn(
          "fixed inset-0 z-50 md:hidden",
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
            "absolute inset-y-0 right-0 flex w-4/5 max-w-xs flex-col gap-6 border-border border-l bg-card p-6 shadow-2xl shadow-black/60 transition-transform duration-300 ease-out",
            menuOpen ? "translate-x-0" : "translate-x-full",
          )}
        >
          <div className="flex items-center justify-between">
            <RagmirLogo />
            <button
              aria-label={t("nav_menu_close")}
              className="flex size-10 items-center justify-center rounded-full border border-border text-foreground transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              onClick={closeMenu}
              tabIndex={menuOpen ? 0 : -1}
              type="button"
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>

          <nav aria-label={t("nav_aria_label")} className="flex flex-col gap-1">
            {navLinks.map((link) => (
              <a
                className="rounded-lg px-3 py-3 font-bold text-base text-muted-foreground transition hover:bg-muted hover:text-foreground"
                href={link.href}
                key={link.href}
                onClick={closeMenu}
                tabIndex={menuOpen ? 0 : -1}
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="mt-auto">
            <Button asChild className="w-full" size="sm">
              <a href={GITHUB_URL} {...externalLinkProps} tabIndex={menuOpen ? 0 : -1}>
                <GithubIcon data-icon="inline-start" />
                {t("nav_github")}
              </a>
            </Button>
            <a
              href="https://www.npmjs.com/package/@jcode.labs/ragmir"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 block text-center text-[0.7rem] font-medium text-muted-foreground/60 no-underline transition hover:text-muted-foreground"
              tabIndex={menuOpen ? 0 : -1}
            >
              v{import.meta.env.PUBLIC_RAGMIR_VERSION}
            </a>
          </div>
        </div>
      </div>
    </>
  )
}
