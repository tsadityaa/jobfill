import { defineConfig } from 'wxt';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  srcDir: '.',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Personal Copilot',
    description: 'Your secure personal application assistant. Store details, autofill forms, manage documents.',
    version: '0.1.0',
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
    plugins: [tailwindcss()],
  }),
});
