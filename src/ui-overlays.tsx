import React from "react";
import {
  metricDefinitions,
  normalizeOverlay,
  moveMetric,
  type MetricId,
  type OverlaySettings,
} from "./domain/metrics";
import { typographyChoices } from "./render/overlays";
import { totalActivityTime } from "./domain/metrics";
import type { Track } from "./domain/activity";
export function OverlayPanel({
  track,
  value,
  onChange,
  themeBackground,
}: {
  themeBackground: string;
  track: Track;
  value: OverlaySettings | undefined;
  onChange: (value: Partial<OverlaySettings>) => void;
}) {
  const overlay = normalizeOverlay(value),
    dragging = React.useRef<MetricId | null>(null);
  return (
    <section className="data-panel">
      <h2>Activity data</h2>
      <label>
        <input
          type="checkbox"
          checked={overlay.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
        />{" "}
        Show activity data
      </label>
      <label>
        Typography
        <select
          value={overlay.typography ?? "modern"}
          onChange={(e) =>
            onChange({
              typography: e.target.value as OverlaySettings["typography"],
            })
          }
        >
          {typographyChoices.map((type) => (
            <option key={type.id} value={type.id}>
              {type.label}
            </option>
          ))}
        </select>
      </label>
      <div className="overlay-options">
        <label>
          Data position
          <select
            value={overlay.position}
            onChange={(e) =>
              onChange({
                position: e.target.value as OverlaySettings["position"],
              })
            }
          >
            <option value="top">Top</option>
            <option value="middle">Middle</option>
            <option value="bottom">Bottom</option>
          </select>
        </label>
        <label>
          Data alignment
          <select
            value={overlay.alignment}
            onChange={(e) =>
              onChange({
                alignment: e.target.value as OverlaySettings["alignment"],
              })
            }
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </label>
        <label>
          Data size
          <select
            value={overlay.size}
            onChange={(e) =>
              onChange({ size: e.target.value as OverlaySettings["size"] })
            }
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </label>
        <label>
          Panel color
          <input
            type="color"
            value={overlay.panelColor ?? themeBackground}
            onChange={(e) => onChange({ panelColor: e.target.value })}
          />
        </label>
        <label>
          Text color
          <input
            type="color"
            value={
              overlay.textColor ??
              (parseInt(
                (overlay.panelColor ?? themeBackground).slice(1, 3),
                16,
              ) *
                0.299 +
                parseInt(
                  (overlay.panelColor ?? themeBackground).slice(3, 5),
                  16,
                ) *
                  0.587 +
                parseInt(
                  (overlay.panelColor ?? themeBackground).slice(5, 7),
                  16,
                ) *
                  0.114 >
              150
                ? "#202b32"
                : "#f5f7fa")
            }
            onChange={(e) => onChange({ textColor: e.target.value })}
          />
        </label>
      </div>
      <button
        type="button"
        onClick={() =>
          onChange({ panelColor: undefined, textColor: undefined })
        }
      >
        Use theme colors
      </button>
      <p className="muted">
        Sans-serif fonts only. Typography is independent of the route theme.
        Local font availability may affect the exact face. Drag rows or use
        arrows to reorder. Missing measurements display —.
      </p>
      <p className="muted">
        {totalActivityTime(track.activity)
          ? `Total time comes from ${totalActivityTime(track.activity)!.source}.`
          : "No reliable total duration is recorded in this file."}
      </p>
      <ol className="metric-list">
        {overlay.order.map((id, index) => {
          const metric = metricDefinitions.find((m) => m.id === id)!;
          return (
            <li
              key={id}
              draggable
              onDragStart={(e) => {
                dragging.current = id;
                e.dataTransfer.setData("text/plain", id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => (dragging.current = null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging.current)
                  onChange(moveMetric(overlay, dragging.current, index));
                dragging.current = null;
              }}
              data-metric={id}
            >
              <span aria-hidden="true" className="drag-grip">
                ⠿
              </span>
              <label>
                <input
                  type="checkbox"
                  aria-label={`Show ${metric.label}`}
                  checked={overlay.visible.includes(id)}
                  onChange={(e) =>
                    onChange({
                      visible: e.target.checked
                        ? [...overlay.visible, id]
                        : overlay.visible.filter((item) => item !== id),
                    })
                  }
                />
                {metric.label}
                {!track.metrics.available[id] && <small>Unavailable</small>}
              </label>
              <button
                type="button"
                aria-label={`Move ${metric.label} up`}
                disabled={index === 0}
                onClick={() => onChange(moveMetric(overlay, id, index - 1))}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move ${metric.label} down`}
                disabled={index === overlay.order.length - 1}
                onClick={() => onChange(moveMetric(overlay, id, index + 1))}
              >
                ↓
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
