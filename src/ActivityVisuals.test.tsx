import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityCountdown, ActivityDial } from "./ActivityVisuals";

describe("activity visuals", () => {
  it.each([[0, 100], [0.25, 75], [1, 0], [-1, 100], [2, 0], [Number.NaN, 100]])(
    "renders bounded progress for %s",
    (progress, offset) => {
      const markup = renderToStaticMarkup(<ActivityDial progress={progress} />);
      expect(markup).toContain(`stroke-dashoffset="${offset}"`);
      expect(markup).toContain('aria-hidden="true"');
    },
  );

  it("keeps paused, reminder and completion states available to styling", () => {
    expect(renderToStaticMarkup(<ActivityDial progress={0.4} paused />)).toContain('data-paused="true"');
    expect(renderToStaticMarkup(<ActivityDial progress={0.4} kind="reminder" />)).toContain('data-kind="reminder"');
    expect(renderToStaticMarkup(<ActivityDial progress={1} complete />)).toContain('data-complete="true"');
  });

  it.each([[0, "0:00"], [65_000, "1:05"], [3_600_000, "1:00:00"]])(
    "keeps the full countdown accessible at %s ms",
    (milliseconds, label) => {
      const markup = renderToStaticMarkup(<ActivityCountdown milliseconds={milliseconds} />);
      expect(markup).toContain(`aria-label="${label}"`);
      expect(markup).toContain('aria-hidden="true"');
      expect(markup.match(/class="countdown-digit"/g)).toHaveLength(label.replace(/:/g, "").length);
    },
  );
});
