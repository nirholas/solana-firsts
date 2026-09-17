import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Absolute so the deep /t/:cluster/:mint route resolves assets from the root.
  base: '/',
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          solana: ['@solana/kit', '@solana-program/memo', '@solana-program/system', '@solana-program/token-2022'],
          vendor: ['react', 'react-dom', 'lucide-react'],
        },
      },
    },
  },
  server: { port: 4173 },
});
