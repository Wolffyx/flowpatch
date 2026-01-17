import { useRef, useCallback } from 'react'
import type { DragMoveEvent } from '@dnd-kit/core'

interface AutoScrollConfig {
  threshold?: number // Distance from edge to trigger scroll (default: 100px)
  speed?: number // Base scroll speed (default: 15)
  acceleration?: number // Speed multiplier near edge (default: 2)
}

export function useDragAutoScroll(
  containerRef: React.RefObject<HTMLElement | null>,
  config: AutoScrollConfig = {}
) {
  const { threshold = 100, speed = 15, acceleration = 2 } = config
  const animationFrameRef = useRef<number | null>(null)
  const scrollDirectionRef = useRef<number>(0)

  const scrollLoop = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    if (scrollDirectionRef.current !== 0) {
      container.scrollLeft += scrollDirectionRef.current
      animationFrameRef.current = requestAnimationFrame(scrollLoop)
    }
  }, [containerRef])

  const onDragMove = useCallback(
    (event: DragMoveEvent) => {
      const container = containerRef.current
      if (!container || !event.active) return

      const rect = container.getBoundingClientRect()
      const pointerX = (event.activatorEvent as PointerEvent)?.clientX ?? 0
      const currentX = pointerX + (event.delta?.x ?? 0)

      let scrollX = 0

      // Right edge detection
      const distFromRight = rect.right - currentX
      if (distFromRight < threshold && distFromRight > 0) {
        const intensity = 1 - distFromRight / threshold
        scrollX = speed * (1 + intensity * acceleration)
      }

      // Left edge detection
      const distFromLeft = currentX - rect.left
      if (distFromLeft < threshold && distFromLeft > 0) {
        const intensity = 1 - distFromLeft / threshold
        scrollX = -speed * (1 + intensity * acceleration)
      }

      scrollDirectionRef.current = scrollX

      if (scrollX !== 0 && !animationFrameRef.current) {
        animationFrameRef.current = requestAnimationFrame(scrollLoop)
      } else if (scrollX === 0 && animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    },
    [containerRef, threshold, speed, acceleration, scrollLoop]
  )

  const cleanup = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    scrollDirectionRef.current = 0
  }, [])

  return { onDragMove, cleanup }
}
