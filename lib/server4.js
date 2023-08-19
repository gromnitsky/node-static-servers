/*
  - range requests
    - single
    - multipart/byteranges
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

        let cnt_type = content_type(file, opt.mime)
        let dest = content_encoding(req, writable, cnt_type)
        if (!dest.length) {
            let err = new Error('Pas acceptable')
            err.code = 'EBADE'
            return error(writable, err, opt.verbose)
        }

        let ims = new Date(req.headers['if-modified-since']).getTime()
        if (ims >= stats.mtime.toUTCString() // last-modified value
            || req.headers['if-none-match'] === etag(writable, stats)) {
            writable.statusCode = 304
            return writable.end()
        }

        if (req.method === 'HEAD') {
            set_headers(writable, opt, stats, cnt_type)
            return writable.end()
        }

        let readable = fs.createReadStream(file)
        readable.once('data', () => set_headers(writable, opt, stats, cnt_type))
        readable.on('error', err => error(writable, err, opt.verbose))
        pipeline(readable, ...dest, () => {/* all streams are closed */})
    })
}

function set_headers(writable, opt, stats, content_type) {
    if (!writable.getHeader('content-encoding'))
        writable.setHeader('Content-Length', stats.size)
    writable.setHeader('Content-Type', content_type)
    writable.setHeader('ETag', etag(writable, stats))
    writable.setHeader('Last-Modified', stats.mtime.toUTCString())
    Object.entries(opt.headers || {}).map( v => writable.setHeader(...v))
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

function content_encoding(req, writable, content_type) {
    let enc = req.headers['accept-encoding']
    if (!enc || !/(text\/|javascript|json|\+xml)/.test(content_type))
        return [writable] // don't compress binaries

    let r = accept_encoding_negotiate('deflate', accept_encoding_parse(enc))
    if (r === 'no deal') return []
    if (r === 'pass-through') return [writable]

    writable.setHeader('Content-Encoding', 'deflate')
    return [zlib.createDeflate(), writable]
}

// return [[a..b], [c..d], ...]
export function range_parse(s, content_length) {
    const MAX_RANGES = 10
    const MAX_OVERLAPS = 2
    // let err = new Error('Plage non satisfaisable')
    // err.code = 'ECHRNG'

    if (content_length <= 0) return null
    let pairs = (s ?? '').split(',')
    if (pairs.length > MAX_RANGES) return null

    let r = []
    for (let v of pairs) {
        let first, last, m
        if ((/^-?\d+-?$/).test(v)) {
            last = content_length-1
            first = parseInt(v, 10)
            if (first < 0) {    // -500
                first = content_length - first*-1
                if (first < 0) first = 0
            }
            if (first === 0) first = 0 // '-0' idiocy
        } else if ( (m = v.match(/^([0-9]+)-([0-9]+)$/))) {
            first = parseInt(m[1], 10)
            last = parseInt(m[2], 10)
            if (last >= content_length) last = content_length-1
        } else
            return null

        if (first >= content_length) return null
        if (first > last) return null
        r.push([first, last])
    }

    if (r.filter( pair => { // check for overlaps
        return r.filter( v => pair[0] >= v[0]
                         && pair[1] <= v[1]).length > MAX_OVERLAPS
    }).length) return null

    return r
}

function etag(writable, s) {
    let suffix = writable.getHeader('content-encoding') ? 'compressed' : ''
    return [s.dev, s.ino, s.mtime.getTime(), suffix].filter(Boolean).join`-`
}

function content_type(file, custom_types) {
    mime.define(custom_types, true)
    return mime.getType(file) || 'application/octet-stream'
}

function error(writable, err, verbose) {
    if (!writable.headersSent) {
        let codes = { 'ENOENT':404, 'EACCES':403,
                      'EINVAL':400, 'EBADE':406, 'ECHRNG': 416 }
        writable.statusCode = codes[err?.code] || 500
        if (verbose) writable.statusMessage = err
    }
    writable.end()
}
