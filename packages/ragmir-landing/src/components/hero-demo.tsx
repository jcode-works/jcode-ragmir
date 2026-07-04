import { cn } from "@jcode.labs/ragmir-ui/utils"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

interface HeroDemoProps {
  translations: Record<string, string>
}

type LineType =
  | "command"
  | "file"
  | "summary"
  | "citation"
  | "result"
  | "code"
  | "stat"
  | "prompt"
  | "mcp"
  | "agent"

interface TerminalLine {
  type: LineType
  text: string
}

export function HeroDemo({ translations }: HeroDemoProps): React.JSX.Element {
  const t = useCallback((key: string): string => translations[key] ?? key, [translations])

  const lines = useMemo<TerminalLine[]>(
    () => [
      { type: "command", text: t("demo_cmd_1") },
      { type: "file", text: t("demo_out_1a") },
      { type: "file", text: t("demo_out_1b") },
      { type: "file", text: t("demo_out_1c") },
      { type: "file", text: t("demo_out_1d") },
      { type: "summary", text: t("demo_out_1e") },
      { type: "prompt", text: t("demo_cmd_2") },
      { type: "mcp", text: t("demo_out_2a") },
      { type: "citation", text: t("demo_out_2b") },
      { type: "result", text: t("demo_out_2c") },
      { type: "result", text: t("demo_out_2d") },
      { type: "mcp", text: t("demo_out_2e") },
      { type: "citation", text: t("demo_out_2f") },
      { type: "result", text: t("demo_out_2g") },
      { type: "agent", text: t("demo_out_3a") },
      { type: "code", text: t("demo_out_3b") },
      { type: "code", text: t("demo_out_3c") },
      { type: "citation", text: t("demo_out_3d") },
      { type: "command", text: t("demo_cmd_5") },
      { type: "stat", text: t("demo_out_5") },
    ],
    [t],
  )

  const [visibleCount, setVisibleCount] = useState(0)
  const [isTyping, setIsTyping] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const isVisible = useRef(false)
  const hasPlayedRef = useRef(false)
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearAllTimeouts = useCallback(() => {
    for (const timeout of timeoutsRef.current) clearTimeout(timeout)
    timeoutsRef.current = []
  }, [])

  const startSequence = useCallback(() => {
    clearAllTimeouts()
    setVisibleCount(0)
    let elapsed = 400

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line) continue
      const isCommand = line.type === "command"
      const isPrompt = line.type === "prompt"
      const needsTyping = isCommand || isPrompt
      const delay = needsTyping ? 800 : 160
      const typing = needsTyping ? Math.min(1000, Math.max(300, line.text.length * 22)) : 0

      if (needsTyping) {
        timeoutsRef.current.push(setTimeout(() => setIsTyping(true), elapsed))
        timeoutsRef.current.push(setTimeout(() => setIsTyping(false), elapsed + typing))
      }

      elapsed += delay + typing
      const lineIndex = i
      timeoutsRef.current.push(setTimeout(() => setVisibleCount(lineIndex + 1), elapsed))
    }
  }, [lines, clearAllTimeouts])

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
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  })

  const lineClass: Record<LineType, string> = {
    command: "text-foreground/90",
    file: "text-foreground/70",
    summary: "mt-1 text-emerald-400",
    citation: "mt-1 font-semibold text-[var(--accent-title)]",
    result: "pl-4 text-muted-foreground",
    code: "text-cyan-400",
    stat: "mt-1 text-cyan-400",
    prompt: "text-amber-400",
    mcp: "mt-1 text-[var(--accent-title)]/80",
    agent: "mt-2 text-emerald-400",
  }

  const linePrefix: Partial<Record<LineType, string>> = {
    prompt: ">",
    command: "$",
  }

  return (
    <div
      className="mx-auto w-full max-w-sm overflow-hidden rounded-xl border border-border bg-[#0a0a0a] shadow-2xl shadow-black/60"
      ref={containerRef}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border bg-card/50 px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-red-500/80" />
          <span className="size-2.5 rounded-full bg-yellow-500/80" />
          <span className="size-2.5 rounded-full bg-green-500/80" />
        </div>
        <span className="truncate font-mono text-[0.65rem] text-muted-foreground">
          {t("demo_terminal_title")}
        </span>
        <span className="font-mono text-[0.6rem] font-bold uppercase tracking-wider text-[var(--accent-title)]">
          {t("demo_badge")}
        </span>
      </div>

      <div
        className="h-[22rem] overflow-y-auto p-4 font-mono text-xs leading-relaxed"
        ref={scrollRef}
      >
        {lines.slice(0, visibleCount).map((line, index) => {
          const key = `${line.type}-${index}`
          const prefix = linePrefix[line.type]
          if (prefix) {
            return (
              <div key={key} className="mt-2 mb-1 flex items-start gap-2">
                <span className="shrink-0 text-green-400">{prefix}</span>
                <span className={lineClass[line.type]}>{line.text}</span>
              </div>
            )
          }
          return (
            <div key={key} className={cn("mb-0.5", lineClass[line.type])}>
              {line.text}
            </div>
          )
        })}

        {isTyping && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-green-400">$</span>
            <span className="inline-block h-3.5 w-2 animate-pulse bg-[var(--accent-title)]" />
          </div>
        )}

        {!isTyping && visibleCount < lines.length && (
          <span className="inline-block h-3.5 w-2 animate-pulse bg-green-400/70" />
        )}
      </div>
    </div>
  )
}
