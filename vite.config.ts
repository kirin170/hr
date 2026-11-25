import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // 隔离验收时可把代理指向另一个 API 实例，避免占用默认 3000 上的开发服务。
  // 用 loadEnv 读取（前缀置空以包含进程环境变量），避免在 web tsconfig 里引用 node 的 process。
  const env = loadEnv(mode, '', '')
  const apiTarget = env.VITE_PROXY_TARGET || 'http://localhost:3000'
  const port = Number(env.VITE_PORT) || 4173

  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port,
      proxy: {
        '/api/v1': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})
