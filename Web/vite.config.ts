import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  // base:'./' — критично для загрузки из file:// в Electron (иначе assets
  // резолвятся с абсолютного /, что ломает production-сборку).
  base: './',
  plugins: [react()],
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
});
