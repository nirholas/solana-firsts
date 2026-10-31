import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Absolute so the deep /t/:cluster/:mint route resolves assets from the root.
  base: '/',
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: false,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
            { name: 'solana', test: /node_modules[\\/](@solana|@solana-program)[\\/]/ },
            { name: 'vendor', test: /node_modules[\\/](react|react-dom|lucide-react)[\\/]/ },
          ],
        },
      },
    },
  },
  server: { port: 4173 },
});
