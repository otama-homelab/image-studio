import {defineConfig,mergeConfig} from 'vitest/config';
import base from './vite.config.ts';
export default mergeConfig(base,defineConfig({test:{environment:'jsdom',maxWorkers:1,fileParallelism:false,include:['tests/**/*.test.tsx']}}));
