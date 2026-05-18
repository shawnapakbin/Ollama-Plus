import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Send, Terminal, Loader2, Globe, FileText, Bot, Copy, Check, Square, Pencil, RotateCcw, ChevronDown, Cpu, Zap } from 'lucide-react';
import { ipcService } from '../services/ipcService';
import { taskRuntime } from '../services/taskRuntime';
import './Chat.css';

const CodeBlock = ({ language, value }) => {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="code-block-container">
      <div className="code-block-header">
        <span className="code-lang">{language}</span>
        <button onClick={copy} className="copy-code-btn">
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre>
        <code className={`language-${language}`}>{value}</code>
      </pre>
    </div>
  );
};

const MarkdownComponents = {
  code({ node, inline, className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '');
    const codeString = String(children).replace(/\n$/, '');
    
    return !inline && match ? (
      <CodeBlock language={match[1]} value={codeString} {...props} />
    ) : (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }
};

const CollapsibleBlock = ({ title, icon: Icon, children, type = 'thought', isOpen = false, isStreaming = false }) => {
  const [open, setOpen] = useState(isOpen);

  React.useEffect(() => {
    if (isStreaming) setOpen(true);
  }, [isStreaming]);

  return (
    <div className={`collapsible-block ${type}`}>
      <div
        className={`block-summary ${isStreaming ? 'streaming' : ''}`}
        onClick={() => setOpen(o => !o)}
        role="button"
      >
        <Icon size={16} className="icon" />
        <span>{title}</span>
        <ChevronDown size={16} className="chevron" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
      </div>
      {open && (
        <div className="block-content">
          {children}
        </div>
      )}
    </div>
  );
};

export default function Chat({ selectedModel, hostUrl, keepAlive, sessionId, sessionTitle, onSessionUpdate }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [chatMode, setChatMode] = useState('auto');
  const [activeStreamId, setActiveStreamId] = useState(null);
  const messagesEndRef = useRef(null);
  const [processor, setProcessor] = useState(null);

  const [copiedId, setCopiedId] = useState(null);
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [steerQueue, setSteerQueue] = useState(null);
  const messagesRef = useRef(messages);
  const generationDepthRef = useRef(0);
  const steerAbortIntentRef = useRef(null);
  const steerQueueRef = useRef(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const clearChat = () => {
    setMessages([]);
    steerQueueRef.current = null;
    setSteerQueue(null);
  };

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const abortActiveStream = () => {
    if (activeStreamId) {
      ipcService.stopOllamaStream(activeStreamId);
      setActiveStreamId(null);
    }
  };

  const handleStop = () => {
    steerAbortIntentRef.current = 'stop-only';
    abortActiveStream();
  };

  const handleInterruptSteer = () => {
    if (!steerQueueRef.current) return;
    steerAbortIntentRef.current = 'interrupt-send';
    abortActiveStream();
  };

  const handleSendQueuedSteer = async () => {
    const pending = steerQueueRef.current;
    if (!pending || isGenerating) return;
    steerQueueRef.current = null;
    setSteerQueue(null);
    await commitUserTurn(pending);
  };

  const handleEdit = (index) => {
    const msg = messages[index];
    setInput(msg.content);
    setMessages(messages.slice(0, index));
  };

  const handleRegenerate = async (index) => {
    if (isGenerating) return;
    
    // Find the user message preceding this assistant message
    // Usually it's index - 1, but we'll truncate history to everything before this assistant msg
    const historyBefore = messages.slice(0, index);
    setMessages([...historyBefore, { role: 'assistant', content: '', model: selectedModel }]);
    await processOllamaRequest(historyBefore);
  };

  const fetchProcessorStatus = async () => {
    if (!hostUrl) return;
    try {
      const res = await ipcService.invokeOllama(hostUrl, '/api/ps');
      if (res && res.models && res.models.length > 0) {
        const current = res.models.find(m => m.name === selectedModel || selectedModel.startsWith(m.name));
        if (current) {
          // If size_vram > 0 or explicitly says GPU
          const isGPU = current.size_vram > 0;
          setProcessor(isGPU ? 'GPU' : 'CPU');
        } else {
          setProcessor(null);
        }
      } else {
        setProcessor(null);
      }
    } catch (e) {
      console.error("Failed to fetch processor status", e);
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isGenerating]);

  useEffect(() => {
    fetchProcessorStatus();
    if (!sessionId) return;

    steerQueueRef.current = null;
    queueMicrotask(() => setSteerQueue(null));

    let cancelled = false;
    (async () => {
      const saved = await ipcService.loadChat(sessionId);
      if (cancelled) return;
      if (saved && saved.messages) setMessages(saved.messages);
      else setMessages([]);
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId, hostUrl]);

  const saveSession = async (currentMsgs) => {
    if (sessionId) {
      await ipcService.saveChat(sessionId, currentMsgs);
      onSessionUpdate();
    }
  };

  // Tool definitions for Ollama
  const tools = [
    {
      type: 'function',
      function: {
        name: 'run_shell_command',
        description: 'Execute a shell command (PowerShell) on the user\'s local machine. Use this to list files, read directories, or execute tools.',
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
        description: 'Perform an action in a persistent web browser (Playwright). Useful for navigation, interaction, and data extraction.',
        parameters: {
          type: 'object',
          properties: {
            action: { 
              type: 'string', 
              enum: ['goto', 'click', 'type', 'press', 'scroll', 'wait', 'screenshot', 'extract-text', 'evaluate'],
              description: 'The action to perform' 
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
        description: 'Read a markdown file from the user\'s local wiki knowledge base.',
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
        description: 'Update the persistent memory about the user. Use this to remember names, preferences, or important facts across sessions.',
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
        description: 'Get the current date and time. Returns ISO UTC, Unix ms, and a human-readable local time. Optional IANA timezone (e.g. America/New_York, Europe/London, Asia/Tokyo); defaults to the user system timezone.',
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
        description: 'Evaluate mathematical expressions using a full math engine (mathjs): arithmetic, trig, logarithms, complex numbers (i), matrices (e.g. det(A), inv(A), multiply(A,B)), units, combinatorics, and BigNumber precision. Use for any non-trivial or engineering calculation instead of guessing.',
        parameters: {
          type: 'object',
          properties: {
            expression: { type: 'string', description: 'Expression in mathjs syntax (e.g. sqrt(3^2+4^2), sin(pi/4), det([[1,2],[3,4]]), e^(i*pi)+1)' },
            scope: {
              type: 'object',
              description: 'Optional named values for multi-step work, e.g. {"A": [[1,2],[3,4]], "x": 2}. Values may be numbers, nested arrays for matrices, or strings the engine accepts.'
            }
          },
          required: ['expression']
        }
      }
    }
  ];

  const buildSteerPayload = (textTrim, files) => {
    const fileContext = files.length > 0
      ? '\n\n' + files.map(f =>
          `--- Attached file: ${f.name} ---\n${f.content}\n--- End of ${f.name} ---`
        ).join('\n\n')
      : '';
    const displayContent = textTrim || `📎 ${files.map(f => f.name).join(', ')}`;
    const ollamaContent = (textTrim || '') + fileContext;
    const attachmentNames = files.map(f => f.name);
    const preview = displayContent.length > 160 ? displayContent.slice(0, 157) + '…' : displayContent;
    return { displayContent, ollamaContent, attachmentNames, preview };
  };

  const commitUserTurn = async (payload, taskId) => {
    const base = messagesRef.current;
    const { displayContent, ollamaContent, attachmentNames } = payload;
    const newMsgs = [...base, {
      role: 'user',
      content: displayContent,
      ...(attachmentNames.length ? { attachments: attachmentNames } : {})
    }];
    const ollamaMsgs = [...base, { role: 'user', content: ollamaContent }];
    setMessages([...newMsgs, { role: 'assistant', content: '', model: selectedModel }]);
    await processOllamaRequest(ollamaMsgs, taskId);
  };

  const handleSend = async () => {
    if ((!input.trim() && attachedFiles.length === 0) || !selectedModel) return;

    const textTrim = input.trim();
    const filesSnapshot = attachedFiles.map(f => ({ ...f }));
    const payload = buildSteerPayload(textTrim, filesSnapshot);

    if (isGenerating) {
      steerQueueRef.current = payload;
      setSteerQueue(payload);
      setInput('');
      setAttachedFiles([]);
      return;
    }

    const taskTitle = payload.preview || textTrim || 'User request';
    const taskId = taskRuntime.createTask(taskTitle, 'chat');
    taskRuntime.setState(taskId, 'queued', 'Request captured from chat input.');

    setInput('');
    setAttachedFiles([]);
    await commitUserTurn(payload, taskId);
  };

  const processOllamaRequest = async (currentMessages, taskId = null) => {
    generationDepthRef.current++;
    if (generationDepthRef.current === 1) {
      setIsGenerating(true);
      if (taskId) {
        taskRuntime.setState(taskId, 'running', 'Model generation started.');
      }
    }
    try {
      // Load memory if it exists
      let memoryContext = '';
      try {
        const mem = await ipcService.readWiki('memory/personal.md');
        if (mem) memoryContext = `\n\n[PERSISTENT MEMORY]\n${mem}`;
      } catch (e) {}

      const payload = {
        model: selectedModel,
        messages: currentMessages,
        stream: true
      };

      if (keepAlive) {
        payload.keep_alive = -1;
      }

      let useTools = false;

      if (chatMode === 'tools') {
        useTools = true;
      } else if (chatMode === 'auto') {
        // Router call to let the LLM decide
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: '🤔 *Evaluating tool usage...*' };
          return updated;
        });

        try {
          const userPrompt = currentMessages[currentMessages.length - 1].content;
          const routerPayload = {
            model: selectedModel,
            messages: [
              { role: 'system', content: 'You are a routing agent. Your job is to decide if the user needs external tools. Tools available: run_shell_command (PowerShell), browser_action (Playwright), read_wiki (Markdown), web_search, get_current_time (clock), engineering_calculator (mathjs: matrices, complex, trig, precision math). Answer with exactly YES or NO.' },
              { role: 'user', content: `User request: "${userPrompt}"\nDo you need tools for this?` }
            ],
            stream: false
          };
          if (keepAlive) routerPayload.keep_alive = -1;

          const routerRes = await ipcService.invokeOllama(hostUrl, '/api/chat', routerPayload);
          if (routerRes && routerRes.message && routerRes.message.content.toUpperCase().includes('YES')) {
            useTools = true;
          }
        } catch (e) {
          console.error("Router failed", e);
        }

        // Clear the thinking message
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: '' };
          return updated;
        });
      }

      if (useTools) {
        payload.tools = tools;
        // Inject tool instruction for models that struggle with native tool calling
        payload.messages = [
          { 
            role: 'system', 
            content: `You have access to tools. To use them, you MUST output a JSON block like: {"tool": "tool_name", "parameters": {"arg": "val"}}. 
Available tools:
- run_shell_command: {command: string}
- browser_action: {action: string, url?: string, selector?: string, text?: string, key?: string, wait_for?: string, script?: string}
- read_wiki: {filepath: string}
- web_search: {query: string}
- update_user_memory: {content: string} (Store facts here)
- get_current_time: {timezone?: string, locale?: string}
- engineering_calculator: {expression: string, scope?: object}${memoryContext}` 
          },
          ...currentMessages
        ];
      } else {
        payload.messages = [
          { role: 'system', content: `You are a helpful AI assistant.${memoryContext}` },
          ...currentMessages
        ];
      }

      let currentContent = '';
      let toolCalls = null;
      let finalRes = null;
      let sId = null;

      await new Promise((resolve, reject) => {
        sId = ipcService.invokeOllamaStream(hostUrl, '/api/chat', payload, {
          onData: (chunkText) => {
            const lines = chunkText.split('\n').filter(l => l.trim());
            for (const line of lines) {
              try {
                const parsed = JSON.parse(line);
                if (parsed.message) {
                  if (parsed.message.content) {
                    currentContent += parsed.message.content;
                    setMessages(prev => {
                      const updated = [...prev];
                      if (updated[updated.length - 1].role === 'assistant') {
                        updated[updated.length - 1] = { ...updated[updated.length - 1], content: currentContent };
                      }
                      return updated;
                    });
                  }
                  if (parsed.message.tool_calls) {
                    toolCalls = parsed.message.tool_calls;
                  }
                }
                if (parsed.done) {
                  finalRes = parsed;
                }
              } catch (e) {}
            }
          },
          onEnd: () => resolve(),
          onError: (err) => reject(new Error(err))
        });
        setActiveStreamId(sId);
      });
      setActiveStreamId(null);

      // Fallback: If no official tool_calls, look for JSON in the content
      if ((!toolCalls || toolCalls.length === 0) && currentContent.includes('{')) {
        const jsonMatch = currentContent.match(/\{(?:[^{}]|\{[^{}]*\})*\}/g);
        if (jsonMatch) {
          toolCalls = jsonMatch.map(str => {
            try {
              const parsed = JSON.parse(str);
              const toolName =
                parsed.tool ||
                parsed.action ||
                (parsed.command ? 'run_shell_command' : null) ||
                (parsed.query || parsed.q ? 'web_search' : null) ||
                (((parsed.expression !== undefined && parsed.expression !== '') || (parsed.expr !== undefined && parsed.expr !== ''))
                  ? 'engineering_calculator'
                  : null);
              if (toolName) {
                return {
                  function: {
                    name: toolName === 'search' ? 'web_search' : toolName,
                    arguments: parsed.parameters || parsed.params || parsed
                  }
                };
              }
            } catch (e) {}
            return null;
          }).filter(Boolean);
        }
      }

      if (toolCalls && toolCalls.length > 0) {
        // Handle tool calls
        let toolResults = [...currentMessages, { role: 'assistant', content: currentContent, tool_calls: toolCalls }];
        if (taskId) {
          taskRuntime.addLog(taskId, `Tool calls requested: ${toolCalls.length}.`);
        }
        
        for (const call of toolCalls) {
          const fn = call.function.name;
          const args = typeof call.function.arguments === 'string' 
            ? JSON.parse(call.function.arguments) 
            : call.function.arguments;
          let result = '';
          
          try {
            if (fn === 'run_shell_command') {
              const command = String(args.command || args.cmd || '').trim();
              const res = await ipcService.runShellCommand(command);
              if (!res.ok) {
                if (res.denied) {
                  result = `Shell command denied by user.\nPolicy decision token: ${res.policy?.decisionToken || 'n/a'}\nSelection: ${res.policy?.selectionId || 'deny'}`;
                } else {
                  result = `Shell command failed: ${res.message}`;
                }
              } else {
                result = `Started shell command in terminal (ID: ${res.terminalId}). The user can view it in the Terminals tab.\nPolicy decision token: ${res.policy?.decisionToken || 'auto-allow'}\nSelection: ${res.policy?.selectionId || 'auto-allow'}`;
              }
            } else if (fn === 'browser_action') {
              const res = await ipcService.browserAction(args);
              if (res.error) {
                const tokenLine = res.policy?.decisionToken
                  ? `\nPolicy decision token: ${res.policy.decisionToken}\nSelection: ${res.policy?.selectionId || 'deny'}`
                  : '';
                result = `Error: ${res.error}${tokenLine}`;
              } else if (res.screenshot) {
                const tokenLine = res.policy?.decisionToken
                  ? `\nPolicy decision token: ${res.policy.decisionToken}\nSelection: ${res.policy?.selectionId || 'allow'}`
                  : '';
                result = `Action completed. Current URL: ${res.url}\n[Screenshot captured]${tokenLine}`;
                // In a real app, we might want to display the screenshot in the chat.
                // For now, we return the text feedback.
              } else {
                const tokenLine = res.policy?.decisionToken
                  ? `\nPolicy decision token: ${res.policy.decisionToken}\nSelection: ${res.policy?.selectionId || 'allow'}`
                  : '';
                result = `Action: ${args.action} completed.\nURL: ${res.url}\nTitle: ${res.title}\n\nOutput: ${res.result}${tokenLine}`;
              }
            } else if (fn === 'fetch_webpage') {
              // Legacy support
              const res = await ipcService.browserAction({ action: 'goto', url: args.url });
              const contentRes = await ipcService.browserAction({ action: 'extract-text' });
              result = contentRes.result;
            } else if (fn === 'read_wiki') {
              result = await ipcService.readWiki(args.filepath || args.path);
              if (!result) result = "File not found.";
            } else if (fn === 'web_search' || fn === 'search') {
              result = await ipcService.webSearch(args.query || args.q);
            } else if (fn === 'update_user_memory') {
              const currentMem = await ipcService.readWiki('memory/personal.md') || '';
              const newMem = currentMem + '\n- ' + args.content;
              await ipcService.writeWiki('memory/personal.md', newMem);
              result = "Memory updated successfully.";
            } else if (fn === 'get_current_time' || fn === 'clock' || fn === 'current_time') {
              result = await ipcService.getClock({
                timezone: args.timezone || args.tz,
                locale: args.locale
              });
            } else if (fn === 'engineering_calculator' || fn === 'calculator' || fn === 'math_eval') {
              result = await ipcService.engineeringCalculator({
                expression: args.expression ?? args.expr,
                scope: args.scope
              });
            }
          } catch (e) {
            result = `Error executing tool ${fn}: ${e.message}`;
          }

          if (taskId) {
            const summary = result ? String(result).slice(0, 120) : 'No output';
            taskRuntime.addLog(taskId, `Tool ${fn}: ${summary}`);
          }

          toolResults.push({
            role: 'tool',
            content: result,
            name: fn
          });
        }

        // Send results back to Ollama
        setMessages([...toolResults, { role: 'assistant', content: '', model: selectedModel }]);
        await saveSession(toolResults);
        await processOllamaRequest(toolResults, taskId);
        return;
      }

      const metrics = finalRes ? {
        totalDuration: (finalRes.total_duration / 1e9).toFixed(2) + 's',
        loadDuration: (finalRes.load_duration / 1e6).toFixed(2) + 'ms',
        promptEvalCount: finalRes.prompt_eval_count,
        promptEvalDuration: (finalRes.prompt_eval_duration / 1e6).toFixed(2) + 'ms',
        promptEvalRate: (finalRes.prompt_eval_count / (finalRes.prompt_eval_duration / 1e9)).toFixed(2) + ' tok/s',
        evalCount: finalRes.eval_count,
        evalDuration: (finalRes.eval_duration / 1e6).toFixed(2) + 'ms',
        evalRate: (finalRes.eval_count / (finalRes.eval_duration / 1e9)).toFixed(2) + ' tok/s'
      } : null;

      const finalMsgs = [...currentMessages, {
        role: 'assistant',
        model: selectedModel,
        content: currentContent,
        metrics: metrics
      }];
      setMessages(finalMsgs);
      await saveSession(finalMsgs);
      if (taskId) {
        taskRuntime.setState(taskId, 'done', 'Completed successfully.');
      }
      
      // Update processor status after generation
      setTimeout(fetchProcessorStatus, 500);

      // Auto-rename if it's a new chat
      if (sessionTitle === 'New Chat' && finalMsgs.length >= 2) {
        autoRename(finalMsgs);
      }

    } catch (err) {
      console.error(err);
      setMessages([...currentMessages, { role: 'assistant', content: '**Error**: Failed to communicate with Ollama.' }]);
      if (taskId) {
        const msg = err instanceof Error ? err.message : 'Unknown generation error';
        taskRuntime.setState(taskId, 'failed', `Failed: ${msg}`);
      }
    } finally {
      generationDepthRef.current--;
      if (generationDepthRef.current === 0) {
        const intent = steerAbortIntentRef.current;
        steerAbortIntentRef.current = null;
        if (intent === 'stop-only') {
          setIsGenerating(false);
        } else {
          const pending = steerQueueRef.current;
          if (pending) {
            steerQueueRef.current = null;
            setSteerQueue(null);
            const queuedTaskId = taskRuntime.createTask(pending.preview || 'Queued steer', 'chat');
            taskRuntime.setState(queuedTaskId, 'queued', 'Queued steer accepted after current generation.');
            await commitUserTurn(pending, queuedTaskId);
          } else {
            setIsGenerating(false);
          }
        }
      }
    }
  };

  const autoRename = async (currentMessages) => {
    try {
      const prompt = `You are a helpful assistant. Based on the following conversation, provide a VERY concise (3-5 words) title for this chat session. Do not use quotes or special characters.
Conversation:
${currentMessages.map(m => `${m.role.toUpperCase()}: ${m.content.substring(0, 100)}`).join('\n')}

Title:`;

      const payload = {
        model: selectedModel,
        messages: [{ role: 'user', content: prompt }],
        stream: false
      };
      if (keepAlive) payload.keep_alive = -1;

      const res = await ipcService.invokeOllama(hostUrl, '/api/chat', payload);
      if (res && res.message && res.message.content) {
        let newTitle = res.message.content.trim().replace(/["']/g, '');
        if (newTitle.length > 50) newTitle = newTitle.substring(0, 47) + '...';
        await ipcService.renameChat(sessionId, newTitle);
        onSessionUpdate();
      }
    } catch (e) {
      console.error("Auto-rename failed", e);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();
    // Show a temporary parsing indicator in the attached files list
    const tempEntry = { name: file.name, content: null, parsing: true };
    setAttachedFiles(prev => [...prev, tempEntry]);

    try {
      let parsedText = '';

      if (ext === 'pdf' || ext === 'csv') {
        const arrayBuffer = await file.arrayBuffer();
        parsedText = await ipcService.parseFileBuffer(ext, Array.from(new Uint8Array(arrayBuffer)));
      } else {
        parsedText = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = e => resolve(e.target.result);
          reader.onerror = reject;
          reader.readAsText(file);
        });
      }

      setAttachedFiles(prev => prev.map(f =>
        f.name === file.name && f.parsing ? { name: file.name, content: parsedText, parsing: false } : f
      ));
    } catch (err) {
      setAttachedFiles(prev => prev.filter(f => !(f.name === file.name && f.parsing)));
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const renderMessageContent = (content, toolCalls = null) => {
    let elements = [];
    let currentText = content || '';

    // Handle tool calls if they exist (rendered BEFORE the content usually)
    if (toolCalls && toolCalls.length > 0) {
      toolCalls.forEach((call, idx) => {
        elements.push(
          <CollapsibleBlock 
            key={`call-${idx}`}
            title={`Tool Call: ${call.function.name}`}
            icon={Cpu}
            type="tool"
          >
            <pre className="tool-args">
              <code>{JSON.stringify(call.function.arguments, null, 2)}</code>
            </pre>
          </CollapsibleBlock>
        );
      });
    }

    if (!currentText) return elements.length > 0 ? elements : null;

    // Handle full think blocks
    const fullThinkRegex = /<think>([\s\S]*?)<\/think>/g;
    let lastIndex = 0;
    let match;

    while ((match = fullThinkRegex.exec(currentText)) !== null) {
      // Add text before the think block
      if (match.index > lastIndex) {
        elements.push(
          <div key={`text-${lastIndex}`} className="final-text">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>{currentText.substring(lastIndex, match.index)}</ReactMarkdown>
          </div>
        );
      }

      // Add the think block
      elements.push(
        <CollapsibleBlock 
          key={`think-${match.index}`}
          title="Thought Process"
          icon={Bot}
          type="thought"
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>{match[1]}</ReactMarkdown>
        </CollapsibleBlock>
      );

      lastIndex = fullThinkRegex.lastIndex;
    }

    // Handle partial think blocks (during streaming)
    const partialThinkMatch = currentText.substring(lastIndex).match(/<think>([\s\S]*)$/);
    if (partialThinkMatch) {
      const restText = currentText.substring(lastIndex).replace(/<think>[\s\S]*$/, '');
      if (restText) {
        elements.push(
          <div key={`text-partial-before`} className="final-text">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>{restText}</ReactMarkdown>
          </div>
        );
      }
      elements.push(
        <CollapsibleBlock 
          key="think-partial"
          title="Thinking..."
          icon={Loader2}
          type="thought"
          isOpen={true}
          isStreaming={true}
        >
          <div className="streaming-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>{partialThinkMatch[1]}</ReactMarkdown>
          </div>
        </CollapsibleBlock>
      );
    } else {
      // Add remaining text
      if (lastIndex < currentText.length) {
        elements.push(
          <div key={`text-final`} className="final-text">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>{currentText.substring(lastIndex)}</ReactMarkdown>
          </div>
        );
      }
    }

    return elements;
  };

  return (
    <div className="chat-container" onDrop={handleDrop} onDragOver={handleDragOver}>
      <div className="messages scrollable">
        {messages.length === 0 && (
          <div className="empty-state">
            <Bot size={48} className="empty-icon" />
            <h3>Ask anything</h3>
            <p>Your local Ollama model is ready. Drag and drop CSV, MD, PDF, or TXT files here to analyze them. Use tools to execute shell commands, fetch web pages, or read your wiki.</p>
          </div>
        )}
        
        {messages.map((m, i) => (
          <div key={i} className={`message-row ${m.role}`}>
            {m.role === 'tool' ? (
              <div className="tool-result-container">
                <CollapsibleBlock 
                  title={`Tool Output: ${m.name}`}
                  icon={Terminal}
                  type="tool"
                >
                  <div className="tool-output">
                    {m.content.length > 500 ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>{m.content.substring(0, 500) + '...'}</ReactMarkdown>
                    ) : (
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>{m.content}</ReactMarkdown>
                    )}
                  </div>
                </CollapsibleBlock>
              </div>
            ) : (
              <div className={`message-bubble ${m.role} glass-panel`}>
                <div className="message-header">
                  <div className="message-role">
                    {m.role === 'assistant' ? (m.model || selectedModel) : 'User'}
                  </div>
                  <div className="message-actions">
                    <button 
                      className="copy-btn" 
                      onClick={() => copyToClipboard(m.content, i)}
                      title="Copy to clipboard"
                    >
                      {copiedId === i ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                    {m.role === 'user' && (
                      <button 
                        className="copy-btn" 
                        onClick={() => handleEdit(i)}
                        title="Edit message"
                        disabled={isGenerating}
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    {m.role === 'assistant' && (
                      <button 
                        className="copy-btn" 
                        onClick={() => handleRegenerate(i)}
                        title="Regenerate response"
                        disabled={isGenerating}
                      >
                        <RotateCcw size={14} />
                      </button>
                    )}
                  </div>
                </div>
                {renderMessageContent(m.content, m.tool_calls)}
                {m.attachments && m.attachments.length > 0 && (
                  <div className="message-attachments">
                    {m.attachments.map((name, idx) => (
                      <span key={idx} className="attachment-tag">
                        <FileText size={11} /> {name}
                      </span>
                    ))}
                  </div>
                )}
                {m.metrics && (
                  <div className="message-metrics-grid">
                    <div className="metric-item" title="Total Duration">
                      <span className="label">⏱ Total</span>
                      <span className="value">{m.metrics.totalDuration}</span>
                    </div>
                    <div className="metric-item" title="Load Duration">
                      <span className="label">📂 Load</span>
                      <span className="value">{m.metrics.loadDuration}</span>
                    </div>
                    <div className="metric-item" title="Prompt Tokens">
                      <span className="label">📥 Prompt</span>
                      <span className="value">{m.metrics.promptEvalCount} tok</span>
                    </div>
                    <div className="metric-item" title="Prompt Duration">
                      <span className="label">⏱ P-Eval</span>
                      <span className="value">{m.metrics.promptEvalDuration}</span>
                    </div>
                    <div className="metric-item" title="Prompt Rate">
                      <span className="label">🚀 P-Rate</span>
                      <span className="value">{m.metrics.promptEvalRate}</span>
                    </div>
                    <div className="metric-item" title="Response Tokens">
                      <span className="label">🔤 Response</span>
                      <span className="value">{m.metrics.evalCount} tok</span>
                    </div>
                    <div className="metric-item" title="Response Duration">
                      <span className="label">⏱ R-Eval</span>
                      <span className="value">{m.metrics.evalDuration}</span>
                    </div>
                    <div className="metric-item" title="Response Rate">
                      <span className="label">⚡ R-Rate</span>
                      <span className="value">{m.metrics.evalRate}</span>
                    </div>
                    {processor && (
                      <div className="metric-item">
                        <span className="label">💻 Device</span>
                        <span className={`processor-badge ${processor.toLowerCase()}`}>
                          {processor}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {isGenerating && (
          <div className="message-row assistant">
            <div className="message-bubble assistant glass-panel generating">
              <Loader2 size={18} className="spin" /> Generating...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-footer">
        <div className="chat-controls">
          <button 
            className="nav-item" 
            onClick={clearChat} 
            disabled={isGenerating || messages.length === 0}
            id="clear-chat-btn"
            title="Clear Chat History"
          >
            🗑️ Clear Chat
          </button>
          
          <div className="chat-status">
            {isGenerating && (
              <span className="status-text">
                Generating response…
                {steerQueue ? ' Steer queued.' : ''}
              </span>
            )}
          </div>
          
          <select 
            aria-label="Select chat mode"
            value={chatMode} 
            onChange={(e) => setChatMode(e.target.value)}
            className="chat-mode-select"
            disabled={isGenerating}
          >
            <option value="auto">🤖 Auto (Smart Routing)</option>
            <option value="standard">🧠 Reasoning Mode (No Tools)</option>
            <option value="tools">🛠️ Agent Mode (Force Tools)</option>
          </select>
        </div>
        {steerQueue && (
          <div className="steer-queue glass-panel">
            <div className="steer-queue-body">
              <span className="steer-queue-label">Queued steer</span>
              <p className="steer-queue-preview">{steerQueue.preview}</p>
            </div>
            {isGenerating ? (
              <button
                type="button"
                className="steer-queue-interrupt"
                onClick={handleInterruptSteer}
                disabled={!activeStreamId}
                title={!activeStreamId ? 'Wait until the model starts streaming' : 'Stop the current reply and send this message now'}
              >
                <Zap size={16} />
                Interrupt
              </button>
            ) : (
              <button
                type="button"
                className="steer-queue-send"
                onClick={() => void handleSendQueuedSteer()}
                title="Send the queued message now"
              >
                <Send size={16} />
                Send now
              </button>
            )}
          </div>
        )}
        <div className="input-box glass-panel">
          {attachedFiles.length > 0 && (
            <div className="attached-files">
              {attachedFiles.map((f, i) => (
                <div key={i} className={`file-chip ${f.parsing ? 'parsing' : ''}`}>
                  <FileText size={12} />
                  <span>{f.name}</span>
                  {f.parsing
                    ? <Loader2 size={12} className="spin" />
                    : <button onClick={() => setAttachedFiles(prev => prev.filter((_, idx) => idx !== i))}>✕</button>
                  }
                </div>
              ))}
            </div>
          )}
          <textarea 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={isGenerating ? 'Queue a steer message… (Enter to queue)' : 'Send a message to Ollama... (Drag and drop files here)'}
            rows={2}
          />
          <div className="input-send-actions">
            {isGenerating && (
              <button className="stop-btn" onClick={handleStop} type="button" title="Stop generation (keeps queued steer for later)">
                <Square size={18} fill="currentColor" />
              </button>
            )}
            <button
              type="button"
              className="primary send-btn"
              onClick={handleSend}
              disabled={!input.trim() && attachedFiles.length === 0}
              title={isGenerating ? 'Queue steer message' : 'Send'}
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
