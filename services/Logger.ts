
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  timestamp: number;
  component: string;
  message: string;
  level: LogLevel;
  data?: any;
}

class LoggerService {
  private logs: LogEntry[] = [];
  private listeners: ((entry: LogEntry) => void)[] = [];
  private maxLogs = 5000;

  log(component: string, message: string, level: LogLevel = 'info', data?: any) {
    const entry: LogEntry = {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
      timestamp: Date.now(),
      component,
      message,
      level,
      data
    };

    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Console mirror
    const style = level === 'error' ? 'color: red' : level === 'warn' ? 'color: orange' : 'color: cyan';
    // console.log(`%c[${component}] ${message}`, style, data || '');

    this.notify(entry);
  }

  getHistory(): LogEntry[] {
    return [...this.logs];
  }

  subscribe(callback: (entry: LogEntry) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  private notify(entry: LogEntry) {
    this.listeners.forEach(l => l(entry));
  }

  clear() {
    this.logs = [];
  }

  downloadLogs() {
    const blob = new Blob([JSON.stringify(this.logs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `system_logs_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

export const SystemLogger = new LoggerService();
