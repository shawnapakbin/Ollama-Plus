import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleDot, AlertTriangle, Clock3 } from 'lucide-react';
import { taskRuntime, type RuntimeTask, type TaskState } from '../services/taskRuntime';
import './TaskBoard.css';

const STATE_META: Record<TaskState, { icon: React.ComponentType<{ size?: number }>; label: string }> = {
  queued: { icon: Clock3, label: 'Queued' },
  running: { icon: CircleDot, label: 'Running' },
  blocked: { icon: AlertTriangle, label: 'Blocked' },
  done: { icon: CheckCircle2, label: 'Done' },
  failed: { icon: AlertTriangle, label: 'Failed' }
};

function formatAge(isoDate: string) {
  const deltaMs = Date.now() - new Date(isoDate).getTime();
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return 'just now';
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function TaskBoard() {
  const [tasks, setTasks] = useState<RuntimeTask[]>(() => taskRuntime.list());
  const [selectedTaskId, setSelectedTaskId] = useState<string>(taskRuntime.list()[0]?.id || '');

  useEffect(() => {
    return taskRuntime.subscribe((nextTasks) => {
      setTasks(nextTasks);
      setSelectedTaskId((prev) => {
        if (prev && nextTasks.some((task) => task.id === prev)) return prev;
        return nextTasks[0]?.id || '';
      });
    });
  }, []);

  const selectedTask = useMemo(() => tasks.find((task) => task.id === selectedTaskId) || tasks[0], [selectedTaskId, tasks]);

  return (
    <div className="task-board-container">
      <aside className="task-board-list glass-panel">
        <div className="task-board-header">
          <h3>Task Board</h3>
          <span className="task-count">{tasks.length} tasks</span>
        </div>
        <div className="task-list-scroll">
          {tasks.map((task) => {
            const MetaIcon = STATE_META[task.state].icon;
            return (
              <button
                key={task.id}
                className={`task-card ${task.id === selectedTask?.id ? 'active' : ''}`}
                onClick={() => setSelectedTaskId(task.id)}
              >
                <MetaIcon size={14} />
                <div className="task-card-text">
                  <span className="task-title">{task.title}</span>
                  <span className="task-subtitle">{STATE_META[task.state].label} · {formatAge(task.updatedAt)}</span>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="task-board-details glass-panel">
        {selectedTask ? (
          <>
            <h3>{selectedTask.title}</h3>
            <p className="task-detail-state">Status: {STATE_META[selectedTask.state].label}</p>
            <p className="task-detail-text">Created {formatAge(selectedTask.createdAt)} · Updated {formatAge(selectedTask.updatedAt)}.</p>
            <div className="task-log-list">
              {selectedTask.logs.map((log) => (
                <div key={log.id} className="task-log-item">
                  <span className="task-log-time">{new Date(log.at).toLocaleTimeString()}</span>
                  <span className="task-log-text">{log.text}</span>
                </div>
              ))}
              {selectedTask.logs.length === 0 && <p className="task-empty">No logs yet.</p>}
            </div>
          </>
        ) : (
          <p className="task-empty">No task selected.</p>
        )}
      </section>
    </div>
  );
}
