import http from 'node:http';

const url = process.env.HEALTH_URL || 'http://localhost:3000/health';

const req = http.get(url, (res) => {
  if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
    process.exit(0);
  } else {
    process.exit(1);
  }
});

req.on('error', () => process.exit(1));

