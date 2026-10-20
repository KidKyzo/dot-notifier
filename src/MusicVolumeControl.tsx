import type { CSSProperties } from "react";
import { settingsCopy } from "./core/settings-copy";

export function MusicVolumeControl({ volume, onChange }: {
  volume: number | null;
  onChange: (volume: number) => void;
}) {
  return (
    <section aria-label={settingsCopy.musicVolume} className="music-volume-control" onClick={(event) => event.stopPropagation()}>
      <div className="music-volume-heading">
        <label htmlFor="music-session-volume">{settingsCopy.musicVolume}</label>
        <span>{volume === null ? settingsCopy.musicVolumeUnavailable : `${volume}%`}</span>
      </div>
      <input
        aria-valuetext={volume === null ? settingsCopy.musicVolumeUnavailable : `${volume}%`}
        disabled={volume === null}
        id="music-session-volume"
        max="100"
        min="0"
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        style={{ "--music-volume": `${volume ?? 0}%` } as CSSProperties}
        type="range"
        value={volume ?? 0}
      />
    </section>
  );
}
