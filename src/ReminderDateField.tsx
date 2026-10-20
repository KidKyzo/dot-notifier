import { useRef } from "react";
import { settingsCopy } from "./core/settings-copy";

export function finishReminderDateSelection(input: Pick<HTMLInputElement, "blur"> | null, onDone: () => void) {
  input?.blur();
  onDone();
}

export function ReminderDateField({ value, selected, onChange, onDone }: {
  value: string;
  selected: boolean;
  onChange: (value: string) => void;
  onDone: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="reminder-date-field">
      <label htmlFor="reminder-date-time">{settingsCopy.reminderDateTime}</label>
      <div className="reminder-date-input-row">
        <input
          id="reminder-date-time"
          onChange={(event) => onChange(event.currentTarget.value)}
          ref={inputRef}
          type="datetime-local"
          value={value}
        />
        <button onClick={() => finishReminderDateSelection(inputRef.current, onDone)} type="button">
          {settingsCopy.done}
        </button>
      </div>
      {selected && value && <small className="reminder-date-hint">{settingsCopy.reminderDateSelected}</small>}
    </div>
  );
}
