import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          solana: ['@solana/kit', '@solana-program/memo', '@solana-program/system', '@solana-program/token'],
          vendor: ['react', 'react-dom', 'lucide-react'],
        },
      },
    },
  },
  server: { port: 4173 },
});
