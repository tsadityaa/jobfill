import { defineConfig } from 'wxt';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function extensionFileLoggerPlugin() {
  const rootLogFile = path.resolve(__dirname, '../extension-dev.log');
  const extLogFile = path.resolve(__dirname, 'extension-dev.log');

  function writeToLogFiles(content: string) {
    try {
      fs.appendFileSync(rootLogFile, content, 'utf8');
    } catch {}
    try {
      fs.appendFileSync(extLogFile, content, 'utf8');
    } catch {}
  }

  function formatLogEntry(log: {
    level?: string;
    message?: string;
    timestamp?: string | Date;
    module?: string;
    extra?: any[];
    stacks?: string[];
  }): string {
    const time = log.timestamp ? new Date(log.timestamp).toISOString() : new Date().toISOString();
    const level = (log.level || 'info').toUpperCase().padEnd(5);
    const mod = log.module || 'extension';
    let text = `[${time}] [${level}] [${mod}] ${log.message || ''}\n`;

    if (Array.isArray(log.extra) && log.extra.length > 0) {
      log.extra.forEach((item: any, idx: number) => {
        const str = typeof item === 'object' && item !== null
          ? JSON.stringify(item, null, 2)
          : String(item);
        text += `  [Data #${idx + 1}]:\n` + str.split('\n').map((l) => `    ${l}`).join('\n') + '\n';
      });
    }

    if (Array.isArray(log.stacks) && log.stacks.length > 0) {
      text += `  [Stack]:\n` + log.stacks.map((s: any) => `    ${s}`).join('\n') + '\n';
    }

    text += '--------------------------------------------------------------------------------\n';
    return text;
  }

  return {
    name: 'extension-file-logger',
    configureServer(server: any) {
      const banner = `\n================================================================================\n[${new Date().toISOString()}] Extension Dev Server Started — Logging to extension-dev.log\n================================================================================\n\n`;
      writeToLogFiles(banner);

      server.middlewares.use((req: any, res: any, next: any) => {
        // Ensure preflight and standard requests from content scripts (e.g. docs.google.com) pass CORS
        if (req.url?.startsWith('/api/debug/client-logs') || req.url?.startsWith('/api/dev-logger')) {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

          if (req.method === 'OPTIONS') {
            res.writeHead(204, {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
              'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
            });
            res.end();
            return;
          }
        }

        if (req.url === '/api/debug/client-logs' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk: any) => {
            body += chunk.toString();
          });
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              if (Array.isArray(data.logs)) {
                let formatted = '';
                for (const item of data.logs) {
                  formatted += formatLogEntry(item);
                }
                writeToLogFiles(formatted);
              }
            } catch {}
          });
          return next();
        }

        if (req.url === '/api/dev-logger' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk: any) => {
            body += chunk.toString();
          });
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              const logs = Array.isArray(data.logs) ? data.logs : [data];
              let formatted = '';
              for (const item of logs) {
                formatted += formatLogEntry(item);
              }
              writeToLogFiles(formatted);
              res.writeHead(200, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              });
              res.end(JSON.stringify({ success: true }));
            } catch (err: any) {
              res.writeHead(400, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              });
              res.end(JSON.stringify({ error: err?.message || 'Invalid JSON' }));
            }
          });
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  srcDir: '.',
  dev: {
    server: {
      port: 3001,
      strictPort: true,
    },
  },
  modules: ['@wxt-dev/module-react', 'wxt-module-console-forward'],
  consoleForward: {
    enabled: true,
    silentOnError: false,
  },
  manifest: {
    name: 'MemoraFill',
    description: 'Your secure personal application assistant. Store details, autofill forms, manage documents.',
    version: '0.1.1',
    action: { default_title: 'MemoraFill' },
    permissions: ['storage', 'unlimitedStorage', 'activeTab', 'scripting', 'webNavigation', 'identity'],
    host_permissions: ['<all_urls>', 'https://eneyoicwuqjdaonccqkm.supabase.co/*'],
    icons: {
      '16': 'icon-16.png',
      '32': 'icon-32.png',
      '48': 'icon-48.png',
      '128': 'icon-128.png',
    },
  },
  vite: () => ({
    plugins: [tailwindcss(), extensionFileLoggerPlugin()],
    server: {
      cors: {
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      },
    },
  }),
});
