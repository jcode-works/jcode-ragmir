import {
  Boxes,
  Clapperboard,
  Code2,
  FileText,
  FolderSync,
  ListChecks,
  type LucideIcon,
  RotateCcw,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { cn } from "../lib/utils"
import { CommandCopyButton } from "./command-copy"
import {
  DEFAULT_HERO_DEMO_SCENARIO,
  findHeroDemoScenario,
  HERO_DEMO_SCENARIOS,
  type TerminalLineKind,
  type TerminalScriptLine,
} from "./hero-demo-script"

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
const COPYABLE_TERMINAL_LINE_KINDS = new Set<TerminalLineKind>(["shell", "codex"])

const SCENARIO_ICONS: Record<string, LucideIcon> = {
  word: FileText,
  monorepo: Boxes,
  drive: FolderSync,
  youtube: Clapperboard,
  visa: ListChecks,
}

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

  const handleScenarioSelect = useCallback(
    (scenarioId: string) => {
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
    shell: "text-foreground/92",
    codex: "text-amber-300",
    script: "text-cyan-300",
    tree: "text-sky-300/90",
    output: "text-muted-foreground",
    mcp: "text-[var(--accent-title)]",
    citation: "font-semibold text-yellow-300",
    insight: "text-emerald-300",
    change: "text-cyan-300",
    success: "text-emerald-400",
  }

  const linePrefix: Partial<Record<TerminalLineKind, string>> = {
    shell: "$ shell",
    codex: "Codex",
    script: t("demo_script_prefix"),
    mcp: "Ragmir",
  }

  const progress = Math.round((playback.visibleCount / activeScenario.lines.length) * 100)

  return (
    <div
      className="mx-auto flex h-[34rem] min-h-[34rem] max-h-[34rem] min-w-0 w-full max-w-full shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-[#0a0a0a] shadow-2xl shadow-black/60 sm:max-w-lg"
      ref={containerRef}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card/50 px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-red-500/80" />
          <span className="size-2.5 rounded-full bg-yellow-500/80" />
          <span className="size-2.5 rounded-full bg-green-500/80" />
        </div>
        <span className="truncate font-mono text-[0.65rem] text-muted-foreground">
          {activeScenario.terminalTitle}
        </span>
        <span className="font-mono text-[0.6rem] font-bold uppercase tracking-wider text-[var(--accent-title)]">
          {t(activeScenario.badgeKey)}
        </span>
      </div>

      <div className="shrink-0 border-b border-border bg-card/35">
        <div className="flex border-b border-border/80 bg-background/55">
          <div
            className="h-10 min-w-0 flex-1 overflow-x-auto overflow-y-hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            ref={tabScrollRef}
            role="tablist"
          >
            <div className="flex min-w-max">
              {HERO_DEMO_SCENARIOS.map((scenario, index) => {
                const Icon = SCENARIO_ICONS[scenario.id] ?? Code2
                const isActive = scenario.id === activeScenario.id

                return (
                  <button
                    aria-selected={isActive}
                    className={cn(
                      "relative flex h-10 shrink-0 items-center gap-1.5 border-r border-border px-3 font-mono font-semibold uppercase transition focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:px-4",
                      isActive
                        ? "bg-[#121212] text-foreground before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-[var(--accent-title)]"
                        : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                    )}
                    key={scenario.id}
                    onClick={() => handleScenarioSelect(scenario.id)}
                    role="tab"
                    style={{ fontSize: "0.58rem" }}
                    type="button"
                  >
                    <span className="text-foreground/70" style={{ fontSize: "0.46rem" }}>
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <Icon aria-hidden="true" className="size-2.5 shrink-0" />
                    <span>{t(scenario.titleKey)}</span>
                  </button>
                )
              })}
            </div>
          </div>
          <button
            aria-label={t("demo_replay_label")}
            className="flex h-10 w-10 shrink-0 items-center justify-center border-l border-border text-muted-foreground transition hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            onClick={startSequence}
            title={t("demo_replay_label")}
            type="button"
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
          </button>
        </div>
        <p className="h-16 overflow-y-auto px-4 py-3 text-xs font-medium leading-5 text-muted-foreground">
          {t(activeScenario.descriptionKey)}
        </p>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto p-4 font-mono text-[0.68rem] leading-relaxed sm:text-xs"
        ref={scrollRef}
      >
        {activeScenario.lines.slice(0, playback.visibleCount).map((line, index) =>
          renderTerminalLine({
            key: `${activeScenario.id}-${line.kind}-${index}`,
            line,
            lineClass,
            linePrefix,
            copyLabel: t("copy_command"),
            text: resolveLineText(line),
          }),
        )}

        {playback.typingLineIndex !== null &&
          renderTerminalLine({
            key: `${activeScenario.id}-typing-${playback.typingLineIndex}`,
            line: activeScenario.lines[playback.typingLineIndex],
            lineClass,
            linePrefix,
            copyLabel: t("copy_command"),
            text: playback.typedText,
            showCursor: true,
          })}

        {playback.typingLineIndex === null && !playback.isComplete && (
          <span className="inline-block h-3.5 w-2 animate-pulse bg-green-400/70" />
        )}
      </div>

      <div className="h-1 shrink-0 bg-border/70">
        <div
          className="h-full bg-[var(--accent-title)] transition-[width] duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
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

  const prefix = linePrefix[line.kind]
  const copyable = !showCursor && COPYABLE_TERMINAL_LINE_KINDS.has(line.kind) && text.trim()
  const content = (
    <span className={cn("min-w-0 whitespace-pre-wrap break-words", lineClass[line.kind])}>
      {text}
      {showCursor && (
        <span className="ml-1 inline-block h-3.5 w-2 animate-pulse bg-[var(--accent-title)]" />
      )}
    </span>
  )

  if (prefix) {
    return (
      <div className="group/terminal-line mt-3 mb-1" key={key}>
        <div className="mb-1.5 flex items-center gap-2">
          <span className="h-px w-4 bg-green-400/50" />
          <span className="font-mono text-[0.55rem] font-bold uppercase tracking-[0.16em] text-green-400/80">
            {prefix}
          </span>
          <span className="h-px min-w-0 flex-1 bg-border/60" />
        </div>
        <div className="flex min-w-0 items-start gap-2 border-border/80 border-l pl-3">
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
    <div className={cn("mb-0.5 border-border/50 border-l pl-3", lineClass[line.kind])} key={key}>
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
