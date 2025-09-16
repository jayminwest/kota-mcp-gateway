import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from './config.js';

type KasaToken = { token: string; terminalUUID: string };

const CLOUD_URL = 'https://wap.tplinkcloud.com';

function kasaHeaders() {
  return {
    'Content-Type': 'application/json',
  } as Record<string, string>;
}

function tokensPath(config: AppConfig) {
  const dir = path.resolve(config.DATA_DIR, 'kasa');
  return { dir, file: path.join(dir, 'tokens.json') };
}

async function ensureDir(p: string) { await fs.mkdir(p, { recursive: true }); }

export async function loadKasaToken(config: AppConfig): Promise<KasaToken | null> {
  const { file } = tokensPath(config);
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}

export async function saveKasaToken(config: AppConfig, token: KasaToken) {
  const { dir, file } = tokensPath(config);
  await ensureDir(dir);
  await fs.writeFile(file, JSON.stringify(token, null, 2), 'utf8');
}

export class KasaCloudClient {
  private username?: string;
  private password?: string;
  private token?: string;
  private terminalUUID?: string;
  constructor(private config: AppConfig) {
    this.username = config.KASA_USERNAME;
    this.password = config.KASA_PASSWORD;
  }

  private async login(): Promise<void> {
    if (!this.username || !this.password) throw new Error('Missing KASA_USERNAME/KASA_PASSWORD');
    const saved = await loadKasaToken(this.config);
    const uuid = saved?.terminalUUID || randomUUID();

    const makeBodies = () => [
      {
        method: 'login',
        params: {
          appType: 'Kasa_Android',
          cloudUserName: this.username,
          cloudPassword: this.password,
          terminalUUID: uuid,
        },
      },
      {
        method: 'login',
        params: {
          appType: 'Kasa_Android',
          appVersion: '3.0.0',
          locale: 'en_US',
          clientType: 'android',
          cloudUserName: this.username,
          cloudPassword: this.password,
          terminalUUID: uuid,
        },
      },
      {
        method: 'login',
        params: {
          appType: 'Kasa_iOS',
          appVersion: '3.0.0',
          locale: 'en_US',
          clientType: 'ios',
          cloudUserName: this.username,
          cloudPassword: this.password,
          terminalUUID: uuid,
        },
      },
    ];

    let lastErr: any = null;
    for (const body of makeBodies()) {
      const res = await fetch(CLOUD_URL, { method: 'POST', headers: kasaHeaders(), body: JSON.stringify(body) } as any);
      if (!res.ok) { lastErr = new Error(`Kasa login HTTP ${res.status}`); continue; }
      const json = await res.json();
      if (json.error_code && json.error_code !== 0) { lastErr = new Error(`Kasa login error: ${json.msg || json.error_code}`); continue; }
      const token = json.result?.token as string | undefined;
      if (!token) { lastErr = new Error('Kasa login failed: no token'); continue; }
      this.token = token;
      this.terminalUUID = uuid;
      await saveKasaToken(this.config, { token, terminalUUID: uuid });
      return;
    }
    throw lastErr || new Error('Kasa login failed');
  }

  private async ensureToken() {
    if (this.token) return;
    const saved = await loadKasaToken(this.config);
    if (saved?.token) {
      this.token = saved.token;
      this.terminalUUID = saved.terminalUUID;
      return;
    }
    await this.login();
  }

  private async cloudRequest(pathAndQuery: string, body: any) {
    const url = pathAndQuery.startsWith('http') ? pathAndQuery : `${CLOUD_URL}${pathAndQuery}`;
    const res = await fetch(url, { method: 'POST', headers: kasaHeaders(), body: JSON.stringify(body) } as any);
    if (!res.ok) throw new Error(`Kasa HTTP ${res.status}`);
    const json = await res.json();
    if (json.error_code && json.error_code !== 0) throw new Error(`Kasa error: ${json.msg || json.error_code}`);
    return json;
  }

  private async findDevice(deviceIdOrAlias: string) {
    const devices = await this.getDeviceList();
    const dev = devices.find((d: any) => d.deviceId === deviceIdOrAlias || d.alias === deviceIdOrAlias);
    if (!dev) throw new Error(`Device not found: ${deviceIdOrAlias}`);
    return dev;
  }

  async getDeviceList(): Promise<any[]> {
    await this.ensureToken();
    const url = `?token=${this.token}`;
    const body = { method: 'getDeviceList' };
    let data = await this.cloudRequest(url, body);
    // If token invalid, re-login and retry
    if (data.error_code && data.error_code !== 0) {
      await this.login();
      data = await this.cloudRequest(`?token=${this.token}`, body);
    }
    const list = data?.result?.deviceList || [];
    return list;
  }

  async setPowerState(deviceId: string, state: boolean): Promise<any> {
    await this.ensureToken();
    const dev = await this.findDevice(deviceId);
    const appServerUrl = dev.appServerUrl as string;
    const reqData = JSON.stringify({ system: { set_relay_state: { state: state ? 1 : 0 } } });
    const body = { method: 'passthrough', params: { deviceId: dev.deviceId, requestData: reqData } };
    const url = `${appServerUrl}?token=${this.token}`;
    const data = await this.cloudRequest(url, body);
    const inner = data?.result?.responseData ? JSON.parse(data.result.responseData) : {};
    return inner;
  }

  async setBulbState(deviceId: string, state: { on_off?: number; brightness?: number; hue?: number; saturation?: number; color_temp?: number; transition_period?: number }) {
    await this.ensureToken();
    const dev = await this.findDevice(deviceId);
    const appServerUrl = dev.appServerUrl as string;
    const url = `${appServerUrl}?token=${this.token}`;
    const service = 'smartlife.iot.smartbulb.lightingservice';
    const payload = { [service]: { transition_light_state: { ...state } } } as any;
    const body = { method: 'passthrough', params: { deviceId: dev.deviceId, requestData: JSON.stringify(payload) } };
    let data = await this.cloudRequest(url, body);
    let inner = data?.result?.responseData ? JSON.parse(data.result.responseData) : {};
    // If device expects set_light_state instead
    const err = inner?.[service]?.transition_light_state?.err_code;
    if (typeof err !== 'undefined' && err !== 0) {
      const payload2 = { [service]: { set_light_state: { ...state } } } as any;
      const body2 = { method: 'passthrough', params: { deviceId: dev.deviceId, requestData: JSON.stringify(payload2) } };
      data = await this.cloudRequest(url, body2);
      inner = data?.result?.responseData ? JSON.parse(data.result.responseData) : {};
    }
    return inner;
  }
}

export class KasaLanClient {
  private discoveryMs: number;
  private client: any;
  private require = createRequire(import.meta.url);
  constructor(private config: AppConfig) {
    const lib = this.require('tplink-smarthome-api');
    this.client = new lib.Client();
    this.discoveryMs = config.KASA_LAN_DISCOVERY_MS ?? 3000;
  }

  private async discover(): Promise<any[]> {
    const devices: any[] = [];
    const discovery = this.client.startDiscovery();
    discovery.on('device-new', (d: any) => { devices.push(d); });
    await new Promise((r) => setTimeout(r, this.discoveryMs));
    discovery.stop();
    return devices;
  }

  private async findDevice(idOrAlias: string): Promise<any> {
    const list = await this.discover();
    for (const d of list) {
      if (d.deviceId === idOrAlias || d.alias === idOrAlias) return d;
    }
    throw new Error(`Device not found: ${idOrAlias}`);
  }

  async getDeviceList(): Promise<any[]> {
    const list = await this.discover();
    return list.map((d: any) => ({ deviceId: d.deviceId, alias: d.alias, deviceModel: d.model, status: d.relayState ?? d.lightingState?.on_off }));
  }

  async setPowerState(deviceIdOrAlias: string, state: boolean) {
    const d = await this.findDevice(deviceIdOrAlias);
    if (typeof d.setPowerState === 'function') return d.setPowerState(state);
    if (d.lighting && d.lighting.setLightState) return d.lighting.setLightState({ on_off: state ? 1 : 0 });
    // try generic
    if (d.setPowerState) return d.setPowerState(state);
    throw new Error('Device does not support power state');
  }

  async setBulbState(deviceIdOrAlias: string, state: { on_off?: number; brightness?: number; hue?: number; saturation?: number; color_temp?: number; transition_period?: number }) {
    const d = await this.findDevice(deviceIdOrAlias);
    if (!d.lighting || !d.lighting.setLightState) throw new Error('Device is not a bulb or lacks lighting controls');
    return d.lighting.setLightState({ ...state });
  }
}

export function getKasaClient(config: AppConfig) {
  const lanOnly = config.KASA_LAN_ONLY === true;
  if (lanOnly) return new KasaLanClient(config);
  // Prefer LAN first; fallback to cloud
  return new (class {
    lan = new KasaLanClient(config);
    cloud = new KasaCloudClient(config);
    async getDeviceList() {
      try { return await this.lan.getDeviceList(); } catch { return await this.cloud.getDeviceList(); }
    }
    async setPowerState(id: string, s: boolean) {
      try { return await this.lan.setPowerState(id, s); } catch { return await this.cloud.setPowerState(id, s); }
    }
    async setBulbState(id: string, st: any) {
      try { return await this.lan.setBulbState(id, st); } catch { return await this.cloud.setBulbState(id, st); }
    }
  })();
}
