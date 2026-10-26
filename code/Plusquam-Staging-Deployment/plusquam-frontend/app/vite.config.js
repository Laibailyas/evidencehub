import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
// Hosting: apppq.plusquam.xyz (subdomain) → base '/'.
// If you instead serve from intel.plusquam.xyz/app/, change base to '/app/'.
export default defineConfig({
    plugins: [react()],
    base: '/',
    resolve: {
        alias: { '@': path.resolve(import.meta.dirname, './src') },
    },
    build: {
        outDir: 'dist',
        sourcemap: false,
        emptyOutDir: true,
    },
});
