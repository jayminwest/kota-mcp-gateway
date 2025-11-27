#!/usr/bin/env tsx
/**
 * Test script for KOTA entry point functionality
 * Tests discovery, invocation, and context loading
 */

import { McpClient } from '@modelcontextprotocol/sdk/client/mcp.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP_URL = 'http://localhost:8084/mcp';

async function testKotaEntryPoint() {
  console.log('🚀 Starting KOTA Entry Point Tests\n');

  // Create MCP client
  const transport = new StreamableHTTPClientTransport({
    url: MCP_URL,
    enableJsonResponse: true,
  });

  const client = new McpClient({
    name: 'kota-test-client',
    version: '1.0.0',
  });

  try {
    await client.connect(transport);
    console.log('✅ Connected to MCP server\n');

    // Test 1: Discovery
    console.log('📋 Test 1: Discovery (kota_discover)');
    console.log('Calling: kota_discover({ query: "memory" })');

    const discoverResult = await client.callTool('kota_discover', {
      query: 'memory',
    });

    const discoverData = JSON.parse(discoverResult.content[0].text as string);
    console.log('Result:', JSON.stringify(discoverData, null, 2));
    console.log(`✅ Found ${discoverData.bundles?.length || 0} bundles matching "memory"\n`);

    // Test 2: Invocation
    console.log('🔧 Test 2: Invocation (kota_invoke)');
    console.log('Calling: kota_invoke({ bundle: "memory", action: "list" })');

    const invokeResult = await client.callTool('kota_invoke', {
      bundle: 'memory',
      action: 'list',
      args: {},
    });

    const invokeData = JSON.parse(invokeResult.content[0].text as string);
    console.log('Result keys:', Object.keys(invokeData));
    console.log(`✅ Successfully invoked memory.list\n`);

    // Test 3: Context Loading
    console.log('🌐 Test 3: Context Loading (kota_context)');
    console.log('Calling: kota_context({ context: "startup" })');

    const contextResult = await client.callTool('kota_context', {
      context: 'startup',
    });

    const contextData = JSON.parse(contextResult.content[0].text as string);
    console.log('Context name:', contextData.context_name);
    console.log('Loaded at:', contextData.loaded_at);
    console.log('Data keys:', Object.keys(contextData.data || {}));
    console.log('Next steps:', contextData.next_steps);
    console.log(`✅ Successfully loaded startup context\n`);

    // Test 4: Discovery - list all
    console.log('📋 Test 4: Discovery - List All');
    console.log('Calling: kota_discover({})');

    const allBundlesResult = await client.callTool('kota_discover', {});
    const allBundlesData = JSON.parse(allBundlesResult.content[0].text as string);
    console.log(`Total bundles: ${allBundlesData.total}`);
    console.log(`Tool bundles: ${allBundlesData.bundles?.filter((b: any) => b.category === 'tool').length || 0}`);
    console.log(`Context bundles: ${allBundlesData.bundles?.filter((b: any) => b.category === 'context').length || 0}`);
    console.log('✅ Successfully listed all bundles\n');

    console.log('🎉 All tests passed!');

    await client.close();
  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response:', error.response);
    }
    process.exit(1);
  }
}

// Run tests
testKotaEntryPoint();
