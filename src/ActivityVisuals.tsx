import { formatCountdown } from "./core/reminder-timer";

type ActivityDialProps = {
  progress: number;
  kind?: "timer" | "reminder";
  paused?: boolean;
  complete?: boolean;
};

export function ActivityDial({ progress, kind = "timer", paused = false, complete = false }: ActivityDialProps) {
  const value = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  return (
    <svg aria-hidden="true" className="activity-dial" data-kind={kind} data-paused={paused || undefined} data-complete={complete || undefined} viewBox="0 0 36 36">
      <circle className="activity-dial-track" cx="18" cy="18" r="15" />
      <circle className="activity-dial-progress" cx="18" cy="18" r="15" pathLength="100" strokeDasharray="100" strokeDashoffset={100 * (1 - value)} />
      <g className="activity-dial-symbol" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {complete ? <path d="m12 18 4 4 8-8" />
          : paused ? <path d="M15 13v10m6-10v10" />
            : kind === "reminder" ? <path d="M12 22h12l-2-3v-3a4 4 0 0 0-8 0v3zm4 3h4M18 10v2" />
              : <><path d="M18 12v6l3 2M15 9h6" /><circle cx="18" cy="19" r="7" /></>}
      </g>
    </svg>
  );
}

export function ActivityCountdown({ milliseconds }: { milliseconds: number }) {
  const label = formatCountdown(milliseconds);
  return (
    <span className="activity-countdown" aria-label={label}>
      <span aria-hidden="true" className="activity-countdown-digits">
        {Array.from(label, (character, index) => (
          <span className={character === ":" ? "countdown-separator" : "countdown-digit"} key={label.length - index}>
            <span key={character}>{character}</span>
          </span>
        ))}
      </span>
    </span>
  );
}
