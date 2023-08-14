/*
  test:

  $ seq 10000 | xargs -P 1000 -I@ curl -s http://127.0.0.1:3000/server.js -o /dev/null

  It should not print

  "[DEP0137] DeprecationWarning: Closing a FileHandle object on
  garbage collection is deprecated."

  or

  "Warning: Closing file descriptor NN on garbage collection"
*/

import fs from 'fs/promises'
import http from 'http'
import path from 'path'

let server = http.createServer( (req, res) => {
    serve_static(res, req.url)
})

server.listen(process.env.PORT || 3000)
console.error(process.pid)

let public_root = path.dirname(await fs.realpath(process.argv[1]))

function serve_static(res, file) {
    if (/^\/+$/.test(file)) file = "index.html"
    let name = path.join(public_root, path.normalize(file))
    let fd
    fs.open(name).then( file_handle => {
        fd = file_handle
        return file_handle.stat()
    }).then( stats => {
        if (!stats.isFile()) throw new Error(":(")
        res.setHeader('Content-Length', stats.size)
        res.setHeader('Content-Type', {
            '.html': 'text/html',
            '.js': 'application/javascript'
        }[path.extname(name)] || 'application/octet-stream')

        return fd.createReadStream()
    }).then( stream => stream.pipe(res)).catch( err => {
        res.statusCode = 404
        console.error(err.message)
        res.end()
    })
}
