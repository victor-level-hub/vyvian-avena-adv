import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // necessário para os testes de componente (.test.jsx) compilarem JSX
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.{js,jsx}'],
    environment: 'node',
    globals: false,
    setupFiles: ['tests/setup.js'],
    reporters: ['verbose'],
    sequence: { concurrent: false },
  },
});
