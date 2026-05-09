# MCP Server Setup

## Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "browser": {
      "command": "/path/to/my-agent-browser/scripts/start-mcp.sh"
    }
  }
}
```

Replace `/path/to/my-agent-browser` with the actual install path.

## Cursor

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "browser": {
      "command": "/path/to/my-agent-browser/scripts/start-mcp.sh"
    }
  }
}
```

## Direct npx (no wrapper)

If you don't need config file management, configure directly:

```json
{
  "mcpServers": {
    "browser": {
      "command": "npx",
      "args": [
        "-y", "chrome-devtools-mcp@latest",
        "--browserUrl", "http://127.0.0.1:19333"
      ]
    }
  }
}
```

Note: this requires Chrome to be already running on port 19333.

## Let chrome-devtools-mcp manage Chrome

If you want the MCP server to launch and manage Chrome itself:

```json
{
  "mcpServers": {
    "browser": {
      "command": "npx",
      "args": [
        "-y", "chrome-devtools-mcp@latest",
        "--headless",
        "--userDataDir", "/home/you/.my-agent-browser/profiles/default/user-data",
        "--proxyServer", "http://127.0.0.1:3067",
        "--chromeArg", "--disable-blink-features=AutomationControlled"
      ]
    }
  }
}
```

This is simpler but Chrome dies when the MCP server stops (session ends).
