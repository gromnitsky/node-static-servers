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
    serve_static(res, req.url, {verbose_error: true})
})

server.listen(process.env.PORT || 3000)
console.error(process.pid, process.cwd())

function serve_static(res, file, opt = {}) {
    if (/^\/+$/.test(file)) file = "index.html"
    let name = path.join(opt.public_root || process.cwd(), path.normalize(file))

    fs.stat(name, (err, stats) => {
        if (err || !stats.isFile()) return error(res, err)

        let readable = fs.createReadStream(name)
        readable.once('data', () => {
            res.setHeader('Content-Length', stats.size)
            res.setHeader('Content-Type', {
                '.html': 'text/html',
                '.js': 'application/javascript'
            }[path.extname(name)] || 'application/octet-stream')
        })
        readable.on('error', e => {
            error(res, e, {code: 500, verbose_error: opt.verbose_error})
        })
        readable.pipe(res)
    })
}

function error(res, msg, opt = {code: 404, verbose_error: false}) {
    res.statusCode = opt.code
    if (opt.verbose_error) {
        console.error(msg.message)
        res.statusMessage = msg
    }
    res.end()
}
