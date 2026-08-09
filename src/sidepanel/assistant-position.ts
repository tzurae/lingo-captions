export type AssistantPlacement = 'above' | 'below';

type Point = { x: number; y: number };
type Size = { width: number; height: number };

export function calculateAssistantPosition(
  anchor: Point,
  popup: Size,
  viewport: Size,
  inset = 16,
  gap = 8,
): { left: number; top: number; placement: AssistantPlacement } {
  const horizontalSpace = viewport.width - inset * 2;
  const verticalSpace = viewport.height - inset * 2;
  const left = popup.width > horizontalSpace
    ? inset
    : clamp(anchor.x - popup.width / 2, inset, viewport.width - inset - popup.width);

  const aboveTop = anchor.y - gap - popup.height;
  const aboveSpace = anchor.y - gap - inset;
  const belowSpace = viewport.height - inset - anchor.y - gap;
  const placement: AssistantPlacement = aboveTop < inset && belowSpace >= aboveSpace ? 'below' : 'above';
  const preferredTop = placement === 'above' ? aboveTop : anchor.y + gap;
  const top = popup.height > verticalSpace
    ? inset
    : clamp(preferredTop, inset, viewport.height - inset - popup.height);

  return { left, top, placement };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
