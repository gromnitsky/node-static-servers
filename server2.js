/*
  + uses 'mime' from npm
  - sets last-modified & etag
  - responds to HEAD requests
*/

import http from 'http'
import mime from 'mime'
import serve_static from './lib/server2.js'

let server = http.createServer( (req, res) => {
    serve_static(res, req.url, {
        headers: { 'access-control-allow-origin': 'example.com' },
        mime: { 'text/markdown': ['txt'] },
        verbose: true
    })
})

server.listen(process.env.PORT || 3000)
console.error(process.pid, process.cwd())
