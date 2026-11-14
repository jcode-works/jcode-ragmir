import { RotateCcw } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { highlightCall, highlightCode, highlightCommand } from "../lib/command-syntax"
import { cn } from "../lib/utils"
import { CommandCopyButton } from "./command-copy"
import {
  DEFAULT_HERO_DEMO_SCENARIO,
  findHeroDemoScenario,
  HERO_DEMO_SCENARIOS,
  type TerminalLineKind,
  type TerminalScriptLine,
} from "./hero-demo-script"
import { TabIndicator } from "./tab-indicator"

interface HeroDemoProps {
  translations: Record<string, string>
}

interface PlaybackState {
  visibleCount: number
  typingLineIndex: number | null
  typedText: string
  isComplete: boolean
}

const INITIAL_PLAYBACK_STATE: PlaybackState = {
  visibleCount: 0,
  typingLineIndex: null,
  typedText: "",
  isComplete: false,
}

const TYPEABLE_LINE_KINDS = new Set<TerminalLineKind>(["shell", "codex"])
/** Pause on a finished scenario before the demo moves to the next one on its own. */
const AUTO_ADVANCE_DELAY_MS = 4200
const COPYABLE_TERMINAL_LINE_KINDS = new Set<TerminalLineKind>(["shell", "codex"])

export function HeroDemo({ translations }: HeroDemoProps): React.JSX.Element {
  const t = useCallback((key: string): string => translations[key] ?? key, [translations])
  const [activeScenarioId, setActiveScenarioId] = useState(DEFAULT_HERO_DEMO_SCENARIO.id)
  const activeScenario = useMemo(() => findHeroDemoScenario(activeScenarioId), [activeScenarioId])
  const [playback, setPlayback] = useState<PlaybackState>(INITIAL_PLAYBACK_STATE)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const tabScrollRef = useRef<HTMLDivElement>(null)
  const isVisible = useRef(false)
  const hasPlayedRef = useRef(false)
  // Once a visitor picks a tab or replays, the demo stops moving on by itself.
  const userInteractedRef = useRef(false)
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearAllTimeouts = useCallback(() => {
    for (const timeout of timeoutsRef.current) clearTimeout(timeout)
    timeoutsRef.current = []
  }, [])

  const resolveLineText = useCallback(
    (line: TerminalScriptLine): string => {
      if (line.text !== undefined) return line.text
      return t(line.textKey)
    },
    [t],
  )

  const startSequence = useCallback(() => {
    clearAllTimeouts()
    const prefersReducedMotion =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

    if (prefersReducedMotion) {
      setPlayback({
        visibleCount: activeScenario.lines.length,
        typingLineIndex: null,
        typedText: "",
        isComplete: true,
      })
      return
    }

    setPlayback(INITIAL_PLAYBACK_STATE)
    let elapsed = 350

    const schedule = (callback: () => void, delay: number) => {
      timeoutsRef.current.push(setTimeout(callback, delay))
    }

    for (let i = 0; i < activeScenario.lines.length; i++) {
      const line = activeScenario.lines[i]
      if (!line) continue
      const lineIndex = i
      const text = resolveLineText(line)

      if (TYPEABLE_LINE_KINDS.has(line.kind)) {
        const characters = Array.from(text)
        const typingDuration = clamp(characters.length * 24, 560, 1800)
        const stepMs = Math.max(18, Math.round(typingDuration / Math.max(characters.length, 1)))

        schedule(
          () =>
            setPlayback({
              visibleCount: lineIndex,
              typingLineIndex: lineIndex,
              typedText: "",
              isComplete: false,
            }),
          elapsed,
        )

        for (let characterIndex = 0; characterIndex < characters.length; characterIndex++) {
          const partialText = characters.slice(0, characterIndex + 1).join("")
          schedule(
            () =>
              setPlayback((current) =>
                current.typingLineIndex === lineIndex
                  ? { ...current, typedText: partialText }
                  : current,
              ),
            elapsed + (characterIndex + 1) * stepMs,
          )
        }

        elapsed += typingDuration + 180
      } else {
        elapsed += line.kind === "tree" ? 260 : 430
      }

      schedule(
        () =>
          setPlayback((current) => ({
            ...current,
            visibleCount: lineIndex + 1,
            typingLineIndex: null,
            typedText: "",
          })),
        elapsed,
      )

      elapsed += line.holdMs ?? defaultLineHoldMs(line.kind)
    }

    schedule(() => setPlayback((current) => ({ ...current, isComplete: true })), elapsed + 250)
  }, [activeScenario, clearAllTimeouts, resolveLineText])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    const observer = new IntersectionObserver(
      (entries) => {
        const wasVisible = isVisible.current
        isVisible.current = entries[0]?.isIntersecting ?? false
        if (isVisible.current && !wasVisible && !hasPlayedRef.current) {
          hasPlayedRef.current = true
          startSequence()
        }
      },
      { threshold: 0.3 },
    )
    observer.observe(element)
    return () => {
      observer.disconnect()
      clearAllTimeouts()
    }
  }, [startSequence, clearAllTimeouts])

  useEffect(() => {
    if (isVisible.current || hasPlayedRef.current) {
      startSequence()
    }
  }, [startSequence])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  })

  useEffect(() => {
    if (!playback.isComplete || userInteractedRef.current || !isVisible.current) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    const timeout = setTimeout(() => {
      const index = HERO_DEMO_SCENARIOS.findIndex((scenario) => scenario.id === activeScenario.id)
      const next = HERO_DEMO_SCENARIOS[(index + 1) % HERO_DEMO_SCENARIOS.length]
      if (next) setActiveScenarioId(next.id)
    }, AUTO_ADVANCE_DELAY_MS)
    return () => clearTimeout(timeout)
  }, [playback.isComplete, activeScenario.id])

  useEffect(() => {
    // Keep the active tab visible inside the horizontal tab strip without scrolling the page.
    const container = tabScrollRef.current
    const active = container?.querySelector<HTMLElement>(
      `[data-scenario-id="${activeScenario.id}"]`,
    )
    if (!container || !active) return
    const containerRect = container.getBoundingClientRect()
    const activeRect = active.getBoundingClientRect()
    if (activeRect.left < containerRect.left || activeRect.right > containerRect.right) {
      container.scrollTo({
        left: container.scrollLeft + activeRect.left - containerRect.left - 8,
        behavior: "smooth",
      })
    }
  }, [activeScenario.id])

  const handleReplay = useCallback(() => {
    userInteractedRef.current = true
    startSequence()
  }, [startSequence])

  const handleScenarioSelect = useCallback(
    (scenarioId: string) => {
      userInteractedRef.current = true
      if (scenarioId === activeScenario.id) {
        startSequence()
        return
      }

      setActiveScenarioId(scenarioId)
    },
    [activeScenario.id, startSequence],
  )

  const handleTabWheel = useCallback((event: WheelEvent) => {
    const element = tabScrollRef.current
    if (!element || element.scrollWidth <= element.clientWidth) return

    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (delta === 0) return

    event.preventDefault()
    element.scrollLeft += delta
  }, [])

  useEffect(() => {
    const element = tabScrollRef.current
    if (!element) return

    element.addEventListener("wheel", handleTabWheel, { passive: false })
    return () => element.removeEventListener("wheel", handleTabWheel)
  }, [handleTabWheel])

  const lineClass: Record<TerminalLineKind, string> = {
    shell: "",
    codex: "text-amber-300",
    script: "text-cyan-300",
    tree: "text-sky-300/90",
    output: "text-muted-foreground",
    mcp: "",
    citation: "font-semibold text-yellow-300",
    insight: "text-emerald-300",
    change: "text-cyan-300",
    success: "text-emerald-400",
  }

  const linePrefix: Partial<Record<TerminalLineKind, string>> = {
    shell: "Shell",
    codex: t("demo_agent_prefix"),
    script: t("demo_script_prefix"),
    mcp: "Ragmir",
  }

  // One keyed list: a line being typed and the same line once finished share a key, so React
  // updates it in place and its entrance animation plays only once.
  const renderedLines = activeScenario.lines.slice(0, playback.visibleCount).map((line, index) =>
    renderTerminalLine({
      key: `${activeScenario.id}-${index}`,
      line,
      lineClass,
      linePrefix,
      copyLabel: t("copy_command"),
      text: resolveLineText(line),
    }),
  )
  if (playback.typingLineIndex !== null) {
    renderedLines.push(
      renderTerminalLine({
        key: `${activeScenario.id}-${playback.typingLineIndex}`,
        line: activeScenario.lines[playback.typingLineIndex],
        lineClass,
        linePrefix,
        copyLabel: t("copy_command"),
        text: playback.typedText,
        showCursor: true,
      }),
    )
  }

  return (
    <div
      className="mx-auto flex h-[34rem] min-h-[34rem] max-h-[34rem] min-w-0 w-full max-w-full shrink-0 flex-col overflow-hidden rounded-xl bg-card sm:max-w-xl lg:max-w-none"
      ref={containerRef}
    >
      <div className="flex shrink-0 items-center gap-3 px-4 pt-3.5 pb-2.5">
        <div aria-hidden="true" className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </div>
        <span className="truncate font-mono text-[0.68rem] text-muted-foreground">
          {activeScenario.terminalTitle}
        </span>
      </div>

      <div className="mx-3 flex shrink-0 items-center gap-1 rounded-full bg-background p-1">
        <div
          className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          ref={tabScrollRef}
          role="tablist"
        >
          <div className="group/scenario-tabs relative flex min-w-max gap-1">
            <TabIndicator activeSelector='[aria-selected="true"]' />
            {HERO_DEMO_SCENARIOS.map((scenario) => {
              const isActive = scenario.id === activeScenario.id

              return (
                <button
                  aria-selected={isActive}
                  className={cn(
                    "relative h-8 shrink-0 rounded-full px-3 font-semibold text-xs transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive
                      ? "bg-foreground text-background group-data-[indicator=ready]/scenario-tabs:bg-transparent"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  data-scenario-id={scenario.id}
                  key={scenario.id}
                  onClick={() => handleScenarioSelect(scenario.id)}
                  role="tab"
                  type="button"
                >
                  {t(scenario.titleKey)}
                </button>
              )
            })}
          </div>
        </div>
        <button
          aria-label={t("demo_replay_label")}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={handleReplay}
          title={t("demo_replay_label")}
          type="button"
        >
          <RotateCcw aria-hidden="true" className="size-3.5" />
        </button>
      </div>

      <p className="min-h-16 px-4 pt-3 pb-2 text-xs leading-5 text-muted-foreground">
        {t(activeScenario.descriptionKey)}
      </p>

      <div
        className="mx-3 mb-3 min-h-0 flex-1 overflow-y-auto rounded-xl bg-background p-4 font-mono text-[0.68rem] leading-relaxed sm:text-xs"
        ref={scrollRef}
      >
        {renderedLines}

        {playback.typingLineIndex === null && !playback.isComplete && (
          <span className="inline-block h-3.5 w-2 animate-pulse bg-foreground/60" />
        )}
      </div>
    </div>
  )
}

function renderTerminalLine(input: {
  key: string
  line: TerminalScriptLine | undefined
  lineClass: Record<TerminalLineKind, string>
  linePrefix: Partial<Record<TerminalLineKind, string>>
  copyLabel: string
  text: string
  showCursor?: boolean
}): React.JSX.Element | null {
  const { key, line, lineClass, linePrefix, copyLabel, text, showCursor = false } = input

  if (!line) return null

  const prefix = line.prefix ?? linePrefix[line.kind]
  const copyable = !showCursor && COPYABLE_TERMINAL_LINE_KINDS.has(line.kind) && text.trim()
  const body =
    line.kind === "shell"
      ? highlightCommand(text)
      : line.kind === "mcp"
        ? highlightCall(text)
        : line.kind === "script" && text.includes("(")
          ? highlightCode(text)
          : text
  const content = (
    <span className={cn("min-w-0 whitespace-pre-wrap break-words", lineClass[line.kind])}>
      {body}
      {showCursor && (
        <span className="ml-1 inline-block h-3.5 w-2 animate-pulse bg-foreground/70" />
      )}
    </span>
  )

  if (prefix) {
    return (
      <div className="group/terminal-line terminal-line-in mt-3 mb-1" key={key}>
        <span className="mb-1 block font-sans text-[0.68rem] font-semibold text-muted-foreground">
          {prefix}
        </span>
        <div className="flex min-w-0 items-start gap-2">
          <span className="min-w-0 flex-1">{content}</span>
          {copyable && (
            <CommandCopyButton
              className="mt-0.5 opacity-0 group-hover/terminal-line:opacity-100 focus-visible:opacity-100"
              command={text}
              copyLabel={copyLabel}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "terminal-line-in mb-0.5",
        line.kind === "citation" && "citation-mark -mx-1 px-1",
        lineClass[line.kind],
      )}
      key={key}
    >
      {content}
    </div>
  )
}

function defaultLineHoldMs(kind: TerminalLineKind): number {
  if (kind === "citation" || kind === "insight" || kind === "success") return 1050
  if (kind === "mcp") return 750
  if (kind === "tree" || kind === "change") return 520
  return 680
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
