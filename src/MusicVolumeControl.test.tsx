import { describe, expect, it, vi } from "vitest";
import type { ChangeEvent, MouseEvent } from "react";
import { MusicVolumeControl } from "./MusicVolumeControl";

describe("music volume control", () => {
  it("keeps the panel open when the slider is clicked and still changes volume", () => {
    const changeVolume = vi.fn();
    const control = MusicVolumeControl({ volume: 64, onChange: changeVolume });
    const click = { stopPropagation: vi.fn() } as unknown as MouseEvent<HTMLElement>;
    control.props.onClick(click);

    expect(click.stopPropagation).toHaveBeenCalledOnce();

    const slider = control.props.children[1];
    slider.props.onChange({ currentTarget: { value: "75" } } as ChangeEvent<HTMLInputElement>);
    expect(changeVolume).toHaveBeenCalledWith(75);
  });
});
