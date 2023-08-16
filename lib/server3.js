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

        let ims = new Date(req.headers['if-modified-since']).getTime()
        if (ims >= stats.mtime.toUTCString() // last-modified value
            || req.headers['if-none-match'] === etag(stats)) {
            writable.statusCode = 304
            return writable.end()
        }

        let comp = accept_encoding(req, writable, file, opt)
        if (comp instanceof Error) return error(writable, comp, opt.verbose)

        if (req.method === 'HEAD') {
            set_headers(writable, file, opt, stats)
            return writable.end()
        }

        let readable = fs.createReadStream(file)
        readable.once('data', () => set_headers(writable, file, opt, stats))
        let oopsie = err => error(writable, err, opt.verbose)
        let streams = [readable, comp, writable].filter(Boolean)
        pipeline(...streams, oopsie)
    })
}

function set_headers(res, file, opt, stats) {
    if (!opt.no_content_length) res.setHeader('Content-Length', stats.size)
    res.setHeader('Content-Type', content_type(file, opt.mime))
    res.setHeader('ETag', etag(stats))
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
    let err = new Error('Pas acceptable')
    err.code = 'EBADE'

    let v = enc.find( v => v.name === algo)
    let asterisk = enc.find( v => v.name === '*')
        || enc.find( v => v.name === 'identity')
    if (!v && asterisk?.q === 0) return err
    if (v && v.q === 0) return err
    if (!v) return false

    return true
}

function accept_encoding(req, res, file, opt) {
    let enc = req.headers['accept-encoding']
    if (!enc || !/(text\/|application.javascript|application.json|\+xml)/
        .test(content_type(file, opt.mime)))
        return // don't compress

    let r = accept_encoding_negotiate('deflate', accept_encoding_parse(enc))
    if (r instanceof Error) return r
    if (r) {
        res.setHeader('Content-Encoding', 'deflate')
        opt.no_content_length = true
        return zlib.createDeflate()
    }
}

function etag(s) { return [s.dev, s.ino, s.mtime.getTime()].join`-` }

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
