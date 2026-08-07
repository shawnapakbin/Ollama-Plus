import { useEffect, useMemo, useState } from 'react';
import './App.css';
import {
  runtimeClient,
  type ApprovalDecision,
  type RuntimeBootstrapPlan,
  type RuntimeChatConfig,
  type RuntimeChatMessage,
  type RuntimeChatStreamEvent,
  type RuntimeGraphSummary,
  type RuntimeOllamaModel,
  type RuntimeRunSummary,
  type RuntimeSessionSummary,
  type RuntimeStatus
} from './services/runtimeClient';

function formatTimestamp(value: string | null): string {
  if (!value) return 'No timestamp';

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function getRunStatusTone(status: string): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (status === 'completed') return 'ok';
  if (status === 'waiting_approval' || status === 'paused' || status === 'running') return 'warn';
  if (status === 'failed' || status === 'canceled') return 'danger';
  return 'neutral';
}

function getMessageLabel(message: RuntimeChatMessage): string {
  if (message.role === 'user') return 'You';
  if (message.role === 'assistant') return message.model || 'Assistant';
  return 'System';
}

function App() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [plan, setPlan] = useState<RuntimeBootstrapPlan | null>(null);
  const [graphs, setGraphs] = useState<RuntimeGraphSummary[]>([]);
  const [sessions, setSessions] = useState<RuntimeSessionSummary[]>([]);
  const [runs, setRuns] = useState<RuntimeRunSummary[]>([]);
  const [messages, setMessages] = useState<RuntimeChatMessage[]>([]);
  const [chatConfig, setChatConfig] = useState<RuntimeChatConfig>({ endpoint: 'http://127.0.0.1:11434', model: '' });
  const [availableModels, setAvailableModels] = useState<RuntimeOllamaModel[]>([]);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [activeGraphId, setActiveGraphId] = useState('core-chat');
  const [composer, setComposer] = useState('');
  const [streamDrafts, setStreamDrafts] = useState<Record<string, { sessionId: string; content: string; model: string; endpoint: string }>>({});
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isPlanningRun, setIsPlanningRun] = useState(false);
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [actionRunId, setActionRunId] = useState<string | null>(null);
  const [approvalDrafts, setApprovalDrafts] = useState<Record<string, { operator: string; operatorRole: string; reason: string }>>({});

  useEffect(() => {
    let alive = true;

    async function load() {
      setIsLoading(true);
      setError('');

      try {
        const [nextStatus, nextPlan, nextGraphs, nextSessions, nextConfig] = await Promise.all([
          runtimeClient.getStatus(),
          runtimeClient.getBootstrapPlan(),
          runtimeClient.getGraphCatalog(),
          runtimeClient.listSessions(),
          runtimeClient.getChatConfig()
        ]);

        let modelCatalog = {
          endpoint: nextConfig.endpoint,
          model: nextConfig.model,
          availableModels: []
        };

        try {
          modelCatalog = await runtimeClient.listOllamaModels(nextConfig.endpoint);
        } catch (catalogError) {
          const message = catalogError instanceof Error ? catalogError.message : String(catalogError);
          setError(message);
        }

        const sessionId = nextSessions[0]?.id ?? '';
        const [nextMessages, nextRuns] = sessionId
          ? await Promise.all([
              runtimeClient.listMessages(sessionId),
              runtimeClient.listRuns(sessionId)
            ])
          : [[], []];

        if (!alive) return;
        setStatus(nextStatus);
        setPlan(nextPlan);
        setGraphs(nextGraphs);
        setSessions(nextSessions);
        setChatConfig({ endpoint: modelCatalog.endpoint || nextConfig.endpoint, model: modelCatalog.model || nextConfig.model });
        setAvailableModels(modelCatalog.availableModels);
        setActiveSessionId(sessionId);
        setMessages(nextMessages);
        setRuns(nextRuns);
      } catch (loadError) {
        if (!alive) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (alive) {
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = runtimeClient.onChatStream((event: RuntimeChatStreamEvent) => {
      if (event.type === 'started') {
        setStreamDrafts((current) => ({
          ...current,
          [event.requestId]: {
            sessionId: event.sessionId,
            content: '',
            model: event.model,
            endpoint: event.endpoint
          }
        }));
        return;
      }

      if (event.type === 'token') {
        setStreamDrafts((current) => {
          const existing = current[event.requestId];
          if (!existing) return current;
          return {
            ...current,
            [event.requestId]: {
              ...existing,
              content: `${existing.content}${event.delta}`
            }
          };
        });
        return;
      }

      setStreamDrafts((current) => {
        const next = { ...current };
        delete next[event.requestId];
        return next;
      });

      if (event.type === 'error') {
        setError(event.message);
      }
    });

    return unsubscribe;
  }, []);

  async function refreshSessionData(sessionId: string) {
    const [nextStatus, nextSessions, nextMessages, nextRuns] = await Promise.all([
      runtimeClient.getStatus(),
      runtimeClient.listSessions(),
      runtimeClient.listMessages(sessionId),
      runtimeClient.listRuns(sessionId)
    ]);

    setStatus(nextStatus);
    setSessions(nextSessions);
    setMessages(nextMessages);
    setRuns(nextRuns);
  }

  async function handleSelectSession(sessionId: string) {
    setActiveSessionId(sessionId);
    setError('');

    try {
      await refreshSessionData(sessionId);
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : String(selectError));
    }
  }

  async function handleCreateSession() {
    setIsCreatingSession(true);
    setError('');

    try {
      const session = await runtimeClient.createSession();
      setActiveSessionId(session.id);
      await refreshSessionData(session.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setIsCreatingSession(false);
    }
  }

  async function handleRefreshModels() {
    setIsRefreshingModels(true);
    setError('');

    try {
      const catalog = await runtimeClient.listOllamaModels(chatConfig.endpoint);
      setAvailableModels(catalog.availableModels);
      setChatConfig({ endpoint: catalog.endpoint, model: catalog.model });
    } catch (modelError) {
      setError(modelError instanceof Error ? modelError.message : String(modelError));
    } finally {
      setIsRefreshingModels(false);
    }
  }

  async function handleSaveConfig(nextConfig: Partial<RuntimeChatConfig>) {
    setError('');

    try {
      const saved = await runtimeClient.saveChatConfig({
        endpoint: nextConfig.endpoint ?? chatConfig.endpoint,
        model: nextConfig.model ?? chatConfig.model
      });
      setChatConfig(saved);
    } catch (configError) {
      setError(configError instanceof Error ? configError.message : String(configError));
    }
  }

  async function handleStartRun(graphId: string) {
    setIsPlanningRun(true);
    setError('');

    try {
      const preferredSessionId = activeSessionId || sessions[0]?.id;
      const run = await runtimeClient.startRun(graphId, preferredSessionId);
      setActiveGraphId(run.graphId);
      await refreshSessionData(run.sessionId);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setIsPlanningRun(false);
    }
  }

  async function handleSendMessage() {
    setIsSendingMessage(true);
    setError('');

    try {
      let sessionId = activeSessionId;
      if (!sessionId) {
        const session = await runtimeClient.createSession();
        sessionId = session.id;
        setActiveSessionId(session.id);
      }

      const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
      const optimisticUserMessage: RuntimeChatMessage = {
        id: `pending-user:${requestId}`,
        sessionId,
        role: 'user',
        content: composer.trim(),
        model: chatConfig.model || null,
        endpoint: chatConfig.endpoint || null,
        createdAt: new Date().toISOString()
      };

      setMessages((current) => [...current, optimisticUserMessage]);

      const result = await runtimeClient.sendChatMessageStream({
        sessionId,
        content: composer,
        endpoint: chatConfig.endpoint,
        model: chatConfig.model,
        requestId
      });
      setComposer('');
      setActiveSessionId(result.sessionId);
      await Promise.all([
        refreshSessionData(result.sessionId),
        handleSaveConfig({ endpoint: result.endpoint, model: result.model })
      ]);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : String(sendError));
    } finally {
      setIsSendingMessage(false);
    }
  }

  async function handleRunAction(runId: string, action: 'execute' | 'resume' | 'step' | 'cancel' | 'approve' | 'deny') {
    setActionRunId(runId);
    setError('');

    try {
      const decision: ApprovalDecision | undefined = approvalDrafts[runId]
        ? {
            operator: approvalDrafts[runId].operator,
            operatorRole: approvalDrafts[runId].operatorRole,
            reason: approvalDrafts[runId].reason
          }
        : undefined;

      if (action === 'execute') {
        await runtimeClient.executeRun(runId);
      } else if (action === 'resume') {
        await runtimeClient.resumeRun(runId);
      } else if (action === 'step') {
        await runtimeClient.stepRun(runId);
      } else if (action === 'approve') {
        await runtimeClient.approveRun(runId, decision);
      } else if (action === 'deny') {
        await runtimeClient.denyRun(runId, decision);
      } else {
        await runtimeClient.cancelRun(runId);
      }

      if (activeSessionId) {
        await refreshSessionData(activeSessionId);
      }
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setActionRunId(null);
    }
  }

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const activeRuns = useMemo(() => runs.filter((run) => run.sessionId === activeSessionId), [runs, activeSessionId]);
  const activeDrafts = useMemo(() => Object.entries(streamDrafts)
    .filter(([, draft]) => draft.sessionId === activeSessionId)
    .map(([requestId, draft]) => ({ requestId, ...draft })), [streamDrafts, activeSessionId]);
  const latestRun = activeRuns[0] ?? null;
  const policyRows = useMemo(() => {
    const entries = new Map<string, { id: string; requiredApproverRole: string; actionScope: string; minRiskScore: number }>();

    for (const run of activeRuns) {
      for (const checkpoint of run.checkpoints) {
        if (!checkpoint.approvalPolicy) continue;
        entries.set(checkpoint.approvalPolicy.id, {
          id: checkpoint.approvalPolicy.id,
          requiredApproverRole: checkpoint.approvalPolicy.requiredApproverRole,
          actionScope: checkpoint.approvalPolicy.actionScope,
          minRiskScore: checkpoint.approvalPolicy.minRiskScore
        });
      }
    }

    return Array.from(entries.values());
  }, [activeRuns]);

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <p className="eyebrow">Ollama + chat runtime</p>
          <h1>Local and LAN chat orchestration</h1>
          <p className="top-copy">Primary chat UI backed by Electron, persisted session history, and direct Ollama HTTP transport.</p>
        </div>
        <div className="top-actions">
          <button className="ghost-action" type="button" onClick={() => void handleRefreshModels()} disabled={isRefreshingModels || isLoading}>
            {isRefreshingModels ? 'Refreshing...' : 'Refresh models'}
          </button>
          <button className="ghost-action" type="button" onClick={() => void handleCreateSession()} disabled={isCreatingSession || isLoading}>
            {isCreatingSession ? 'Creating...' : 'New chat'}
          </button>
          <button className="primary-action" type="button" onClick={() => void handleStartRun(activeGraphId)} disabled={isPlanningRun || !activeSessionId}>
            {isPlanningRun ? 'Planning...' : 'Plan runtime run'}
          </button>
        </div>
      </header>

      {error ? <div className="callout error">{error}</div> : null}

      <section className="metric-grid">
        <article className="metric-card">
          <span>Sessions</span>
          <strong>{status?.sessionCount ?? 0}</strong>
          <small>Latest {formatTimestamp(status?.latestSessionAt ?? null)}</small>
        </article>
        <article className="metric-card">
          <span>Model</span>
          <strong>{chatConfig.model || 'unselected'}</strong>
          <small>{chatConfig.endpoint}</small>
        </article>
        <article className="metric-card">
          <span>Messages</span>
          <strong>{messages.length}</strong>
          <small>{activeSession ? activeSession.title : 'No session selected'}</small>
        </article>
        <article className="metric-card">
          <span>Runtime</span>
          <strong>{status?.mode ?? 'loading'}</strong>
          <small>{status?.langsmith.mode ?? 'langsmith pending'}</small>
        </article>
      </section>

      <section className="chat-layout">
        <aside className="surface session-rail">
          <div className="panel-head">
            <h2>Chats</h2>
          </div>
          <div className="session-stack">
            {sessions.length === 0 ? <div className="empty-state">Create a chat session to begin.</div> : sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                className={`session-item ${session.id === activeSessionId ? 'active' : ''}`}
                onClick={() => void handleSelectSession(session.id)}
              >
                <div>
                  <strong>{session.title}</strong>
                  <p>{session.lastRunSummary}</p>
                </div>
                <span className={`status-pill ${getRunStatusTone(session.status)}`}>{session.status}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="surface chat-column">
          <div className="panel-head">
            <div>
              <h2>{activeSession?.title ?? 'Chat'}</h2>
              <p>Send prompts to your selected Ollama endpoint and persist the conversation locally.</p>
            </div>
          </div>

          <div className="message-list">
            {messages.length === 0 ? <div className="empty-state">No messages yet. Send the first prompt to start the conversation.</div> : messages.map((message) => (
              <article key={message.id} className={`message-card ${message.role}`}>
                <div className="message-meta">
                  <strong>{getMessageLabel(message)}</strong>
                  <span>{formatTimestamp(message.createdAt)}</span>
                </div>
                <p>{message.content}</p>
              </article>
            ))}
            {activeDrafts.map((draft) => (
              <article key={draft.requestId} className="message-card assistant streaming">
                <div className="message-meta">
                  <strong>{draft.model || 'Assistant'}</strong>
                  <span>Streaming...</span>
                </div>
                <p>{draft.content || 'Waiting for first token...'}</p>
              </article>
            ))}
          </div>

          <div className="composer-card">
            <div className="composer-toolbar">
              <label>
                Ollama endpoint
                <input
                  type="text"
                  value={chatConfig.endpoint}
                  onChange={(event) => setChatConfig((current) => ({ ...current, endpoint: event.target.value }))}
                  onBlur={() => void handleSaveConfig({ endpoint: chatConfig.endpoint })}
                  placeholder="http://127.0.0.1:11434 or http://192.168.x.x:11434"
                />
              </label>
              <label>
                Model
                <select
                  value={chatConfig.model}
                  onChange={(event) => {
                    const nextModel = event.target.value;
                    setChatConfig((current) => ({ ...current, model: nextModel }));
                    void handleSaveConfig({ model: nextModel });
                  }}
                >
                  <option value="">Select model</option>
                  {availableModels.map((model) => (
                    <option key={model.name} value={model.name}>{model.name}</option>
                  ))}
                </select>
              </label>
            </div>

            <textarea
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              placeholder="Ask your local or LAN Ollama service something useful..."
              rows={5}
            />
            <div className="composer-actions">
              <small>{chatConfig.endpoint}</small>
              <button className="primary-action" type="button" onClick={() => void handleSendMessage()} disabled={isSendingMessage || !composer.trim()}>
                {isSendingMessage ? 'Sending...' : 'Send message'}
              </button>
            </div>
          </div>
        </section>

        <aside className="surface inspector-rail">
          <section>
            <div className="panel-head">
              <h2>Runtime inspector</h2>
            </div>
            <ul className="meta-list">
              <li>Electron {status?.electronVersion ?? '-'}</li>
              <li>Node {status?.nodeVersion ?? '-'}</li>
              <li>Chrome {status?.chromeVersion ?? '-'}</li>
              <li>App {status?.appVersion ?? '-'}</li>
            </ul>
          </section>

          <section>
            <div className="panel-head split-head">
              <div>
                <h2>Graphs</h2>
                <p>Plan runtime operations alongside chat sessions.</p>
              </div>
            </div>
            <div className="graph-pills">
              {graphs.map((graph) => (
                <button
                  key={graph.id}
                  type="button"
                  className={`graph-pill ${graph.id === activeGraphId ? 'active' : ''}`}
                  onClick={() => setActiveGraphId(graph.id)}
                >
                  {graph.name}
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="panel-head">
              <h2>Runs</h2>
            </div>
            {activeRuns.length === 0 ? <div className="empty-state">No runtime runs for this session.</div> : (
              <div className="run-list compact">
                {activeRuns.map((run) => (
                  <article className="run-card" key={run.id}>
                    <header className="run-header">
                      <div>
                        <h3>{run.graphName}</h3>
                        <p>{run.summary}</p>
                      </div>
                      <span className={`status-pill ${getRunStatusTone(run.status)}`}>{run.status}</span>
                    </header>
                    <div className="run-actions">
                      {(run.status === 'planned' || run.status === 'paused') ? <button className="secondary-action" type="button" onClick={() => void handleRunAction(run.id, 'resume')} disabled={actionRunId === run.id}>Start</button> : null}
                      {(run.status === 'planned' || run.status === 'running' || run.status === 'paused') ? <button className="secondary-action" type="button" onClick={() => void handleRunAction(run.id, 'step')} disabled={actionRunId === run.id}>Step</button> : null}
                      {(run.status === 'planned' || run.status === 'paused') ? <button className="secondary-action" type="button" onClick={() => void handleRunAction(run.id, 'execute')} disabled={actionRunId === run.id}>Run all</button> : null}
                      {(run.status === 'planned' || run.status === 'running' || run.status === 'paused') ? <button className="secondary-action danger" type="button" onClick={() => void handleRunAction(run.id, 'cancel')} disabled={actionRunId === run.id}>Cancel</button> : null}
                    </div>
                    {run.status === 'waiting_approval' ? (
                      <>
                        <div className="approval-form">
                          <label>
                            Operator
                            <input
                              type="text"
                              value={approvalDrafts[run.id]?.operator ?? ''}
                              onChange={(event) => {
                                const value = event.target.value;
                                setApprovalDrafts((current) => ({
                                  ...current,
                                  [run.id]: {
                                    operator: value,
                                    operatorRole: current[run.id]?.operatorRole ?? 'runtime-reviewer',
                                    reason: current[run.id]?.reason ?? ''
                                  }
                                }));
                              }}
                            />
                          </label>
                          <label>
                            Role
                            <input
                              type="text"
                              value={approvalDrafts[run.id]?.operatorRole ?? 'runtime-reviewer'}
                              onChange={(event) => {
                                const value = event.target.value;
                                setApprovalDrafts((current) => ({
                                  ...current,
                                  [run.id]: {
                                    operator: current[run.id]?.operator ?? '',
                                    operatorRole: value,
                                    reason: current[run.id]?.reason ?? ''
                                  }
                                }));
                              }}
                            />
                          </label>
                          <label>
                            Reason
                            <input
                              type="text"
                              value={approvalDrafts[run.id]?.reason ?? ''}
                              onChange={(event) => {
                                const value = event.target.value;
                                setApprovalDrafts((current) => ({
                                  ...current,
                                  [run.id]: {
                                    operator: current[run.id]?.operator ?? '',
                                    operatorRole: current[run.id]?.operatorRole ?? 'runtime-reviewer',
                                    reason: value
                                  }
                                }));
                              }}
                            />
                          </label>
                        </div>
                        <div className="run-actions">
                          <button className="secondary-action" type="button" onClick={() => void handleRunAction(run.id, 'approve')} disabled={actionRunId === run.id}>Approve</button>
                          <button className="secondary-action danger" type="button" onClick={() => void handleRunAction(run.id, 'deny')} disabled={actionRunId === run.id}>Deny</button>
                        </div>
                      </>
                    ) : null}
                    {run.pendingApproval ? <div className="approval-banner">Approval needed: {run.pendingApproval.checkpointTitle} | role {run.pendingApproval.requiredApproverRole}</div> : null}
                  </article>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="panel-head">
              <h2>Policies</h2>
            </div>
            {policyRows.length === 0 ? <div className="empty-state">No approval policies active for this session.</div> : (
              <div className="policy-list">
                {policyRows.map((policy) => (
                  <article key={policy.id} className="policy-card">
                    <strong>{policy.id}</strong>
                    <p>Role: {policy.requiredApproverRole}</p>
                    <p>Scope: {policy.actionScope}</p>
                    <p>Min risk: {policy.minRiskScore}</p>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="panel-head">
              <h2>Latest events</h2>
            </div>
            {latestRun ? <ul className="event-list">{latestRun.events.slice(-6).reverse().map((event) => <li key={event}>{event}</li>)}</ul> : <div className="empty-state">No run events yet.</div>}
          </section>

          <section>
            <div className="panel-head">
              <h2>Milestones</h2>
            </div>
            <ol className="milestone-list">
              {(plan?.milestones ?? []).map((milestone) => <li key={milestone}>{milestone}</li>)}
            </ol>
          </section>
        </aside>
      </section>
    </main>
  );
}

export default App;
