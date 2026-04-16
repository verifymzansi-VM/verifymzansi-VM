import { useCallback, useRef, type TouchEventHandler } from "react";

interface UseHorizontalSwipeNavigationOptions {
  onPrevious?: () => void;
  onNext?: () => void;
  canPrevious?: boolean;
  canNext?: boolean;
  disabled?: boolean;
  threshold?: number;
  axisLockRatio?: number;
  ignoreSelector?: string;
}

interface SwipeStart {
  x: number;
  y: number;
  ignore: boolean;
}

const DEFAULT_IGNORE_SELECTOR =
  '[data-carousel-control="true"], a[href], input, select, textarea, summary';

export function useHorizontalSwipeNavigation({
  onPrevious,
  onNext,
  canPrevious = false,
  canNext = false,
  disabled = false,
  threshold = 44,
  axisLockRatio = 0.7,
  ignoreSelector = DEFAULT_IGNORE_SELECTOR,
}: UseHorizontalSwipeNavigationOptions) {
  const startRef = useRef<SwipeStart | null>(null);

  const shouldIgnoreTarget = useCallback(
    (target: EventTarget | null) =>
      target instanceof Element && Boolean(target.closest(ignoreSelector)),
    [ignoreSelector]
  );

  const reset = useCallback(() => {
    startRef.current = null;
  }, []);

  const onTouchStart = useCallback<TouchEventHandler<HTMLElement>>(
    (event) => {
      if (disabled || event.touches.length !== 1) {
        startRef.current = null;
        return;
      }

      const touch = event.touches[0];
      startRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        ignore: shouldIgnoreTarget(event.target),
      };
    },
    [disabled, shouldIgnoreTarget]
  );

  const onTouchEnd = useCallback<TouchEventHandler<HTMLElement>>(
    (event) => {
      const start = startRef.current;
      startRef.current = null;

      if (!start || start.ignore || disabled || event.changedTouches.length === 0) {
        return;
      }

      const touch = event.changedTouches[0];
      const deltaX = touch.clientX - start.x;
      const deltaY = touch.clientY - start.y;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      if (absX < threshold || absY > absX * axisLockRatio) {
        return;
      }

      if (deltaX < 0 && canNext) {
        onNext?.();
        return;
      }

      if (deltaX > 0 && canPrevious) {
        onPrevious?.();
      }
    },
    [axisLockRatio, canNext, canPrevious, disabled, onNext, onPrevious, threshold]
  );

  return {
    onTouchStart,
    onTouchEnd,
    onTouchCancel: reset,
  };
}
