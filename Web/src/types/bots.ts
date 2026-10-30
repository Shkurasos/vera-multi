/** Команда из меню бота (setMyCommands). */
export interface BotCommand {
  command: string;
  description: string;
}

export interface BotKeywordRule {
  keywords: string[];
  response: string;
}

/** Бот глазами владельца. Токен сервер не хранит и не отдаёт повторно. */
export interface Bot {
  id: string;
  userId: string;
  username: string;
  name: string;
  createdAt: string;
  tokenIssuedAt?: string | null;
  hasWebhook?: boolean;
  /** Меню команд; приходит в публичном GET /bots/:username. */
  commands?: BotCommand[];
  /** Кнопка мини-приложения слева от поля ввода (/setmenubutton). */
  menuButton?: { text: string } | null;
}

export interface ScanFinding {
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  evidence?: string;
  recommendation?: string;
}

export interface ScanResult {
  id: string;
  url: string;
  createdById: string;
  statusCode: number;
  responseTimeMs: number;
  headers: Record<string, string>;
  findings: ScanFinding[];
  aiAnalysis?: string;
  aiAnalyzed: boolean;
  createdAt: string;
}

export interface ProxyLogEntry {
  id: string;
  method: string;
  url: string;
  requestHeaders?: string;
  requestBody?: string;
  statusCode: number;
  responseHeaders?: string;
  responseBody?: string;
  contentType?: string;
  clientIp?: string;
  createdAt: string;
}

export interface RepeaterEntry {
  id: string;
  method: string;
  url: string;
  requestHeaders?: string;
  requestBody?: string;
  statusCode: number;
  responseHeaders?: string;
  responseBody?: string;
  responseTimeMs: number;
  createdAt: string;
}

export interface AiModelInfo {
  id: string;
  name: string;
  description?: string;
  status: 'empty' | 'training' | 'ready';
  files: number;
  chars: number;
  lastTrainedAt?: string;
}