import { MimirBackground } from "@jcode.labs/mimir-ui"
import { MimirLogo } from "./landing-navbar"

interface LandingFooterProps {
  translations: Record<string, string>
  localizedHomeUrl: string
}

const externalLinkProps = {
  target: "_blank",
  rel: "noopener noreferrer",
} as const

function FooterMarquee({ phrase }: { phrase: string }): React.JSX.Element {
  const copyClassName =
    "whitespace-nowrap pr-8 font-black text-5xl text-foreground/90 uppercase italic leading-[1.1] tracking-tighter md:pr-14 md:text-7xl"

  return (
    <div aria-hidden="true" className="relative z-10 my-10 overflow-hidden py-3">
      <div className="flex w-max animate-marquee-text">
        <span className={copyClassName}>{phrase}</span>
        <span className={copyClassName}>{phrase}</span>
      </div>
    </div>
  )
}

export function LandingFooter({
  translations,
  localizedHomeUrl,
}: LandingFooterProps): React.JSX.Element {
  const t = (key: string): string => translations[key] ?? key
  const footerLinks = [
    { href: "https://github.com/jcode-works/jcode-mimir", label: t("nav_github") },
    { href: "https://www.npmjs.com/package/@jcode.labs/mimir", label: t("footer_link_npm") },
    { href: "https://github.com/jcode-works/jcode-mimir#readme", label: t("footer_link_docs") },
    { href: "https://github.com/sponsors/jb-thery", label: t("footer_link_sponsors") },
  ]

  return (
    <footer className="relative z-10 mt-10 overflow-hidden">
      <div className="relative isolate overflow-hidden pt-16 pb-10">
        <MimirBackground behindContent className="inset-0" height="100%" />

        <div className="relative z-10 mx-auto flex max-w-7xl flex-col items-center gap-6 px-5 md:px-8">
          <a
            aria-label="Mimir"
            className="flex items-center transition hover:opacity-80"
            href={localizedHomeUrl}
          >
            <MimirLogo />
          </a>
          <nav aria-label={t("footer_nav_label")}>
            <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
              {footerLinks.map((link) => (
                <li key={link.label}>
                  <a
                    className="font-semibold text-muted-foreground text-sm transition hover:text-foreground"
                    href={link.href}
                    {...externalLinkProps}
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <FooterMarquee phrase={t("footer_marquee")} />

        <div className="relative z-10 mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-5 text-muted-foreground text-xs sm:flex-row md:px-8">
          <p>{t("footer_text")}</p>
          <p>MIT · JCode Labs</p>
        </div>
      </div>
    </footer>
  )
}
