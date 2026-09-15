/**
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Registers every MCP tool's Gateway_Routes on a gateway instance.
 *
 * This is the importable seam for the route registration that previously lived
 * inline in electron/main.js. It takes a gateway (from createGateway()) plus the
 * tool library functions and path helpers as injected dependencies, so the exact
 * set of routes and their metadata can be registered and asserted without
 * importing the Electron main process.
 *
 * Behavior is identical to the previous inline registration: the same routes,
 * the same handler adaptation, and the same metadata are registered under the
 * servers `browser`, `terminal`, `folder`, `python`, `openscad`, and
 * `blender_plate`.
 */

/**
 * Register all MCP gateway routes on the provided gateway.
 *
 * @param {object} gateway A gateway created by createGateway(); must expose register().
 * @param {object} deps Injected tool library functions and path helpers.
 */
export function registerGatewayRoutes(gateway, deps) {
  if (!gateway || typeof gateway.register !== 'function') {
    throw new Error('registerGatewayRoutes requires a gateway with a register() method.');
  }
  if (!deps || typeof deps !== 'object') {
    throw new Error('registerGatewayRoutes requires an injected dependencies object.');
  }

  const {
    // Browser (playwrightSessions.mjs)
    createBrowserSession,
    listBrowserSessions,
    closeBrowserSession,
    createBrowserPage,
    listBrowserPages,
    activateBrowserPage,
    closeBrowserPage,
    executeBrowserSessionAction,
    // Terminal (terminalSessions.mjs)
    createTerminalSession,
    listTerminalSessions,
    readTerminalOutput,
    writeTerminalInput,
    executeTerminalCommand,
    closeTerminalSession,
    // Folder (folderOps.mjs)
    listDirectory,
    readTextFile,
    writeTextFile,
    createTextFile,
    deletePath,
    renamePath,
    // Python sandbox (pythonSandbox.mjs)
    checkDockerAvailable,
    runSandboxedPython,
    listSandboxRuns,
    readRunArtifact,
    // OpenSCAD (openscad.mjs)
    checkOpenScadHealth,
    compileOpenScad,
    // Blender Plate (blenderPlate.mjs)
    checkBlenderPlateHealth,
    buildBlenderPlate,
    // Path confinement (security.mjs + node:path)
    getFileRoot,
    resolveInsideRoot,
    relativePath
  } = deps;

  // Resolve a sourcePath argument to a target inside the file root, returning
  // both the absolute target and the root-relative path. Shared by OpenSCAD
  // compile and Blender Plate build for their `sourcePath` input mode.
  const resolveOpenScadSourcePath = (sourcePath) => {
    const target = resolveInsideRoot(getFileRoot(), String(sourcePath || ''));
    const relPath = relativePath(getFileRoot(), target).replace(/\\/g, '/');
    return { target, relPath };
  };

  // ─── Browser (8 routes) ─────────────────────────────────────────────────────
  gateway.register('browser', 'create_session', async (payload) => createBrowserSession(payload), {
    description: 'Launch a new headless browser session and open its first page. Returns the session summary and the initial page.',
    parameters: {
      type: 'object',
      properties: {
        headless: { type: 'boolean', description: 'Run the browser without a visible window. Defaults to true.' },
        executablePath: { type: 'string', description: 'Absolute path to the browser executable to launch. Optional; a platform default is used when omitted.' },
        userAgent: { type: 'string', description: 'Override the browser context User-Agent string.' },
        viewport: {
          type: 'object',
          description: 'Initial viewport dimensions for the browser context.',
          properties: {
            width: { type: 'number' },
            height: { type: 'number' }
          }
        },
        firstPage: {
          type: 'object',
          description: 'Options for the first page opened in the session (e.g. an initial url to navigate to and a navigation timeoutMs).',
          properties: {
            url: { type: 'string' },
            timeoutMs: { type: 'number' }
          }
        }
      }
    }
  });
  gateway.register('browser', 'list_sessions', async () => listBrowserSessions(), {
    description: 'List all active browser sessions with their summaries. Takes no parameters.',
    parameters: { type: 'object', properties: {} }
  });
  gateway.register('browser', 'close_session', async (payload) => closeBrowserSession(String(payload.sessionId || '')), {
    description: 'Close a browser session by id, releasing its browser, context, and pages.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Identifier of the session to close.' }
      },
      required: ['sessionId']
    }
  });
  gateway.register('browser', 'create_page', async (payload) => createBrowserPage(String(payload.sessionId || ''), payload), {
    description: 'Open a new page in an existing browser session and make it the active page.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Identifier of the session to open the page in.' },
        url: { type: 'string', description: 'Optional URL to navigate the new page to immediately.' },
        timeoutMs: { type: 'number', description: 'Navigation timeout in milliseconds when a url is provided.' }
      },
      required: ['sessionId']
    }
  });
  gateway.register('browser', 'list_pages', async (payload) => listBrowserPages(String(payload.sessionId || '')), {
    description: 'List all pages in a browser session along with the session summary.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Identifier of the session whose pages to list.' }
      },
      required: ['sessionId']
    }
  });
  gateway.register('browser', 'activate_page', async (payload) => activateBrowserPage(String(payload.sessionId || ''), String(payload.pageId || '')), {
    description: 'Make a specific page the active page within its browser session.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Identifier of the session that owns the page.' },
        pageId: { type: 'string', description: 'Identifier of the page to activate.' }
      },
      required: ['sessionId', 'pageId']
    }
  });
  gateway.register('browser', 'close_page', async (payload) => closeBrowserPage(String(payload.sessionId || ''), String(payload.pageId || '')), {
    description: 'Close a specific page within a browser session.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Identifier of the session that owns the page.' },
        pageId: { type: 'string', description: 'Identifier of the page to close.' }
      },
      required: ['sessionId', 'pageId']
    }
  });
  gateway.register('browser', 'action', async (payload) => executeBrowserSessionAction(String(payload.sessionId || ''), payload), {
    description: 'Perform a browser action (navigation, interaction, capture, or cookie/header management) on the active or specified page of a session.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'The browser action to perform.',
          enum: [
            'goto', 'click', 'type', 'press', 'scroll', 'wait', 'back', 'forward',
            'reload', 'evaluate', 'screenshot', 'content', 'extract-text',
            'set-headers', 'get-cookies', 'set-cookies'
          ]
        },
        sessionId: { type: 'string', description: 'Identifier of the target session.' },
        pageId: { type: 'string', description: 'Identifier of the target page. Defaults to the session active page when omitted.' },
        url: { type: 'string', description: 'Target URL for the "goto" action.' },
        selector: { type: 'string', description: 'CSS selector for "click", "type", "press", or "scroll" actions.' },
        text: { type: 'string', description: 'Text to type for "type", or scroll direction ("down"/"up") for "scroll".' },
        key: { type: 'string', description: 'Key to press for the "press" action (e.g. "Enter").' },
        timeoutMs: { type: 'number', description: 'Action timeout in milliseconds.' },
        wait_for: { type: 'string', description: 'For the "wait" action: a URL (http...) to wait for, or a selector to wait to appear.' },
        ms: { type: 'number', description: 'For the "wait" action: milliseconds to wait when no wait_for is provided.' },
        script: { type: 'string', description: 'JavaScript to run in the page for the "evaluate" action.' },
        fullPage: { type: 'boolean', description: 'Capture the full scrollable page for the "screenshot" action.' },
        headers: { type: 'object', description: 'Extra HTTP headers to set for the "set-headers" action.' },
        cookies: { type: 'array', description: 'Cookies to add for the "set-cookies" action.', items: { type: 'object' } }
      },
      required: ['action']
    }
  });

  // ─── Terminal (6 routes) ─────────────────────────────────────────────────────
  gateway.register('terminal', 'create_session', async (payload) => createTerminalSession(payload), {
    description: 'Create a new PTY-backed terminal session confined to the terminal root and return its summary.',
    parameters: {
      type: 'object',
      properties: {
        shell: { type: 'string', description: 'Shell executable to launch. Defaults to the platform shell when omitted.' },
        args: { type: 'array', description: 'Arguments passed to the shell.', items: { type: 'string' } },
        cwd: { type: 'string', description: 'Working directory relative to the terminal root. Defaults to the root.' }
      }
    }
  });

  gateway.register('terminal', 'list_sessions', async () => listTerminalSessions(), {
    description: 'List all active terminal sessions with their summaries. Takes no parameters.',
    parameters: { type: 'object', properties: {} }
  });

  gateway.register('terminal', 'read_output', async (payload) => readTerminalOutput(String(payload.sessionId || ''), payload.maxChars, payload.clear), {
    description: 'Read buffered output from a terminal session, optionally clearing the unread buffer.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Identifier of the target session.' },
        maxChars: { type: 'number', description: 'Maximum number of characters to return (clamped 1-64000, default 32000).' },
        clear: { type: 'boolean', description: 'Whether to clear the unread buffer after reading. Defaults to true.' }
      },
      required: ['sessionId']
    }
  });

  gateway.register('terminal', 'write_input', async (payload) => writeTerminalInput(String(payload.sessionId || ''), String(payload.input || '')), {
    description: 'Write raw input to a terminal session without waiting for command completion.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Identifier of the target session.' },
        input: { type: 'string', description: 'Input text to write to the session.' }
      },
      required: ['sessionId', 'input']
    }
  });

  gateway.register('terminal', 'execute_command', async (payload) => executeTerminalCommand(String(payload.sessionId || ''), String(payload.command || ''), {
    timeoutMs: payload.timeoutMs,
    settleMs: payload.settleMs,
    approveRisky: payload.approveRisky === true
  }), {
    description: 'Run a command in a terminal session and wait for output to settle. Risky or non-allowlisted commands return a blocked result.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Identifier of the target session.' },
        command: { type: 'string', description: 'Command to execute in the session.' },
        timeoutMs: { type: 'number', description: 'Overall wait timeout in milliseconds (clamped 100-60000, default 8000).' },
        settleMs: { type: 'number', description: 'Idle settle interval in milliseconds (clamped 50-5000, default 350).' },
        approveRisky: { type: 'boolean', description: 'Set true to allow commands that match a risky pattern.' }
      },
      required: ['sessionId', 'command']
    }
  });

  gateway.register('terminal', 'close_session', async (payload) => closeTerminalSession(String(payload.sessionId || '')), {
    description: 'Close a terminal session by id, terminating its underlying process.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Identifier of the target session.' }
      },
      required: ['sessionId']
    }
  });

  // ─── Folder (6 routes) ───────────────────────────────────────────────────────
  gateway.register('folder', 'list', async (payload) => listDirectory(String(payload.path || '.')), {
    description: 'List the entries of a directory within the file root. Path is optional and defaults to the root.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path relative to the file root. Defaults to the root when omitted.' }
      }
    }
  });

  gateway.register('folder', 'read', async (payload) => readTextFile(String(payload.path || '')), {
    description: 'Read a UTF-8 text file within the file root and return its content and metadata.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the file root.' }
      },
      required: ['path']
    }
  });

  gateway.register('folder', 'write', async (payload) => writeTextFile(String(payload.path || ''), String(payload.content ?? '')), {
    description: 'Write UTF-8 text to a file within the file root, creating parent directories as needed. Returns the resulting file metadata.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the file root.' },
        content: { type: 'string', description: 'Text content to write to the file.' }
      },
      required: ['path']
    }
  });

  gateway.register('folder', 'create', async (payload) => createTextFile(String(payload.path || ''), String(payload.content ?? '')), {
    description: 'Create a UTF-8 text file within the file root, always creating parent directories. Returns the resulting file metadata.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the file root.' },
        content: { type: 'string', description: 'Initial text content for the file.' }
      },
      required: ['path']
    }
  });

  gateway.register('folder', 'delete', async (payload) => deletePath(String(payload.path || '')), {
    description: 'Delete a file or directory within the file root. Returns whether the target was deleted or was already missing.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the file root to delete.' }
      },
      required: ['path']
    }
  });

  gateway.register('folder', 'rename', async (payload) => renamePath(String(payload.fromPath || ''), String(payload.toPath || '')), {
    description: 'Rename or move a file or directory within the file root. Both paths are confined to the root.',
    parameters: {
      type: 'object',
      properties: {
        fromPath: { type: 'string', description: 'Source path relative to the file root.' },
        toPath: { type: 'string', description: 'Destination path relative to the file root.' }
      },
      required: ['fromPath', 'toPath']
    }
  });

  // ─── Python sandbox (4 routes) ───────────────────────────────────────────────
  gateway.register('python', 'health', async () => {
    try {
      const version = await checkDockerAvailable();
      return { ok: true, docker: version };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, {
    description: 'Report Python sandbox availability by probing Docker. Returns the detected Docker version when available and a Docker-unavailable failure otherwise. Takes no parameters.',
    parameters: { type: 'object', properties: {} }
  });

  gateway.register('python', 'run', async (payload) => runSandboxedPython({
    code: String(payload.code || ''),
    timeoutSec: payload.timeoutSec,
    image: payload.image,
    approveUnsafe: payload.approveUnsafe === true
  }), {
    description: 'Run Python code in an isolated Docker sandbox and return its captured stdout, stderr, exit code, and truncation flag. Blocked-pattern code is rejected unless approveUnsafe is set.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Python source code to execute in the sandbox.' },
        timeoutSec: { type: 'number', description: 'Execution timeout in seconds, clamped to 1-120. Defaults to 30 when omitted.' },
        image: { type: 'string', description: 'Docker image to run. Defaults to the built-in Python 3D image.' },
        approveUnsafe: { type: 'boolean', description: 'Set true to allow code that matches a blocked pattern to run.' }
      },
      required: ['code']
    }
  });

  gateway.register('python', 'list_runs', async (payload) => listSandboxRuns(payload.limit), {
    description: 'List recent sandbox run records from the sandbox root, most recent first. An optional limit caps the number of records returned.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of run records to return. Returns all runs when omitted.' }
      }
    }
  });

  gateway.register('python', 'read_artifact', async (payload) => readRunArtifact(String(payload.runId || ''), String(payload.fileName || '')), {
    description: 'Read an artifact file produced by a previous sandbox run. The file is confined to the run directory within the sandbox root.',
    parameters: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Identifier of the sandbox run that produced the artifact.' },
        fileName: { type: 'string', description: 'Artifact file name relative to the run directory.' }
      },
      required: ['runId', 'fileName']
    }
  });

  // ─── OpenSCAD (2 routes) ─────────────────────────────────────────────────────
  gateway.register('openscad', 'health', async () => checkOpenScadHealth(), {
    description: 'Report OpenSCAD availability by probing the OpenSCAD CLI. Returns the detected executable and version when available and a not-found note otherwise. Takes no parameters.',
    parameters: { type: 'object', properties: {} }
  });

  gateway.register('openscad', 'compile', async (payload) => compileOpenScad(payload, { resolveSourcePath: resolveOpenScadSourcePath }), {
    description: 'Compile OpenSCAD source into an STL artifact. Provide exactly one of source (inline SCAD string) or sourcePath (a .scad file relative to the file root). Optional parameters override SCAD variables. When OpenSCAD is not installed the call returns a semantic failure with no artifact.',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Inline OpenSCAD source. Provide exactly one of source or sourcePath.' },
        sourcePath: { type: 'string', description: 'Path to a .scad file relative to the file root. Provide exactly one of source or sourcePath.' },
        parameters: { type: 'object', description: 'Map of SCAD variable names to number, boolean, or string values passed as -D overrides.' },
        timeoutMs: { type: 'number', description: 'Compile timeout in milliseconds, clamped to 1000-180000. Defaults to 45000 when omitted.' },
        maxArtifactBytes: { type: 'number', description: 'Maximum accepted STL artifact size in bytes. Larger artifacts are rejected.' },
        returnPayloadBase64: { type: 'boolean', description: 'When true (default), include the STL artifact as a base64 payload in the result.' }
      }
    }
  });

  // ─── Blender Plate (2 routes) ────────────────────────────────────────────────
  gateway.register('blender_plate', 'health', async () => checkBlenderPlateHealth(), {
    description: 'Report Blender availability by probing the Blender CLI. Returns the detected executable and version when available and a not-found note otherwise. Takes no parameters.',
    parameters: { type: 'object', properties: {} }
  });

  gateway.register('blender_plate', 'build', async (payload) => buildBlenderPlate(payload, { resolveSourcePath: resolveOpenScadSourcePath }), {
    description: 'Run a Blender Python script headlessly and export the scene to a 3D model artifact. Provide exactly one of source (inline Python string) or sourcePath (a .py file relative to the file root). When Blender is not installed the call returns a semantic failure with no artifact.',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Inline Blender Python script. Provide exactly one of source or sourcePath.' },
        sourcePath: { type: 'string', description: 'Path to a .py Blender script relative to the file root. Provide exactly one of source or sourcePath.' },
        format: { type: 'string', description: 'Export format: stl, obj, gltf, or glb. Defaults to glb when omitted.' },
        timeoutMs: { type: 'number', description: 'Build timeout in milliseconds, clamped to 1000-300000. Defaults to 120000 when omitted.' },
        maxArtifactBytes: { type: 'number', description: 'Maximum accepted artifact size in bytes. Larger artifacts are rejected.' },
        returnPayloadBase64: { type: 'boolean', description: 'When true (default), include the exported artifact as a base64 payload in the result.' }
      }
    }
  });
}
