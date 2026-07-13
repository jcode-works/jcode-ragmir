import { useEffect, useRef, useState } from "react"
import { cn } from "../lib/utils"

interface RagmirBackgroundProps {
  height?: string
  className?: string
  enableOnMobile?: boolean
  /** When true, applies -z-10 to place background behind content. Default: true */
  behindContent?: boolean
  /** Override the background color. Useful when the component is placed inside a section with a custom background. */
  bgColor?: string
  /** When false, hides the default top/bottom fade overlay. Default: true */
  overlay?: boolean
}

// Constants
const MOBILE_BREAKPOINT = 768
const SPACING = { desktop: { x: 20, y: 16 }, mobile: { x: 28, y: 22 } }
const SCROLL_SPEED = { desktop: 0.25, mobile: 0.15 }
const THEME = {
  light: { bg: "#ffffff", brightness: { base: 120, min: 80, max: 160 } },
  dark: { bg: "#000000", brightness: { base: 110, min: 80, max: 150 } },
}

// Pre-computed constants
const TWO_PI = Math.PI * 2
const VIEWPORT_BUFFER = SPACING.desktop.y * 3
const MAX_DPR = 2 // Cap DPR for performance (3x Retina would be overkill)
const HOVER_RADIUS = 200 // Mouse glow radius in CSS pixels
const HOVER_RADIUS_SQ = HOVER_RADIUS * HOVER_RADIUS

// Compute background color from CSS variable (expensive: cache result, don't call per frame)
const computeBgColor = (isDark: boolean): string => {
  const theme = isDark ? THEME.dark : THEME.light
  if (typeof window === "undefined") return theme.bg
  const computedBg = getComputedStyle(document.body).getPropertyValue("--background").trim()
  if (
    computedBg &&
    !computedBg.startsWith("oklch") &&
    !computedBg.startsWith("oklab") &&
    !computedBg.startsWith("lab(") &&
    !computedBg.startsWith("lch(")
  ) {
    return computedBg
  }
  return theme.bg
}

// Helper to get initial background color synchronously (works during SSR and client)
const getInitialBgColor = (): string => {
  if (typeof document === "undefined") return THEME.dark.bg
  return document.documentElement.classList.contains("dark") ? THEME.dark.bg : THEME.light.bg
}

export const RagmirBackground = ({
  height = "50vh",
  className,
  enableOnMobile = true,
  behindContent = true,
  bgColor,
  overlay = true,
}: RagmirBackgroundProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Compute bg color at render time for immediate inline style (prevents flash)
  const initialBgColor = bgColor || getInitialBgColor()
  // Track when component is ready for smooth fade-in
  const [isReady, setIsReady] = useState(false)
  const stateRef = useRef({
    animationId: 0,
    scrollOffset: 0,
    lastTime: 0,
    isMobile: typeof window !== "undefined" ? window.innerWidth < MOBILE_BREAKPOINT : false,
    isDark:
      typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : true,
    dots: [] as { baseX: number; baseY: number }[],
    gridRows: 0,
    rect: null as DOMRect | null,
    terrainCache: new Map<number, number>(),
    mouseX: -1,
    mouseY: -1,
    hasMouseHover: false,
    cachedBg: "",
    dpr: 1,
    rgbaCache: new Map<number, string>(),
  })

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const state = stateRef.current
    state.isMobile = window.innerWidth < MOBILE_BREAKPOINT

    // Skip canvas setup on mobile if disabled
    if (state.isMobile && !enableOnMobile) return

    const ctx = canvas.getContext("2d", { alpha: false })
    if (!ctx) return

    // Immediately fill canvas with correct background to prevent black flash
    // alpha: false creates an opaque black canvas by default - we must fill it ASAP
    const isDarkNow = document.documentElement.classList.contains("dark")
    state.isDark = isDarkNow
    state.cachedBg = computeBgColor(isDarkNow)
    const initialBg = isDarkNow ? THEME.dark.bg : THEME.light.bg
    ctx.fillStyle = initialBg
    ctx.fillRect(0, 0, canvas.width || 1, canvas.height || 1)

    // Flags to control animation loop
    let isVisible = true
    let isIntersecting = false
    let isReducedMotion = false

    // FPS Throttling
    const FPS_LIMIT = 30
    const FRAME_INTERVAL = 1000 / FPS_LIMIT
    let lastDrawTime = 0

    // Setup canvas dimensions and dots grid
    const setupCanvas = () => {
      const rect = container.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return

      // DPR for Retina support - capped for performance, lower on mobile
      state.dpr = state.isMobile ? 1 : Math.min(window.devicePixelRatio || 1, MAX_DPR)
      const dpr = state.dpr

      state.rect = rect
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`

      // Scale context for DPR
      ctx.scale(dpr, dpr)

      // Immediately fill with correct background after resize (resizing clears canvas)
      const theme = state.isDark ? THEME.dark : THEME.light
      ctx.fillStyle = theme.bg
      ctx.fillRect(0, 0, rect.width, rect.height)

      const spacing = state.isMobile ? SPACING.mobile : SPACING.desktop
      const cols = Math.floor(rect.width / spacing.x) + 3
      const rows = Math.floor(rect.height / spacing.y) + 5
      state.gridRows = rows

      // Only recreate dots if grid size changed
      const newLength = rows * cols
      if (state.dots.length !== newLength) {
        state.dots = []
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            state.dots.push({
              baseX: col * spacing.x - spacing.x,
              baseY: row * spacing.y - spacing.y * 2,
            })
          }
        }
      }

      state.terrainCache.clear()

      // Force a redraw after setup to ensure content appears even if not animating
      requestAnimationFrame((t) => {
        drawFrame(t, true)
        // Mark as ready after first successful draw for fade-in transition
        setIsReady(true)
      })
    }

    // Terrain generation with simple cache
    const getTerrain = (x: number, y: number): number => {
      const key = (Math.round(x / 10) << 16) | (Math.round(y / 10) & 0xffff)
      let value = state.terrainCache.get(key)
      if (value === undefined) {
        value =
          Math.sin(x * 0.005 + y * 0.004) * 20 +
          Math.cos(x * 0.01 - y * 0.007) * 12 +
          Math.sin(x * 0.02 + y * 0.015) * 5
        if (state.terrainCache.size > 400) {
          state.terrainCache.clear()
        }
        state.terrainCache.set(key, value)
      }
      return value
    }

    const drawFrame = (currentTime: number, force = false) => {
      // FPS Throttling
      if (!force) {
        const elapsed = currentTime - lastDrawTime
        if (elapsed < FRAME_INTERVAL) return
        lastDrawTime = currentTime - (elapsed % FRAME_INTERVAL)
      } else {
        lastDrawTime = currentTime
      }

      const rect = state.rect
      if (!rect) return

      // Delta time calculation
      if (state.lastTime === 0) state.lastTime = currentTime
      // Cap delta to prevent huge jumps if tab was inactive
      const delta = Math.min((currentTime - state.lastTime) / 16.67, 2)

      // Update logic (only if not forced and not reduced motion)
      if (!force && !isReducedMotion) {
        state.lastTime = currentTime

        // Update scroll
        const speed = state.isMobile ? SCROLL_SPEED.mobile : SCROLL_SPEED.desktop
        state.scrollOffset += speed * delta
      } else {
        // Reset lastTime so delta doesn't accumulate while paused
        state.lastTime = currentTime
      }

      // Use cached theme state (updated by MutationObserver)
      const theme = state.isDark ? THEME.dark : THEME.light
      const bg = bgColor || state.cachedBg || theme.bg
      const dpr = state.dpr

      // Reset transform and clear canvas (single setTransform instead of reset+scale)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, rect.width, rect.height)

      // Pre-compute values
      const spacing = state.isMobile ? SPACING.mobile : SPACING.desktop
      const cycleHeight = spacing.y * state.gridRows
      if (state.scrollOffset > cycleHeight * 2) {
        state.scrollOffset %= cycleHeight
      }

      const centerX = rect.width * 0.5
      const invHeight = 1 / rect.height
      const edgeThreshold = rect.width * 0.48

      // Draw dots
      for (let i = 0; i < state.dots.length; i++) {
        const dot = state.dots[i]
        if (!dot) continue
        let y = dot.baseY - state.scrollOffset

        // Wrap Y position
        if (y < -VIEWPORT_BUFFER) {
          dot.baseY += cycleHeight
          y += cycleHeight
        } else if (y > rect.height + VIEWPORT_BUFFER) {
          dot.baseY -= cycleHeight
          y -= cycleHeight
        }

        // Skip if outside visible area
        if (y < -30 || y > rect.height + 30) continue

        // Calculate visual properties
        const normalizedY = Math.max(0, Math.min(1, y * invHeight))
        const distFromCenter = dot.baseX - centerX
        const curveFactor = Math.max(-1, Math.min(1, distFromCenter / centerX))
        const perspective = Math.max(0, Math.min(1, 1 - normalizedY * 0.7))

        // Terrain elevation
        const terrain = getTerrain(dot.baseX, dot.baseY + state.scrollOffset * 0.3)
        const elevation = Math.max(-50, Math.min(50, terrain * perspective * 0.7))

        // Final position
        const finalX =
          centerX +
          Math.max(-rect.width, Math.min(rect.width, distFromCenter * (1 + normalizedY * 0.4)))
        const finalY = y - curveFactor * curveFactor * 100 * perspective + elevation

        // Skip invalid positions
        if (!Number.isFinite(finalX) || !Number.isFinite(finalY)) continue
        if (Math.abs(finalX - centerX) > rect.width) continue

        // Edge fade and opacity
        const edgeRatio = Math.abs(distFromCenter) / edgeThreshold
        const edgeFade = Math.max(0, 1 - edgeRatio * edgeRatio * edgeRatio)
        let opacity = Math.max(0, Math.min(0.7, edgeFade * perspective * 0.8))
        if (opacity < 0.01) continue

        // Size and brightness
        const size = Math.max(0.5, Math.min(2, 0.9 + perspective * 0.45))
        // Note: For brightness base, we still use the hardcoded theme constants
        // because extracting "brightness" from an arbitrary CSS variable color is complex/expensive.
        // This is an acceptable tradeoff as long as dots contrast well with the background.
        let brightness = Math.max(
          theme.brightness.min,
          Math.min(
            theme.brightness.max,
            Math.round(theme.brightness.base + terrain * 1.08 + perspective * 30),
          ),
        )

        // Mouse hover glow
        if (state.hasMouseHover) {
          const dx = finalX - state.mouseX
          const dy = finalY - state.mouseY
          const distSq = dx * dx + dy * dy
          if (distSq < HOVER_RADIUS_SQ) {
            const ratio = 1 - Math.sqrt(distSq) / HOVER_RADIUS
            const boost = ratio * ratio // quadratic falloff
            if (state.isDark) {
              brightness = Math.round(brightness + (255 - brightness) * boost)
            } else {
              brightness = Math.round(brightness * (1 - boost))
            }
            opacity = Math.min(1, opacity + boost * 0.6)
          }
        }

        // Draw dot: cached rgba string to avoid per-dot string allocation
        const rgbaKey = (brightness << 8) | Math.round(opacity * 100)
        let rgba = state.rgbaCache.get(rgbaKey)
        if (!rgba) {
          rgba = `rgba(${brightness},${brightness},${brightness},${opacity})`
          if (state.rgbaCache.size > 500) state.rgbaCache.clear()
          state.rgbaCache.set(rgbaKey, rgba)
        }
        ctx.fillStyle = rgba

        ctx.beginPath()
        ctx.arc(finalX, finalY, size, 0, TWO_PI)
        ctx.fill()
      }
    }

    // Animation loop
    const animate = (currentTime: number) => {
      // Stop loop if hidden or not intersecting
      // We also stop the loop if Reduced Motion is ON (we just draw once in setup/resize)
      if (!isVisible || !isIntersecting || isReducedMotion) {
        state.animationId = 0
        return
      }

      const rect = state.rect
      if (!rect) {
        state.animationId = requestAnimationFrame(animate)
        return
      }

      drawFrame(currentTime)

      state.animationId = requestAnimationFrame(animate)
    }

    // Mouse hover handlers (desktop glow effect)
    // Listen on document because the canvas sits behind content (-z-10)
    const handleMouseMove = (e: MouseEvent) => {
      const rect = state.rect
      if (!rect) return
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const isOver = x >= 0 && x <= rect.width && y >= 0 && y <= rect.height
      state.mouseX = x
      state.mouseY = y
      state.hasMouseHover = isOver
      if (!state.animationId && isIntersecting) {
        requestAnimationFrame((t) => drawFrame(t, true))
      }
    }
    const handleMouseLeave = () => {
      state.hasMouseHover = false
      if (!state.animationId && isIntersecting) {
        requestAnimationFrame((t) => drawFrame(t, true))
      }
    }

    // Initialize
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    isReducedMotion = mediaQuery.matches

    setupCanvas()

    const startAnimation = () => {
      // Don't start loop if Reduce Motion is on
      if (!state.animationId && isVisible && isIntersecting && !isReducedMotion) {
        state.lastTime = 0
        state.animationId = requestAnimationFrame(animate)
      } else if (isReducedMotion && isVisible && isIntersecting) {
        // Even if reduced motion, ensure we draw at least one frame if we become visible
        // (e.g. scroll into view) to prevent blank canvas
        requestAnimationFrame((t) => drawFrame(t, true))
      }
    }

    const stopAnimation = () => {
      if (state.animationId) {
        cancelAnimationFrame(state.animationId)
        state.animationId = 0
      }
    }

    // 1. Resize Observer
    // Throttle resize on mobile to prevent triggering during Safari elastic scroll
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === container) {
          // On mobile, throttle resize to avoid triggering during scroll momentum
          if (state.isMobile) {
            if (resizeTimeout) return // Ignore if already pending
            resizeTimeout = setTimeout(() => {
              state.isMobile = window.innerWidth < MOBILE_BREAKPOINT
              setupCanvas()
              resizeTimeout = null
            }, 200)
          } else {
            // Desktop: execute immediately
            state.isMobile = window.innerWidth < MOBILE_BREAKPOINT
            setupCanvas()
          }
        }
      }
    })
    resizeObserver.observe(container)

    // 2. Intersection Observer (Visibility on screen)
    // Use rootMargin to prevent rapid firing during Safari's elastic scroll
    // Debounce state changes to prevent flickering on mobile Safari
    let intersectionTimeout: ReturnType<typeof setTimeout> | null = null
    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          // Clear any pending timeout to debounce rapid changes
          if (intersectionTimeout) {
            clearTimeout(intersectionTimeout)
          }

          const newIsIntersecting = entry.isIntersecting

          // On mobile, use longer debounce in BOTH directions to prevent Safari elastic scroll flash
          const debounceDelay = state.isMobile ? 300 : 150

          if (newIsIntersecting && !isIntersecting) {
            // On mobile, debounce activation too to prevent rapid toggling during elastic scroll
            if (state.isMobile) {
              intersectionTimeout = setTimeout(() => {
                isIntersecting = true
                startAnimation()
              }, debounceDelay)
            } else {
              // Desktop: start immediately
              isIntersecting = true
              startAnimation()
            }
          } else if (!newIsIntersecting && isIntersecting) {
            // Delay deactivation to avoid flickering during scroll
            intersectionTimeout = setTimeout(() => {
              isIntersecting = false
              stopAnimation()
            }, debounceDelay)
          }
        })
      },
      // On mobile, increase rootMargin significantly to reduce sensitivity during elastic scroll
      {
        threshold: 0,
        rootMargin: state.isMobile ? "200px 0px" : "50px 0px",
      },
    )
    intersectionObserver.observe(container)

    // 3. Document Visibility (Tab switching)
    const handleVisibility = () => {
      isVisible = !document.hidden
      if (isVisible) {
        startAnimation()
      } else {
        stopAnimation()
      }
    }
    document.addEventListener("visibilitychange", handleVisibility)

    // 4. Mutation Observer for Theme (Dark/Light mode)
    // Also trigger a redraw when theme changes
    const mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes" && mutation.attributeName === "class") {
          state.isDark = document.documentElement.classList.contains("dark")
          state.cachedBg = computeBgColor(state.isDark)
          state.rgbaCache.clear()
          // If reduced motion is on or animation paused, force a redraw to update background color
          if (!state.animationId) {
            requestAnimationFrame((t) => drawFrame(t, true))
          }
        }
      }
    })
    mutationObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })

    // 5. Reduced Motion Listener
    const handleMotionChange = (e: MediaQueryListEvent) => {
      isReducedMotion = e.matches
      if (isReducedMotion) {
        stopAnimation()
        requestAnimationFrame((t) => drawFrame(t, true)) // Draw one static frame
      } else {
        startAnimation()
      }
    }
    mediaQuery.addEventListener("change", handleMotionChange)

    // 6. Mouse hover (desktop only)
    if (!state.isMobile) {
      document.addEventListener("mousemove", handleMouseMove)
      document.documentElement.addEventListener("mouseleave", handleMouseLeave)
    }

    // Initial check for theme
    state.isDark = document.documentElement.classList.contains("dark")

    return () => {
      stopAnimation()
      if (intersectionTimeout) {
        clearTimeout(intersectionTimeout)
      }
      if (resizeTimeout) {
        clearTimeout(resizeTimeout)
      }
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      mutationObserver.disconnect()
      document.removeEventListener("visibilitychange", handleVisibility)
      mediaQuery.removeEventListener("change", handleMotionChange)
      document.removeEventListener("mousemove", handleMouseMove)
      document.documentElement.removeEventListener("mouseleave", handleMouseLeave)
      state.dots = []
      state.terrainCache.clear()
      state.rgbaCache.clear()
    }
  }, [enableOnMobile, bgColor])

  return (
    <div
      ref={containerRef}
      className={cn(
        "absolute w-full overflow-hidden pointer-events-none",
        behindContent && "-z-10",
        className,
      )}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        overflow: "hidden",
        pointerEvents: "none",
        zIndex: behindContent ? -10 : undefined,
        height,
        backgroundColor: initialBgColor,
        opacity: isReady ? 1 : 0,
        // Force GPU compositing layer on Safari to prevent flickering during scroll
        transform: "translateZ(0)",
        WebkitTransform: "translateZ(0)",
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden",
      }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          backgroundColor: initialBgColor,
          // Ensure canvas is on its own compositor layer
          transform: "translateZ(0)",
          WebkitTransform: "translateZ(0)",
          // Force Safari to maintain a stable GPU layer during scroll
          willChange: "transform",
        }}
      />
      {overlay && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background:
              "linear-gradient(to bottom, #000 0%, rgba(0, 0, 0, 0.88) 8%, transparent 34%, transparent 66%, rgba(0, 0, 0, 0.88) 92%, #000 100%)",
          }}
        />
      )}
    </div>
  )
}
