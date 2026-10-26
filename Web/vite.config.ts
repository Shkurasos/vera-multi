import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Идентификатор сборки: зашивается в бандл (__VERA_BUILD_ID__) и кладётся
// рядом в dist/version.json. Клиент сравнивает свой id с серверным и, если
// они разные, предлагает обновиться. В dev-режиме id = 'dev' — проверка
// отключена, иначе dev-сервер всегда «отставал» бы от последней dist-сборки.
const BUILD_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function versionFilePlugin(): Plugin {
  return {
    name: 'vera-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ buildId: BUILD_ID, builtAt: new Date().toISOString() }),
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  // base:'./' — критично для загрузки из file:// в Electron (иначе assets
  // резолвятся с абсолютного /, что ломает production-сборку).
  base: './',
  plugins: [react(), versionFilePlugin()],
  define: {
    __VERA_BUILD_ID__: JSON.stringify(command === 'build' ? BUILD_ID : 'dev'),
  },
  resolve: {
    alias: [
      // Точный алиас: только bare-импорт "@mui/icons-material" → шим с паками иконок.
      // Подпути "@mui/icons-material/Foo" продолжают идти в оригинальный пакет,
      // что критично для самого шима (он импортирует Foo, FooOutlined и т.д.).
      { find: /^@mui\/icons-material$/, replacement: path.resolve(__dirname, './src/mui-icons-shim.tsx') },
      { find: '@', replacement: path.resolve(__dirname, './src') },
      { find: '@components', replacement: path.resolve(__dirname, './src/components') },
      { find: '@pages', replacement: path.resolve(__dirname, './src/pages') },
      { find: '@hooks', replacement: path.resolve(__dirname, './src/hooks') },
      { find: '@store', replacement: path.resolve(__dirname, './src/store') },
      { find: '@services', replacement: path.resolve(__dirname, './src/services') },
    ],
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    allowedHosts: [
      '.ngrok-free.dev',
      '.ngrok-free.app',
    ],
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // Установщики лежат на Express-сервере. Без прокси Vite отдаёт SPA
      // index.html под именем .exe, и Windows сообщает о повреждённом файле.
      '/downloads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'mui-vendor': ['@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled'],
          'state-vendor': ['zustand', 'axios', 'socket.io-client'],
        },
      },
    },
  },
}));
