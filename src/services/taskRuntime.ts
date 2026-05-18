export type TaskState = 'queued' | 'running' | 'blocked' | 'done' | 'failed';

export type TaskLog = {
  id: string;
  at: string;
  text: string;
};

export type RuntimeTask = {
  id: string;
  title: string;
  state: TaskState;
  updatedAt: string;
  createdAt: string;
  origin: 'chat' | 'system';
  logs: TaskLog[];
};

type TaskSubscriber = (tasks: RuntimeTask[]) => void;

const STORAGE_KEY = 'runtimeTasks';
const MAX_TASKS = 120;
const subscribers = new Set<TaskSubscriber>();

function loadFromStorage(): RuntimeTask[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t) => t && typeof t.id === 'string' && typeof t.title === 'string')
      .map((t) => ({
        id: t.id,
        title: t.title,
        state: t.state || 'queued',
        updatedAt: t.updatedAt || new Date().toISOString(),
        createdAt: t.createdAt || t.updatedAt || new Date().toISOString(),
        origin: t.origin === 'system' ? 'system' : 'chat',
        logs: Array.isArray(t.logs)
          ? t.logs
              .filter((log) => log && typeof log.id === 'string' && typeof log.text === 'string')
              .map((log) => ({ id: log.id, at: log.at || new Date().toISOString(), text: log.text }))
          : []
      }));
  } catch {
    return [];
  }
}

let tasks: RuntimeTask[] = loadFromStorage();

function persistAndBroadcast() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks.slice(0, MAX_TASKS)));
  const snapshot = [...tasks];
  subscribers.forEach((subscriber) => subscriber(snapshot));
}

function updateTask(taskId: string, updater: (task: RuntimeTask) => RuntimeTask) {
  tasks = tasks.map((task) => (task.id === taskId ? updater(task) : task));
  persistAndBroadcast();
}

export const taskRuntime = {
  subscribe(subscriber: TaskSubscriber) {
    subscribers.add(subscriber);
    subscriber([...tasks]);
    return () => subscribers.delete(subscriber);
  },
  list() {
    return [...tasks];
  },
  createTask(title: string, origin: RuntimeTask['origin'] = 'chat') {
    const now = new Date().toISOString();
    const id = `task-${Math.random().toString(36).slice(2, 10)}`;
    const newTask: RuntimeTask = {
      id,
      title: title.trim() || 'Untitled task',
      state: 'queued',
      createdAt: now,
      updatedAt: now,
      origin,
      logs: [
        {
          id: `log-${Math.random().toString(36).slice(2, 10)}`,
          at: now,
          text: 'Task queued.'
        }
      ]
    };

    tasks = [newTask, ...tasks].slice(0, MAX_TASKS);
    persistAndBroadcast();
    return id;
  },
  setState(taskId: string, state: TaskState, note?: string) {
    updateTask(taskId, (task) => {
      const now = new Date().toISOString();
      const nextLogs = note
        ? [
            {
              id: `log-${Math.random().toString(36).slice(2, 10)}`,
              at: now,
              text: note
            },
            ...task.logs
          ]
        : task.logs;

      return {
        ...task,
        state,
        updatedAt: now,
        logs: nextLogs.slice(0, 80)
      };
    });
  },
  addLog(taskId: string, text: string) {
    if (!text.trim()) return;
    updateTask(taskId, (task) => {
      const now = new Date().toISOString();
      return {
        ...task,
        updatedAt: now,
        logs: [
          {
            id: `log-${Math.random().toString(36).slice(2, 10)}`,
            at: now,
            text: text.trim()
          },
          ...task.logs
        ].slice(0, 80)
      };
    });
  }
};
