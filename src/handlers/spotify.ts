import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec } from '../types/index.js';
import { SpotifyClient } from '../utils/spotify.js';
import { ensurePacificIso } from '../utils/time.js';

const SEARCH_TYPES = ['track', 'artist', 'album', 'playlist', 'show', 'episode', 'audiobook'] as const;

const RecentTracksSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  after: z.union([z.coerce.number(), z.string()]).optional(),
  before: z.union([z.coerce.number(), z.string()]).optional(),
}).strip();

const TopItemsSchema = z.object({
  type: z.enum(['tracks', 'artists']).optional(),
  time_range: z.enum(['short_term', 'medium_term', 'long_term']).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  offset: z.coerce.number().int().min(0).max(1000).optional(),
}).strip();

const SearchSchema = z.object({
  query: z.string().min(1),
  type: z.union([
    z.enum(SEARCH_TYPES),
    z.array(z.enum(SEARCH_TYPES)).min(1),
  ]).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  offset: z.coerce.number().int().min(0).max(1000).optional(),
  market: z.string().optional(),
}).strip();

const AudioFeaturesSchema = z.object({
  track_ids: z.union([
    z.array(z.string()).min(1).max(100),
    z.string().min(1),
  ]),
}).strip();

type TimestampInput = number | string | undefined;
type AudioFeatureSummary = {
  id: string;
  tempo: number | null;
  key: number | null;
  mode: number | null;
  time_signature: number | null;
  danceability: number | null;
  energy: number | null;
  valence: number | null;
  acousticness: number | null;
  instrumentalness: number | null;
  liveness: number | null;
  speechiness: number | null;
  loudness: number | null;
  duration_ms: number | null;
};

type AudioFeatureAverages = Omit<AudioFeatureSummary, 'id'> & {
  sample_size: number;
};

type RecentTrackItem = {
  played_at?: string;
  track: any;
  context?: { type?: string; uri?: string };
};

type RecentTrackWithFeatures = RecentTrackItem & {
  audio_features?: AudioFeatureSummary;
};

export class SpotifyHandler extends BaseHandler {
  readonly prefix = 'spotify';

  getTools(): ToolSpec[] {
    return [
      {
        action: 'get_current',
        description: 'What is playing right now',
        inputSchema: {},
      },
      {
        action: 'recent_tracks',
        description: 'List recently played tracks (up to 50)',
        inputSchema: {
          limit: RecentTracksSchema.shape.limit,
          after: RecentTracksSchema.shape.after,
          before: RecentTracksSchema.shape.before,
        },
      },
      {
        action: 'top_items',
        description: 'Spotify top tracks or artists',
        inputSchema: {
          type: TopItemsSchema.shape.type,
          time_range: TopItemsSchema.shape.time_range,
          limit: TopItemsSchema.shape.limit,
          offset: TopItemsSchema.shape.offset,
        },
      },
      {
        action: 'search',
        description: 'Search Spotify catalog for recommendations',
        inputSchema: {
          query: SearchSchema.shape.query,
          type: SearchSchema.shape.type,
          limit: SearchSchema.shape.limit,
          offset: SearchSchema.shape.offset,
          market: SearchSchema.shape.market,
        },
      },
      {
        action: 'audio_features',
        description: 'Get audio features (BPM, energy, mood) for up to 100 tracks',
        inputSchema: {
          track_ids: AudioFeaturesSchema.shape.track_ids,
        },
      },
    ];
  }

  async execute(action: string, args: any): Promise<CallToolResult> {
    try {
      const client = new SpotifyClient(this.config, { logger: this.logger });
      switch (action) {
        case 'get_current': {
          const data = await client.getCurrentlyPlaying();
          if (!data) {
            return this.textResult('Nothing is currently playing.');
          }
          if (!data?.item) {
            return this.jsonResult({ raw: data, note: 'No current track item returned.' }, 'Currently playing');
          }
          const payload = {
            track: this.formatTrack(data.item),
            is_playing: data.is_playing,
            progress_ms: data.progress_ms,
            device: data.device ? {
              id: data.device.id,
              name: data.device.name,
              type: data.device.type,
              volume_percent: data.device.volume_percent,
            } : undefined,
            context: data.context ? {
              type: data.context.type,
              uri: data.context.uri,
            } : undefined,
          };
          return this.jsonResult(payload, 'Currently playing');
        }
        case 'recent_tracks': {
          const parsed = this.parseArgs(RecentTracksSchema, args);
          const data = await client.getRecentTracks({
            limit: parsed.limit ?? 20,
            after: this.toSpotifyTimestamp(parsed.after),
            before: this.toSpotifyTimestamp(parsed.before),
          });
          const items = Array.isArray(data?.items) ? data.items : [];
          const baseItems: RecentTrackItem[] = items.map((item: any) => ({
            played_at: this.formatPlayedAt(item.played_at),
            track: this.formatTrack(item.track),
            context: item.context ? { type: item.context.type, uri: item.context.uri } : undefined,
          }));
          const trackIds = Array.from(new Set(
            baseItems
              .map((entry: RecentTrackItem) => entry.track?.id as string | undefined)
              .filter((id): id is string => Boolean(id))
          ));
          let featureMap = new Map<string, AudioFeatureSummary>();
          const featureWarnings: string[] = [];
          if (trackIds.length > 0) {
            const featureResult = await this.loadAudioFeatures(client, trackIds);
            featureMap = featureResult.map;
            if (featureResult.warnings.length) {
              featureWarnings.push(...featureResult.warnings);
            }
          }
          const enriched: RecentTrackWithFeatures[] = baseItems.map((item: RecentTrackItem) => ({
            ...item,
            audio_features: item.track?.id ? featureMap.get(item.track.id) : undefined,
          }));
          const featureAverages = this.computeFeatureAverages(Array.from(featureMap.values()));
          const averagePopularity = this.averageNumber(enriched.map((entry: RecentTrackWithFeatures) => entry.track?.popularity));
          const averageDuration = this.averageNumber(enriched.map((entry: RecentTrackWithFeatures) => entry.track?.duration_ms));
          const averages: Record<string, unknown> = {};
          if (featureAverages) averages.audio_features = featureAverages;
          if (averagePopularity !== null) averages.track_popularity = averagePopularity;
          if (averageDuration !== null) averages.track_duration_ms = averageDuration;
          const payload: Record<string, unknown> = {
            total: enriched.length,
            limit: parsed.limit ?? 20,
            next: data?.next,
            cursors: data?.cursors,
            items: enriched,
          };
          if (Object.keys(averages).length > 0) payload.averages = averages;
          if (featureWarnings.length > 0) payload.feature_warnings = featureWarnings;
          return this.jsonResult(payload, 'Recent tracks');
        }
        case 'top_items': {
          const parsed = this.parseArgs(TopItemsSchema, args);
          const type = parsed.type ?? 'tracks';
          const data = await client.getTopItems({
            type,
            time_range: parsed.time_range ?? 'medium_term',
            limit: parsed.limit ?? 20,
            offset: parsed.offset ?? 0,
          });
          const items = Array.isArray(data?.items) ? data.items : [];
          const mapped = type === 'artists'
            ? items.map((artist: any, index: number) => ({
                rank: parsed.offset ? parsed.offset + index + 1 : index + 1,
                id: artist.id,
                name: artist.name,
                genres: artist.genres,
                popularity: artist.popularity,
                followers: artist.followers?.total,
                url: artist.external_urls?.spotify,
              }))
            : items.map((track: any, index: number) => ({
                rank: parsed.offset ? parsed.offset + index + 1 : index + 1,
                ...this.formatTrack(track),
                popularity: track.popularity,
              }));
          const payload = {
            type,
            time_range: parsed.time_range ?? 'medium_term',
            limit: parsed.limit ?? 20,
            offset: parsed.offset ?? 0,
            total: data?.total,
            items: mapped,
          };
          return this.jsonResult(payload, 'Top items');
        }
        case 'search': {
          const parsed = this.parseArgs(SearchSchema, args);
          const types = this.normalizeTypes(parsed.type);
          const data = await client.search({
            query: parsed.query,
            types,
            limit: parsed.limit ?? 10,
            offset: parsed.offset ?? 0,
            market: parsed.market,
          });
          const results: Record<string, any[]> = {};
          for (const type of types) {
            const pluralKey = `${type}s`;
            const section = data?.[pluralKey] ?? data?.[type];
            if (!section?.items) continue;
            const items = section.items.slice(0, parsed.limit ?? 10).map((item: any) => {
              if (type === 'track') return this.formatTrack(item);
              if (type === 'artist') {
                return {
                  id: item.id,
                  name: item.name,
                  genres: item.genres,
                  popularity: item.popularity,
                  url: item.external_urls?.spotify,
                };
              }
              if (type === 'album') {
                return {
                  id: item.id,
                  name: item.name,
                  release_date: item.release_date,
                  total_tracks: item.total_tracks,
                  artists: (item.artists || []).map((a: any) => a.name),
                  url: item.external_urls?.spotify,
                };
              }
              if (type === 'playlist') {
                return {
                  id: item.id,
                  name: item.name,
                  owner: item.owner?.display_name,
                  tracks: item.tracks?.total,
                  url: item.external_urls?.spotify,
                };
              }
              return {
                id: item.id,
                name: item.name,
                description: item.description,
                url: item.external_urls?.spotify,
              };
            });
            if (items.length > 0) {
              results[type] = items;
            }
          }
          const payload = {
            query: parsed.query,
            limit: parsed.limit ?? 10,
            offset: parsed.offset ?? 0,
            types,
            results,
          };
          return this.jsonResult(payload, 'Spotify search results');
        }
        case 'audio_features': {
          const parsed = this.parseArgs(AudioFeaturesSchema, args);
          const ids = this.normalizeTrackIds(parsed.track_ids);
          if (ids.length === 0) {
            return this.textResult('No valid track IDs provided.');
          }
          if (ids.length > 100) {
            return this.textResult('Spotify audio features supports up to 100 track IDs per call.');
          }
          const data = await client.getAudioFeatures(ids);
          const mapped = this.extractAudioFeatures(data, ids);
          const payload = {
            count: mapped.length,
            missing: ids.filter(id => !mapped.some(feature => feature.id === id)),
            features: mapped,
          };
          return this.jsonResult(payload, 'Audio features');
        }
        default:
          return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
      }
    } catch (err: any) {
      this.logger.error({ err, action }, 'Spotify handler error');
      return { content: [{ type: 'text', text: `Spotify error: ${err?.message || String(err)}` }], isError: true };
    }
  }

  private textResult(text: string): CallToolResult {
    return { content: [{ type: 'text', text }] };
  }

  private jsonResult(obj: any, title: string): CallToolResult {
    const text = `${title}: ${JSON.stringify(obj, null, 2)}`;
    return { content: [{ type: 'text', text }] };
  }

  private toSpotifyTimestamp(value: TimestampInput): number | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'number') {
      return Math.floor(value);
    }
    const numeric = Number(value);
    if (!Number.isNaN(numeric)) {
      return Math.floor(numeric);
    }
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
    throw new Error(`Unable to parse timestamp: ${value}`);
  }

  private normalizeTypes(type: unknown): string[] {
    const allowed = new Set<string>(SEARCH_TYPES);
    let values: string[];
    if (!type) {
      values = ['track'];
    } else if (typeof type === 'string') {
      values = type.split(',').map(t => t.trim());
    } else if (Array.isArray(type)) {
      values = type.map(t => String(t));
    } else {
      values = ['track'];
    }
    const normalized = values
      .map(v => v.toLowerCase())
      .filter(v => allowed.has(v));
    if (normalized.length === 0) {
      return ['track'];
    }
    return Array.from(new Set(normalized));
  }

  private normalizeTrackIds(input: string | string[]): string[] {
    const values = Array.isArray(input)
      ? input
      : input.split(/[\s,]+/);
    const ids = values
      .map(v => v.trim())
      .filter(Boolean)
      .map(v => {
        if (v.startsWith('spotify:track:')) {
          return v.slice('spotify:track:'.length);
        }
        if (v.includes('open.spotify.com/track/')) {
          const after = v.split('open.spotify.com/track/')[1];
          return after.split(/[?&#]/)[0];
        }
        return v;
      })
      .filter(Boolean);
    return Array.from(new Set(ids));
  }

  private formatTrack(track: any) {
    if (!track) return track;
    return {
      id: track.id,
      name: track.name,
      artists: (track.artists || []).map((artist: any) => artist.name),
      album: track.album ? {
        id: track.album.id,
        name: track.album.name,
        release_date: track.album.release_date,
      } : undefined,
      duration_ms: track.duration_ms,
      explicit: track.explicit,
      popularity: track.popularity,
      url: track.external_urls?.spotify,
      preview_url: track.preview_url,
    };
  }

  private summarizeAudioFeatures(item: any): AudioFeatureSummary | null {
    if (!item) return null;
    const id = item.id;
    if (!id) return null;
    return {
      id,
      tempo: this.safeNumber(item.tempo),
      key: this.safeNumber(item.key),
      mode: this.safeNumber(item.mode),
      time_signature: this.safeNumber(item.time_signature),
      danceability: this.safeNumber(item.danceability),
      energy: this.safeNumber(item.energy),
      valence: this.safeNumber(item.valence),
      acousticness: this.safeNumber(item.acousticness),
      instrumentalness: this.safeNumber(item.instrumentalness),
      liveness: this.safeNumber(item.liveness),
      speechiness: this.safeNumber(item.speechiness),
      loudness: this.safeNumber(item.loudness),
      duration_ms: this.safeNumber(item.duration_ms),
    };
  }

  private extractAudioFeatures(data: any, ids: string[]): AudioFeatureSummary[] {
    const raw = Array.isArray(data?.audio_features)
      ? data.audio_features
      : ids.length === 1 && data
        ? [data]
      : [];
    return raw
      .map((item: any) => this.summarizeAudioFeatures(item))
      .filter((item: AudioFeatureSummary | null): item is AudioFeatureSummary => Boolean(item));
  }

  private async loadAudioFeatures(client: SpotifyClient, trackIds: string[]): Promise<{ map: Map<string, AudioFeatureSummary>; warnings: string[] }> {
    const map = new Map<string, AudioFeatureSummary>();
    const warnings: string[] = [];
    const batches = this.chunkArray(trackIds, 50);
    for (const batch of batches) {
      const pendingIds = batch.filter(id => !map.has(id));
      if (pendingIds.length === 0) continue;
      try {
        const response = await client.getAudioFeatures(pendingIds);
        const summaries = this.extractAudioFeatures(response, pendingIds);
        for (const summary of summaries) {
          map.set(summary.id, summary);
        }
        const missing = pendingIds.filter(id => !map.has(id));
        if (missing.length > 0) {
          warnings.push(`Audio features unavailable for ${missing.length} track(s): ${missing.join(', ')}`);
        }
      } catch (err: any) {
        const message = err?.message || String(err);
        this.logger.warn({ err, count: pendingIds.length }, 'Spotify batch audio features failed');
        warnings.push(`Batch audio features failed (${pendingIds.length} tracks): ${message}`);
        for (const id of pendingIds) {
          try {
            const single = await client.getAudioFeature(id);
            const summary = this.summarizeAudioFeatures(single);
            if (summary) {
              map.set(summary.id, summary);
            } else {
              warnings.push(`No audio features returned for track ${id}`);
            }
          } catch (singleErr: any) {
            const singleMessage = singleErr?.message || String(singleErr);
            this.logger.warn({ err: singleErr, trackId: id }, 'Spotify single audio feature failed');
            warnings.push(`Audio features failed for track ${id}: ${singleMessage}`);
          }
        }
      }
    }
    return { map, warnings };
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      out.push(arr.slice(i, i + size));
    }
    return out;
  }

  private computeFeatureAverages(features: AudioFeatureSummary[]): AudioFeatureAverages | null {
    if (features.length === 0) return null;
    const metrics: (keyof Omit<AudioFeatureSummary, 'id'>)[] = [
      'tempo',
      'key',
      'mode',
      'time_signature',
      'danceability',
      'energy',
      'valence',
      'acousticness',
      'instrumentalness',
      'liveness',
      'speechiness',
      'loudness',
      'duration_ms',
    ];
    const totals: Record<string, { sum: number; count: number }> = {};
    for (const metric of metrics) {
      totals[metric] = { sum: 0, count: 0 };
    }
    for (const feature of features) {
      for (const metric of metrics) {
        const value = feature[metric];
        if (value === null || value === undefined) continue;
        totals[metric].sum += value;
        totals[metric].count += 1;
      }
    }
    const averages: Record<string, number | null> = {};
    for (const metric of metrics) {
      const { sum, count } = totals[metric];
      averages[metric] = count > 0 ? sum / count : null;
    }
    return {
      ...averages,
      sample_size: features.length,
    } as AudioFeatureAverages;
  }

  private averageNumber(values: Array<number | null | undefined>): number | null {
    const filtered = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (!filtered.length) return null;
    const total = filtered.reduce((sum, value) => sum + value, 0);
    return total / filtered.length;
  }

  private safeNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const coerced = Number(value);
    if (!Number.isNaN(coerced) && Number.isFinite(coerced)) return coerced;
    return null;
  }

  private formatPlayedAt(value?: string): string | undefined {
    return ensurePacificIso(value) ?? value;
  }
}
