import { Check } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { cn } from "../lib/utils"

const copyToastSubscribers = new Set<() => void>()

export function emitCopyToast(): void {
  for (const notify of copyToastSubscribers) notify()
}

export function CommandCopyToast({ message }: { message: string }): React.JSX.Element {
  const [visible, setVisible] = useState(false)
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const notify = () => {
      setVisible(true)
      if (hideTimeout.current) clearTimeout(hideTimeout.current)
      hideTimeout.current = setTimeout(() => setVisible(false), 2000)
    }
    copyToastSubscribers.add(notify)
    return () => {
      copyToastSubscribers.delete(notify)
      if (hideTimeout.current) clearTimeout(hideTimeout.current)
    }
  }, [])

  return (
    <div
      aria-live="polite"
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-6 z-50 mx-auto flex w-fit items-center gap-2 rounded-md border border-border bg-card px-4 py-2 font-semibold text-foreground text-sm shadow-2xl shadow-black/40 transition-all duration-300",
        visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
      )}
      role="status"
    >
      <Check aria-hidden="true" className="size-4 text-[var(--accent-title)]" />
      {message}
    </div>
  )
}
