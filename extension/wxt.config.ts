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
    permissions: ['storage', 'unlimitedStorage', 'activeTab', 'scripting', 'webNavigation'],
    icons: {
      '16': 'icon/icon.svg',
      '32': 'icon/icon.svg',
      '48': 'icon/icon.svg',
      '128': 'icon/icon.svg',
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
