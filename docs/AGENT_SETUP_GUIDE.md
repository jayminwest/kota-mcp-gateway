# Agent Setup Guide

Quick start guide for setting up external agents to communicate with KOTA's task queue.

## Overview

This guide shows how to configure an external project (e.g., KotaDB) to access the KOTA task queue via the isolated `/mcp/agents` endpoint.

---

## Step 1: Generate API Key (Server Side)

On the machine running `kota-mcp-gateway`:

```bash
# Generate a secure API key
openssl rand -hex 32
```

Example output:
```
a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456
```

---

## Step 2: Configure Server (kota-mcp-gateway)

Add the API key to `kota-mcp-gateway/.env`:

```bash
# MCP Authentication
MCP_AGENTS_API_KEY=a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456
```

Restart the server:
```bash
npm start
# or
docker-compose restart
```

Verify the endpoint is protected:
```bash
# Should return 401 Unauthorized
curl http://localhost:8084/mcp/agents

# Should return 401 with invalid key
curl -H "Authorization: Bearer invalid" http://localhost:8084/mcp/agents
```

---

## Step 3: Configure Client (External Project)

### Option A: Claude Desktop Configuration

For Claude Desktop or other MCP clients, create/update the MCP configuration file.

**Location**:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

**Configuration**:
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
        "HTTP_AUTHORIZATION": "Bearer a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456"
      }
    }
  }
}
```

**For Tailscale/Production**:
```json
{
  "mcpServers": {
    "kota-agents": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-http-client",
        "https://jaymins-mac-pro.tail1b7f44.ts.net/mcp/agents"
      ],
      "env": {
        "HTTP_AUTHORIZATION": "Bearer a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456"
      }
    }
  }
}
```

### Option B: Environment Variables (Recommended for Projects)

For projects like KotaDB, add to `.env`:

```bash
# KOTA Agents MCP Configuration
KOTA_AGENTS_API_KEY=a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456
KOTA_AGENTS_MCP_ENDPOINT=http://localhost:8084/mcp/agents
```

Then reference in MCP config:
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

## Step 4: Test Connection

Test the connection from the external project:

### Using cURL

```bash
# Set variables
API_KEY="a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456"
ENDPOINT="http://localhost:8084/mcp/agents"

# Test authentication (should work)
curl -H "Authorization: Bearer $API_KEY" "$ENDPOINT"

# Should return MCP server info
```

### Using Claude Desktop

1. Restart Claude Desktop
2. Start a new conversation
3. Type: "List available task projects"
4. Claude should use the `tasks_list_projects` tool

### Using Python

```python
import os
import requests

api_key = os.getenv('KOTA_AGENTS_API_KEY')
endpoint = os.getenv('KOTA_AGENTS_MCP_ENDPOINT')

headers = {
    'Authorization': f'Bearer {api_key}',
    'Content-Type': 'application/json'
}

# Test connection
response = requests.get(endpoint, headers=headers)
print(f"Status: {response.status_code}")
print(f"Response: {response.json()}")
```

---

## Step 5: Use Task Queue

Once connected, agents can use these tools:

```javascript
// List available projects
tasks_list_projects {}

// List pending tasks
tasks_list {
  "project_id": "kotadb",
  "status": "pending",
  "priority": "high",
  "limit": 10
}

// Create a task
tasks_create {
  "project_id": "kotadb",
  "title": "Implement feature X",
  "description": "Add new functionality...",
  "priority": "high",
  "tags": {
    "source": "external-agent",
    "project": "kotadb"
  }
}

// Get task details
tasks_get {
  "project_id": "kotadb",
  "task_id": "task-abc123"
}

// Update task
tasks_update {
  "project_id": "kotadb",
  "task_id": "task-abc123",
  "priority": "high"
}
```

---

## Security Checklist

- [ ] API key generated with `openssl rand -hex 32`
- [ ] API key added to `kota-mcp-gateway/.env` as `MCP_AGENTS_API_KEY`
- [ ] API key added to external project's `.env` as `KOTA_AGENTS_API_KEY`
- [ ] API key NOT committed to version control (in `.gitignore`)
- [ ] Server restarted after configuration changes
- [ ] Connection tested with valid and invalid keys
- [ ] Endpoint returns 401 for missing/invalid keys
- [ ] Claude Desktop restarted after MCP config changes

---

## Multi-Project Setup

For multiple external projects accessing the same KOTA instance:

### Option 1: Shared API Key (Simple)
All external projects use the same `MCP_AGENTS_API_KEY`. This is simpler but less granular.

### Option 2: Project-Specific Keys (Future Enhancement)
Each project gets its own API key with project-scoped access. Requires additional server configuration.

**Recommended**: Start with Option 1 (shared key) for simplicity.

---

## Troubleshooting

### 401 Unauthorized
- **Symptom**: All requests return 401
- **Solutions**:
  - Verify API key matches between server and client
  - Check for trailing whitespace in `.env` files
  - Ensure `Bearer ` prefix in Authorization header
  - Restart server and client after config changes

### 500 Server Configuration Error
- **Symptom**: Server returns 500 error
- **Solution**: `MCP_AGENTS_API_KEY` not set on server - add to `.env` and restart

### Connection Refused
- **Symptom**: Cannot connect to endpoint
- **Solutions**:
  - Verify server is running: `curl http://localhost:8084/health`
  - Check port 8084 is accessible
  - For Tailscale: verify network connectivity

### No Tools Available
- **Symptom**: MCP client shows no tools
- **Solutions**:
  - Verify connecting to `/mcp/agents` not `/mcp`
  - Check MCP client configuration syntax
  - Review server logs for errors

---

## KotaDB Example

Complete setup for the KotaDB project:

### 1. Generate Key (One Time)
```bash
openssl rand -hex 32
# Output: a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456
```

### 2. Configure kota-mcp-gateway
```bash
# Add to kota-mcp-gateway/.env
MCP_AGENTS_API_KEY=a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456
```

### 3. Configure KotaDB Project
```bash
# Add to kotadb/.env
KOTA_AGENTS_API_KEY=a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456
KOTA_AGENTS_MCP_ENDPOINT=https://jaymins-mac-pro.tail1b7f44.ts.net/mcp/agents
```

### 4. Configure KotaDB MCP Client
```json
// kotadb/.mcp.json or claude_desktop_config.json
{
  "mcpServers": {
    "kota-agents": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-http-client",
        "https://jaymins-mac-pro.tail1b7f44.ts.net/mcp/agents"
      ],
      "env": {
        "HTTP_AUTHORIZATION": "Bearer a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456"
      }
    }
  }
}
```

### 5. Test from KotaDB
```python
# In KotaDB agent code
import os
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

api_key = os.getenv('KOTA_AGENTS_API_KEY')
endpoint = os.getenv('KOTA_AGENTS_MCP_ENDPOINT')

server_params = StdioServerParameters(
    command="npx",
    args=["-y", "@modelcontextprotocol/server-http-client", endpoint],
    env={"HTTP_AUTHORIZATION": f"Bearer {api_key}"}
)

async with stdio_client(server_params) as (read, write):
    async with ClientSession(read, write) as session:
        # List projects
        projects = await session.call_tool("tasks_list_projects", {})
        print(projects)

        # Create a task from KotaDB
        task = await session.call_tool("tasks_create", {
            "project_id": "kotadb",
            "title": "Review PR #123",
            "description": "Code review needed for new feature",
            "priority": "high",
            "tags": {"source": "kotadb-agent"}
        })
        print(task)
```

---

## Related Documentation

- [Agents MCP Endpoint Documentation](AGENTS_MCP_ENDPOINT.md) - Complete technical reference
- [Tasks Handler Documentation](handlers/TASKS.md) - Tool reference
- [KotaDB API Reference](KOTADB_API_REFERENCE.md) - REST API for lifecycle operations
