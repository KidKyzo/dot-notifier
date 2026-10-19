# Color palette

The palette is designed for the three ambient category dots. Status color is
communicated with both color and shape or text so the state remains legible
without relying on color alone.

| Token | Hex | Use |
| --- | --- | --- |
| `status-idle` | `#8792A2` | Idle category dot |
| `status-running` | `#5799F7` | Active AI task |
| `status-done` | `#38B987` | Completed task |
| `status-error` | `#E05A64` | Failed task or critical condition |
| `status-needs-input` | `#E6A23C` | Task waiting for user input or permission |
| `status-warning` | `#E6B84A` | System threshold warning |
| `surface` | `#171B22` | Expanded panel surface |
| `surface-raised` | `#222833` | Raised cards and controls |
| `text-primary` | `#F4F6F8` | Primary text on dark surfaces |
| `text-muted` | `#A5AFBD` | Secondary text on dark surfaces |
| `music-accent` | `#F236B5` | Equalizer bars and unread count accent sampled from the user-provided pill reference |

Idle dots use reduced opacity; active status colors use full opacity. Do not use
these values to infer alert priority: queue priority is defined in the event
logic and places `error` and `needs_input` first.
