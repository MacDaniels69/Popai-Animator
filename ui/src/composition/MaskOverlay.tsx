import { useRef, useState } from "react";
import type { Value } from "./model";

export function MaskOverlay({
  points: value,
  width,
  height,
  onChange,
}: {
  points: Value;
  width: number;
  height: number;
  onChange(points: number[]): void;
}) {
  const [draft, setDraft] = useState<number[] | null>(null),
    dragged = useRef<number | null>(null);
  const points = draft || (Array.isArray(value) ? value : []);
  if (!points.length) return null;
  return (
    <svg
      className="comp-mask-overlay"
      viewBox={`0 0 ${width} ${height}`}
      role="group"
      aria-label="Editable polygon mask"
    >
      <polyline
        points={
          points
            .reduce<string[]>((result, _value, index) => {
              if (index % 2 === 0)
                result.push(`${points[index]},${points[index + 1]}`);
              return result;
            }, [])
            .join(" ") +
          (points.length >= 6 ? ` ${points[0]},${points[1]}` : "")
        }
        fill="none"
      />
      {points.map(
        (_point, index) =>
          index % 2 === 0 && (
            <circle
              key={index}
              cx={points[index]}
              cy={points[index + 1]}
              r={Math.max(4, width / 160)}
              role="button"
              aria-label={`Mask vertex ${index / 2 + 1}`}
              tabIndex={0}
              onKeyDown={(event) => {
                const delta = event.shiftKey ? 10 : 1,
                  next = [...points];
                if (event.key === "ArrowLeft") next[index] -= delta;
                else if (event.key === "ArrowRight") next[index] += delta;
                else if (event.key === "ArrowUp") next[index + 1] -= delta;
                else if (event.key === "ArrowDown") next[index + 1] += delta;
                else return;
                event.preventDefault();
                event.stopPropagation();
                onChange(next);
              }}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                dragged.current = index;
                setDraft([...points]);
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (dragged.current !== index) return;
                const rect =
                    event.currentTarget.ownerSVGElement!.getBoundingClientRect(),
                  scale = Math.min(rect.width / width, rect.height / height),
                  x =
                    (event.clientX -
                      rect.left -
                      (rect.width - width * scale) / 2) /
                    scale,
                  y =
                    (event.clientY -
                      rect.top -
                      (rect.height - height * scale) / 2) /
                    scale;
                setDraft((current) => {
                  const next = [...(current || points)];
                  next[index] = Math.round(x);
                  next[index + 1] = Math.round(y);
                  return next;
                });
              }}
              onPointerUp={(event) => {
                if (dragged.current !== index) return;
                dragged.current = null;
                event.currentTarget.releasePointerCapture(event.pointerId);
                if (draft) onChange(draft);
                setDraft(null);
              }}
              onPointerCancel={() => {
                dragged.current = null;
                setDraft(null);
              }}
            />
          ),
      )}
    </svg>
  );
}
