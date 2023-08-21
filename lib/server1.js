import fs from 'fs'
import path from 'path'

export default function(writable, name, opt = {}) {
    if (/^\/+$/.test(name)) name = "index.html"
    let file = path.join(opt.public_root || process.cwd(), path.normalize(name))

    file = decodeURI(file)
    fs.stat(file, (err, stats) => {
        if (!err && !stats.isFile()) {
            err = new Error("Invalid argument")
            err.code = 'EINVAL'
        }
        if (err) return error(writable, err, opt.verbose)

        let readable = fs.createReadStream(file)
        readable.once('data', () => {
            writable.setHeader('Content-Length', stats.size)
            writable.setHeader('Content-Type', Object.assign({
                '.html': 'text/html',
                '.js': 'application/javascript'
            }, opt.mime)[path.extname(file)] || 'application/octet-stream')
            Object.entries(opt.headers || {}).map(h => writable.setHeader(...h))
        })
        readable.on('error', err => error(writable, err, opt.verbose))
        readable.pipe(writable)
    })
}

function error(writable, err, verbose) {
    if (!writable.headersSent) {
        let codes = { 'ENOENT': 404, 'EACCES': 403, 'EINVAL': 400 }
        writable.statusCode = codes[err?.code] || 500
        if (verbose) try { writable.statusMessage = err } catch {/**/}
    }
    writable.end()
}
