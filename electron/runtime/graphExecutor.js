function renderOutput(run, completedCheckpointCount) {
  return [
    `Graph ${run.graphName} completed in bootstrap executor mode.`,
    `Graph ID: ${run.graphId}`,
    `Checkpoints completed: ${completedCheckpointCount}`,
    'Next milestone: replace bootstrap executor with compiled LangGraph nodes and stream callbacks.'
  ].join('\n');
}

export function executeRunLifecycle(run, options = {}) {
  const nowIso = options.now ?? new Date().toISOString();
  const checkpoints = Array.isArray(run.checkpoints) ? run.checkpoints : [];

  if (checkpoints.length === 0) {
    return {
      status: 'failed',
      summary: `Run ${run.graphName} failed: no checkpoints were defined.`,
      nextAction: 'Populate graph checkpoints before executing this run again.',
      checkpoints: [],
      events: ['Execution aborted: missing checkpoint definitions.'],
      output: '',
      error: 'No checkpoints to execute.',
      startedAt: nowIso,
      completedAt: nowIso
    };
  }

  const events = [];
  const completedCheckpoints = checkpoints.map((checkpoint) => {
    events.push(`Completed checkpoint ${checkpoint.order}: ${checkpoint.title}`);
    return {
      ...checkpoint,
      status: 'completed'
    };
  });

  return {
    status: 'completed',
    summary: `${run.graphName} completed using the local runtime bootstrap executor.`,
    nextAction: 'Integrate the compiled LangGraph executor for real model, tool, and memory execution.',
    checkpoints: completedCheckpoints,
    events,
    output: renderOutput(run, completedCheckpoints.length),
    error: '',
    startedAt: nowIso,
    completedAt: nowIso
  };
}