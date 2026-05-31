import { ipcService } from '../../../services/ipcService';
import {
  addPrimitive,
  clearScene,
  getSceneObjects,
  removeObject,
  transformObject,
  type PrimitiveKind
} from '../../../services/sceneStore';
import {
  clearAnnotations,
  getAnnotations,
  getGrid,
  removeAnnotation
} from '../../../services/annotationStore';

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'scene_3d',
      description:
        'Drive the 3D Workspace viewport. Add, transform, recolor, or remove primitive meshes (box, sphere, cylinder, cone, plane, torus) rendered live in the user\'s 3D panel. Always prefer this tool over describing three.js code when the user asks for shapes to appear, move, scale, rotate, or change color.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'add', 'transform', 'remove', 'clear'],
            description: 'Which scene operation to perform.'
          },
          kind: {
            type: 'string',
            enum: ['box', 'sphere', 'cylinder', 'cone', 'plane', 'torus'],
            description: 'Primitive kind (required for action=add).'
          },
          id: { type: 'string', description: 'Target object id for transform/remove (e.g. "box-1"). Use action=list to discover ids.' },
          name: { type: 'string', description: 'Optional friendly name.' },
          color: { type: 'string', description: 'CSS color, e.g. "#ff0000" or "red".' },
          size: { type: 'number', description: 'Base edge length / diameter in scene units. Default 1.' },
          position: {
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
            description: 'World-space position offset.'
          },
          rotation: {
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
            description: 'Euler rotation in radians.'
          },
          scale: {
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
            description: 'Per-axis scale factor.'
          }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {      name: 'scene_annotations',
      description:
        'Inspect or clean up the user-placed annotations on the 3D stage. Each annotation has a world position (in scene units shown with the user-selected measurement unit), an optional target object id, and a note describing the user\'s intent. Use action=list before planning scene_3d changes when annotations are present.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'remove', 'clear'],
            description: 'list returns all annotations and grid config; remove deletes one by id; clear removes all.'
          },
          id: { type: 'string', description: 'Annotation id for action=remove (e.g. "ann-2").' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {      name: 'run_shell_command',
      description:
        "Execute a shell command (PowerShell) on the user's local machine. Use this to list files, read directories, or execute tools.",
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_action',
      description:
        'Perform an action in a persistent web browser (Playwright). Useful for navigation, interaction, and data extraction.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['goto', 'click', 'type', 'press', 'scroll', 'wait', 'screenshot', 'extract-text', 'evaluate', 'reset'],
            description:
              'The action to perform. Use "reset" to clear cookies/storage/cache and start a fresh browsing session.'
          },
          url: { type: 'string', description: 'URL for navigation' },
          selector: { type: 'string', description: 'CSS selector for interaction' },
          text: { type: 'string', description: 'Text to type, scroll direction (up/down), or wait ms' },
          key: { type: 'string', description: 'Key to press (e.g. Enter)' },
          wait_for: { type: 'string', description: 'URL or selector to wait for' },
          script: { type: 'string', description: 'JS code for evaluate' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_wiki',
      description: "Read a markdown file from the user's local wiki knowledge base.",
      parameters: {
        type: 'object',
        properties: {
          filepath: { type: 'string', description: 'Path to the markdown file (e.g. index.md)' }
        },
        required: ['filepath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for current information, news, or general knowledge using DuckDuckGo.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_user_memory',
      description:
        'Update the persistent memory about the user. Use this to remember names, preferences, or important facts across sessions.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The information to remember' }
        },
        required: ['content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description:
        'Get the current date and time. Returns ISO UTC, Unix ms, and a human-readable local time. Optional IANA timezone (e.g. America/New_York, Europe/London, Asia/Tokyo); defaults to the user system timezone.',
      parameters: {
        type: 'object',
        properties: {
          timezone: { type: 'string', description: 'IANA timezone name (optional)' },
          locale: { type: 'string', description: 'BCP 47 locale for formatting (optional), e.g. en-US' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'engineering_calculator',
      description:
        'Evaluate mathematical expressions using a full math engine (mathjs): arithmetic, trig, logarithms, complex numbers (i), matrices (e.g. det(A), inv(A), multiply(A,B)), units, combinatorics, and BigNumber precision. Use for any non-trivial or engineering calculation instead of guessing.',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'Expression in mathjs syntax (e.g. sqrt(3^2+4^2), sin(pi/4), det([[1,2],[3,4]]), e^(i*pi)+1)'
          },
          scope: {
            type: 'object',
            description:
              'Optional named values for multi-step work, e.g. {"A": [[1,2],[3,4]], "x": 2}. Values may be numbers, nested arrays for matrices, or strings the engine accepts.'
          }
        },
        required: ['expression']
      }
    }
  }
];

type ToolArgs = Record<string, unknown>;

function formatPolicy(policy: { decisionToken?: string; selectionId?: string } | undefined, fallback: string): string {
  if (!policy?.decisionToken) return '';
  return `\nPolicy decision token: ${policy.decisionToken}\nSelection: ${policy.selectionId || fallback}`;
}

async function runShellCommand(args: ToolArgs): Promise<string> {
  const command = String(args.command || args.cmd || '').trim();
  const res = await ipcService.runShellCommand(command);
  if (!res.ok) {
    if (res.denied) {
      return `Shell command denied by user.\nPolicy decision token: ${res.policy?.decisionToken || 'n/a'}\nSelection: ${res.policy?.selectionId || 'deny'}`;
    }
    return `Shell command failed: ${res.message}`;
  }
  return `Started shell command in terminal (ID: ${res.terminalId}). The user can view it in the Terminals tab.\nPolicy decision token: ${res.policy?.decisionToken || 'auto-allow'}\nSelection: ${res.policy?.selectionId || 'auto-allow'}`;
}

async function runBrowserAction(args: ToolArgs): Promise<string> {
  const res = await ipcService.browserAction(args);
  if (res.error) {
    return `Error: ${res.error}${formatPolicy(res.policy, 'deny')}`;
  }
  if (res.screenshot) {
    return `Action completed. Current URL: ${res.url}\n[Screenshot captured]${formatPolicy(res.policy, 'allow')}`;
  }
  return `Action: ${args.action} completed.\nURL: ${res.url}\nTitle: ${res.title}\n\nOutput: ${res.result}${formatPolicy(res.policy, 'allow')}`;
}

async function runReadWiki(args: ToolArgs): Promise<string> {
  const filepath = (args.filepath as string) || (args.path as string);
  const result = await ipcService.readWiki(filepath);
  return result || 'File not found.';
}

async function runWebSearch(args: ToolArgs): Promise<string> {
  return ipcService.webSearch((args.query as string) || (args.q as string));
}

async function runUpdateUserMemory(args: ToolArgs): Promise<string> {
  const currentMem = (await ipcService.readWiki('memory/personal.md')) || '';
  const newMem = currentMem + '\n- ' + args.content;
  await ipcService.writeWiki('memory/personal.md', newMem);
  return 'Memory updated successfully.';
}

async function runGetCurrentTime(args: ToolArgs): Promise<string> {
  const res = await ipcService.getClock({
    timezone: (args.timezone as string) || (args.tz as string),
    locale: args.locale as string
  });
  return typeof res === 'string' ? res : JSON.stringify(res);
}

async function runEngineeringCalculator(args: ToolArgs): Promise<string> {
  const res = await ipcService.engineeringCalculator({
    expression: (args.expression ?? args.expr) as string,
    scope: args.scope as Record<string, unknown> | undefined
  });
  return typeof res === 'string' ? res : JSON.stringify(res);
}

async function runScene3d(args: ToolArgs): Promise<string> {
  const action = String(args.action || '').toLowerCase();
  switch (action) {
    case 'list': {
      const list = getSceneObjects();
      if (list.length === 0) return 'Scene is empty.';
      return JSON.stringify(list, null, 2);
    }
    case 'add': {
      const kind = String(args.kind || 'box').toLowerCase() as PrimitiveKind;
      const allowed: PrimitiveKind[] = ['box', 'sphere', 'cylinder', 'cone', 'plane', 'torus'];
      if (!allowed.includes(kind)) return `Unsupported kind: ${kind}. Use one of ${allowed.join(', ')}.`;
      const obj = addPrimitive({
        kind,
        name: args.name as string | undefined,
        color: args.color as string | undefined,
        size: typeof args.size === 'number' ? args.size : undefined,
        position: args.position as Partial<{ x: number; y: number; z: number }> | undefined,
        rotation: args.rotation as Partial<{ x: number; y: number; z: number }> | undefined,
        scale: args.scale as Partial<{ x: number; y: number; z: number }> | undefined
      });
      return `Added ${obj.kind} as id "${obj.id}".`;
    }
    case 'transform': {
      const id = String(args.id || '');
      if (!id) return 'transform requires an id.';
      const next = transformObject(id, {
        name: args.name as string | undefined,
        color: args.color as string | undefined,
        size: typeof args.size === 'number' ? args.size : undefined,
        position: args.position as Partial<{ x: number; y: number; z: number }> | undefined,
        rotation: args.rotation as Partial<{ x: number; y: number; z: number }> | undefined,
        scale: args.scale as Partial<{ x: number; y: number; z: number }> | undefined
      });
      return next ? `Updated "${id}".` : `No object with id "${id}". Call action=list to see current ids.`;
    }
    case 'remove': {
      const id = String(args.id || '');
      if (!id) return 'remove requires an id.';
      return removeObject(id) ? `Removed "${id}".` : `No object with id "${id}".`;
    }
    case 'clear': {
      const n = clearScene();
      return `Cleared ${n} object(s) from the scene.`;
    }
    default:
      return `Unknown scene_3d action: ${action}. Use list, add, transform, remove, or clear.`;
  }
}

async function runSceneAnnotations(args: ToolArgs): Promise<string> {
  const action = String(args.action || '').toLowerCase();
  switch (action) {
    case 'list': {
      const list = getAnnotations();
      const grid = getGrid();
      return JSON.stringify({ grid, annotations: list }, null, 2);
    }
    case 'remove': {
      const id = String(args.id || '');
      if (!id) return 'remove requires an id.';
      return removeAnnotation(id) ? `Removed annotation "${id}".` : `No annotation with id "${id}".`;
    }
    case 'clear': {
      const n = clearAnnotations();
      return `Cleared ${n} annotation(s).`;
    }
    default:
      return `Unknown scene_annotations action: ${action}. Use list, remove, or clear.`;
  }
}

const TOOL_HANDLERS: Record<string, (args: ToolArgs) => Promise<string>> = {
  run_shell_command: runShellCommand,
  browser_action: runBrowserAction,
  read_wiki: runReadWiki,
  web_search: runWebSearch,
  search: runWebSearch,
  update_user_memory: runUpdateUserMemory,
  get_current_time: runGetCurrentTime,
  clock: runGetCurrentTime,
  current_time: runGetCurrentTime,
  engineering_calculator: runEngineeringCalculator,
  calculator: runEngineeringCalculator,
  math_eval: runEngineeringCalculator,
  scene_3d: runScene3d,
  scene3d: runScene3d,
  three_d_scene: runScene3d,
  scene_annotations: runSceneAnnotations,
  annotations: runSceneAnnotations
};

/**
 * Dispatches a tool call by name and returns the textual result that should be
 * appended to the conversation as a `role: 'tool'` message. Legacy aliases
 * (search, calculator, math_eval, etc.) map to the canonical handler.
 */
export async function runTool(fn: string, args: ToolArgs): Promise<string> {
  const handler = TOOL_HANDLERS[fn];
  if (!handler) return `Unknown tool: ${fn}`;
  try {
    return await handler(args);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `Error executing tool ${fn}: ${msg}`;
  }
}
