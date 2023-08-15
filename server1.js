/*
  test:

  $ seq 10000 | xargs -P 1000 -I@ curl -s http://127.0.0.1:3000/server.js -o /dev/null

  It should not print:

  - [DEP0137] DeprecationWarning: Closing a FileHandle object on
    garbage collection is deprecated
  - Warning: Closing file descriptor NN on garbage collection
  - Premature close
*/

import http from 'http'
import serve_static from './lib/server1.js'

let server = http.createServer( (req, res) => {
    serve_static(res, req.url, {
        headers: { 'access-control-allow-origin': 'example.com' },
        mime: { '.txt': 'text/plain' },
        verbose: true
    })
})

server.listen(process.env.PORT || 3000)
console.error(process.pid, process.cwd())
