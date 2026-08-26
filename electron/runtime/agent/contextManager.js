/**
 * Context Manager
 *
 * Manages the LLM context window for the agent execution loop.
 * Builds prompts from task instruction, plan, step history, file contents, and memory records.
 * Tracks token usage against model limits and triggers summarization when needed.
 *
 * Requirements: 3.5, 8.1, 8.2, 8.6
 *
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 */

/**
 * Average characters per token for estimation purposes.
 * A simple heuristic: 1 token ~ 4 characters.
 * @type {number}
 */
export const CHARS_PER_TOKEN = 4;

/**
 * Threshold percentage at which summarization is triggered.
 * @type {number}
 */
export const SUMMARIZATION_TRIGGER_PERCENT = 0.80;

/**
 * Target percentage after summarization completes.
 * @type {number}
 */
export const SUMMARIZATION_TARGET_PERCENT = 0.60;

/**
 * Number of most recent step results to preserve in full during summarization.
 * @type {number}
 */
export const PRESERVED_RECENT_STEPS = 5;

/**
 * Default system prompt for the agent.
 * @type {string}
 */
export const DEFAULT_SYSTEM_PROMPT = `You are an autonomous agent executing tasks step by step. You have access to tools for terminal commands, file operations, browser automation, Python execution, and HTTP requests. Execute each step carefully, observe results, and adapt your approach as needed.`;

/**
 * Estimates the token count of a string.
 *
 * @param {string} text - The text to estimate tokens for.
 * @returns {number} Estimated token count.
 */
export function estimateTokens(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return 0;
  }
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Extracts file paths from a text string.
 * Matches common file path patterns (Unix and Windows).
 *
 * @param {string} text - The text to search for file paths.
 * @returns {string[]} Array of extracted file paths.
 */
export function extractFilePaths(text) {
  if (typeof text !== 'string') {
    return [];
  }
  // Match Unix-style and Windows-style paths
  const pathPattern = /(?:[a-zA-Z]:\\[\w\\.\-/]+|\/[\w/.\-]+\.\w+|\.\/[\w/.\-]+|\.\.\/[\w/.\-]+)/g;
  const matches = text.match(pathPattern) || [];
  return [...new Set(matches)];
}

/**
 * Extracts key identifiers (function names, variable names, class names) from text.
 * Looks for common code identifier patterns.
 *
 * @param {string} text - The text to search for identifiers.
 * @returns {string[]} Array of extracted identifiers.
 */
export function extractIdentifiers(text) {
  if (typeof text !== 'string') {
    return [];
  }
  const identifierPatterns = [
    /(?:function|class|const|let|var|def|export)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
    /([A-Z][a-zA-Z0-9]+(?:Error|Exception|Service|Manager|Controller|Handler))/g
  ];

  const identifiers = new Set();
  for (const pattern of identifierPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      identifiers.add(match[1]);
    }
  }
  return [...identifiers];
}

/**
 * Summarizes a step result into a condensed form, preserving key facts:
 * file paths, identifiers, and outcome summary.
 *
 * @param {object} stepResult - The step result to summarize.
 * @returns {object} A condensed step result.
 */
export function summarizeStepResult(stepResult) {
  if (!stepResult || typeof stepResult !== 'object') {
    return { stepId: '', title: '', status: 'completed', summary: '', filePaths: [], identifiers: [], toolCalls: [], output: '', error: null, startedAt: '', completedAt: '', duration: 0, retryCount: 0 };
  }

  const output = typeof stepResult.output === 'string' ? stepResult.output : '';
  const toolOutputs = Array.isArray(stepResult.toolCalls)
    ? stepResult.toolCalls.map(tc => typeof tc.output === 'string' ? tc.output : '').join('\n')
    : '';

  const combinedText = `${output}\n${toolOutputs}`;
  const filePaths = extractFilePaths(combinedText);
  const identifiers = extractIdentifiers(combinedText);

  // Build a short outcome summary
  const statusText = stepResult.status || 'completed';
  const titleText = stepResult.title || stepResult.stepId || 'Unknown step';
  const summary = `[${statusText}] ${titleText}` +
    (filePaths.length > 0 ? ` | Files: ${filePaths.join(', ')}` : '') +
    (identifiers.length > 0 ? ` | Identifiers: ${identifiers.join(', ')}` : '') +
    (stepResult.error ? ` | Error: ${stepResult.error}` : '');

  return {
    stepId: stepResult.stepId || '',
    title: stepResult.title || '',
    status: stepResult.status || 'completed',
    summary,
    filePaths,
    identifiers,
    toolCalls: [],
    output: summary,
    error: stepResult.error || null,
    startedAt: stepResult.startedAt || '',
    completedAt: stepResult.completedAt || '',
    duration: stepResult.duration || 0,
    retryCount: stepResult.retryCount || 0
  };
}

/**
 * Extracts keywords from a text instruction for memory retrieval matching.
 * Filters out common stop words and short tokens.
 *
 * @param {string} text - The instruction text to extract keywords from.
 * @returns {string[]} Array of keywords.
 */
export function extractKeywords(text) {
  if (typeof text !== 'string') {
    return [];
  }

  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'need', 'must', 'ought',
    'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves',
    'you', 'your', 'yours', 'yourself', 'yourselves',
    'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
    'it', 'its', 'itself', 'they', 'them', 'their', 'theirs',
    'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
    'am', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or',
    'to', 'with', 'and', 'but', 'if', 'not', 'no', 'nor', 'so', 'too',
    'very', 'just', 'about', 'above', 'after', 'again', 'all', 'also',
    'any', 'because', 'before', 'between', 'both', 'each', 'few',
    'how', 'more', 'most', 'other', 'over', 'same', 'some', 'such',
    'than', 'then', 'there', 'through', 'under', 'until', 'up', 'when',
    'where', 'while', 'why'
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));
}

/**
 * Context Manager class.
 *
 * Manages the LLM's context window including token budgeting,
 * summarization, and memory retrieval.
 */
export class ContextManager {
  /**
   * Creates a new ContextManager instance.
   *
   * @param {object} [options={}] - Configuration options.
   * @param {number} [options.modelTokenLimit=8192] - The model's token limit.
   * @param {string} [options.systemPrompt] - Custom system prompt.
   */
  constructor(options = {}) {
    this._modelTokenLimit = options.modelTokenLimit || 8192;
    this._systemPrompt = options.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    this._stepHistory = [];
    this._fileContents = [];
    this._memoryRecords = [];
    this._followUpInstructions = [];
    this._taskInstruction = '';
    this._currentPlan = null;
  }

  /**
   * Builds a complete context window (prompt) from the given task, plan, and history.
   *
   * Per Requirement 8.1: Maintain a Context_Window containing the Task instruction,
   * current plan, completed Step results, and file contents referenced by the current
   * plan or the most recent 3 Steps.
   *
   * @param {object} task - The task instruction object.
   * @param {string} task.instruction - The user's natural language instruction.
   * @param {string} task.workingDirectory - The working directory.
   * @param {Array} [task.attachments] - File attachments.
   * @param {Array} [task.followUpInstructions] - Follow-up instructions.
   * @param {object} plan - The execution plan.
   * @param {Array} history - Array of step results (completed steps).
   * @returns {object} The constructed ContextWindow.
   */
  buildPrompt(task, plan, history) {
    // Store the references for internal tracking
    this._taskInstruction = task?.instruction || '';
    this._currentPlan = plan || null;
    this._stepHistory = Array.isArray(history) ? [...history] : [];

    // Merge follow-up instructions from task with any accumulated via addFollowUp
    if (Array.isArray(task?.followUpInstructions)) {
      for (const followUp of task.followUpInstructions) {
        if (typeof followUp === 'string' && followUp.trim() && !this._followUpInstructions.includes(followUp)) {
          this._followUpInstructions.push(followUp);
        }
      }
    }

    const contextWindow = {
      systemPrompt: this._systemPrompt,
      taskInstruction: this._taskInstruction,
      currentPlan: this._currentPlan,
      stepHistory: this._stepHistory,
      fileContents: this._fileContents,
      memoryRecords: this._memoryRecords,
      totalTokens: 0
    };

    // Include follow-up instructions in the task instruction for context
    if (this._followUpInstructions.length > 0) {
      contextWindow.taskInstruction = this._taskInstruction +
        '\n\n--- Follow-up Instructions ---\n' +
        this._followUpInstructions.join('\n');
    }

    // Calculate total tokens
    contextWindow.totalTokens = this._calculateTotalTokens(contextWindow);

    return contextWindow;
  }

  /**
   * Adds a completed step result to the internal history.
   *
   * @param {object} result - The step result to add.
   */
  addStepResult(result) {
    if (result && typeof result === 'object') {
      this._stepHistory.push(result);
    }
  }

  /**
   * Adds a follow-up instruction to the context.
   *
   * Per Requirement 8.6: Incorporate follow-up instructions without losing existing
   * context. If incorporating would exceed the token limit, summarize older context first.
   *
   * @param {string} instruction - The follow-up instruction text.
   */
  addFollowUp(instruction) {
    if (typeof instruction !== 'string' || instruction.trim().length === 0) {
      return;
    }

    // Check if adding the follow-up would push us over the trigger threshold
    const additionalTokens = estimateTokens(instruction);
    const currentUsage = this._getCurrentTokenUsage();
    const projectedUsage = currentUsage + additionalTokens;

    if (projectedUsage > this._modelTokenLimit * SUMMARIZATION_TRIGGER_PERCENT) {
      this.summarizeIfNeeded(this._modelTokenLimit);
    }

    this._followUpInstructions.push(instruction);
  }

  /**
   * Triggers context summarization if token usage exceeds 80% of the model limit.
   *
   * Per Requirement 3.5 / 8.2:
   * - Triggered when usage exceeds 80%
   * - Target: below 60% after summarization
   * - Preserve most recent 5 step results in full
   * - Retain file paths and key identifiers from summarized entries
   *
   * @param {number} modelTokenLimit - The model's maximum token limit.
   */
  summarizeIfNeeded(modelTokenLimit) {
    const limit = modelTokenLimit || this._modelTokenLimit;
    this._modelTokenLimit = limit;

    const currentTokens = this._getCurrentTokenUsage();
    const triggerThreshold = limit * SUMMARIZATION_TRIGGER_PERCENT;

    if (currentTokens <= triggerThreshold) {
      return; // No summarization needed
    }

    const targetTokens = limit * SUMMARIZATION_TARGET_PERCENT;

    // Identify which step results to summarize (all except the most recent 5)
    const totalSteps = this._stepHistory.length;
    const preserveCount = Math.min(PRESERVED_RECENT_STEPS, totalSteps);
    const summarizeCount = totalSteps - preserveCount;

    if (summarizeCount <= 0) {
      // All steps are within the preservation window - try trimming file contents
      this._trimFileContents(targetTokens);
      return;
    }

    // Summarize older step results
    const olderSteps = this._stepHistory.slice(0, summarizeCount);
    const recentSteps = this._stepHistory.slice(summarizeCount);

    const summarizedSteps = olderSteps.map(step => summarizeStepResult(step));

    // Replace step history with summarized older + full recent
    this._stepHistory = [...summarizedSteps, ...recentSteps];

    // If still over target, trim file contents
    const afterSummarizationTokens = this._getCurrentTokenUsage();
    if (afterSummarizationTokens > targetTokens) {
      this._trimFileContents(targetTokens);
    }
  }

  /**
   * Returns the current token usage statistics.
   *
   * @returns {{ used: number, limit: number, percentage: number }} Token usage details.
   */
  getTokenUsage() {
    const used = this._getCurrentTokenUsage();
    const limit = this._modelTokenLimit;
    const percentage = limit > 0 ? used / limit : 0;

    return { used, limit, percentage };
  }

  /**
   * Retrieves relevant memory records that match keywords from the task instruction.
   *
   * Per Requirement 8.4: Retrieve up to 20 relevant memory records based on
   * keyword overlap with the task instruction.
   *
   * @param {string} taskInstruction - The task instruction to match against.
   * @param {number} [limit=20] - Maximum number of records to return.
   * @returns {Array} Matching memory records, sorted by relevance.
   */
  retrieveRelevantMemory(taskInstruction, limit = 20) {
    if (typeof taskInstruction !== 'string' || taskInstruction.trim().length === 0) {
      return [];
    }

    const keywords = extractKeywords(taskInstruction);
    if (keywords.length === 0) {
      return [];
    }

    // Score each memory record by keyword overlap
    const scoredRecords = this._memoryRecords
      .map(record => {
        const recordText = [
          record.fact || '',
          ...(Array.isArray(record.tags) ? record.tags : [])
        ].join(' ').toLowerCase();

        const matchingKeywords = keywords.filter(kw => recordText.includes(kw));

        if (matchingKeywords.length === 0) {
          return null;
        }

        // Score: keyword match count weighted by importance
        const importanceWeight = (record.importanceScore || 50) / 100;
        const score = matchingKeywords.length * importanceWeight;

        return { record, score, matchCount: matchingKeywords.length };
      })
      .filter(item => item !== null);

    // Sort by score descending, then by importance descending
    scoredRecords.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.record.importanceScore || 0) - (a.record.importanceScore || 0);
    });

    // Return at most `limit` records
    return scoredRecords.slice(0, limit).map(item => item.record);
  }

  /**
   * Sets the memory records available for retrieval.
   *
   * @param {Array} records - Array of MemoryRecord objects.
   */
  setMemoryRecords(records) {
    this._memoryRecords = Array.isArray(records) ? [...records] : [];
  }

  /**
   * Sets the file contents available in context.
   *
   * @param {Array} files - Array of FileReference objects ({ path, content, tokenCount }).
   */
  setFileContents(files) {
    this._fileContents = Array.isArray(files) ? [...files] : [];
  }

  /**
   * Gets the current step history.
   *
   * @returns {Array} The current step history array.
   */
  getStepHistory() {
    return [...this._stepHistory];
  }

  /**
   * Sets the model token limit.
   *
   * @param {number} limit - The new token limit.
   */
  setModelTokenLimit(limit) {
    if (typeof limit === 'number' && limit > 0) {
      this._modelTokenLimit = limit;
    }
  }

  // ─── Internal Helpers ──────────────────────────────────────────────────────

  /**
   * Calculates total tokens for a given context window.
   *
   * @param {object} contextWindow - The context window to measure.
   * @returns {number} Total estimated token count.
   */
  _calculateTotalTokens(contextWindow) {
    let total = 0;

    total += estimateTokens(contextWindow.systemPrompt || '');
    total += estimateTokens(contextWindow.taskInstruction || '');

    // Plan tokens
    if (contextWindow.currentPlan) {
      total += estimateTokens(JSON.stringify(contextWindow.currentPlan));
    }

    // Step history tokens
    if (Array.isArray(contextWindow.stepHistory)) {
      for (const step of contextWindow.stepHistory) {
        total += estimateTokens(JSON.stringify(step));
      }
    }

    // File contents tokens
    if (Array.isArray(contextWindow.fileContents)) {
      for (const file of contextWindow.fileContents) {
        total += file.tokenCount || estimateTokens(file.content || '');
      }
    }

    // Memory records tokens
    if (Array.isArray(contextWindow.memoryRecords)) {
      for (const record of contextWindow.memoryRecords) {
        total += estimateTokens(JSON.stringify(record));
      }
    }

    return total;
  }

  /**
   * Gets the current token usage based on all stored internal state.
   *
   * @returns {number} Current estimated token count.
   */
  _getCurrentTokenUsage() {
    let total = 0;

    total += estimateTokens(this._systemPrompt);
    total += estimateTokens(this._taskInstruction);

    // Follow-up instructions
    for (const followUp of this._followUpInstructions) {
      total += estimateTokens(followUp);
    }

    // Plan
    if (this._currentPlan) {
      total += estimateTokens(JSON.stringify(this._currentPlan));
    }

    // Step history
    for (const step of this._stepHistory) {
      total += estimateTokens(JSON.stringify(step));
    }

    // File contents
    for (const file of this._fileContents) {
      total += file.tokenCount || estimateTokens(file.content || '');
    }

    // Memory records
    for (const record of this._memoryRecords) {
      total += estimateTokens(JSON.stringify(record));
    }

    return total;
  }

  /**
   * Trims file contents to try to reach the target token count.
   * Removes the largest files first, keeping paths referenced in recent steps.
   *
   * @param {number} targetTokens - Target token count to get below.
   */
  _trimFileContents(targetTokens) {
    if (this._fileContents.length === 0) {
      return;
    }

    // Gather file paths referenced in recent (preserved) step results
    const recentSteps = this._stepHistory.slice(-PRESERVED_RECENT_STEPS);
    const referencedPaths = new Set();
    for (const step of recentSteps) {
      const stepText = JSON.stringify(step);
      const paths = extractFilePaths(stepText);
      for (const p of paths) {
        referencedPaths.add(p);
      }
    }

    // Sort files by token count descending (trim largest first)
    const sortedFiles = [...this._fileContents].sort((a, b) => {
      const aTokens = a.tokenCount || estimateTokens(a.content || '');
      const bTokens = b.tokenCount || estimateTokens(b.content || '');
      return bTokens - aTokens;
    });

    const keptFiles = [];
    for (const file of sortedFiles) {
      const currentTokens = this._getCurrentTokenUsageWithFiles(keptFiles);
      if (currentTokens <= targetTokens) {
        // We're under target; keep remaining files
        keptFiles.push(...sortedFiles.slice(sortedFiles.indexOf(file)));
        break;
      }

      // Keep files referenced by recent steps; drop others
      if (referencedPaths.has(file.path)) {
        keptFiles.push(file);
      }
      // Otherwise, drop this file to reduce tokens
    }

    this._fileContents = keptFiles;
  }

  /**
   * Calculates token usage with a hypothetical set of file contents.
   *
   * @param {Array} files - Hypothetical file contents.
   * @returns {number} Estimated token count.
   */
  _getCurrentTokenUsageWithFiles(files) {
    let total = 0;

    total += estimateTokens(this._systemPrompt);
    total += estimateTokens(this._taskInstruction);

    for (const followUp of this._followUpInstructions) {
      total += estimateTokens(followUp);
    }

    if (this._currentPlan) {
      total += estimateTokens(JSON.stringify(this._currentPlan));
    }

    for (const step of this._stepHistory) {
      total += estimateTokens(JSON.stringify(step));
    }

    for (const file of files) {
      total += file.tokenCount || estimateTokens(file.content || '');
    }

    for (const record of this._memoryRecords) {
      total += estimateTokens(JSON.stringify(record));
    }

    return total;
  }
}
