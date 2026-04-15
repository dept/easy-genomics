import { ref, type Ref } from 'vue';

export interface LassoBox {
  left: number;
  top: number;
  width: number;
  height: number;
  visible: boolean;
}

function rectIntersects(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

/**
 * Drag a selection rectangle over a container; on mouseup, collect `data-s3-key` from intersecting rows.
 */
export function useDataCollectionLasso(containerRef: Ref<HTMLElement | null>, onAddKeys: (keys: string[]) => void) {
  const lassoBox = ref<LassoBox>({ left: 0, top: 0, width: 0, height: 0, visible: false });
  const dragging = ref(false);
  let startX = 0;
  let startY = 0;

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    const el = e.target as HTMLElement;
    if (
      el.closest('button') ||
      el.closest('input') ||
      el.closest('label') ||
      el.closest('a') ||
      el.closest('[role="checkbox"]')
    ) {
      return;
    }
    const root = containerRef.value;
    if (!root?.contains(el)) return;

    dragging.value = true;
    const r = root.getBoundingClientRect();
    startX = e.clientX - r.left;
    startY = e.clientY - r.top;
    lassoBox.value = { left: startX, top: startY, width: 0, height: 0, visible: true };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(e: MouseEvent) {
    if (!dragging.value || !containerRef.value) return;
    const r = containerRef.value.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    lassoBox.value = {
      left: Math.min(startX, x),
      top: Math.min(startY, y),
      width: Math.abs(x - startX),
      height: Math.abs(y - startY),
      visible: true,
    };
  }

  function onMouseUp() {
    if (!dragging.value || !containerRef.value) return;
    dragging.value = false;
    const root = containerRef.value;
    const { left, top, width, height } = lassoBox.value;
    lassoBox.value = { ...lassoBox.value, visible: false };
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);

    if (width < 5 || height < 5) return;

    const cr = root.getBoundingClientRect();
    const lassoBounds = {
      left: cr.left + left,
      top: cr.top + top,
      right: cr.left + left + width,
      bottom: cr.top + top + height,
    };

    const keys: string[] = [];
    root.querySelectorAll<HTMLElement>('[data-s3-key]').forEach((rowEl) => {
      const br = rowEl.getBoundingClientRect();
      const b = { left: br.left, top: br.top, right: br.right, bottom: br.bottom };
      if (rectIntersects(lassoBounds, b)) {
        const k = rowEl.dataset.s3Key;
        if (k) keys.push(k);
      }
    });

    if (keys.length) {
      onAddKeys(keys);
    }
  }

  return { lassoBox, onMouseDown };
}
