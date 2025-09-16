/* eslint-env node */
/* global console */
import { URL } from 'node:url';
import localtunnel from 'localtunnel';

const port = Number(process.env.PORT ?? 8081);
const subdomain = process.env.SLACK_TUNNEL_SUBDOMAIN || undefined;

console.log(`Opening Slack tunnel on port ${port}...`);

let tunnel;
try {
  tunnel = await localtunnel({ port, subdomain });
} catch (err) {
  console.error('Failed to create tunnel:', err);
  process.exit(1);
}

const callbackPath = process.env.SLACK_REDIRECT_PATH || '/auth/slack/callback';
const callbackUrl = new URL(callbackPath, tunnel.url).toString();

console.log('Slack tunnel ready');
console.log(`  Local port: ${port}`);
console.log(`  Public base: ${tunnel.url}`);
console.log(`  OAuth redirect URL: ${callbackUrl}`);
console.log('Keep this process running while completing Slack OAuth.');

const cleanup = async () => {
  console.log('\nClosing tunnel');
  await tunnel.close();
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
