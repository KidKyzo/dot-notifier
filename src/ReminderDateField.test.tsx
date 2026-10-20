import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReminderDateField, finishReminderDateSelection } from "./ReminderDateField";

describe("reminder date selection", () => {
  it("offers Done without submitting the reminder", () => {
    const markup = renderToStaticMarkup(
      <ReminderDateField value="2026-11-12T09:30" selected={false} onChange={() => {}} onDone={() => {}} />,
    );
    expect(markup).toContain('type="datetime-local"');
    expect(markup).toContain('type="button"');
    expect(markup).toContain("Done");
    expect(markup).not.toContain("Date selected. Press Add reminder to save.");

    const selectedMarkup = renderToStaticMarkup(
      <ReminderDateField value="2026-11-12T09:30" selected onChange={() => {}} onDone={() => {}} />,
    );
    expect(selectedMarkup).toContain("Date selected. Press Add reminder to save.");
  });

  it("closes the picker and marks the date selection complete", () => {
    const blur = vi.fn();
    const onDone = vi.fn();
    finishReminderDateSelection({ blur }, onDone);
    expect(blur).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledOnce();
  });
});
