# Personal Reminder Hub — Product Requirements Document

Status: proposal · 10 October 2026 · Companion plan: [DEV-PLAN.md](DEV-PLAN.md)

## 1. Product summary

Personal Reminder Hub lets one person create reminders for anything they need to do, see the same active reminders on desktop and mobile, and receive alerts through channels they choose. A reminder can be one-off or repeat hourly, daily, weekly, or monthly. Completing an occurrence clears it from the active view on every device. Categories such as Health, Finance, Shopping, Work, and Study help people organize their reminders; all categories are editable.

The [Smart Daily Task Reminder reference project](https://github.com/mayowa-id/smart-daily-task-reminder) demonstrates scheduled water/stretch prompts, configurable sleep hours, and delivery through email, Telegram, and Twilio WhatsApp. This proposal extends that idea to arbitrary reminders, recurrence, categories, completion, and account-based sync. It is a separate product proposal. The current [Dot Notifier PRD](../PRD.md) is Windows-only and excludes cloud sync/accounts in v1; integrating its overlay would require a separate approved scope change. No reference code is assumed reusable without a license review.

## 2. Problem, users, and outcome

People currently scatter personal commitments across alarms, calendars, chats, and notes. Repeating alerts often pile up after an activity is finished, and a completion on one device may not be reflected on another.

Primary users are individuals managing habits and obligations across a phone and desktop. Examples include a student planning study sessions, a worker managing recurring admin tasks, and someone tracking household or finance reminders. This is a personal tool, not a shared task manager or medical adherence system.

**Outcome:** a user can create a reminder in under one minute, receive it at the intended local time, and clear the current item everywhere with one action.

## 3. Scope and release strategy

| Release | Included | Deferred |
| --- | --- | --- |
| MVP | Account, responsive desktop/mobile web app, one-off and recurring schedules, editable categories, active/upcoming/history views, Done/Skip/Snooze, cross-device sync, in-app alerts, verified email delivery, quiet hours | Dedicated native desktop/mobile apps, WhatsApp, Telegram, shared reminders, AI suggestions |
| V1 | Android/iOS app with push, delivery preferences per reminder, offline read and queued actions, accessibility and reliability hardening | Calendar import, location triggers |
| V1.1 | Optional WhatsApp and/or Telegram connector after opt-in, provider approval, cost, and product review | Open-ended third-party automations |

The responsive web app works on desktop and mobile from MVP. Native mobile push is a V1 milestone because browser notification behavior varies by platform and install state. Windows overlay integration can be considered separately after V1; the reminder product must work without Dot Notifier.

## 4. Core user journeys

1. **Create:** Sign in, enter title, optional note and category, choose date/time or repeat rule, choose timezone and alert channels, preview the next three occurrences, save.
2. **Act:** See due reminders in an active inbox, open one, then choose **Done**, **Snooze**, or **Skip**. Done records completion and removes the active occurrence from every device. Skip records a missed/declined occurrence; it does not complete the work.
3. **Review:** Filter by category or date, inspect upcoming reminders and limited completion history, edit or pause a series, and undo an accidental Done from history.
4. **Personalize:** Rename/recolor categories, set quiet hours and channel preferences, verify contact methods, and disable a channel at any time.

## 5. Functional requirements

| ID | Priority | Requirement and acceptance criteria |
| --- | --- | --- |
| R1 | P0 | Users can create, edit, pause, resume, and archive a reminder with title, optional note, category, schedule, timezone, and enabled delivery channels. Invalid or past one-off dates are rejected with a useful message. |
| R2 | P0 | Support one-off date/time; every N hours within selected active hours; daily at a local time; weekly on selected weekdays; and monthly on a day number or last day. The editor previews the next three occurrences before save. |
| R3 | P0 | Provide built-in starter categories Health, Finance, Shopping, Work, Study, and Personal. Users can add, rename, recolor, reorder, and archive categories. Archiving a category moves its reminders to Personal after user confirmation. |
| R4 | P0 | One account owns its reminders. Changes to reminders and occurrence status appear on another signed-in device after sync, without duplicate active items. The server is authoritative and rejects access to another account's data. |
| R5 | P0 | Due occurrences appear in an active inbox and can be marked Done, Snoozed, or Skipped. Done clears the active occurrence across devices and cancels unsent deliveries. One-off reminders become archived; recurring series keep their next occurrence. |
| R6 | P0 | A recurring series shows at most one unresolved active occurrence. When the next occurrence becomes due, the old one is recorded as missed and the new one replaces it. Missed items remain searchable in history instead of stacking in the inbox. |
| R7 | P0 | Users can view Today, Upcoming, Active, and History, and filter by category. History stores occurrence status and completion time; it does not create a new active item. |
| R8 | P0 | In-app alerts and verified email are available. The user can opt into email per reminder; delivery honors quiet hours, user-level channel settings, and per-reminder settings. Account and reminder emails contain no promotional content. |
| R9 | P0 | A delivery attempt uses a stable key for user, occurrence, channel, and attempt purpose. Retries cannot create a second logical alert; provider failures are visible in internal delivery status without exposing secrets. |
| R10 | P1 | Android/iOS apps receive push alerts when permission is granted. Opening an alert reads current server state, so a completed occurrence cannot be completed again from a stale notification. |
| R11 | P1 | A device may show cached reminders while offline and queue Done/Snooze/Skip actions. On reconnect, server version checks resolve conflicts and the app explains any rejected stale action. |
| R12 | P2 | Optional WhatsApp and Telegram channels require explicit opt-in, verified destination, easy disable/opt-out, and a per-channel delivery budget. No unofficial WhatsApp client, web scraping, or chat UI automation. |
| R13 | P0 | Users can export their reminder definitions and history, delete their account and data, and review active sessions. Account deletion is separate from Done/Archive. |

### Scheduling and completion rules

- Store the recurrence rule and its named IANA timezone. Show times in the user's chosen timezone and label it in the editor. A phone changing timezone does not silently move an existing reminder; the user can edit its timezone.
- Recurrence means local wall-clock time. During a daylight-saving gap, use the first valid local time after the gap; during a repeated hour, fire once. Monthly day 29–31 defaults to the last day in shorter months and the preview makes that visible.
- Quiet hours suppress delivery, not the occurrence. If a due time falls inside quiet hours, send at the first allowed time if the occurrence is still active. If it was completed or superseded, do not send it.
- Snooze applies only to the current occurrence, with presets of 10 minutes, 1 hour, or a chosen time before the next occurrence. It does not change the series schedule. Skip closes the occurrence and waits for the next one.
- An email/WhatsApp message already accepted by a provider cannot be recalled. Its action link must open the current occurrence state and clearly show if it is already Done, Skipped, or superseded.
- A Done action is idempotent: repeating it from any device returns the same completed occurrence. Editing a recurring series affects future occurrences; the current active occurrence is left intact unless the user explicitly applies the edit to it.

## 6. Experience and content requirements

- Creation is a short form with a human-readable schedule preview, for example “Every day at 08:00 in Asia/Makassar.” Advanced settings stay optional.
- Active reminders show title, category, due time, and one prominent Done action. Snooze and Skip remain available but visually secondary.
- Show a successful completion immediately, then reconcile with the server. An Undo action is available from the confirmation and History for a limited window; undoing a recurring occurrence cannot resurrect it after the next one is due.
- Notifications use a short title, due time, and deep link; notes are excluded from lock-screen push by default. User-facing wording must be accessible and localizable.
- The UI meets WCAG 2.2 AA targets for contrast, keyboard use, focus, and screen-reader labels. Do not rely only on category color.

## 7. Data and system boundaries

Core entities: `User`, `Device`, `Category`, `ReminderSeries`, `Occurrence`, `DeliveryPreference`, and `DeliveryAttempt`. Each occurrence has a stable ID, due timestamp, status (`scheduled`, `active`, `done`, `skipped`, `missed`), version, and optional completion timestamp. `DeliveryAttempt` records channel/status/provider reference, not full message bodies. Category and reminder ownership is scoped to one user.

The backend is the source of truth for scheduling and completion. A durable scheduler materializes a bounded window of upcoming occurrences; a worker sends eligible notifications. Clients sync definitions and status through authenticated APIs and receive a change signal or poll when open. Authorization, server-side validation, idempotent updates, retry policy, and audit-safe error handling are required. Provider credentials remain server-side.

Store only the personal data needed for the service. Encrypt transport and provider secrets, avoid logging reminder notes and contact details, and provide export/deletion. Email and phone/WhatsApp destinations are used only for the channels the user enables. No analytics, advertising, or contact import is in scope.

## 8. Success criteria and quality bars

| Measure | MVP/V1 target |
| --- | --- |
| Basic reminder creation | Median under 60 seconds in usability test with five target users |
| Scheduling correctness | Automated tests cover hourly/daily/weekly/monthly, month-end, timezone and DST cases; zero known duplicate logical occurrences |
| Cross-device status | 95% of online sync updates visible on a second open client within 5 seconds in staging test |
| Due-to-in-app alert | 95% within 60 seconds while a client is online; provider delivery is measured separately and is best effort |
| Active inbox | At most one active occurrence per recurring series; Done removes it from both online clients after sync |
| Reliability | No duplicate logical send after worker retry or restart; failures are recoverable and observable without storing message content in logs |

## 9. Risks, dependencies, and open decisions

| Risk/decision | Planned treatment |
| --- | --- |
| WhatsApp eligibility, templates, and cost | Keep optional until business sender setup, user opt-in, approved templates, pricing, and delivery limits are validated. [Twilio's WhatsApp guidance](https://www.twilio.com/docs/whatsapp/api) requires opt-in and preapproved templates for business-initiated notifications. |
| Mobile push availability | V1 native apps use a supported push provider with a trusted server. Permission denial leaves in-app/email available. [FCM overview](https://firebase.google.com/docs/cloud-messaging) describes the server and device roles. |
| Hourly alerts becoming noisy | Default to in-app only for new hourly reminders; show volume estimate and encourage active hours/quiet hours. Channel frequency limits are configurable. |
| Reference repository licensing | Inspect its license and code before considering reuse. Product behavior described in its README is used as inspiration only. |
| Platform scope | Proposed desktop access is a responsive web app; proposed native mobile platforms are Android and iOS. Confirm whether a native Windows client is a release requirement. |
| Communication channels | Confirm whether email, Telegram, or WhatsApp is the first external channel users value after in-app/push. |

## 10. Explicit non-goals

No shared/team reminders, chat reply handling, AI-generated schedules, medical advice, automatic financial transactions, location triggers, calendar replacement, or scraping/automating WhatsApp or other apps. No direct integration with the existing Dot Notifier event bus or overlay is included in this proposal.
