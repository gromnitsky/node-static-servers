/*
  + use 'mime' from npm
  + set last-modified & etag
  + respond with 304
  + respond to HEAD requests
*/

import fs from 'fs'
import path from 'path'
import mime from 'mime'

export default function(req, writable, name, opt = {}) {
    if (/^\/+$/.test(name)) name = "index.html"
    let file = path.join(opt.public_root || process.cwd(), path.normalize(name))

    file = decodeURI(file)
    fs.stat(file, (err, stats) => {
        if (!err && !stats.isFile()) {
            err = new Error("Invalid argument")
            err.code = 'EINVAL'
        }
        if (err) return error(writable, err, opt.verbose)

        let ims = new Date(req.headers['if-modified-since']).getTime()
        if (ims >= stats.mtime.toUTCString() // last-modified value
            || req.headers['if-none-match'] === etag(stats)) {
            writable.statusCode = 304
            return writable.end()
        }

        if (req.method === 'HEAD') {
            set_headers(writable, file, opt, stats)
            return writable.end()
        }

        let readable = fs.createReadStream(file)
        readable.once('data', () => set_headers(writable, file, opt, stats))
        readable.on('error', err => error(writable, err, opt.verbose))
        readable.pipe(writable)
    })
}

function set_headers(res, file, opt, stats) {
    res.setHeader('Content-Length', stats.size)
    res.setHeader('Content-Type', content_type(file, opt.mime))
    res.setHeader('ETag', etag(stats))
    res.setHeader('Last-Modified', stats.mtime.toUTCString())
    Object.entries(opt.headers || {}).map( v => res.setHeader(...v))
}

function etag(s) { return [s.dev, s.ino, s.mtime.getTime()].join`-` }

function content_type(file, custom_types) {
    mime.define(custom_types, true)
    return mime.getType(file) || 'application/octet-stream'
}

function error(writable, err, verbose) {
    if (!writable.headersSent) {
        let codes = { 'ENOENT': 404, 'EACCES': 403, 'EINVAL': 400 }
        writable.statusCode = codes[err?.code] || 500
        if (verbose) writable.statusMessage = err
    }
    writable.end()
}
