# MCP Tools Guide

This guide reflects the current minimal built-in MCP surface.

## Tool Call Format

```text
TOOL:tool_name{"param":"value"}
```

## Registration Policy

Built-ins are now focused on durable primitives:
- core agent orchestration
- file and workflow operations
- one default web search path
- one generic URL fetcher
- one terminal command tool

Convenience wrappers (weather, clipboard, HTML extraction/search wrappers, Python wrapper, public IP wrapper, etc.) are moved to skills.

## Search Policy

- Default built-in path: `search_web_bing` + `fetch_url`
- Optional plugin path: SearXNG plugin tools (when plugin/server is enabled)
- Fallback: if SearXNG path is unavailable, continue with Bing path

## Built-In Tool Inventory (40)

### System
- `current_time`
- `calculate`
- `get_stats`
- `get_current_provider`
- `end_answer`

### Agent / Prompt / Rules
- `conversation_history`
- `search_conversations`
- `subagent`
- `automemory`
- `get_system_prompt`
- `list_active_rules`
- `toggle_rule`
- `list_rules`
- `manage_rule`
- `modify_system_prompt`
- `create_tool`

### Web
- `search_web_bing`
- `fetch_url`

### Files
- `read_file`
- `write_file`
- `edit_file`
- `list_directory`
- `file_exists`
- `delete_file`

### Terminal / Workspace
- `run_command`
- `list_workspace`
- `search_workspace`

### Calendar / Todo / Workflow / Research
- `calendar_op`
- `todo_op`
- `timer`
- `workflow_op`
- `research_op`

### Media
- `get_image_info`
- `open_media`
- `play_audio`
- `view_image`
- `screenshot`

### Connectors
- `connector_op`

## Skill-Only Convenience Replacements

Use [lightweight-tool-replacements.md](../../agentin/skills/lightweight-tool-replacements.md) for:
- weather checks
- instant entity lookup patterns
- public IP checks
- HTML extraction/search wrappers
- clipboard read/write helpers
- memory/disk diagnostics wrappers
- Python wrapper behavior via `run_command`

## Source of Truth

- Runtime registration: [mcp-server.js](../../src/main/mcp-server.js)
- Tool registrars: `src/main/mcp/register-*.js`
- Capability policy: [tool-classification.json](../../src/main/tool-classification.json)
- Grouping/UI policy: [tool-groups.json](../../src/main/tool-groups.json)
- Contract fixture: [mcp-tool-inventory.json](../../tests/fixtures/mcp-tool-inventory.json)
