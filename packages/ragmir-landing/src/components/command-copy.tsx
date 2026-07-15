import { Check, Copy } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { cn } from "../lib/utils"
import { emitCopyToast } from "./command-copy-toast"

interface CommandCopyBoxProps {
  command: string
  copyLabel: string
}

function useCommandCopy(command: string): {
  copied: boolean
  handleCopy: () => Promise<void>
} {
  const [copied, setCopied] = useState(false)
  const resetTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (resetTimeout.current) clearTimeout(resetTimeout.current)
    }
  }, [])

  const handleCopy = async () => {
    try {
      await writeCommandToClipboard(command)
    } catch {
      return
    }
    setCopied(true)
    emitCopyToast()
    if (resetTimeout.current) clearTimeout(resetTimeout.current)
    resetTimeout.current = setTimeout(() => setCopied(false), 1500)
  }

  return { copied, handleCopy }
}

async function writeCommandToClipboard(command: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(command)
    return
  }

  const textarea = document.createElement("textarea")
  textarea.value = command
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.left = "-9999px"
  document.body.append(textarea)
  textarea.select()
  const copyFallback = document.execCommand.bind(document) as (commandId: string) => boolean
  const copied = copyFallback("copy")
  textarea.remove()
  if (!copied) {
    throw new Error("Clipboard copy failed.")
  }
}

export function CommandCopyBox({ command, copyLabel }: CommandCopyBoxProps): React.JSX.Element {
  const { copied, handleCopy } = useCommandCopy(command)

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

interface CommandCopyButtonProps extends CommandCopyBoxProps {
  className?: string
  iconClassName?: string
}

export function CommandCopyButton({
  command,
  copyLabel,
  className,
  iconClassName,
}: CommandCopyButtonProps): React.JSX.Element {
  const { copied, handleCopy } = useCommandCopy(command)

  return (
    <button
      aria-label={`${copyLabel}: ${command}`}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-background/70 text-muted-foreground opacity-80 transition hover:border-foreground/30 hover:bg-muted hover:text-foreground hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      onClick={() => void handleCopy()}
      title={`${copyLabel}: ${command}`}
      type="button"
    >
      {copied ? (
        <Check
          aria-hidden="true"
          className={cn("size-3.5 text-[var(--accent-title)]", iconClassName)}
        />
      ) : (
        <Copy aria-hidden="true" className={cn("size-3.5", iconClassName)} />
      )}
    </button>
  )
}
