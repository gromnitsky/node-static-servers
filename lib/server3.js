/*
  + deflate

    "A sender MUST NOT send a Content-Length header field in any
     message that contains a Transfer-Encoding header field"
*/

import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import {pipeline} from 'stream'
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

        let dest = content_encoding(req, writable, file, opt)
        if ( !(opt.dest_length = dest.length)) {
            let err = new Error('Pas acceptable')
            err.code = 'EBADE'
            return error(writable, err, opt.verbose)
        }

        let ims = new Date(req.headers['if-modified-since']).getTime()
        if (ims >= stats.mtime.toUTCString() // last-modified value
            || req.headers['if-none-match'] === etag(stats, dest.length)) {
            writable.statusCode = 304
            return writable.end()
        }

        if (req.method === 'HEAD') {
            set_headers(writable, file, opt, stats)
            return writable.end()
        }

        let readable = fs.createReadStream(file)
        readable.once('data', () => set_headers(writable, file, opt, stats))
        let oopsie = err => error(writable, err, opt.verbose)
        pipeline(readable, ...dest, oopsie)
    })
}

function set_headers(res, file, opt, stats) {
    if (!opt.no_content_length) res.setHeader('Content-Length', stats.size)
    res.setHeader('Content-Type', content_type(file, opt.mime))
    res.setHeader('ETag', etag(stats, opt.dest_length))
    res.setHeader('Last-Modified', stats.mtime.toUTCString())
    Object.entries(opt.headers || {}).map( v => res.setHeader(...v))
}

// return [{ name: 'foo', q: 1 }, { name: 'bar', q: 0.5 }, ...]
export function accept_encoding_parse(str) {
    return (str || '').split(',')
        .map( v => v.trim()).filter(Boolean)
        .map( v => {
            let p = v.split(';').map( v => v.trim()).filter(Boolean)
            if (!p[0]) return // invalid algo
            let r = { name: p[0], q: 1 }
            let q = p.find( v => v.slice(0,2) === 'q=')
            if (q) {
                let weight = Number(q.split('=')[1])
                if (weight >= 0) r.q = weight
            }
            return r
        }).filter(Boolean).sort( (a, b) => b.q - a.q)
}

export function accept_encoding_negotiate(algo, enc) {
    let v = enc.find( v => v.name === algo)
    let star = enc.find( v => v.name === '*' || v.name === 'identity')
    if (!v && star?.q === 0) return 'no deal'
    if (v && v.q === 0) return 'no deal'
    if (!v) return 'pass-through'
    return 'compress'
}

function content_encoding(req, res, file, opt) {
    let enc = req.headers['accept-encoding']
    if (!enc || !/(text\/|javascript|json|\+xml)/
        .test(content_type(file, opt.mime)))
        return [res] // don't compress binaries

    let r = accept_encoding_negotiate('deflate', accept_encoding_parse(enc))
    if (r === 'no deal') return []
    if (r === 'pass-through') return [res]

    res.setHeader('Content-Encoding', 'deflate')
    opt.no_content_length = true
    return [zlib.createDeflate(), res]
}

function etag(s, dest_length) {
    return [s.dev, s.ino, s.mtime.getTime(), dest_length].join`-`
}

function content_type(file, custom_types) {
    mime.define(custom_types, true)
    return mime.getType(file) || 'application/octet-stream'
}

function error(writable, err, verbose) {
    if (!writable.headersSent) {
        let codes = { 'ENOENT':404, 'EACCES':403, 'EINVAL':400, 'EBADE':406 }
        writable.statusCode = codes[err?.code] || 500
        if (verbose) writable.statusMessage = err
    }
    writable.end()
}
