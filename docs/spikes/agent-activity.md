# Agent activity metadata spike (F30)

Date: 2026-10-19

## Checks

- `codex --version` reported `codex-cli 0.162.1`. Grouped metadata from the latest local rollout: `response_item` records include `function_call` and `custom_tool_call` with tool names, plus `reasoning` and `message`. Only record types, roles, and tool names were inspected; arguments and message text were not copied.
- `agy --version` reported `1.3.5`. Grouped record types and tool names from the latest local IDE transcript. It contains `RUN_COMMAND`, `VIEW_FILE`, `GREP_SEARCH`, `CODE_ACTION`, `LIST_DIRECTORY`, and `PLANNER_RESPONSE` with tool names such as `run_command`, `view_file`, `replace_file_content`, `grep_search`, and `list_dir`. Only metadata was inspected.

## Result

The existing task `title` can carry a fixed activity category without changing the event schema. Codex tool calls and Antigravity step types can update a running task; unknown tools use a generic category. No file paths, commands, prompts, responses, or tool arguments need to be emitted. Live behavior after enabling an integration still needs a manual check.
