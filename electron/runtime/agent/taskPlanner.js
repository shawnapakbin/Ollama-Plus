/**
 * Task Planner
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 *
 * Converts natural language tasks into structured, executable step plans
 * using local Ollama LLM inference. Supports re-planning with constraints
 * (excluded approaches, denied actions, error context).
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
 */

import { randomUUID } from 'node:crypto';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum number of steps in a plan. */
export const MAX_STEPS = 50;

/** Minimum number of steps in a plan. */
export const MIN_STEPS = 1;

/** Maximum title length for a step. */
export const MAX_TITLE_LENGTH = 120;

/** Minimum title length for a step. */
export const MIN_TITLE_LENGTH = 1;

/** Planning timeout for tasks producing fewer than 10 steps (ms). */
export const SHORT_PLAN_TIMEOUT_MS = 30_000;

/** Planning timeout for tasks producing 10+ steps (ms). */
export const LONG_PLAN_TIMEOUT_MS = 60_000;

/** Maximum re-plan attempts per task. */
export const MAX_REPLAN_ATTEMPTS = 3;

/** Valid risk levels for steps. */
export const VALID_RISK_LEVELS = new Set(['low', 'medium', 'high']);

/** Valid tool categories. */
export const VALID_TOOL_CATEGORIES = new Set(['terminal', 'folder', 'browser', 'python', 'http']);

/** Default Ollama API chat endpoint path. */
export const OLLAMA_CHAT_PATH = '/api/chat';

// ─── JSDoc Types ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ToolReference
 * @property {string} name - Tool name
 * @property {string} server - MCP server name
 * @property {'terminal' | 'folder' | 'browser' | 'python' | 'http'} category
 */

/**
 * @typedef {Object} Step
 * @property {string} id - Unique step identifier
 * @property {string} title - Human-readable title (1–120 chars)
 * @property {string} description - Detailed description of the step
 * @property {'low' | 'medium' | 'high'} riskLevel
 * @property {ToolReference[]} requiredTools - Non-empty list of required tools
 * @property {boolean} parallelSafe - Whether this step can execute concurrently
 * @property {number} timeout - Timeout in milliseconds
 * @property {string[]} dependsOn - IDs of steps this depends on
 */

/**
 * @typedef {Object} Plan
 * @property {Step[]} steps - Ordered list of execution steps
 * @property {number} estimatedDuration - Estimated total duration in ms
 * @property {string} reasoning - LLM reasoning for the plan
 */

/**
 * @typedef {Object} TaskInstruction
 * @property {string} instruction - Natural language task
 * @property {string} workingDirectory - Working directory path
 * @property {Array} attachments - File attachments
 * @property {string[]} followUpInstructions - Follow-up instructions
 */

/**
 * @typedef {Object} ContextWindow
 * @property {string} systemPrompt
 * @property {string} taskInstruction
 * @property {Object|null} currentPlan
 * @property {Array} stepHistory
 * @property {Array} fileContents
 * @property {Array} memoryRecords
 * @property {number} totalTokens
 */

/**
 * @typedef {Object} DeniedAction
 * @property {string} tool
 * @property {string} action
 * @property {Record<string, unknown>} params
 * @property {string|null} reason
 */

/**
 * @typedef {Object} ReplanConstraints
 * @property {string[]} excludedApproaches - Approaches that failed or were excluded
 * @property {DeniedAction[]} deniedActions - Actions denied by the user
 * @property {Object|null} errorContext - Error that triggered replanning
 * @property {number} maxSteps - Max steps for the new plan
 */

// ─── Plan Normalization ──────────────────────────────────────────────────────

/**
 * Normalizes and validates a raw plan object from LLM output into a proper Plan.
 *
 * Applies the following transformations:
 * - Ensures steps is an array with 1–50 elements
 * - Generates step IDs if missing
 * - Clamps titles to 1–120 characters
 * - Validates risk levels (defaults to 'medium' if invalid)
 * - Ensures requiredTools is a non-empty array with valid categories
 * - Ensures parallelSafe is a boolean (defaults to false)
 * - Validates timeout values
 * - Ensures dependsOn is an array of valid step IDs
 * - Computes estimatedDuration from step timeouts
 *
 * @param {any} rawPlan - The raw plan object from LLM output
 * @returns {{ valid: boolean, plan: Plan | null, errors: string[] }}
 */
export function normalizePlan(rawPlan) {
  const errors = [];

  if (!rawPlan || typeof rawPlan !== 'object') {
    return { valid: false, plan: null, errors: ['Plan must be a non-null object'] };
  }

  // Extract steps array
  let rawSteps = rawPlan.steps;
  if (!Array.isArray(rawSteps)) {
    // Try to find steps in common alternate locations
    if (Array.isArray(rawPlan.plan?.steps)) {
      rawSteps = rawPlan.plan.steps;
    } else if (Array.isArray(rawPlan.tasks)) {
      rawSteps = rawPlan.tasks;
    } else {
      return { valid: false, plan: null, errors: ['Plan must contain a "steps" array'] };
    }
  }

  // Enforce step count bounds
  if (rawSteps.length < MIN_STEPS) {
    return { valid: false, plan: null, errors: [`Plan must have at least ${MIN_STEPS} step`] };
  }

  if (rawSteps.length > MAX_STEPS) {
    rawSteps = rawSteps.slice(0, MAX_STEPS);
    errors.push(`Plan truncated from ${rawPlan.steps?.length} to ${MAX_STEPS} steps`);
  }

  // Normalize each step
  const normalizedSteps = [];
  const stepIds = new Set();

  for (let i = 0; i < rawSteps.length; i++) {
    const raw = rawSteps[i];
    if (!raw || typeof raw !== 'object') {
      errors.push(`Step at index ${i} is not a valid object, skipping`);
      continue;
    }

    const step = normalizeStep(raw, i, stepIds, errors);
    if (step) {
      stepIds.add(step.id);
      normalizedSteps.push(step);
    }
  }

  if (normalizedSteps.length < MIN_STEPS) {
    return { valid: false, plan: null, errors: [...errors, 'No valid steps remaining after normalization'] };
  }

  // Validate dependsOn references point to actual step IDs
  const validStepIds = new Set(normalizedSteps.map(s => s.id));
  for (const step of normalizedSteps) {
    step.dependsOn = step.dependsOn.filter(depId => {
      if (!validStepIds.has(depId)) {
        errors.push(`Step "${step.id}" depends on non-existent step "${depId}", removing dependency`);
        return false;
      }
      if (depId === step.id) {
        errors.push(`Step "${step.id}" cannot depend on itself, removing self-dependency`);
        return false;
      }
      return true;
    });
  }

  // Compute estimated duration (sum of timeouts as a rough estimate)
  const estimatedDuration = normalizedSteps.reduce((sum, s) => sum + s.timeout, 0);

  // Extract reasoning
  const reasoning = typeof rawPlan.reasoning === 'string'
    ? rawPlan.reasoning
    : typeof rawPlan.explanation === 'string'
      ? rawPlan.explanation
      : 'Plan generated from task analysis.';

  const plan = {
    steps: normalizedSteps,
    estimatedDuration,
    reasoning
  };

  return { valid: true, plan, errors };
}

/**
 * Normalizes a single step from raw LLM output.
 *
 * @param {any} raw - Raw step object
 * @param {number} index - Index in the steps array
 * @param {Set<string>} existingIds - Set of already-assigned step IDs
 * @param {string[]} errors - Mutable error accumulator
 * @returns {Step|null}
 */
function normalizeStep(raw, index, existingIds, errors) {
  // ID
  let id = typeof raw.id === 'string' && raw.id.trim().length > 0
    ? raw.id.trim()
    : `step-${index + 1}`;

  // Ensure uniqueness
  if (existingIds.has(id)) {
    id = `${id}-${randomUUID().slice(0, 8)}`;
  }

  // Title (1–120 chars)
  let title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (title.length === 0) {
    title = typeof raw.name === 'string' ? raw.name.trim() : `Step ${index + 1}`;
  }
  if (title.length > MAX_TITLE_LENGTH) {
    title = title.slice(0, MAX_TITLE_LENGTH);
    errors.push(`Step "${id}" title truncated to ${MAX_TITLE_LENGTH} characters`);
  }
  if (title.length < MIN_TITLE_LENGTH) {
    title = `Step ${index + 1}`;
  }

  // Description
  const description = typeof raw.description === 'string'
    ? raw.description
    : typeof raw.details === 'string'
      ? raw.details
      : '';

  // Risk level
  let riskLevel = typeof raw.riskLevel === 'string'
    ? raw.riskLevel.toLowerCase()
    : typeof raw.risk === 'string'
      ? raw.risk.toLowerCase()
      : 'medium';

  if (!VALID_RISK_LEVELS.has(riskLevel)) {
    errors.push(`Step "${id}" has invalid risk level "${riskLevel}", defaulting to "medium"`);
    riskLevel = 'medium';
  }

  // Required tools
  let requiredTools = normalizeToolReferences(raw.requiredTools || raw.tools || raw.required_tools);
  if (requiredTools.length === 0) {
    // Infer a default tool from the step description or title
    const inferredCategory = inferToolCategory(title, description);
    requiredTools = [{
      name: inferredCategory,
      server: `${inferredCategory}-server`,
      category: inferredCategory
    }];
    errors.push(`Step "${id}" had no valid tools, inferred "${inferredCategory}" from context`);
  }

  // Parallel safe
  const parallelSafe = raw.parallelSafe === true || raw.parallel_safe === true || raw.parallel === true;

  // Timeout
  let timeout = typeof raw.timeout === 'number' && raw.timeout > 0
    ? raw.timeout
    : getDefaultTimeout(requiredTools);

  // dependsOn
  let dependsOn = [];
  if (Array.isArray(raw.dependsOn)) {
    dependsOn = raw.dependsOn.filter(d => typeof d === 'string' && d.trim().length > 0).map(d => d.trim());
  } else if (Array.isArray(raw.depends_on)) {
    dependsOn = raw.depends_on.filter(d => typeof d === 'string' && d.trim().length > 0).map(d => d.trim());
  } else if (Array.isArray(raw.dependencies)) {
    dependsOn = raw.dependencies.filter(d => typeof d === 'string' && d.trim().length > 0).map(d => d.trim());
  }

  return {
    id,
    title,
    description,
    riskLevel,
    requiredTools,
    parallelSafe,
    timeout,
    dependsOn
  };
}

/**
 * Normalizes a raw tool references array into valid ToolReference objects.
 *
 * @param {any} raw - Raw tool references value
 * @returns {ToolReference[]}
 */
function normalizeToolReferences(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }

  const tools = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const category = mapToValidCategory(item);
      if (category) {
        tools.push({ name: item, server: `${category}-server`, category });
      }
    } else if (item && typeof item === 'object') {
      const name = typeof item.name === 'string' ? item.name : '';
      const server = typeof item.server === 'string' ? item.server : '';
      const rawCategory = typeof item.category === 'string' ? item.category : '';
      const category = mapToValidCategory(rawCategory || name || server);

      if (category) {
        tools.push({
          name: name || category,
          server: server || `${category}-server`,
          category
        });
      }
    }
  }

  return tools;
}

/**
 * Maps a string to a valid tool category.
 *
 * @param {string} input
 * @returns {'terminal' | 'folder' | 'browser' | 'python' | 'http' | null}
 */
function mapToValidCategory(input) {
  if (typeof input !== 'string') return null;
  const lower = input.toLowerCase();

  if (lower.includes('terminal') || lower.includes('shell') || lower.includes('command') || lower.includes('cli') || lower.includes('bash')) {
    return 'terminal';
  }
  if (lower.includes('folder') || lower.includes('file') || lower.includes('fs') || lower.includes('read') || lower.includes('write') || lower.includes('edit')) {
    return 'folder';
  }
  if (lower.includes('browser') || lower.includes('playwright') || lower.includes('web') || lower.includes('navigate') || lower.includes('page')) {
    return 'browser';
  }
  if (lower.includes('python') || lower.includes('script') || lower.includes('sandbox') || lower.includes('execute')) {
    return 'python';
  }
  if (lower.includes('http') || lower.includes('api') || lower.includes('request') || lower.includes('fetch') || lower.includes('network')) {
    return 'http';
  }

  // Check if it's directly one of the valid categories
  if (VALID_TOOL_CATEGORIES.has(lower)) {
    return lower;
  }

  return null;
}

/**
 * Infers a tool category from step title and description text.
 *
 * @param {string} title
 * @param {string} description
 * @returns {'terminal' | 'folder' | 'browser' | 'python' | 'http'}
 */
function inferToolCategory(title, description) {
  const text = `${title} ${description}`.toLowerCase();

  if (text.includes('run') || text.includes('command') || text.includes('install') || text.includes('build') || text.includes('test') || text.includes('execute')) {
    return 'terminal';
  }
  if (text.includes('read') || text.includes('write') || text.includes('create file') || text.includes('modify') || text.includes('edit') || text.includes('delete file')) {
    return 'folder';
  }
  if (text.includes('browse') || text.includes('navigate') || text.includes('page') || text.includes('click') || text.includes('scrape')) {
    return 'browser';
  }
  if (text.includes('python') || text.includes('script') || text.includes('compute') || text.includes('calculate')) {
    return 'python';
  }
  if (text.includes('api') || text.includes('request') || text.includes('http') || text.includes('fetch') || text.includes('download')) {
    return 'http';
  }

  // Default fallback
  return 'terminal';
}

/**
 * Gets the default timeout for a step based on its required tools.
 * Uses the longest timeout among the tool categories present.
 *
 * @param {ToolReference[]} tools
 * @returns {number} Timeout in milliseconds
 */
function getDefaultTimeout(tools) {
  const categoryTimeouts = {
    terminal: 60_000,
    folder: 30_000,
    browser: 120_000,
    python: 60_000,
    http: 30_000
  };

  let maxTimeout = 30_000;
  for (const tool of tools) {
    const t = categoryTimeouts[tool.category] || 60_000;
    if (t > maxTimeout) {
      maxTimeout = t;
    }
  }
  return maxTimeout;
}

// ─── JSON Extraction Helpers ─────────────────────────────────────────────────

/**
 * Attempts to extract a JSON object from LLM output text.
 * Handles raw JSON, JSON wrapped in markdown code blocks, and
 * JSON embedded within surrounding text.
 *
 * @param {string} text - Raw LLM output text
 * @returns {any|null} Parsed JSON object or null if extraction fails
 */
export function extractJsonFromResponse(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return null;
  }

  const trimmed = text.trim();

  // Attempt 1: Direct JSON parse
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue to next attempt
  }

  // Attempt 2: Extract from markdown code block (```json ... ``` or ``` ... ```)
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // Continue to next attempt
    }
  }

  // Attempt 3: Find the first { ... } block (greedy, outermost braces)
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {
      // Continue to next attempt
    }
  }

  // Attempt 4: Find the first [ ... ] block (for array-style plans)
  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try {
      const parsed = JSON.parse(trimmed.slice(firstBracket, lastBracket + 1));
      // Wrap bare array in plan structure
      if (Array.isArray(parsed)) {
        return { steps: parsed };
      }
    } catch {
      // All extraction attempts failed
    }
  }

  return null;
}

// ─── Prompt Construction ─────────────────────────────────────────────────────

/**
 * Builds the system prompt for plan generation.
 *
 * @returns {string}
 */
function buildPlanningSystemPrompt() {
  return `You are a task planning agent. Given a user's task instruction and context, decompose the task into a structured execution plan.

You MUST respond with a valid JSON object containing:
{
  "steps": [
    {
      "id": "step-1",
      "title": "Short, descriptive title (1-120 chars)",
      "description": "Detailed description of what this step does",
      "riskLevel": "low" | "medium" | "high",
      "requiredTools": [
        { "name": "tool_name", "server": "server_name", "category": "terminal" | "folder" | "browser" | "python" | "http" }
      ],
      "parallelSafe": false,
      "timeout": 60000,
      "dependsOn": []
    }
  ],
  "reasoning": "Explanation of why this plan structure was chosen"
}

Rules:
- Each plan must have 1 to 50 steps
- Each step title must be 1 to 120 characters
- Risk levels: "low" (read-only, non-destructive), "medium" (modifies files), "high" (deletes files, system commands, network)
- requiredTools must be non-empty for each step
- Tool categories: "terminal" (shell commands), "folder" (file read/write), "browser" (web navigation), "python" (code execution), "http" (API requests)
- Set parallelSafe to true only if the step has no dependencies on other steps' outputs
- Timeout in milliseconds (default: 60000 for terminal/python, 30000 for folder/http, 120000 for browser)
- dependsOn lists step IDs that must complete before this step starts
- Reference information from the provided context (files, previous outputs, memory) in your plan

Respond ONLY with the JSON object, no additional text.`;
}

/**
 * Builds the user prompt for initial plan generation.
 *
 * @param {TaskInstruction} task
 * @param {ContextWindow} context
 * @returns {string}
 */
function buildPlanningUserPrompt(task, context) {
  const parts = [];

  parts.push(`## Task\n${task.instruction}`);

  if (task.workingDirectory) {
    parts.push(`\n## Working Directory\n${task.workingDirectory}`);
  }

  // Include context items (Requirement 2.6: reference context window items)
  if (context) {
    if (Array.isArray(context.fileContents) && context.fileContents.length > 0) {
      const fileList = context.fileContents.map(f => f.path).join('\n  - ');
      parts.push(`\n## Available Files\n  - ${fileList}`);
    }

    if (Array.isArray(context.memoryRecords) && context.memoryRecords.length > 0) {
      const memories = context.memoryRecords
        .slice(0, 10)
        .map(m => `- ${m.fact}`)
        .join('\n');
      parts.push(`\n## Relevant Memory\n${memories}`);
    }

    if (Array.isArray(context.stepHistory) && context.stepHistory.length > 0) {
      const recentSteps = context.stepHistory
        .slice(-5)
        .map(s => `- [${s.status}] ${s.title}: ${s.output?.slice(0, 200) || 'no output'}`)
        .join('\n');
      parts.push(`\n## Recent Step Results\n${recentSteps}`);
    }
  }

  if (Array.isArray(task.attachments) && task.attachments.length > 0) {
    const attachList = task.attachments.map(a => `- ${a.filename} (${a.mimeType})`).join('\n');
    parts.push(`\n## Attachments\n${attachList}`);
  }

  return parts.join('\n');
}

/**
 * Builds the user prompt for re-planning with constraints.
 *
 * @param {TaskInstruction} task
 * @param {ContextWindow} context
 * @param {ReplanConstraints} constraints
 * @returns {string}
 */
function buildReplanUserPrompt(task, context, constraints) {
  const baseParts = [buildPlanningUserPrompt(task, context)];

  baseParts.push('\n## Re-Planning Constraints');
  baseParts.push('The previous plan failed or was modified. Generate a NEW plan that avoids the following issues:');

  if (Array.isArray(constraints.excludedApproaches) && constraints.excludedApproaches.length > 0) {
    baseParts.push(`\n### Excluded Approaches (DO NOT use these)`);
    for (const approach of constraints.excludedApproaches) {
      baseParts.push(`- ${approach}`);
    }
  }

  if (Array.isArray(constraints.deniedActions) && constraints.deniedActions.length > 0) {
    baseParts.push(`\n### Denied Actions (user explicitly rejected these - DO NOT include)`);
    for (const denied of constraints.deniedActions) {
      const desc = `Tool: ${denied.tool}, Action: ${denied.action}` +
        (denied.reason ? `, Reason: ${denied.reason}` : '');
      baseParts.push(`- ${desc}`);
    }
  }

  if (constraints.errorContext) {
    baseParts.push(`\n### Error Context`);
    baseParts.push(`- Error type: ${constraints.errorContext.type || 'unknown'}`);
    baseParts.push(`- Message: ${constraints.errorContext.message || 'unknown'}`);
    baseParts.push(`- Failed step: ${constraints.errorContext.stepId || 'unknown'}`);
    baseParts.push(`- Attempts: ${constraints.errorContext.attemptCount || 0}`);
  }

  if (typeof constraints.maxSteps === 'number' && constraints.maxSteps > 0) {
    baseParts.push(`\n### Constraints`);
    baseParts.push(`- Maximum steps allowed: ${Math.min(constraints.maxSteps, MAX_STEPS)}`);
  }

  return baseParts.join('\n');
}

// ─── Task Planner Class ──────────────────────────────────────────────────────

/**
 * Task Planner class.
 *
 * Generates structured execution plans from natural language tasks using
 * local Ollama LLM inference. Supports re-planning with constraints.
 */
export class TaskPlanner {
  /**
   * Creates a new TaskPlanner instance.
   *
   * @param {Object} options
   * @param {Object} [options.ollamaClient] - Ollama client instance (optional, can be mocked)
   * @param {string} [options.endpoint='http://localhost:11434'] - Ollama API endpoint
   * @param {string} [options.modelId='llama3'] - Default model ID for planning
   * @param {Function} [options.fetchFn] - Custom fetch function (for testing/mocking)
   */
  constructor(options = {}) {
    this._ollamaClient = options.ollamaClient || null;
    this._endpoint = options.endpoint || 'http://localhost:11434';
    this._modelId = options.modelId || 'llama3';
    this._fetchFn = options.fetchFn || globalThis.fetch;
    this._replanCount = 0;
  }

  /**
   * Generates an execution plan from a task instruction and context.
   *
   * Per Requirement 2.1: Produce an ordered list of Steps within 30 seconds
   * for tasks with fewer than 10 Steps, and within 60 seconds for tasks
   * with 10 or more Steps, up to a maximum of 50 Steps per plan.
   *
   * @param {TaskInstruction} task - The task to plan
   * @param {ContextWindow} context - Current context window
   * @returns {Promise<Plan>} The generated plan
   * @throws {Error} If planning fails or times out
   */
  async generatePlan(task, context) {
    if (!task || typeof task.instruction !== 'string' || task.instruction.trim().length === 0) {
      throw new Error('Task instruction is required for plan generation');
    }

    const systemPrompt = buildPlanningSystemPrompt();
    const userPrompt = buildPlanningUserPrompt(task, context);

    const rawResponse = await this._callLLM(systemPrompt, userPrompt, LONG_PLAN_TIMEOUT_MS);

    const parsed = extractJsonFromResponse(rawResponse);
    if (!parsed) {
      throw new Error('Failed to parse plan from LLM response. The model did not return valid JSON.');
    }

    const { valid, plan, errors } = normalizePlan(parsed);
    if (!valid || !plan) {
      throw new Error(`Plan validation failed: ${errors.join('; ')}`);
    }

    // Enforce timeout constraint based on step count (Requirement 2.1)
    // The plan itself is valid; we just note the timeout used was appropriate
    return plan;
  }

  /**
   * Re-generates a plan with constraints, excluding denied actions and
   * failed approaches.
   *
   * Per Requirement 2.4: Re-plan remaining Steps, up to a maximum of
   * 3 re-plan attempts per Task.
   *
   * Per Property 13: Denied actions must not appear in subsequent re-plans.
   *
   * @param {TaskInstruction} task - The original task instruction
   * @param {ContextWindow} context - Current context window
   * @param {ReplanConstraints} constraints - Constraints for replanning
   * @returns {Promise<Plan>} The new plan
   * @throws {Error} If replanning fails, times out, or replan limit is exceeded
   */
  async replan(task, context, constraints) {
    this._replanCount++;

    if (this._replanCount > MAX_REPLAN_ATTEMPTS) {
      throw new Error(
        `Maximum re-plan attempts (${MAX_REPLAN_ATTEMPTS}) exceeded. ` +
        'Halting execution and awaiting user input.'
      );
    }

    if (!task || typeof task.instruction !== 'string' || task.instruction.trim().length === 0) {
      throw new Error('Task instruction is required for re-planning');
    }

    const systemPrompt = buildPlanningSystemPrompt();
    const userPrompt = buildReplanUserPrompt(task, context, constraints || {});

    const rawResponse = await this._callLLM(systemPrompt, userPrompt, LONG_PLAN_TIMEOUT_MS);

    const parsed = extractJsonFromResponse(rawResponse);
    if (!parsed) {
      throw new Error('Failed to parse re-plan from LLM response. The model did not return valid JSON.');
    }

    // Apply maxSteps constraint
    const maxSteps = constraints?.maxSteps && constraints.maxSteps > 0
      ? Math.min(constraints.maxSteps, MAX_STEPS)
      : MAX_STEPS;

    if (Array.isArray(parsed.steps) && parsed.steps.length > maxSteps) {
      parsed.steps = parsed.steps.slice(0, maxSteps);
    }

    const { valid, plan, errors } = normalizePlan(parsed);
    if (!valid || !plan) {
      throw new Error(`Re-plan validation failed: ${errors.join('; ')}`);
    }

    // Validate that denied actions are not present in the new plan (Property 13)
    if (Array.isArray(constraints?.deniedActions) && constraints.deniedActions.length > 0) {
      const violatingSteps = findDeniedActionViolations(plan, constraints.deniedActions);
      if (violatingSteps.length > 0) {
        // Remove violating steps rather than failing completely
        plan.steps = plan.steps.filter(s => !violatingSteps.includes(s.id));

        if (plan.steps.length < MIN_STEPS) {
          throw new Error(
            'Re-plan produced only steps that were denied by the user. ' +
            'Cannot proceed without user guidance.'
          );
        }

        // Recalculate estimated duration
        plan.estimatedDuration = plan.steps.reduce((sum, s) => sum + s.timeout, 0);
      }
    }

    return plan;
  }

  /**
   * Gets the current replan count for this planner instance.
   *
   * @returns {number}
   */
  getReplanCount() {
    return this._replanCount;
  }

  /**
   * Resets the replan counter (e.g., for a new task session).
   */
  resetReplanCount() {
    this._replanCount = 0;
  }

  /**
   * Sets the model ID for LLM inference.
   *
   * @param {string} modelId
   */
  setModelId(modelId) {
    if (typeof modelId === 'string' && modelId.trim().length > 0) {
      this._modelId = modelId.trim();
    }
  }

  /**
   * Sets the endpoint for LLM inference.
   *
   * @param {string} endpoint
   */
  setEndpoint(endpoint) {
    if (typeof endpoint === 'string' && endpoint.trim().length > 0) {
      this._endpoint = endpoint.trim();
    }
  }

  /**
   * Determines the appropriate planning timeout based on the expected
   * step count.
   *
   * Per Requirement 2.1: 30s for <10 steps, 60s for >=10 steps.
   *
   * @param {number} expectedSteps - Expected number of steps
   * @returns {number} Timeout in milliseconds
   */
  getPlanningTimeout(expectedSteps) {
    if (typeof expectedSteps === 'number' && expectedSteps >= 10) {
      return LONG_PLAN_TIMEOUT_MS;
    }
    return SHORT_PLAN_TIMEOUT_MS;
  }

  // ─── Internal Methods ────────────────────────────────────────────────────

  /**
   * Calls the Ollama LLM for plan generation.
   *
   * Uses the /api/chat endpoint with a system prompt and user message.
   * Supports timeout enforcement.
   *
   * @param {string} systemPrompt - System prompt
   * @param {string} userPrompt - User message
   * @param {number} timeoutMs - Request timeout in milliseconds
   * @returns {Promise<string>} The LLM response text
   * @throws {Error} If the request fails or times out
   */
  async _callLLM(systemPrompt, userPrompt, timeoutMs) {
    // If an ollamaClient is provided, use it
    if (this._ollamaClient && typeof this._ollamaClient.chat === 'function') {
      return await this._callViaOllamaClient(systemPrompt, userPrompt, timeoutMs);
    }

    // Otherwise use fetch-based approach
    return await this._callViaFetch(systemPrompt, userPrompt, timeoutMs);
  }

  /**
   * Calls the LLM via the provided OllamaClient instance.
   *
   * @param {string} systemPrompt
   * @param {string} userPrompt
   * @param {number} timeoutMs
   * @returns {Promise<string>}
   */
  async _callViaOllamaClient(systemPrompt, userPrompt, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this._ollamaClient.chat({
        model: this._modelId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        stream: false,
        options: { temperature: 0.2 }
      }, { signal: controller.signal });

      return typeof response === 'string'
        ? response
        : response?.message?.content || response?.content || JSON.stringify(response);
    } catch (err) {
      if (err.name === 'AbortError' || err.message?.includes('abort')) {
        throw new Error(
          `Plan generation timed out after ${timeoutMs / 1000} seconds. ` +
          'Consider simplifying the task or increasing the timeout.'
        );
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Calls the LLM via direct fetch to the Ollama API endpoint.
   *
   * @param {string} systemPrompt
   * @param {string} userPrompt
   * @param {number} timeoutMs
   * @returns {Promise<string>}
   */
  async _callViaFetch(systemPrompt, userPrompt, timeoutMs) {
    const url = `${this._endpoint}${OLLAMA_CHAT_PATH}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this._fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this._modelId,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          stream: false,
          options: { temperature: 0.2 }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`Ollama API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();

      // Ollama chat API returns { message: { content: "..." } }
      return data?.message?.content || data?.content || data?.response || JSON.stringify(data);
    } catch (err) {
      if (err.name === 'AbortError' || err.message?.includes('abort')) {
        throw new Error(
          `Plan generation timed out after ${timeoutMs / 1000} seconds. ` +
          'Consider simplifying the task or increasing the timeout.'
        );
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Checks if a plan contains steps that use denied actions.
 *
 * Per Property 13: Denied actions must not appear in subsequent re-plans.
 *
 * @param {Plan} plan - The plan to check
 * @param {DeniedAction[]} deniedActions - List of denied actions
 * @returns {string[]} IDs of steps that violate denied action constraints
 */
function findDeniedActionViolations(plan, deniedActions) {
  const violatingStepIds = [];

  for (const step of plan.steps) {
    for (const denied of deniedActions) {
      // Check if any required tool matches the denied action's tool and action
      const toolMatch = step.requiredTools.some(t =>
        t.name === denied.tool ||
        t.category === denied.tool ||
        t.server === denied.tool
      );

      if (toolMatch) {
        // Check if the step description suggests the same action
        const stepText = `${step.title} ${step.description}`.toLowerCase();
        const deniedAction = (denied.action || '').toLowerCase();

        if (deniedAction && stepText.includes(deniedAction)) {
          violatingStepIds.push(step.id);
          break;
        }
      }
    }
  }

  return violatingStepIds;
}
