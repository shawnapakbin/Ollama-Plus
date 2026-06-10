#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  {
    name: 'ollama-plus-datetime',
    version: '0.1.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

function asTextResult(payload) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

/** Return the IANA timezone name for a given UTC offset string like "+05:30". */
function resolveTimezone(tzParam) {
  if (!tzParam) return Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Accept IANA names directly (e.g. "America/New_York")
  try {
    Intl.DateTimeFormat('en', { timeZone: tzParam });
    return tzParam;
  } catch {
    throw new Error(`Unknown timezone: "${tzParam}". Use an IANA name such as "America/New_York" or "Europe/London".`);
  }
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'datetime_now',
      description:
        'Get the current date and time from the host machine, including the local timezone. ' +
        'Returns ISO 8601 timestamp, Unix epoch (ms), day-of-week, week number, and full timezone info.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    },
    {
      name: 'datetime_convert',
      description:
        'Convert a date-time string from one timezone to another. ' +
        'Input and output timezones must be IANA timezone names (e.g. "America/New_York", "Asia/Tokyo", "UTC").',
      inputSchema: {
        type: 'object',
        properties: {
          datetime: {
            type: 'string',
            description: 'ISO 8601 date-time string to convert (e.g. "2024-06-09T14:30:00").'
          },
          fromTimezone: {
            type: 'string',
            description: 'IANA source timezone (e.g. "America/New_York"). Defaults to local timezone.'
          },
          toTimezone: {
            type: 'string',
            description: 'IANA target timezone (e.g. "Asia/Tokyo"). Defaults to "UTC".'
          }
        },
        required: ['datetime'],
        additionalProperties: false
      }
    },
    {
      name: 'datetime_format',
      description:
        'Format a date-time value using Intl.DateTimeFormat options. ' +
        'Accepts an ISO 8601 string or Unix epoch in milliseconds.',
      inputSchema: {
        type: 'object',
        properties: {
          datetime: {
            type: 'string',
            description:
              'ISO 8601 date-time string or Unix epoch in milliseconds (as a string).'
          },
          timezone: {
            type: 'string',
            description: 'IANA timezone for the output. Defaults to local timezone.'
          },
          locale: {
            type: 'string',
            description: 'BCP 47 locale tag (e.g. "en-US", "de-DE"). Defaults to system locale.'
          },
          dateStyle: {
            type: 'string',
            enum: ['full', 'long', 'medium', 'short'],
            description: 'Date portion style.'
          },
          timeStyle: {
            type: 'string',
            enum: ['full', 'long', 'medium', 'short'],
            description: 'Time portion style.'
          }
        },
        required: ['datetime'],
        additionalProperties: false
      }
    },
    {
      name: 'datetime_diff',
      description:
        'Calculate the difference between two date-time values. ' +
        'Returns the gap expressed in milliseconds, seconds, minutes, hours, days, weeks, and approximate months/years.',
      inputSchema: {
        type: 'object',
        properties: {
          from: {
            type: 'string',
            description: 'Start ISO 8601 date-time string.'
          },
          to: {
            type: 'string',
            description: 'End ISO 8601 date-time string.'
          }
        },
        required: ['from', 'to'],
        additionalProperties: false
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'datetime_now': {
      const now = new Date();
      const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const utcOffset = (() => {
        const offsetMin = -now.getTimezoneOffset();
        const sign = offsetMin >= 0 ? '+' : '-';
        const absMin = Math.abs(offsetMin);
        const h = String(Math.floor(absMin / 60)).padStart(2, '0');
        const m = String(absMin % 60).padStart(2, '0');
        return `${sign}${h}:${m}`;
      })();

      // ISO week number
      const thursday = new Date(now);
      thursday.setDate(now.getDate() + 4 - (now.getDay() || 7));
      const yearStart = new Date(thursday.getFullYear(), 0, 1);
      const weekNumber = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);

      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      return asTextResult({
        iso8601: now.toISOString(),
        localIso8601: new Intl.DateTimeFormat('sv', {
          timeZone: localTz,
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          fractionalSecondDigits: 3
        }).format(now).replace(' ', 'T'),
        epochMs: now.getTime(),
        timezone: localTz,
        utcOffset,
        dayOfWeek: dayNames[now.getDay()],
        isoWeekNumber: weekNumber,
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        day: now.getDate(),
        hour: now.getHours(),
        minute: now.getMinutes(),
        second: now.getSeconds()
      });
    }

    case 'datetime_convert': {
      const { datetime, fromTimezone, toTimezone = 'UTC' } = args;
      const fromTz = resolveTimezone(fromTimezone || null);
      const toTz = resolveTimezone(toTimezone);

      // Parse the input datetime string as a wall-clock time in fromTz
      // We create a Date by reformatting to a UTC-anchored parse
      const srcDate = new Date(datetime);
      if (isNaN(srcDate.getTime())) {
        throw new Error(`Cannot parse datetime: "${datetime}". Use ISO 8601 format.`);
      }

      // Format in source timezone to confirm the interpreted local time
      const fmtFrom = new Intl.DateTimeFormat('sv', {
        timeZone: fromTz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
      const fmtTo = new Intl.DateTimeFormat('sv', {
        timeZone: toTz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });

      return asTextResult({
        input: datetime,
        fromTimezone: fromTz,
        toTimezone: toTz,
        inputLocalTime: fmtFrom.format(srcDate).replace(' ', 'T'),
        convertedLocalTime: fmtTo.format(srcDate).replace(' ', 'T'),
        epochMs: srcDate.getTime(),
        utc: srcDate.toISOString()
      });
    }

    case 'datetime_format': {
      const { datetime, timezone, locale, dateStyle, timeStyle } = args;
      const tz = resolveTimezone(timezone || null);
      const parsed = new Date(
        /^\d+$/.test(String(datetime)) ? parseInt(datetime, 10) : datetime
      );
      if (isNaN(parsed.getTime())) {
        throw new Error(`Cannot parse datetime: "${datetime}".`);
      }

      const fmtOptions = { timeZone: tz };
      if (dateStyle) fmtOptions.dateStyle = dateStyle;
      if (timeStyle) fmtOptions.timeStyle = timeStyle;
      if (!dateStyle && !timeStyle) {
        fmtOptions.dateStyle = 'full';
        fmtOptions.timeStyle = 'long';
      }

      const formatted = new Intl.DateTimeFormat(locale || undefined, fmtOptions).format(parsed);

      return asTextResult({
        input: datetime,
        formatted,
        timezone: tz,
        locale: locale || Intl.DateTimeFormat().resolvedOptions().locale,
        epochMs: parsed.getTime()
      });
    }

    case 'datetime_diff': {
      const { from, to } = args;
      const fromDate = new Date(from);
      const toDate = new Date(to);
      if (isNaN(fromDate.getTime())) throw new Error(`Cannot parse "from": "${from}".`);
      if (isNaN(toDate.getTime())) throw new Error(`Cannot parse "to": "${to}".`);

      const diffMs = toDate.getTime() - fromDate.getTime();
      const absMs = Math.abs(diffMs);

      return asTextResult({
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        sign: diffMs >= 0 ? 'positive' : 'negative',
        milliseconds: diffMs,
        seconds: diffMs / 1000,
        minutes: diffMs / 60000,
        hours: diffMs / 3600000,
        days: diffMs / 86400000,
        weeks: diffMs / 604800000,
        approximateMonths: diffMs / (30.4375 * 86400000),
        approximateYears: diffMs / (365.25 * 86400000),
        absolute: {
          milliseconds: absMs,
          seconds: Math.floor(absMs / 1000),
          minutes: Math.floor(absMs / 60000),
          hours: Math.floor(absMs / 3600000),
          days: Math.floor(absMs / 86400000)
        }
      });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
