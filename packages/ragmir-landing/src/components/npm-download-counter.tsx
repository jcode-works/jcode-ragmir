import { useEffect, useRef, useState } from "react"
import { cn } from "../lib/utils"

const COUNT_UP_DURATION_MS = 1200

interface NpmDownloadCounterProps {
  downloads: number
  label: string
  locale: string
  align?: "center" | "start"
}

function formatNumber(value: number, locale: string): string {
  const localeMap: Record<string, string> = {
    en: "en-US",
    fr: "fr-FR",
  }
  return value.toLocaleString(localeMap[locale] ?? "en-US")
}

function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3
}

export function NpmDownloadCounter({
  downloads,
  label,
  locale,
  align = "start",
}: NpmDownloadCounterProps): React.JSX.Element {
  const [displayCount, setDisplayCount] = useState(0)
  const displayCountRef = useRef(0)
  const animationRef = useRef<number>(0)

  useEffect(() => {
    const start = displayCountRef.current
    const diff = downloads - start
    if (diff === 0) return

    const startTime = performance.now()

    const animate = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / COUNT_UP_DURATION_MS, 1)
      const current = Math.round(start + diff * easeOutCubic(progress))

      displayCountRef.current = current
      setDisplayCount(current)
      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate)
      }
    }

    animationRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animationRef.current)
  }, [downloads])

  return (
    <div
      className={cn(
        "flex items-start md:items-center gap-1",
        align === "center" ? "justify-center" : "justify-start",
        "font-semibold text-xs md:text-sm",
        "text-white",
      )}
    >
      <span className="tabular-nums font-black">{formatNumber(displayCount, locale)}</span>
      <span>{label}</span>
    </div>
  )
}
