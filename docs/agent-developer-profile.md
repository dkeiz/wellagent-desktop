# Agent Developer Profile

`Developer Profile` is a per-agent permission preset in LocalAgent.

It exists for cases where one agent needs broad working access for coding, automation, debugging, or system integration, without opening those permissions for every other agent.

## What It Does

When enabled for an agent, `Developer Profile` turns on:

- main permissions
- `files` mode = `full`
- `unsafe` tools
- `web` tools
- `terminal` tools
- `ports` tools
- `visual` tools

In practice, this is the fast way to make one agent behave like a developer-capable worker.

## Where To Find It

1. Open the agent editor.
2. Edit an existing agent.
3. Go to `Agent Permissions`.
4. Click `Enable Developer Profile`.

When active, the button changes to `Disable Developer Profile`.

## What It Affects

The profile is scoped to one agent only.

It does:

- change that agent's permission profile
- allow that agent to use higher-trust tools

It does not:

- change global tool permissions for the whole app
- expose the app over A2A
- add API keys or connector credentials
- affect other agents automatically

## How To Turn It Off

You can turn it off in two ways:

- click `Disable Developer Profile`
- click `Reset To Global`

Both remove the preset and return the agent to the current global permission baseline.

## Important Behavior

Disabling the profile does not restore some previous custom mix of toggles.

It resets the agent back to global defaults.

That means:

- use the preset when you want a quick broad-access setup
- use manual permission editing when you want a long-term custom setup

## Manual Edits While Active

If you manually change:

- a permission checkbox
- files mode
- a per-tool override

while `Developer Profile` is active, the agent leaves preset mode and becomes a normal custom permission profile.

This is intentional. The preset is a shortcut, not a second parallel permission system.

## Good Use Cases

- coding agents
- file manager agents
- integration agents
- debugging agents
- temporary automation sessions

## Use With Care

This profile enables high-trust capabilities.

That includes:

- file writes and deletes
- shell access
- unsafe tool access
- connector and port operations

Use it when the agent genuinely needs developer-level access, and turn it off when the task is done.
