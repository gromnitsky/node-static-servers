/*
  test:

  $ seq 10000 | xargs -P 1000 -I@ curl -s http://127.0.0.1:3000/server.js -o /dev/null

  It should not print:

  - [DEP0137] DeprecationWarning: Closing a FileHandle object on
    garbage collection is deprecated
  - Warning: Closing file descriptor NN on garbage collection
  - Premature close
*/

import fs from 'fs'
import http from 'http'
import path from 'path'

let server = http.createServer( (req, res) => {
    serve_static(res, req.url, {verbose_err: true})
})

server.listen(process.env.PORT || 3000)
console.error(process.pid, process.cwd())

function serve_static(writable, name, opt = {}) {
    if (/^\/+$/.test(name)) name = "index.html"
    let file = path.join(opt.public_root || process.cwd(), path.normalize(name))

    fs.stat(file, (err, stats) => {
        if (err || !stats.isFile()) return error(writable, err)

        let headers_were_set
        let readable = fs.createReadStream(file)
        readable.once('data', () => {
            writable.setHeader('Content-Length', stats.size)
            writable.setHeader('Content-Type', {
                '.html': 'text/html',
                '.js': 'application/javascript'
            }[path.extname(file)] || 'application/octet-stream')
            headers_were_set = true
        })
        readable.on('error', e => {
            if (headers_were_set)
                writable.end()
            else
                error(writable, e, {code: 500, verbose_err: opt.verbose_err})
        })
        readable.pipe(writable)
    })
}

function error(res, msg, opt = {code: 404, verbose_err: false}) {
    res.statusCode = opt.code
    if (opt.verbose_err) {
        console.error(msg.message)
        res.statusMessage = msg
    }
    res.end()
}
