/**
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
})
