/**
 * Startup Context Bundle
 *
 * Replaces the /kota-startup slash command with a composable context bundle
 * that loads initial session context from multiple data sources.
 *
 * This bundle fetches:
 * - Current date/time
 * - Recent memories (current_work_context, conversation_notes)
 * - Today's calendar events
 * - Recent Slack messages (Sunil DM)
 * - Latest WHOOP recovery data
 * - Most recent weekly note
 *
 * Error handling: Uses Promise.allSettled() to ensure partial failures don't
 * block the entire context load. Failed fetches return null and log warnings.
 */

import type {
  ContextBundle,
  ContextExecutionOptions,
  ContextResult,
} from '../types/context.js';

/**
 * Full session initialization context bundle.
 *
 * Loads comprehensive context from memory, calendar, Slack, health data,
 * and recent weekly notes to provide KOTA with full awareness of current
 * state and priorities.
 */
export const startupBundle: ContextBundle = {
  name: 'startup',
  description:
    'Full session initialization context - loads memory, calendar, slack, health data',
  tags: ['core', 'session', 'initialization'],

  async execute(opts: ContextExecutionOptions): Promise<ContextResult> {
    const { handlers, cache, refresh } = opts;

    // Check cache first (unless refresh=true)
    if (!refresh) {
      const cached = cache.get('startup');
      if (cached) {
        return cached;
      }
    }

    // Get current date for calendar queries and identity
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    // Fetch data from handlers in parallel
    // Use Promise.allSettled to handle failures gracefully
    const [
      workContextResult,
      conversationNotesResult,
      calendarResult,
      slackResult,
      whoopResult,
    ] = await Promise.allSettled([
      // Fetch work context memory
      handlers.execute('memory', 'get', {
        query: 'current_work_context',
      }),
      // Fetch conversation notes
      handlers.execute('memory', 'get', {
        query: 'conversation_notes',
      }),
      // Fetch today's calendar events
      handlers.execute('calendar', 'list_events', {
        start: now.toISOString(),
        end: endOfDay.toISOString(),
      }),
      // Fetch recent Slack messages from Sunil DM (Geo-Sync client)
      handlers.execute('slack', 'get_messages', {
        channel: 'D098X745TDY', // Sunil DM
        limit: 5,
      }),
      // Fetch latest WHOOP recovery data
      handlers.execute('whoop', 'get_recovery', {
        limit: 1,
      }),
    ]);

    // Extract results (handle rejections gracefully)
    const workContext =
      workContextResult.status === 'fulfilled'
        ? workContextResult.value
        : null;
    const conversationNotes =
      conversationNotesResult.status === 'fulfilled'
        ? conversationNotesResult.value
        : null;
    const calendarEvents =
      calendarResult.status === 'fulfilled' ? calendarResult.value : null;
    const slackMessages =
      slackResult.status === 'fulfilled' ? slackResult.value : null;
    const whoopRecovery =
      whoopResult.status === 'fulfilled' ? whoopResult.value : null;

    // Note: Weekly note fetching is commented out as it requires file system access
    // which should be handled by a separate handler or through workspace tools
    // const weeklyNote = await fetchWeeklyNote(); // TODO: Implement when file handler exists

    // Build result with all gathered context
    const result: ContextResult = {
      context_name: 'startup',
      loaded_at: now.toISOString(),
      data: {
        current_date: today,
        current_time: now.toISOString(),
        identity: {
          name: 'KOTA',
          role: 'Knowledge-Oriented Thinking Aide',
          user: 'Jaymin',
          user_age: 24, // Born May 30, 2001
          location: 'Seattle, WA',
          personality:
            'Direct, curious, proactive. Cut the fluff, focus on value.',
        },
        work_context: workContext,
        conversation_notes: conversationNotes,
        calendar_today: calendarEvents,
        slack_urgent: slackMessages,
        recovery_today: whoopRecovery,
        // weekly_note: weeklyNote, // TODO: Add when file handler exists
      },
      next_steps: [
        "Check calendar for today's meetings and time blocks",
        'Review Slack for client messages (especially Sunil for Geo-Sync)',
        'Check recent weekly note for current goals and context',
        'Review WHOOP recovery to gauge energy levels for the day',
        'Update memory with session notes at end of conversation',
      ],
      ttl_seconds: 300, // Cache for 5 minutes
    };

    // Store in cache for future requests
    if (result.ttl_seconds) {
      cache.set('startup', result, result.ttl_seconds);
    }

    return result;
  },
};
