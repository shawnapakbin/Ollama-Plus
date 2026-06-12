import { ipcService } from '../../../services/ipcService';
import {
  addModel,
  addPrimitive,
  clearScene,
  getSceneObjects,
  removeObject,
  transformObject,
  type PrimitiveKind,
  type ModelFormat
} from '../../../services/sceneStore';
import {
  clearAnnotations,
  getAnnotations,
  getGrid,
  removeAnnotation
} from '../../../services/annotationStore';
import { requestOpenViewer3D } from '../../../services/workspaceEvents';

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
            enum: ['list', 'add', 'transform', 'remove', 'clear', 'import_model', 'list_models'],
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
          },
          sourcePath: { type: 'string', description: 'Relative model path inside the selected Folder MCP root (for action=import_model).' },
          modelName: { type: 'string', description: 'Optional custom display name for an imported model.' },
          scanPath: { type: 'string', description: 'Optional subfolder path for action=list_models.' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'openscad_generate',
      description:
        'Compile OpenSCAD source into an STL model through the guarded MCP OpenSCAD runtime, then import it into the 3D workspace. Supports health checks and compile from inline source or a .scad file path under Folder MCP root.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['health', 'compile'],
            description: 'health checks OpenSCAD runtime availability; compile generates and imports STL.'
          },
          source: { type: 'string', description: 'Inline OpenSCAD source text (use with action=compile).' },
          sourcePath: { type: 'string', description: 'Relative .scad path under Folder MCP root (use with action=compile).' },
          parameters: { type: 'object', description: 'Optional parameter overrides map passed to OpenSCAD -D flags.' },
          modelName: { type: 'string', description: 'Optional display name for the imported model.' },
          createNew: { type: 'boolean', description: 'When true, keep prior models from the same source instead of replacing them.' },
          timeoutMs: { type: 'number', description: 'Optional compile timeout in milliseconds.' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'blender_plate_generate',
      description:
        'Run Blender Plate Python source through the guarded MCP Blender runtime, export to STL/OBJ/GLTF/GLB, then import into the 3D workspace. Supports health checks and compile from inline source or a .py file path under Folder MCP root.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['health', 'build'],
            description: 'health checks Blender runtime availability; build generates and imports a model.'
          },
          source: { type: 'string', description: 'Inline Blender Python source text (use with action=build).' },
          sourcePath: { type: 'string', description: 'Relative .py path under Folder MCP root (use with action=build).' },
          format: {
            type: 'string',
            enum: ['stl', 'obj', 'gltf', 'glb'],
            description: 'Output artifact format. Defaults to glb.'
          },
          modelName: { type: 'string', description: 'Optional display name for the imported model.' },
          createNew: { type: 'boolean', description: 'When true, keep prior models from the same source instead of replacing them.' },
          timeoutMs: { type: 'number', description: 'Optional build timeout in milliseconds.' },
          fallbackToOpenScad: { type: 'boolean', description: 'When true (default), .scad sourcePath requests are routed to openscad_generate compile.' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'blender_plate_scene',
      description:
        'Primary Blender Plate scene tool for small-model reliability. Manage Blender-owned scene objects with a concise action set, and delegate model builds through Blender Plate runtime when needed.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'add', 'transform', 'remove', 'clear', 'import_model', 'build'],
            description: 'Blender scene operation to perform.'
          },
          id: { type: 'string', description: 'Target object id for transform/remove.' },
          kind: {
            type: 'string',
            enum: ['box', 'sphere', 'cylinder', 'cone', 'plane', 'torus'],
            description: 'Primitive kind for action=add.'
          },
          name: { type: 'string', description: 'Optional friendly object name.' },
          color: { type: 'string', description: 'CSS color.' },
          size: { type: 'number', description: 'Base primitive size in scene units.' },
          position: {
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
            description: 'World-space position.'
          },
          rotation: {
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
            description: 'Euler rotation in radians.'
          },
          scale: {
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
            description: 'Per-axis scale.'
          },
          sourcePath: { type: 'string', description: 'Relative model path under Folder MCP root for import/build.' },
          source: { type: 'string', description: 'Inline Blender Python source for action=build.' },
          format: { type: 'string', enum: ['stl', 'obj', 'gltf', 'glb'], description: 'Build output format for action=build.' },
          modelName: { type: 'string', description: 'Optional imported model display name.' },
          createNew: { type: 'boolean', description: 'For action=build, keep prior models when true.' },
          timeoutMs: { type: 'number', description: 'Optional build timeout in milliseconds.' },
          fallbackToOpenScad: { type: 'boolean', description: 'For action=build, fallback .scad to OpenSCAD compile when true (default).' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'scene_annotations',
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
    function: {
      name: 'terminal_session',
      description:
        'Manage a persistent punchout terminal session backed by the local MCP terminal server. Use this when the model needs to inspect the OS, run commands interactively, keep process state across turns, or work inside the user-approved workspace file system. Prefer create/list/execute/read over one-shot shell execution when the task needs a real terminal session.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'list', 'read', 'write', 'execute', 'close'],
            description: 'Which terminal-session action to perform.'
          },
          sessionId: { type: 'string', description: 'Existing terminal session id.' },
          shell: { type: 'string', description: 'Optional shell override for create.' },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional shell args override for create.'
          },
          cwd: { type: 'string', description: 'Optional working directory relative to the configured terminal root.' },
          command: { type: 'string', description: 'Command to run in execute mode.' },
          input: { type: 'string', description: 'Raw input to send to a session.' },
          maxChars: { type: 'number', description: 'Maximum output size to read.' },
          clear: { type: 'boolean', description: 'Clear unread output after reading.' },
          timeoutMs: { type: 'number', description: 'Execution timeout in milliseconds.' },
          settleMs: { type: 'number', description: 'Idle settle window in milliseconds.' },
          approveRisky: { type: 'boolean', description: 'Explicitly approve a risky command.' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'python_terminal',
      description:
        'Use a local Python terminal session for 3D modeling, geometry generation, and offline rendering workflows. This runs directly on the user machine without Docker. Prefer this for Python-based modeling tasks that need a persistent interpreter session.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['health', 'create', 'list', 'read', 'write', 'execute', 'run', 'close'],
            description: 'Which Python terminal-session action to perform.'
          },
          sessionId: { type: 'string', description: 'Existing Python terminal session id.' },
          shell: { type: 'string', description: 'Optional shell override for create; defaults to the first available Python interpreter.' },
          args: { type: 'array', items: { type: 'string' }, description: 'Optional shell args override for create.' },
          cwd: { type: 'string', description: 'Optional working directory for the terminal session.' },
          command: { type: 'string', description: 'Python code or input to send in execute mode.' },
          input: { type: 'string', description: 'Raw input to send to an existing session.' },
          maxChars: { type: 'number', description: 'Maximum output size to read.' },
          clear: { type: 'boolean', description: 'Clear unread output after reading.' },
          timeoutMs: { type: 'number', description: 'Execution timeout in milliseconds.' },
          settleMs: { type: 'number', description: 'Idle settle window in milliseconds.' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'folder_mcp',
      description:
        'Operate on the user-selected Folder MCP root. This tool has unrestricted read/write access only inside that root and all subfolders. Use it for file workflows, project scaffolding, and model asset management without shell commands.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['root', 'select_root', 'clear_root', 'list', 'read', 'write', 'delete', 'rename', 'mkdir', 'list_models'],
            description: 'Which Folder MCP action to perform.'
          },
          path: { type: 'string', description: 'Relative path under the selected folder root.' },
          fromPath: { type: 'string', description: 'Source path for rename.' },
          toPath: { type: 'string', description: 'Destination path for rename.' },
          content: { type: 'string', description: 'Text content for write.' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_action',
      description:
        'Perform browser automation actions through the central MCP browser gateway. Supports multi-session and multi-page workflows for web browsing, interaction, extraction, and diagnostics.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: [
              'create_session',
              'list_sessions',
              'close_session',
              'create_page',
              'list_pages',
              'close_page',
              'activate_page',
              'goto',
              'click',
              'type',
              'press',
              'scroll',
              'wait',
              'screenshot',
              'content',
              'extract-text',
              'evaluate',
              'back',
              'forward',
              'reload',
              'set-headers',
              'get-cookies',
              'set-cookies',
              'reset'
            ],
            description: 'Browser gateway action to perform.'
          },
          sessionId: { type: 'string', description: 'Browser session id for multi-session operations.' },
          pageId: { type: 'string', description: 'Page id inside a browser session.' },
          url: { type: 'string', description: 'URL for navigation' },
          selector: { type: 'string', description: 'CSS selector for interaction' },
          text: { type: 'string', description: 'Text to type, scroll direction (up/down), or wait ms' },
          key: { type: 'string', description: 'Key to press (e.g. Enter)' },
          wait_for: { type: 'string', description: 'URL or selector to wait for' },
          script: { type: 'string', description: 'JS code for evaluate' },
          timeoutMs: { type: 'number', description: 'Optional per-action timeout in milliseconds.' },
          fullPage: { type: 'boolean', description: 'When true for screenshot, capture full page.' },
          headers: { type: 'object', description: 'Headers map for set-headers action.' },
          cookies: { type: 'array', items: { type: 'object' }, description: 'Cookie objects for set-cookies action.' }
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
      name: 'wiki_maintain',
      description:
        'Maintain the user wiki through MCP-backed operations (list/read/upsert/append/search). Use this for persistent user/profile knowledge and user-requested knowledge capture in markdown files.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['root', 'list', 'read', 'upsert_note', 'append_entry', 'search', 'set_root', 'set_autonomy', 'set_policy', 'reindex'],
            description: 'Wiki action to perform.'
          },
          path: { type: 'string', description: 'Relative wiki path for read/list/upsert/append.' },
          content: { type: 'string', description: 'Markdown note content for upsert_note.' },
          entry: { type: 'string', description: 'Entry text to append for append_entry.' },
          heading: { type: 'string', description: 'Optional heading for append_entry.' },
          explicit: { type: 'boolean', description: 'Set true only when the user explicitly asks to save or remember this content.' },
          category: { type: 'string', enum: ['profile', 'knowledge', 'journal'], description: 'Knowledge category hint used by wiki policy and default pathing.' },
          query: { type: 'string', description: 'Search query for action=search.' },
          maxResults: { type: 'number', description: 'Maximum search results.' },
          mode: { type: 'string', enum: ['auto', 'review', 'hybrid'], description: 'Autonomy mode for set_autonomy.' },
          level: { type: 'string', enum: ['strict', 'balanced', 'aggressive'], description: 'Knowledge policy level for set_policy.' },
          overwrite: { type: 'boolean', description: 'Whether upsert_note should overwrite aggressively.' }
        },
        required: ['action']
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

async function runBrowserAction(args: ToolArgs): Promise<string> {
  const res = await ipcService.browserAction(args);
  if (res.error) {
    return `Error: ${res.error}${formatPolicy(res.policy, 'deny')}`;
  }
  if (res.screenshot) {
    return `Action completed. Session: ${res.sessionId || 'default'}\nCurrent URL: ${res.url}\n[Screenshot captured]${formatPolicy(res.policy, 'allow')}`;
  }
  if (res.sessions || res.pages) {
    return JSON.stringify(res, null, 2);
  }
  const output = typeof res.result === 'string' ? res.result : JSON.stringify(res.result ?? res, null, 2);
  return `Action: ${args.action} completed.\nSession: ${res.sessionId || res.session?.sessionId || 'default'}\nURL: ${res.url || res.page?.url || ''}\nTitle: ${res.title || res.page?.title || ''}\n\nOutput: ${output}${formatPolicy(res.policy, 'allow')}`;
}

async function runReadWiki(args: ToolArgs): Promise<string> {
  const filepath = (args.filepath as string) || (args.path as string);
  const result = await ipcService.readWiki(filepath);
  return result || 'File not found.';
}

async function runWikiMaintain(args: ToolArgs): Promise<string> {
  const now = new Date();
  const category = String(args.category || '').toLowerCase();
  const explicit = args.explicit === true;
  const normalizePath = (fallback: string): string => {
    const raw = String(args.path || '').trim();
    if (raw) return raw;
    if (category === 'profile') return 'profile/preferences.md';
    if (category === 'journal') return `journal/${now.toISOString().slice(0, 7)}.md`;
    if (category === 'knowledge') return 'knowledge/topics/general.md';
    return fallback;
  };

  const action = String(args.action || '').toLowerCase();
  switch (action) {
    case 'root': {
      const cfg = await ipcService.getMcpWikiConfig();
      return JSON.stringify(cfg, null, 2);
    }
    case 'set_root': {
      const next = await ipcService.setMcpWikiRoot(typeof args.path === 'string' ? args.path : undefined);
      return next.canceled
        ? `Wiki folder selection canceled. Active root: ${next.root}`
        : `Wiki folder set to: ${next.root}`;
    }
    case 'set_autonomy': {
      const mode = String(args.mode || 'hybrid').toLowerCase() as 'auto' | 'review' | 'hybrid';
      const next = await ipcService.setMcpWikiAutonomyMode(mode);
      return `Wiki autonomy mode set to ${next.autonomyMode}.`;
    }
    case 'set_policy': {
      const level = String(args.level || 'strict').toLowerCase() as 'strict' | 'balanced' | 'aggressive';
      const next = await ipcService.setMcpWikiKnowledgePolicy(level);
      return `Wiki knowledge policy set to ${next.knowledgePolicy}.`;
    }
    case 'list': {
      const res = await ipcService.listMcpWiki((args.path as string) || '.');
      return JSON.stringify(res, null, 2);
    }
    case 'read': {
      const pathValue = String(args.path || args.filepath || '');
      if (!pathValue) return 'read requires a path.';
      const res = await ipcService.readMcpWiki(pathValue);
      return res.exists ? res.content : 'File not found.';
    }
    case 'upsert_note': {
      const pathValue = normalizePath('knowledge/topics/general.md');
      const content = String(args.content || '');
      const res = await ipcService.upsertMcpWikiNote(pathValue, content, Boolean(args.overwrite), explicit, category || 'knowledge');
      if (res.denied) return `Wiki update denied by policy (${res.reason || res.policy?.selectionId || 'deny'}).`;
      return `Saved wiki note to ${res.path}.`;
    }
    case 'append_entry': {
      const entry = String(args.entry || args.content || '');
      if (!entry.trim()) return 'append_entry requires entry content.';
      const pathValue = normalizePath(`journal/${now.toISOString().slice(0, 7)}.md`);
      const heading = (args.heading as string | undefined) || now.toISOString();
      const res = await ipcService.appendMcpWikiEntry(entry, pathValue, heading, explicit, category || (pathValue.startsWith('journal/') ? 'journal' : 'knowledge'));
      if (res.denied) return `Wiki append denied by policy (${res.reason || res.policy?.selectionId || 'deny'}).`;
      return `Appended wiki entry to ${res.path}.`;
    }
    case 'search': {
      const q = String(args.query || '');
      if (!q.trim()) return 'search requires a query.';
      const res = await ipcService.searchMcpWiki(q, typeof args.maxResults === 'number' ? args.maxResults : undefined);
      return JSON.stringify(res, null, 2);
    }
    case 'reindex': {
      const res = await ipcService.reindexMcpWiki();
      return `Reindexed wiki at ${res.indexedAt} (${res.fileCount} files).`;
    }
    default:
      return 'Unknown wiki_maintain action. Use root, list, read, upsert_note, append_entry, search, set_root, set_autonomy, set_policy, or reindex.';
  }
}

async function runWebSearch(args: ToolArgs): Promise<string> {
  return ipcService.webSearch((args.query as string) || (args.q as string));
}

async function runUpdateUserMemory(args: ToolArgs): Promise<string> {
  const content = String(args.content || '').trim();
  if (!content) return 'No memory content provided.';
  const res = await ipcService.appendMcpWikiEntry(content, 'profile/preferences.md', new Date().toISOString(), false, 'profile');
  if (res.denied) {
    return `Memory update denied by wiki policy (${res.reason || res.policy?.selectionId || 'deny'}).`;
  }
  return 'Memory updated successfully in profile/preferences.md.';
}

async function runGetCurrentTime(args: ToolArgs): Promise<string> {
  const res = await ipcService.getClock({
    timezone: (args.timezone as string) || (args.tz as string),
    locale: args.locale as string
  });
  return typeof res === 'string' ? res : JSON.stringify(res);
}

async function runTerminalSession(args: ToolArgs): Promise<string> {
  const action = String(args.action || '').toLowerCase();
  switch (action) {
    case 'create': {
      const session = await ipcService.createMcpTerminalSession({
        shell: args.shell as string | undefined,
        args: Array.isArray(args.args) ? (args.args as string[]) : undefined,
        cwd: args.cwd as string | undefined
      });
      return `Created terminal session ${session.id} (${session.shell}). CWD: ${session.cwd}`;
    }
    case 'list': {
      const sessions = await ipcService.listMcpTerminalSessions();
      return sessions.length ? JSON.stringify(sessions, null, 2) : 'No MCP terminal sessions are active.';
    }
    case 'read': {
      const res = await ipcService.readMcpTerminalOutput(String(args.sessionId || ''), args.maxChars as number | undefined, args.clear as boolean | undefined);
      return res.output ? res.output : `No unread output for session ${res.session.id}.`;
    }
    case 'write': {
      const res = await ipcService.writeMcpTerminalInput(String(args.sessionId || ''), String(args.input || ''));
      return `Wrote ${res.acceptedChars} character(s) to session ${res.session.id}${res.truncated ? ' (truncated).' : '.'}`;
    }
    case 'execute': {
      const res = await ipcService.executeMcpTerminalCommand(String(args.sessionId || ''), String(args.command || ''), {
        timeoutMs: args.timeoutMs as number | undefined,
        settleMs: args.settleMs as number | undefined,
        approveRisky: args.approveRisky as boolean | undefined
      });
      if (res.blocked) {
        return `Terminal command blocked: ${res.reason}`;
      }
      return `Session ${res.session.id} executed command. Output:\n${res.output || ''}`;
    }
    case 'close': {
      const res = await ipcService.closeMcpTerminalSession(String(args.sessionId || ''));
      return res.closed ? `Closed terminal session ${res.id}.` : `Failed to close terminal session ${res.id}.`;
    }
    default:
      return `Unknown terminal_session action: ${action}. Use create, list, read, write, execute, or close.`;
  }
}

async function runPythonTerminal(args: ToolArgs): Promise<string> {
  const action = String(args.action || '').toLowerCase();
  switch (action) {
    case 'health': {
      const res = await ipcService.checkMcpPythonSandbox();
      return res.ok
        ? `Python terminal ready: ${res.interpreter} (${res.note})`
        : `Python terminal unavailable: ${res.note}`;
    }
    case 'create': {
      const python = await ipcService.checkMcpPythonSandbox();
      if (!python.ok) return `Python terminal unavailable: ${python.note}`;
      const session = await ipcService.createMcpTerminalSession({
        shell: args.shell as string | undefined || python.shell,
        args: Array.isArray(args.args) ? (args.args as string[]) : python.args,
        cwd: args.cwd as string | undefined
      });
      return `Created Python terminal session ${session.id} (${session.shell}). CWD: ${session.cwd}`;
    }
    case 'list': {
      const sessions = await ipcService.listMcpTerminalSessions();
      const pythonSessions = sessions.filter((session) => String(session.shell || '').toLowerCase().includes('python') || String(session.shell || '').toLowerCase() === 'py');
      return pythonSessions.length ? JSON.stringify(pythonSessions, null, 2) : 'No Python terminal sessions are active.';
    }
    case 'read': {
      const res = await ipcService.readMcpTerminalOutput(String(args.sessionId || ''), args.maxChars as number | undefined, args.clear as boolean | undefined);
      return res.output ? res.output : `No unread output for session ${res.session.id}.`;
    }
    case 'write': {
      const res = await ipcService.writeMcpTerminalInput(String(args.sessionId || ''), String(args.input || ''));
      return `Wrote ${res.acceptedChars} character(s) to session ${res.session.id}${res.truncated ? ' (truncated).' : '.'}`;
    }
    case 'execute': {
      const res = await ipcService.executeMcpTerminalCommand(String(args.sessionId || ''), String(args.command || ''), {
        timeoutMs: args.timeoutMs as number | undefined,
        settleMs: args.settleMs as number | undefined,
        approveRisky: true
      });
      if (res.blocked) {
        return `Python terminal command blocked: ${res.reason}`;
      }
      return `Session ${res.session.id} executed command. Output:\n${res.output || ''}`;
    }
    case 'run': {
      const python = await ipcService.checkMcpPythonSandbox();
      if (!python.ok) return `Python terminal unavailable: ${python.note}`;
      const session = await ipcService.createMcpTerminalSession({
        shell: args.shell as string | undefined || python.shell,
        args: Array.isArray(args.args) ? (args.args as string[]) : python.args,
        cwd: args.cwd as string | undefined
      });
      const res = await ipcService.executeMcpTerminalCommand(session.id, String(args.command || ''), {
        timeoutMs: args.timeoutMs as number | undefined,
        settleMs: args.settleMs as number | undefined,
        approveRisky: true
      });
      if (res.blocked) {
        return `Python terminal command blocked: ${res.reason}`;
      }
      return JSON.stringify({ session: res.session, output: res.output }, null, 2);
    }
    case 'close': {
      const res = await ipcService.closeMcpTerminalSession(String(args.sessionId || ''));
      return res.closed ? `Closed Python terminal session ${res.id}.` : `Failed to close Python terminal session ${res.id}.`;
    }
    default:
      return `Unknown python_terminal action: ${action}. Use health, create, list, read, write, execute, run, or close.`;
  }
}

async function runFolderMcp(args: ToolArgs): Promise<string> {
  const action = String(args.action || '').toLowerCase();
  switch (action) {
    case 'root': {
      const root = await ipcService.getMcpFolderRoot();
      return JSON.stringify(root, null, 2);
    }
    case 'select_root': {
      const selected = await ipcService.selectMcpFolderRoot();
      return selected.canceled
        ? `Folder selection canceled. Active root: ${selected.root}`
        : `Folder root set to: ${selected.root}`;
    }
    case 'clear_root': {
      const cleared = await ipcService.clearMcpFolderRoot();
      return `Folder root reset to workspace default: ${cleared.root}`;
    }
    case 'list': {
      const res = await ipcService.listMcpFolder((args.path as string) || '.');
      return JSON.stringify(res, null, 2);
    }
    case 'read': {
      const res = await ipcService.readMcpFolderText(String(args.path || ''));
      return res.content;
    }
    case 'write': {
      const res = await ipcService.writeMcpFolderText(String(args.path || ''), String(args.content || ''));
      return `Wrote ${res.bytes} byte(s) to ${res.path}`;
    }
    case 'delete': {
      const res = await ipcService.deleteMcpFolderPath(String(args.path || ''));
      return res.deleted ? 'Deleted path.' : 'Path not found.';
    }
    case 'rename': {
      const res = await ipcService.renameMcpFolderPath(String(args.fromPath || ''), String(args.toPath || ''));
      return `Renamed ${res.from} -> ${res.to}`;
    }
    case 'mkdir': {
      const res = await ipcService.createMcpFolderDir(String(args.path || ''));
      return `Created directory: ${res.path}`;
    }
    case 'list_models': {
      const res = await ipcService.listMcpFolderModels((args.path as string) || '.');
      return JSON.stringify(res, null, 2);
    }
    default:
      return 'Unknown folder_mcp action. Use root, select_root, clear_root, list, read, write, delete, rename, mkdir, or list_models.';
  }
}

async function runEngineeringCalculator(args: ToolArgs): Promise<string> {
  const res = await ipcService.engineeringCalculator({
    expression: (args.expression ?? args.expr) as string,
    scope: args.scope as Record<string, unknown> | undefined
  });
  return typeof res === 'string' ? res : JSON.stringify(res);
}

async function runOpenScadGenerate(args: ToolArgs): Promise<string> {
  requestOpenViewer3D();
  const action = String(args.action || '').toLowerCase();

  if (action === 'health') {
    const res = await ipcService.mcpGatewayCall({
      server: 'openscad',
      action: 'health',
      payload: {}
    });
    if (!res.ok) return `OpenSCAD health check failed: ${res.error || 'Unknown error.'}`;
    return JSON.stringify(res.data, null, 2);
  }

  if (action !== 'compile') {
    return 'Unknown openscad_generate action. Use health or compile.';
  }

  const health = await ipcService.mcpGatewayCall({
    server: 'openscad',
    action: 'health',
    payload: {}
  });
  if (!health.ok) {
    return `OpenSCAD health check failed: ${health.error || 'Unknown error.'}`;
  }
  const healthData = (health.data || {}) as Record<string, unknown>;
  if (!healthData.ok) {
    return `OpenSCAD runtime unavailable: ${String(healthData.note || 'OpenSCAD is not ready.')}`;
  }

  const source = typeof args.source === 'string' ? args.source : undefined;
  const sourcePath = typeof args.sourcePath === 'string' ? args.sourcePath : undefined;
  const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined;
  const parameters = args.parameters as Record<string, unknown> | undefined;

  const compile = await ipcService.mcpGatewayCall({
    server: 'openscad',
    action: 'compile',
    payload: {
      source,
      sourcePath,
      parameters,
      timeoutMs,
      returnPayloadBase64: true
    }
  });

  if (!compile.ok) {
    return `OpenSCAD compile request failed: ${compile.error || 'Unknown error.'}`;
  }

  const result = (compile.data || {}) as Record<string, unknown>;
  if (!result.ok) {
    const category = String(result.errorCategory || 'ERROR');
    const error = String(result.error || 'OpenSCAD compile failed.');
    const stderr = typeof result.stderr === 'string' && result.stderr.trim()
      ? `\n\nCompiler stderr:\n${result.stderr}`
      : '';
    return `OpenSCAD ${category}: ${error}${stderr}`;
  }

  const payloadBase64 = String(result.payloadBase64 || '');
  if (!payloadBase64) {
    return 'OpenSCAD compile succeeded but no STL payload was returned.';
  }

  const modelSourcePath = String(result.modelSourcePath || sourcePath || `generated/openscad/${Date.now()}.stl`);
  const sourceInfo = (result.source && typeof result.source === 'object') ? (result.source as Record<string, unknown>) : {};
  const sourceHash = String(sourceInfo.sourceHash || '').trim();
  const paramsHash = String(sourceInfo.paramsHash || '').trim();
  const sourceKey = sourceHash && paramsHash ? `openscad:${sourceHash}:${paramsHash}` : modelSourcePath;
  const createNew = args.createNew === true;

  if (!createNew) {
    const existing = getSceneObjects().filter((obj) => {
      if (obj.kind !== 'model') return false;
      if (obj.sourceKey) return obj.sourceKey === sourceKey;
      return obj.sourcePath === modelSourcePath;
    });
    for (const obj of existing) {
      removeObject(obj.id);
    }
  }

  const artifact = (result.artifact && typeof result.artifact === 'object') ? (result.artifact as Record<string, unknown>) : {};

  const model = addModel({
    sourcePath: modelSourcePath,
    sourceKey,
    engineKind: 'openscad',
    modelFormat: 'stl',
    payloadBase64,
    name: (args.modelName as string) || String(artifact.name || 'OpenSCAD Model'),
    position: args.position as Partial<{ x: number; y: number; z: number }> | undefined,
    rotation: args.rotation as Partial<{ x: number; y: number; z: number }> | undefined,
    scale: args.scale as Partial<{ x: number; y: number; z: number }> | undefined
  });

  const durationMs = typeof result.durationMs === 'number' ? result.durationMs : undefined;
  const replacedMsg = createNew ? 'Created a new model entry.' : 'Replaced prior model(s) from the same source path.';
  return `Compiled OpenSCAD to STL and imported as id "${model.id}" (${model.name}). ${replacedMsg}${durationMs ? ` Compile time: ${durationMs} ms.` : ''}`;
}

function emitBlenderFallbackTelemetry(payload: {
  reason: string;
  sourceKind: 'scad_path' | 'scad_inline';
  requestedAction: string;
}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('ollama-plus:blender-fallback', {
    detail: {
      ...payload,
      at: new Date().toISOString()
    }
  }));
}

function looksLikeOpenScadSource(source: string): boolean {
  const text = source.trim();
  if (!text) return false;
  const hasConstruct = /\b(cube|sphere|cylinder|polyhedron|difference|union|intersection|module|linear_extrude|rotate_extrude)\s*\(/i.test(text);
  const hasStatement = /;/.test(text);
  const looksLikePython = /^\s*(import\s+|from\s+\w+\s+import\s+|def\s+\w+\s*\()/m.test(text);
  return hasConstruct && hasStatement && !looksLikePython;
}

async function tryOpenScadFallback(
  args: ToolArgs,
  reason: string,
  source?: string,
  sourcePath?: string
): Promise<string | null> {
  const fallbackToOpenScad = args.fallbackToOpenScad !== false;
  if (!fallbackToOpenScad) return null;

  const scadPath = sourcePath && /\.scad$/i.test(sourcePath) ? sourcePath : undefined;
  const scadSource = source && looksLikeOpenScadSource(source) ? source : undefined;
  if (!scadPath && !scadSource) return null;

  emitBlenderFallbackTelemetry({
    reason,
    sourceKind: scadPath ? 'scad_path' : 'scad_inline',
    requestedAction: String(args.action || 'build')
  });

  const fallbackOut = await runOpenScadGenerate({
    ...args,
    action: 'compile',
    source: scadSource,
    sourcePath: scadPath
  });
  return `Blender Plate fallback (${reason}) -> ${fallbackOut}`;
}

async function runBlenderPlateGenerate(args: ToolArgs): Promise<string> {
  requestOpenViewer3D();
  const action = String(args.action || '').toLowerCase();

  if (action === 'health') {
    const res = await ipcService.mcpGatewayCall({
      server: 'blender_plate',
      action: 'health',
      payload: {}
    });
    if (!res.ok) return `Blender Plate health check failed: ${res.error || 'Unknown error.'}`;
    return JSON.stringify(res.data, null, 2);
  }

  if (action !== 'build') {
    return 'Unknown blender_plate_generate action. Use health or build.';
  }

  const sourcePath = typeof args.sourcePath === 'string' ? args.sourcePath : undefined;
  const source = typeof args.source === 'string' ? args.source : undefined;
  const fallbackToOpenScad = args.fallbackToOpenScad !== false;
  if (sourcePath && /\.scad$/i.test(sourcePath) && fallbackToOpenScad) {
    const out = await runOpenScadGenerate({
      ...args,
      action: 'compile',
      source,
      sourcePath
    });
    return `Blender Plate fallback -> ${out}`;
  }

  const health = await ipcService.mcpGatewayCall({
    server: 'blender_plate',
    action: 'health',
    payload: {}
  });
  if (!health.ok) {
    const fallback = await tryOpenScadFallback(args, 'health request failed', source, sourcePath);
    if (fallback) return fallback;
    return `Blender Plate health check failed: ${health.error || 'Unknown error.'}`;
  }
  const healthData = (health.data || {}) as Record<string, unknown>;
  if (!healthData.ok) {
    const fallback = await tryOpenScadFallback(args, 'runtime unavailable', source, sourcePath);
    if (fallback) return fallback;
    return `Blender Plate runtime unavailable: ${String(healthData.note || 'Blender Plate is not ready.')}`;
  }

  const format = typeof args.format === 'string' ? args.format.toLowerCase() : 'glb';
  const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined;

  const build = await ipcService.mcpGatewayCall({
    server: 'blender_plate',
    action: 'build',
    payload: {
      source,
      sourcePath,
      format,
      timeoutMs,
      returnPayloadBase64: true
    }
  });

  if (!build.ok) {
    const fallback = await tryOpenScadFallback(args, 'build request failed', source, sourcePath);
    if (fallback) return fallback;
    return `Blender Plate build request failed: ${build.error || 'Unknown error.'}`;
  }

  const result = (build.data || {}) as Record<string, unknown>;
  if (!result.ok) {
    const fallback = await tryOpenScadFallback(args, String(result.errorCategory || 'build failed'), source, sourcePath);
    if (fallback) return fallback;
    const category = String(result.errorCategory || 'ERROR');
    const error = String(result.error || 'Blender Plate build failed.');
    const stderr = typeof result.stderr === 'string' && result.stderr.trim()
      ? `\n\nBlender stderr:\n${result.stderr}`
      : '';
    return `Blender Plate ${category}: ${error}${stderr}`;
  }

  const payloadBase64 = String(result.payloadBase64 || '');
  if (!payloadBase64) {
    return 'Blender Plate build succeeded but no payload was returned.';
  }

  const resultFormat = String(result.format || format || 'glb').toLowerCase() as ModelFormat;
  const modelSourcePath = String(result.modelSourcePath || sourcePath || `generated/blender_plate/${Date.now()}.${resultFormat}`);
  const sourceInfo = (result.source && typeof result.source === 'object') ? (result.source as Record<string, unknown>) : {};
  const sourceHash = String(sourceInfo.sourceHash || '').trim();
  const sourceKey = sourceHash ? `blender_plate:${sourceHash}:${resultFormat}` : modelSourcePath;
  const createNew = args.createNew === true;

  if (!createNew) {
    const existing = getSceneObjects().filter((obj) => {
      if (obj.kind !== 'model') return false;
      if (obj.sourceKey) return obj.sourceKey === sourceKey;
      return obj.sourcePath === modelSourcePath;
    });
    for (const obj of existing) {
      removeObject(obj.id);
    }
  }

  const artifact = (result.artifact && typeof result.artifact === 'object') ? (result.artifact as Record<string, unknown>) : {};
  const model = addModel({
    sourcePath: modelSourcePath,
    sourceKey,
    engineKind: 'blender_plate',
    modelFormat: resultFormat,
    payloadBase64,
    name: (args.modelName as string) || String(artifact.name || 'Blender Plate Model'),
    position: args.position as Partial<{ x: number; y: number; z: number }> | undefined,
    rotation: args.rotation as Partial<{ x: number; y: number; z: number }> | undefined,
    scale: args.scale as Partial<{ x: number; y: number; z: number }> | undefined
  });

  const durationMs = typeof result.durationMs === 'number' ? result.durationMs : undefined;
  const replacedMsg = createNew ? 'Created a new model entry.' : 'Replaced prior model(s) from the same source.';
  return `Built Blender Plate model (${resultFormat.toUpperCase()}) and imported as id "${model.id}" (${model.name}). ${replacedMsg}${durationMs ? ` Build time: ${durationMs} ms.` : ''}`;
}

function isBlenderOwnedObject(obj: { engineKind: string }): boolean {
  return obj.engineKind === 'blender_plate';
}

async function runBlenderPlateScene(args: ToolArgs): Promise<string> {
  requestOpenViewer3D();
  const action = String(args.action || '').toLowerCase();
  switch (action) {
    case 'list': {
      const blenderObjects = getSceneObjects().filter((obj) => isBlenderOwnedObject(obj));
      return JSON.stringify({
        engine: 'blender_plate',
        totalObjects: blenderObjects.length,
        objects: blenderObjects
      }, null, 2);
    }
    case 'add': {
      const kind = String(args.kind || 'box').toLowerCase() as PrimitiveKind;
      const allowed: PrimitiveKind[] = ['box', 'sphere', 'cylinder', 'cone', 'plane', 'torus'];
      if (!allowed.includes(kind)) return `Unsupported kind: ${kind}. Use one of ${allowed.join(', ')}.`;
      const obj = addPrimitive({
        kind,
        engineKind: 'blender_plate',
        name: args.name as string | undefined,
        color: args.color as string | undefined,
        size: typeof args.size === 'number' ? args.size : undefined,
        position: args.position as Partial<{ x: number; y: number; z: number }> | undefined,
        rotation: args.rotation as Partial<{ x: number; y: number; z: number }> | undefined,
        scale: args.scale as Partial<{ x: number; y: number; z: number }> | undefined
      });
      return `Blender Plate scene: added ${obj.kind} as id "${obj.id}".`;
    }
    case 'transform': {
      const id = String(args.id || '');
      if (!id) return 'transform requires an id.';
      const current = getSceneObjects().find((obj) => obj.id === id);
      if (!current) return `No object with id "${id}".`;
      if (!isBlenderOwnedObject(current)) {
        return `Object "${id}" is not Blender Plate-owned. Use scene_3d for legacy objects.`;
      }
      const next = transformObject(id, {
        name: args.name as string | undefined,
        color: args.color as string | undefined,
        size: typeof args.size === 'number' ? args.size : undefined,
        position: args.position as Partial<{ x: number; y: number; z: number }> | undefined,
        rotation: args.rotation as Partial<{ x: number; y: number; z: number }> | undefined,
        scale: args.scale as Partial<{ x: number; y: number; z: number }> | undefined
      });
      return next ? `Blender Plate scene: updated "${id}".` : `No object with id "${id}".`;
    }
    case 'remove': {
      const id = String(args.id || '');
      if (!id) return 'remove requires an id.';
      const current = getSceneObjects().find((obj) => obj.id === id);
      if (!current) return `No object with id "${id}".`;
      if (!isBlenderOwnedObject(current)) {
        return `Object "${id}" is not Blender Plate-owned. Use scene_3d for legacy objects.`;
      }
      return removeObject(id) ? `Blender Plate scene: removed "${id}".` : `No object with id "${id}".`;
    }
    case 'clear': {
      const blenderObjects = getSceneObjects().filter((obj) => isBlenderOwnedObject(obj));
      for (const obj of blenderObjects) {
        removeObject(obj.id);
      }
      return `Blender Plate scene: cleared ${blenderObjects.length} object(s).`;
    }
    case 'import_model': {
      const sourcePath = String(args.sourcePath || args.path || '').trim();
      if (!sourcePath) return 'import_model requires sourcePath (relative to Folder MCP root).';
      if (/\.scad$/i.test(sourcePath)) {
        return 'SCAD source files should be built via action="build" to allow Blender Plate fallback behavior.';
      }
      const payload = await ipcService.readMcpFolderModel(sourcePath);
      const format = payload.ext.replace('.', '').toLowerCase() as ModelFormat;
      const model = addModel({
        sourcePath: payload.path,
        sourceKey: `blender_plate:import:${payload.path}`,
        engineKind: 'blender_plate',
        modelFormat: format,
        payloadBase64: payload.base64,
        name: (args.modelName as string) || payload.name,
        position: args.position as Partial<{ x: number; y: number; z: number }> | undefined,
        rotation: args.rotation as Partial<{ x: number; y: number; z: number }> | undefined,
        scale: args.scale as Partial<{ x: number; y: number; z: number }> | undefined
      });
      return `Blender Plate scene: imported model ${payload.name} as id "${model.id}".`;
    }
    case 'build': {
      const out = await runBlenderPlateGenerate({
        ...args,
        action: 'build'
      });
      return `Blender Plate scene build -> ${out}`;
    }
    default:
      return 'Unknown blender_plate_scene action. Use list, add, transform, remove, clear, import_model, or build.';
  }
}

async function runScene3d(args: ToolArgs): Promise<string> {
  requestOpenViewer3D();
  const action = String(args.action || '').toLowerCase();
  switch (action) {
    case 'list': {
      const list = getSceneObjects();
      if (list.length === 0) return 'Scene is empty.';
      return JSON.stringify(list, null, 2);
    }
    case 'list_models': {
      const listed = await ipcService.listMcpFolderModels((args.scanPath as string) || '.');
      return JSON.stringify(listed, null, 2);
    }
    case 'add': {
      if (Array.isArray(args.kind)) {
        return 'scene_3d add expects a single kind string such as "sphere". To add multiple objects, emit separate scene_3d JSON calls, one per object.';
      }
      const kind = String(args.kind || 'box').toLowerCase() as PrimitiveKind;
      const allowed: PrimitiveKind[] = ['box', 'sphere', 'cylinder', 'cone', 'plane', 'torus'];
      if (!allowed.includes(kind)) return `Unsupported kind: ${kind}. Use one of ${allowed.join(', ')}.`;
      const obj = addPrimitive({
        kind,
        engineKind: 'legacy_scene3d',
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
    case 'import_model': {
      const sourcePath = String(args.sourcePath || args.path || '').trim();
      if (!sourcePath) return 'import_model requires sourcePath (relative to Folder MCP root).';
      if (/\.scad$/i.test(sourcePath)) {
        return 'SCAD source files must be compiled before import. Use openscad_generate with action="compile" and sourcePath.';
      }
      const payload = await ipcService.readMcpFolderModel(sourcePath);
      const format = payload.ext.replace('.', '').toLowerCase() as ModelFormat;
      const model = addModel({
        sourcePath: payload.path,
        engineKind: 'legacy_scene3d',
        modelFormat: format,
        payloadBase64: payload.base64,
        name: (args.modelName as string) || payload.name,
        position: args.position as Partial<{ x: number; y: number; z: number }> | undefined,
        rotation: args.rotation as Partial<{ x: number; y: number; z: number }> | undefined,
        scale: args.scale as Partial<{ x: number; y: number; z: number }> | undefined
      });
      return `Imported model ${payload.name} as id "${model.id}" from ${payload.path}.`;
    }
    default:
      return `Unknown scene_3d action: ${action}. Use list, add, transform, remove, clear, import_model, or list_models.`;
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
  browser_action: runBrowserAction,
  read_wiki: runReadWiki,
  wiki_maintain: runWikiMaintain,
  wiki_mcp: runWikiMaintain,
  mcp_wiki: runWikiMaintain,
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
  blender_plate_scene: runBlenderPlateScene,
  blender_scene: runBlenderPlateScene,
  blender_plate_generate: runBlenderPlateGenerate,
  blender_plate: runBlenderPlateGenerate,
  blender_generate: runBlenderPlateGenerate,
  openscad_generate: runOpenScadGenerate,
  openscad: runOpenScadGenerate,
  scene_annotations: runSceneAnnotations,
  annotations: runSceneAnnotations,
  terminal_session: runTerminalSession,
  mcp_terminal: runTerminalSession,
  python_terminal: runPythonTerminal,
  python_sandbox: runPythonTerminal,
  mcp_python_sandbox: runPythonTerminal,
  folder_mcp: runFolderMcp,
  mcp_folder: runFolderMcp
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
