#!/usr/bin/env tsx
import http from 'node:http';
import process from 'node:process';

const [,, source = 'whoop'] = process.argv;

const examples: Record<string, any> = {
  whoop: {
    id: 'sleep_123',
    start: new Date().toISOString(),
    end: new Date(Date.now() + 7.5 * 60 * 60 * 1000).toISOString(),
    score: {
      strain: 8.4,
      average_heart_rate: 50,
      stage_summary: { rem: 120, deep: 90, light: 240 },
    },
  },
};

if (!examples[source]) {
  console.error(`No example payload available for '${source}'.`);
  process.exit(1);
}

const payload = JSON.stringify(examples[source], null, 2);

console.log(`Example payload for '${source}' webhook:\n`);
console.log(payload);
console.log('\nSend with:');
console.log(`curl -X POST http://localhost:8081/webhooks/${source}/sleep \\\n  -H 'Content-Type: application/json' \\\n  -H 'Authorization: Bearer <auth_token>' \\\n  -H 'x-webhook-signature: <computed_signature>' \\\n  --data '${JSON.stringify(examples[source])}'`);

http.get('http://localhost:8081/health', res => {
  console.log(`\nGateway health check status: ${res.statusCode}`);
}).on('error', err => {
  console.warn('Gateway health check failed:', err.message);
});
