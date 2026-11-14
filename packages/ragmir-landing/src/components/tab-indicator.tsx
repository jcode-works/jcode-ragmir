import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { cn } from "../lib/utils"

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

interface IndicatorBox {
  x: number
  y: number
  width: number
  height: number
}

interface TabIndicatorProps {
  /** Matches the active tab, such as `[data-state="active"]` or `[aria-selected="true"]`. */
  activeSelector: string
  className?: string
}

/**
 * One pill that slides to the active tab, so a tab change reads as a move rather than a swap.
 * Render it as the first child of the positioned element that holds the tabs: it measures against
 * its own parent, whose ref React would attach only after this child's layout effect has run.
 * Until it has measured, the list keeps each tab's own active background: the server-rendered
 * page and a page whose script fails still show which tab is selected. Once measured, it marks
 * the list with `data-indicator="ready"`, which tab styles use to drop their own background.
 */
export function TabIndicator({ activeSelector, className }: TabIndicatorProps): React.JSX.Element {
  const pillRef = useRef<HTMLSpanElement>(null)
  const [box, setBox] = useState<IndicatorBox | null>(null)
  const [animate, setAnimate] = useState(false)

  useIsomorphicLayoutEffect(() => {
    const list = pillRef.current?.parentElement
    if (!list) return

    const measure = () => {
      const active = list.querySelector<HTMLElement>(activeSelector)
      if (!active) return
      list.dataset.indicator = "ready"
      setBox((current) => {
        const next = {
          x: active.offsetLeft,
          y: active.offsetTop,
          width: active.offsetWidth,
          height: active.offsetHeight,
        }
        return current &&
          current.x === next.x &&
          current.y === next.y &&
          current.width === next.width &&
          current.height === next.height
          ? current
          : next
      })
    }

    measure()
    // Tabs change state through attributes, resize with fonts and viewport: follow both.
    const mutations = new MutationObserver(measure)
    mutations.observe(list, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state", "aria-selected"],
    })
    const resizes = new ResizeObserver(measure)
    resizes.observe(list)
    for (const child of Array.from(list.children)) resizes.observe(child)
    // Enable the slide only after the first position is painted, so it never flies in from 0.
    const frame = requestAnimationFrame(() => setAnimate(true))

    return () => {
      cancelAnimationFrame(frame)
      mutations.disconnect()
      resizes.disconnect()
      delete list.dataset.indicator
    }
  }, [activeSelector])

  return (
    <span
      aria-hidden="true"
      ref={pillRef}
      className={cn(
        "pointer-events-none absolute top-0 left-0 rounded-full bg-foreground",
        box ? "opacity-100" : "opacity-0",
        animate &&
          "transition-[transform,width] duration-300 ease-[var(--ease-out-expo)] motion-reduce:transition-none",
        className,
      )}
      style={
        box
          ? {
              width: box.width,
              height: box.height,
              transform: `translate3d(${box.x}px, ${box.y}px, 0)`,
            }
          : undefined
      }
    />
  )
}
