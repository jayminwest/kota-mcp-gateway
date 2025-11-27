# Agents MCP Endpoint

Isolated MCP server endpoint for external agents to access task queue management.

## Overview

The `/mcp/agents` endpoint provides a secure, isolated MCP server that exposes **only** the Tasks handler. This allows external agents (e.g., agents running in the KotaDB project) to communicate with the central task queue without access to any other KOTA services.

## Security

- **Required Authentication**: Bearer token (API key) required for all requests
- **Isolated Access**: Only Tasks handler tools are available
- **No Cross-Handler Access**: Agents cannot access Gmail, Calendar, Slack, or any other handlers
- **Project-based Isolation**: Each project has its own task queue database

## Configuration

### Server Setup (kota-mcp-gateway)

1. Generate an API key:
```bash
openssl rand -hex 32
```

2. Add to `.env`:
```bash
MCP_AGENTS_API_KEY=your_generated_api_key_here
```

3. Restart the server

### Client Setup (External Project, e.g., KotaDB)

Configure the MCP client to connect to the agents endpoint with authentication.

#### Claude Desktop / MCP Client Config

Add to your MCP configuration file (e.g., `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "kota-agents": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-http-client",
        "http://localhost:8084/mcp/agents"
      ],
      "env": {
        "HTTP_AUTHORIZATION": "Bearer your_generated_api_key_here"
      }
    }
  }
}
```

#### Environment Variables

For projects using `.env`:

```bash
# In your project's .env file
KOTA_AGENTS_API_KEY=your_generated_api_key_here
KOTA_AGENTS_MCP_ENDPOINT=http://localhost:8084/mcp/agents
```

Then configure your MCP client:

```json
{
  "mcpServers": {
    "kota-agents": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-http-client",
        "${KOTA_AGENTS_MCP_ENDPOINT}"
      ],
      "env": {
        "HTTP_AUTHORIZATION": "Bearer ${KOTA_AGENTS_API_KEY}"
      }
    }
  }
}
```

---

## Available Tools

The agents endpoint exposes these tools from the Tasks handler:

### Project Management
- **`tasks_list_projects`** - List available task queue projects

### Task Operations
- **`tasks_list`** - List tasks with filters (project_id, status, priority, limit, offset)
- **`tasks_get`** - Get task by ID (project_id, task_id)
- **`tasks_create`** - Create new task (project_id, title, description, priority?, tags?, worktree?)
- **`tasks_update`** - Update task metadata (project_id, task_id, title?, description?, priority?, tags?, worktree?)
- **`tasks_delete`** - Delete task (project_id, task_id)

For detailed tool documentation, see [`docs/handlers/TASKS.md`](handlers/TASKS.md).

---

## Authentication

All requests to `/mcp/agents` must include a Bearer token:

```
Authorization: Bearer <your_api_key>
```

### Error Responses

**401 Unauthorized**:
```json
{
  "error": "Unauthorized: Invalid or missing API key"
}
```

**500 Server Configuration Error**:
```json
{
  "error": "Server configuration error: API key not configured"
}
```

---

## Example Usage

### Python Example

```python
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
import os

# Configuration
api_key = os.getenv('KOTA_AGENTS_API_KEY')
endpoint = os.getenv('KOTA_AGENTS_MCP_ENDPOINT', 'http://localhost:8084/mcp/agents')

# Create MCP client with authentication
server_params = StdioServerParameters(
    command="npx",
    args=[
        "-y",
        "@modelcontextprotocol/server-http-client",
        endpoint
    ],
    env={
        "HTTP_AUTHORIZATION": f"Bearer {api_key}"
    }
)

async with stdio_client(server_params) as (read, write):
    async with ClientSession(read, write) as session:
        # List projects
        result = await session.call_tool("tasks_list_projects", {})
        print(result)

        # List pending tasks
        result = await session.call_tool("tasks_list", {
            "project_id": "kotadb",
            "status": "pending",
            "limit": 10
        })
        print(result)

        # Create a task
        result = await session.call_tool("tasks_create", {
            "project_id": "kotadb",
            "title": "Example task from external agent",
            "description": "This task was created by an external agent",
            "priority": "medium",
            "tags": {
                "source": "external-agent",
                "project": "example"
            }
        })
        print(result)
```

### Node.js/TypeScript Example

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const apiKey = process.env.KOTA_AGENTS_API_KEY;
const endpoint = process.env.KOTA_AGENTS_MCP_ENDPOINT || 'http://localhost:8084/mcp/agents';

const transport = new StdioClientTransport({
  command: 'npx',
  args: [
    '-y',
    '@modelcontextprotocol/server-http-client',
    endpoint
  ],
  env: {
    HTTP_AUTHORIZATION: `Bearer ${apiKey}`
  }
});

const client = new Client({
  name: 'example-agent',
  version: '1.0.0',
}, {
  capabilities: {}
});

await client.connect(transport);

// List projects
const projects = await client.callTool({
  name: 'tasks_list_projects',
  arguments: {}
});

// List pending tasks
const tasks = await client.callTool({
  name: 'tasks_list',
  arguments: {
    project_id: 'kotadb',
    status: 'pending',
    limit: 10
  }
});

// Create a task
const newTask = await client.callTool({
  name: 'tasks_create',
  arguments: {
    project_id: 'kotadb',
    title: 'Example task from external agent',
    description: 'This task was created by an external agent',
    priority: 'medium',
    tags: {
      source: 'external-agent',
      project: 'example'
    }
  }
});

await client.close();
```

---

## Deployment Considerations

### Production Deployment

1. **Use HTTPS**: In production, ensure the endpoint is served over HTTPS
   ```
   https://your-server.com/mcp/agents
   ```

2. **Secure API Key Storage**: Store the API key securely (e.g., in a secrets manager, not in version control)

3. **Network Security**: Consider restricting access to the `/mcp/agents` endpoint via:
   - IP whitelisting
   - VPN/Tailscale network isolation
   - Firewall rules

4. **Rate Limiting**: The Tasks API has rate limiting (100 req/min per IP). Monitor usage for external agents.

### Tailscale Network

If using Tailscale (as in the KotaDB setup):

```bash
# Use the Tailscale hostname
KOTA_AGENTS_MCP_ENDPOINT=https://jaymins-mac-pro.tail1b7f44.ts.net/mcp/agents
```

---

## Monitoring

Server logs include agent activity:

```json
{
  "tool": "tasks_create",
  "args": { "project_id": "kotadb", "title": "..." },
  "endpoint": "agents",
  "sessionId": "..."
}
```

Search for `endpoint: 'agents'` to filter agent-specific requests.

---

## Security Best Practices

1. **Rotate API Keys**: Periodically generate new API keys and update client configurations
2. **Monitor Access**: Review logs for suspicious activity
3. **Project Isolation**: Each project has its own task queue - agents can only access queues they know about
4. **Least Privilege**: Agents only have access to task operations, not other KOTA services
5. **Audit Trail**: All task operations are logged with timestamps and actor information

---

## Differences from Main MCP Endpoint

| Feature | `/mcp` (Main) | `/mcp/agents` (Agents) |
|---------|---------------|------------------------|
| **Authentication** | Optional (MCP_AUTH_TOKEN) | Required (MCP_AGENTS_API_KEY) |
| **Available Handlers** | All handlers (Gmail, Calendar, Slack, Tasks, etc.) | Tasks only |
| **Use Case** | Local KOTA services | External agent communication |
| **Help Resources** | Full help system | Tasks-specific only |
| **Prompts** | All prompts available | None |

---

## Troubleshooting

### Connection Refused
- Verify server is running: `curl http://localhost:8084/health`
- Check endpoint is accessible: `curl http://localhost:8084/mcp/agents` (should return 401)

### 401 Unauthorized
- Verify API key matches between server `.env` and client config
- Ensure Authorization header format: `Bearer <key>` (note the space)
- Check for trailing whitespace in API key

### 500 Server Configuration Error
- Server-side: `MCP_AGENTS_API_KEY` not set in `.env`
- Generate key: `openssl rand -hex 32`
- Add to `.env` and restart server

### No Tools Available
- Verify you're connecting to `/mcp/agents` not `/mcp`
- Check MCP client configuration

---

## Related Documentation

- [Tasks Handler Documentation](handlers/TASKS.md) - Detailed tool reference
- [KotaDB API Reference](KOTADB_API_REFERENCE.md) - REST API for lifecycle operations
- [Home Server API](HOME_SERVER_API.md) - Full API documentation
