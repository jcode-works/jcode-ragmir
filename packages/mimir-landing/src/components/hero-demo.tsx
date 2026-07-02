import { useGSAP } from "@gsap/react"
import { cn } from "@jcode.labs/mimir-ui/utils"
import { gsap } from "gsap"
import { TextPlugin } from "gsap/TextPlugin"
import { Bot, Check, Lock, Workflow, Zap } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

gsap.registerPlugin(TextPlugin)

interface HeroDemoProps {
  t: (key: string) => string
}

// Resume automatic playback after this idle time (ms) following a manual click.
const RESUME_DELAY = 10000

// Animated "how it works" demo: for each step it types the user's action (a
// command / prompt) and shows what it does below. Clicking a step takes manual
// control (auto-play pauses); it resumes after idle. Paused while off-screen.
export function HeroDemo({ t }: HeroDemoProps): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<gsap.core.Timeline | null>(null)
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const userPaused = useRef(false)
  const isVisible = useRef(true)
  const [activeStep, setActiveStep] = useState(0)

  const steps = [t("demo_step_index"), t("demo_step_ask"), t("demo_step_cite")]

  const syncPlayState = useCallback(() => {
    const timeline = timelineRef.current
    if (!timeline) return
    if (isVisible.current && !userPaused.current) {
      timeline.play()
    } else {
      timeline.pause()
    }
  }, [])

  useGSAP(
    () => {
      const panels = gsap.utils.toArray<HTMLElement>(".demo-panel")

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        gsap.set(panels, { autoAlpha: 0 })
        if (panels[0]) gsap.set(panels[0], { autoAlpha: 1 })
        return
      }

      const hold = 4
      const timeline = gsap.timeline({ repeat: -1 })
      panels.forEach((panel, index) => {
        const typed = panel.querySelector<HTMLElement>(".demo-typed")
        const result = panel.querySelector<HTMLElement>(".demo-result")
        const label = `step-${index}`
        timeline.addLabel(label)
        timeline.call(() => setActiveStep(index), [], label)
        timeline.fromTo(
          panel,
          { autoAlpha: 0, y: 16 },
          { autoAlpha: 1, y: 0, duration: 0.55, ease: "power3.out" },
          label,
        )

        let resultAt = 0.6
        if (typed) {
          const full = typed.textContent ?? ""
          const typingDuration = Math.min(1.4, Math.max(0.5, full.length * 0.045))
          timeline.set(typed, { text: "" }, label)
          timeline.to(
            typed,
            { text: full, duration: typingDuration, ease: "none" },
            `${label}+=0.45`,
          )
          resultAt = 0.45 + typingDuration + 0.15
        }
        if (result) {
          timeline.fromTo(
            result,
            { autoAlpha: 0, y: 6 },
            { autoAlpha: 1, y: 0, duration: 0.4, ease: "power2.out" },
            `${label}+=${resultAt}`,
          )
        }

        timeline.to(
          panel,
          { autoAlpha: 0, y: -14, duration: 0.45, ease: "power2.in" },
          `${label}+=${hold}`,
        )
      })
      timelineRef.current = timeline
    },
    { scope: container },
  )

  // Pause the timeline when the demo is off-screen, and clean up the idle timer.
  useEffect(() => {
    const element = container.current
    if (!element) return
    const observer = new IntersectionObserver(
      (entries) => {
        isVisible.current = entries[0]?.isIntersecting ?? true
        syncPlayState()
      },
      { threshold: 0 },
    )
    observer.observe(element)
    return () => {
      observer.disconnect()
      if (resumeTimer.current) clearTimeout(resumeTimer.current)
    }
  }, [syncPlayState])

  const handleStepClick = (index: number) => {
    setActiveStep(index)
    const timeline = timelineRef.current

    if (!timeline) {
      // Reduced motion: no timeline, just reveal the chosen panel.
      const panels = container.current?.querySelectorAll<HTMLElement>(".demo-panel")
      const target = panels?.[index]
      if (panels) gsap.set(panels, { autoAlpha: 0 })
      if (target) gsap.set(target, { autoAlpha: 1 })
      return
    }

    userPaused.current = true
    timeline.pause()
    timeline.seek((timeline.labels[`step-${index}`] ?? 0) + 2.5)

    if (resumeTimer.current) clearTimeout(resumeTimer.current)
    resumeTimer.current = setTimeout(() => {
      userPaused.current = false
      syncPlayState()
    }, RESUME_DELAY)
  }

  return (
    <div
      className="overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-black/55"
      ref={container}
    >
      <div className="flex items-center justify-between gap-4 border-b border-border p-4 md:p-5">
        <div className="flex items-center gap-3">
          <Workflow aria-hidden="true" className="size-5 text-foreground" />
          <h2 className="font-black text-lg leading-none">{t("demo_title")}</h2>
        </div>
        <span className="rounded-full border border-border bg-muted/50 px-3 py-1 font-bold text-foreground text-xs uppercase tracking-wide">
          {t("demo_badge")}
        </span>
      </div>

      <div className="flex items-center gap-3 px-4 pt-4 md:px-5">
        {steps.map((label, index) => {
          const active = activeStep === index
          return (
            <button
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex flex-1 items-center gap-2 overflow-hidden rounded-lg py-1 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
                active ? "opacity-100" : "opacity-60 hover:opacity-100",
              )}
              key={label}
              onClick={() => handleStepClick(index)}
              type="button"
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full font-bold text-xs transition",
                  active ? "bg-[var(--accent-title)] text-white" : "bg-muted text-muted-foreground",
                )}
              >
                {index + 1}
              </span>
              <span
                className={cn(
                  "truncate font-semibold text-sm transition",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </button>
          )
        })}
      </div>

      <div className="grid p-4 md:p-5">
        <div
          className="demo-panel col-start-1 row-start-1 flex flex-col justify-center gap-3"
          data-step="0"
        >
          <p className="text-muted-foreground text-xs">{t("demo_index_action")}</p>
          <div className="rounded-lg border border-border bg-background p-4 font-mono text-foreground/80 text-sm">
            <span className="text-[var(--accent-title)]">$ </span>
            <span className="demo-typed">{t("demo_index_command")}</span>
          </div>
          <p className="demo-result flex items-center gap-2 pt-1 font-semibold text-[var(--accent-title)] text-xs">
            <Lock aria-hidden="true" className="size-3.5 shrink-0" />
            {t("demo_index_result")}
          </p>
        </div>

        <div
          className="demo-panel col-start-1 row-start-1 flex flex-col justify-center gap-3 opacity-0"
          data-step="1"
        >
          <p className="text-muted-foreground text-xs">{t("demo_ask_action")}</p>
          <div className="rounded-lg border border-border bg-muted/45 p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <Bot aria-hidden="true" className="size-4 text-[var(--accent-title)]" />
              Codex
            </div>
            <p className="mt-2 text-foreground/90 text-sm leading-6">
              <span className="demo-typed">{t("demo_ask_command")}</span>
            </p>
          </div>
          <p className="demo-result flex items-center gap-2 pt-1 font-semibold text-[var(--accent-title)] text-xs">
            <Zap aria-hidden="true" className="size-3.5 shrink-0" />
            {t("demo_ask_result")}
          </p>
        </div>

        <div
          className="demo-panel col-start-1 row-start-1 flex flex-col justify-center gap-3 opacity-0"
          data-step="2"
        >
          <p className="text-muted-foreground text-xs">{t("demo_cite_action")}</p>
          <div className="rounded-lg border border-border bg-background/70 p-4 font-mono text-[var(--accent-title)] text-xs leading-6">
            {t("workspace_answer_citations")}
          </div>
          <p className="demo-result flex items-center gap-2 pt-1 font-semibold text-[var(--accent-title)] text-xs">
            <Check aria-hidden="true" className="size-3.5 shrink-0" />
            {t("demo_cite_result")}
          </p>
        </div>
      </div>
    </div>
  )
}
