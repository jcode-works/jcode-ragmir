import { cn } from "@jcode.labs/ragmir-ui/utils"
import { Check, Copy } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { emitCopyToast } from "./command-copy-toast"

interface CommandCopyBoxProps {
  command: string
  copyLabel: string
}

export function CommandCopyBox({ command, copyLabel }: CommandCopyBoxProps): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const resetTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (resetTimeout.current) clearTimeout(resetTimeout.current)
    }
  }, [])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command)
    } catch {
      return
    }
    setCopied(true)
    emitCopyToast()
    if (resetTimeout.current) clearTimeout(resetTimeout.current)
    resetTimeout.current = setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      aria-label={`${copyLabel}: ${command}`}
      className="group flex w-full items-center justify-between gap-3 rounded-md border border-border bg-background p-3 text-left transition hover:border-foreground/30 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => void handleCopy()}
      type="button"
    >
      <code className="overflow-x-auto font-mono text-foreground/78 text-xs">{command}</code>
      {copied ? (
        <Check aria-hidden="true" className="size-4 shrink-0 text-[var(--accent-title)]" />
      ) : (
        <Copy
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition group-hover:text-foreground"
        />
      )}
    </button>
  )
}

interface CommandLineBlockProps {
  command: string
  copyLabel: string
  icon?: React.ReactNode
  label: string
  className?: string
}

export function CommandLineBlock({
  command,
  copyLabel,
  icon,
  label,
  className,
}: CommandLineBlockProps): React.JSX.Element {
  return (
    <div className={cn("rounded-lg border border-border bg-muted/45 p-4", className)}>
      <div className="flex items-center gap-2">
        {icon}
        <p className="font-bold text-sm">{label}</p>
      </div>
      <div className="mt-3">
        <CommandCopyBox command={command} copyLabel={copyLabel} />
      </div>
    </div>
  )
}
