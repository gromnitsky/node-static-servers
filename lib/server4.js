/*
  + range requests
    + single
    + multipart/byteranges
    + if-range
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

        let rr; try {
            rr = new RangeRequest(req, writable, opt, file, stats, headers)
        } catch (err) {
            return error(writable, err, opt.verbose)
        }
        let dest = rr.ranges ? [writable] : content_encoding(req, writable, headers, cnt_type)
        if (!dest.length) return error(writable, EBADE, opt.verbose)

        let ims = new Date(req.headers['if-modified-since'])
        if (!rr.ranges &&
            (ims >= new Date(stats.mtime.toUTCString())
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

        if (rr.ranges?.length > 1) {
            let promises = rr.ranges.map( (range, idx) => {
                // a function that returns a promise
                return () => rr.multipart_write(range, idx)
            })
            serial(promises).catch( err => {
                error(writable, err, opt.verbose)
            })
        } else {
            let ro = {}
            if (rr.ranges) ro = { start: rr.ranges[0][0], end: rr.ranges[0][1] }
            let readable = fs.createReadStream(file, ro)
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

class RangeRequest {
    constructor(readable, writable, opt, file, stats, headers) {
        this.readable = readable
        this.writable = writable
        this.opt = opt
        this.file = file
        this.stats = stats
        this.headers = headers

        this.cnt_type = content_type(file, opt.mime)
        this.raw = readable.headers.range?.match(/bytes=(\S+)/)?.[1]
        let if_range = readable.headers['if-range']
        // "if the representation is unchanged, send me the part(s)
        // that I am requesting in Range; otherwise, send me the
        // entire representation"
        if (if_range) {
            let date = new Date(if_range)
            if (date < new Date(stats.mtime.toUTCString())
                || (isNaN(date) && if_range !== etag(stats, headers))) {
                this.raw = null
            }
        }
        if (this.raw) this.mk_headers(this.raw)
    }

    mk_headers(raw) {
        if ( !(this.ranges = range_parse(raw, this.stats.size))) throw ECHRNG
        this.writable.statusCode = 206
        if (this.ranges.length === 1) {
            let range = this.ranges[0]
            this.headers['Content-Range'] = this.content_range(range)
            this.headers['Content-Length'] = range[1]-range[0]+1
        } else {
            this.headers['Content-Type'] = `multipart/byteranges; boundary=${this.boundary()}`
            this.headers['Content-Length'] = this.ranges.map(v => {
                return this.part_headers(v).length + (v[1]-v[0]+1)
            }).reduce( (acc, cur) => acc+cur, 0)
                + this.last_boundary().length
        }
    }

    multipart_write(range, idx) {
        return new Promise((resolve, reject) => {
            let ro = { start: range[0], end: range[1] }
            let readable = fs.createReadStream(this.file, ro)
            readable.on('error', reject)
            readable.once('data', () => {
                if (idx === 0) set_headers(this.writable,this.opt,this.headers)
                this.writable.write(this.part_headers(range))
            })
            readable.pipe(this.writable, {end: false})
            if (idx === this.ranges.length-1) {
                readable.on('end', () => {
                    this.writable.end(this.last_boundary())
                })
            }
            readable.on('end', () => resolve(ro))
        })
    }

    boundary() {
        return this._boundary
            || (this._boundary = process.env.DEBUG_BOUNDARY
                || crypto.randomBytes(10).toString('hex'))
    }

    last_boundary() { return `\r\n--${this.boundary()}--\r\n` }

    part_headers(range) {
        return [
            `\r\n--${this.boundary()}`,
            `Content-Type: ${this.cnt_type}`,
            `Content-Range: ${this.content_range(range)}`
        ].join("\r\n") + "\r\n\r\n"
    }

    content_range(range) {
        return `bytes ${range[0]}-${range[1]}/${this.stats.size}`
    }
}

const serial = funcs => // https://stackoverflow.com/a/41115086
    funcs.reduce((promise, func) =>
        promise.then(result => func().then(Array.prototype.concat.bind(result))), Promise.resolve([]))

function etag(s, headers) {
    let suffix = headers['Content-Encoding'] ? 'compressed' : ''
    return '"' + [s.dev, s.ino, s.mtime.getTime(), suffix]
        .filter(Boolean).join`-` + '"'
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
        if (verbose) try { writable.statusMessage = err } catch {/**/}
    }
    writable.end()
}

function mk_err(msg, code) {
    let err = new Error(msg); err.code = code
    return err
}

const EINVAL = mk_err("Argument invalide", 'EINVAL')
const ECHRNG = mk_err('Plage non satisfaisable', 'ECHRNG')
const EBADE = mk_err('Pas acceptable', 'EBADE')
