/*
  - range requests
    - single
    - multipart/byteranges
*/

import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import {pipeline} from 'stream'
import crypto from 'crypto'
import mime from 'mime'

export default function(req, writable, name, opt = {}) {
    if (/^\/+$/.test(name)) name = "index.html"
    let file = path.join(opt.public_root || process.cwd(), path.normalize(name))

    file = decodeURI(file)
    fs.stat(file, (err, stats) => {
        if (!err && !stats.isFile()) return error(writable, EINVAL, opt.verbose)
        if (err) return error(writable, err, opt.verbose)

        let headers = {}
        let cnt_type = content_type(file, opt.mime)

        let rangeopt = { stream: {}, boundary: part_boundary() }
        let ranges = req.headers.range?.match(/bytes=(\S+)/)?.[1]
        if (req.headers['if-range']) {
            ims = new Date(req.headers['if-range']).getTime()
            if (ims >= stats.mtime.toUTCString()
                || req.headers['if-range'] !== etag(stats, headers)) {
                ranges = null
            }
        }
        if (ranges) {
            if ( !(ranges = range_parse(ranges, stats.size)))
                 return error(writable, ECHRNG, opt.verbose)
            writable.statusCode = 206
            if (ranges.length === 1) {
                let range = ranges[0]
                headers['Content-Range'] = content_range(range, stats)
                headers['Content-Length'] = range[1]-range[0]+1
                rangeopt.stream.start = range[0]
                rangeopt.stream.end = range[1]
            } else {
                headers['Content-Type'] = `multipart/byteranges; boundary=${rangeopt.boundary}`
                headers['Content-Length'] = ranges.map(v => {
                    return part_headers(v, stats, cnt_type, rangeopt.boundary)
                        .length + (v[1]-v[0]+1)
                }).reduce( (acc, cur) => acc+cur, 0)
                    + part_last_boundary(rangeopt.boundary).length
            }
        }

        let dest = ranges ? [writable] : content_encoding(req, writable, headers, cnt_type)
        if (!dest.length) return error(writable, EBADE, opt.verbose)

        let ims = new Date(req.headers['if-modified-since']).getTime()
        if (!ranges &&
            (ims >= stats.mtime.toUTCString() // last-modified value
             || req.headers['if-none-match'] === etag(stats, headers))) {
            writable.statusCode = 304
            return writable.end()
        }

        if (!('Content-Length' in headers) && !headers['Content-Encoding'])
            headers['Content-Length'] = stats.size
        if (!headers['Content-Type']) headers['Content-Type'] = cnt_type
        headers.ETag = etag(stats, headers)
        headers['Last-Modified'] = stats.mtime.toUTCString()
        headers['Accept-Ranges'] = 'bytes'

        if (req.method === 'HEAD') {
            set_headers(writable, opt, headers)
            return writable.end()
        }

        if (ranges?.length > 1) { // multipart/byteranges
            ranges.forEach( (range, idx) => {
                let readable = fs.createReadStream(file, {
                    start: range[0],
                    end: range[1]
                })
                readable.on('error', err => error(writable, err, opt.verbose))
                readable.once('data', () => {
                    if (idx === 0) set_headers(writable, opt, headers)
                    writable.write(part_headers(range, stats, cnt_type,
                                                rangeopt.boundary))
                })
                readable.pipe(writable, {end: false})
                if (idx === ranges.length-1) {
                    readable.on('end', () => {
                        writable.end(part_last_boundary(rangeopt.boundary))
                    })
                }
            })
        } else { // life is easy
            let readable = fs.createReadStream(file, rangeopt.stream)
            readable.once('data', () => set_headers(writable, opt, headers))
            readable.on('error', err => error(writable, err, opt.verbose))
            pipeline(readable, ...dest, () => {/* all streams are closed */})
        }
    })
}

function set_headers(writable, opt, headers) {
    Object.entries(headers).map( v => writable.setHeader(...v))
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

function content_encoding(req, writable, headers, content_type) {
    let enc = req.headers['accept-encoding']
    if (!enc || !/(text\/|javascript|json|\+xml)/.test(content_type))
        return [writable] // don't compress binaries

    let r = accept_encoding_negotiate('deflate', accept_encoding_parse(enc))
    if (r === 'no deal') return []
    if (r === 'pass-through') return [writable]

    headers['Content-Encoding'] = 'deflate'
    return [zlib.createDeflate(), writable]
}

// return [[a..b], [c..d], ...]
export function range_parse(s, content_length) {
    const MAX_RANGES = 10
    const MAX_OVERLAPS = 2

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

function content_range(range, stats) {
    return `${range[0]}-${range[1]}/${stats.size}`
}

function part_headers(range, stats, content_type, boundary) {
    return [
        `\r\n--${boundary}`,
        `Content-Type: ${content_type}`,
        `Content-Range: ${content_range(range, stats)}`
    ].join("\r\n") + "\r\n\r\n"
}

function part_boundary() { return crypto.randomBytes(10).toString('hex') }

function part_last_boundary(boundary) { return `\r\n--${boundary}--\r\n`  }

function etag(s, headers) {
    let suffix = headers['Content-Encoding'] ? 'compressed' : ''
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

function mk_err(msg, code) {
    let err = new Error(msg); err.code = code
    return err
}

const EINVAL = mk_err("Invalid argument", 'EINVAL')
const ECHRNG = mk_err('Plage non satisfaisable', 'ECHRNG')
const EBADE = mk_err('Pas acceptable', 'EBADE')
