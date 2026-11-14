import { appendFileSync, writeFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// `npm run dev:phone` serves over HTTPS on the local network, because phones
// only allow audio input on secure pages. The certificate is self-signed, so
// Safari shows a warning once.
const phone = process.env.BOUNCE_PHONE === '1'

/** Dev only: the page posts diagnostics here so they show up in the server log and .phone-log. */
function phoneLog(): Plugin {
  const file = '.phone-log'
  return {
    name: 'bounce-phone-log',
    configureServer(server) {
      writeFileSync(file, '')
      server.middlewares.use('/__log', (req, res) => {
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          const line = `${new Date().toISOString().slice(11, 19)} ${body}`
          console.log(`[phone] ${line}`)
          appendFileSync(file, line + '\n')
          res.statusCode = 204
          res.end()
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), phoneLog(), ...(phone ? [basicSsl()] : [])],
  server: phone ? { port: 5184, strictPort: true, host: true } : { port: 5183 },
})
