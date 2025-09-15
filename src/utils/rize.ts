import type { AppConfig } from './config.js';

const ENDPOINT = 'https://api.rize.io/api/v1/graphql';

export class RizeClient {
  private token?: string;
  constructor(private config: AppConfig) {
    this.token = config.RIZE_API_KEY;
    if (!this.token) throw new Error('Missing RIZE_API_KEY');
  }

  private async post(body: any) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    } as any);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Rize HTTP ${res.status}: ${txt}`);
    }
    const json = await res.json();
    if (json.errors && json.errors.length) {
      const msg = json.errors.map((e: any) => e.message).join('; ');
      throw new Error(`Rize GraphQL errors: ${msg}`);
    }
    return json;
  }

  async query(query: string, variables?: Record<string, any>) {
    return this.post({ query, variables });
  }

  async introspect(partial = true) {
    // Full introspection can be huge; partial returns type names and fields only
    const FULL = `
      query IntrospectionQuery {
        __schema {
          queryType { name }
          mutationType { name }
          types { name kind fields { name type { name kind ofType { name kind } } } }
        }
      }
    `;
    const PARTIAL = `
      query IntrospectionQuery {
        __schema {
          queryType { name }
          mutationType { name }
          types { name kind }
        }
      }
    `;
    return this.post({ query: partial ? PARTIAL : FULL });
  }
}

