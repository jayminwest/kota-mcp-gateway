import http from 'node:http';

const defaultPort = process.env.PORT || '8084';
const healthPath = process.env.HEALTH_PATH || '/health';
const url = process.env.HEALTH_URL || `http://localhost:${defaultPort}${healthPath.startsWith('/') ? healthPath : `/${healthPath}`}`;

const req = http.get(url, (res) => {
  if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
    process.exit(0);
  } else {
    process.exit(1);
  }
});

req.on('error', () => process.exit(1));
