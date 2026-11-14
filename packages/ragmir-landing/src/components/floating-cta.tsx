import { ArrowRight } from "lucide-react"
import { useEffect, useState } from "react"

interface FloatingCtaProps {
  href: string
  label: string
}

// Sections that already offer the install action; the floating button steps aside near them.
const SELF_SERVE_SECTION_IDS = ["library", "cta-final"]

/**
 * Mobile-only install button that appears once the hero has scrolled away and hides again
 * while the install section or the closing call to action is on screen.
 */
export function FloatingCta({ href, label }: FloatingCtaProps): React.JSX.Element {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const nearbySections = new Set<string>()
    let pastHero = false

    const update = () => setVisible(pastHero && nearbySections.size === 0)
    const onScroll = () => {
      pastHero = window.scrollY > window.innerHeight * 0.7
      update()
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) nearbySections.add(entry.target.id)
          else nearbySections.delete(entry.target.id)
        }
        update()
      },
      { rootMargin: "0px 0px 96px 0px" },
    )
    for (const id of SELF_SERVE_SECTION_IDS) {
      const section = document.getElementById(id)
      if (section) observer.observe(section)
    }

    window.addEventListener("scroll", onScroll, { passive: true })
    onScroll()
    return () => {
      observer.disconnect()
      window.removeEventListener("scroll", onScroll)
    }
  }, [])

  return (
    <div
      aria-hidden={!visible}
      inert={!visible}
      className={`fixed inset-x-0 bottom-4 z-40 flex justify-center px-5 transition-[opacity,transform] duration-500 ease-out md:hidden ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-24 opacity-0"
      }`}
    >
      <a
        className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-7 text-sm font-bold text-primary-foreground shadow-2xl shadow-black/60 transition hover:bg-primary/90"
        href={href}
      >
        {label}
        <ArrowRight className="size-4" aria-hidden="true" />
      </a>
    </div>
  )
}
