// Standalone reproducer for the v0.7.12 OCR rasterize failure.
// Loads @napi-rs/canvas + pdfjs-dist legacy + a sample PDF, installs the
// same globalThis polyfills the production tryLoadCanvas() does, then runs
// page.render() at 300 DPI exactly like rasterizePageProd. Captures the
// FULL Error.stack so we can see which native method actually throws.
//
// Usage:
//   node scripts/diagnose-ocr-render.mjs [pdf-path]
//
// Default PDF: ./release/wave21-sample.pdf

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { argv } from 'node:process'

const pdfPath = argv[2] ?? './release/wave21-sample.pdf'
const absPath = resolve(pdfPath)

console.log(`[diagnose] reading ${absPath}`)
const bufBytes = readFileSync(absPath)
// pdf.js requires Uint8Array, not Buffer (Node 22+ — pdf.js getDocument throws on Buffer)
const bytes = new Uint8Array(bufBytes.buffer, bufBytes.byteOffset, bufBytes.byteLength)
console.log(`[diagnose] PDF bytes: ${bytes.length}`)

// Step 1 — load @napi-rs/canvas and install globals (same as tryLoadCanvas)
const napi = await import('@napi-rs/canvas')
console.log(`[diagnose] @napi-rs/canvas keys: ${Object.keys(napi).slice(0, 20).join(', ')}`)

const g = globalThis
if (g.Image === undefined && napi.Image !== undefined) g.Image = napi.Image
if (g.Path2D === undefined && napi.Path2D !== undefined) g.Path2D = napi.Path2D
if (g.ImageData === undefined && napi.ImageData !== undefined) g.ImageData = napi.ImageData
if (g.DOMMatrix === undefined && napi.DOMMatrix !== undefined) g.DOMMatrix = napi.DOMMatrix
console.log(`[diagnose] globalThis.Image ? ${typeof g.Image} — Path2D ? ${typeof g.Path2D} — ImageData ? ${typeof g.ImageData} — DOMMatrix ? ${typeof g.DOMMatrix}`)

// Step 2 — load pdfjs-dist legacy (same module path as ocr-bootstrap)
const pdfjsModuleName = 'pdfjs-dist' + '/legacy/build/pdf.mjs'
const pdfjs = await import(pdfjsModuleName)
console.log(`[diagnose] pdfjs version: ${pdfjs.version ?? '(no version export)'}`)

// Step 3 — getDocument + getPage(1)
const doc = await pdfjs.getDocument({ data: bytes }).promise
console.log(`[diagnose] doc.numPages: ${doc.numPages}`)
const page = await doc.getPage(1)
console.log(`[diagnose] page acquired`)

const scale = 300 / 72
const viewport = page.getViewport({ scale })
console.log(`[diagnose] viewport: ${Math.ceil(viewport.width)}x${Math.ceil(viewport.height)}`)

// Step 4 — create canvas + context, render, capture full error
const canvas = napi.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
const ctx = canvas.getContext('2d')
console.log(`[diagnose] context type: ${ctx?.constructor?.name}`)

// Wrap every ctx method to log its first call with non-trivial args, so
// if the error comes from a specific ctx method we'll see which one.
const wrapMethods = ['drawImage', 'putImageData', 'createImageData', 'getImageData', 'createPattern', 'fillText', 'strokeText', 'fill', 'stroke']
for (const m of wrapMethods) {
  const original = ctx[m]
  if (typeof original !== 'function') continue
  ctx[m] = function (...args) {
    try {
      return original.apply(this, args)
    } catch (err) {
      const argShapes = args.map(a => {
        if (a === null) return 'null'
        if (a === undefined) return 'undefined'
        if (typeof a === 'string') return `string(${JSON.stringify(a.slice(0, 40))})`
        if (typeof a === 'number') return `number(${a})`
        if (typeof a === 'boolean') return `boolean(${a})`
        if (a instanceof Uint8Array) return `Uint8Array(len=${a.length})`
        if (a instanceof ArrayBuffer) return `ArrayBuffer(byteLength=${a.byteLength})`
        if (Buffer.isBuffer?.(a)) return `Buffer(len=${a.length})`
        const ctor = a?.constructor?.name ?? typeof a
        const keys = Object.keys(a ?? {}).slice(0, 8).join(',')
        return `${ctor}{${keys}}`
      })
      err.__capturedMethod = m
      err.__capturedArgs = argShapes
      throw err
    }
  }
}

console.log(`[diagnose] starting page.render at scale ${scale}`)
try {
  await page.render({ canvasContext: ctx, viewport }).promise
  console.log(`[diagnose] render SUCCEEDED — no bug to reproduce`)
} catch (err) {
  console.log(`\n========== ERROR REPRODUCED ==========`)
  console.log(`name: ${err.name}`)
  console.log(`message: ${err.message}`)
  console.log(`captured method (if from wrapped ctx call): ${err.__capturedMethod ?? '(not from ctx method — possibly internal pdf.js)'}`)
  console.log(`captured args: ${err.__capturedArgs ? JSON.stringify(err.__capturedArgs) : '(none)'}`)
  console.log(`\n========== FULL STACK ==========`)
  console.log(err.stack)
  console.log(`\n========== ERROR OBJECT KEYS ==========`)
  console.log(Object.keys(err))
  writeFileSync('release/diagnose-ocr-render-stack.txt', `${err.message}\n\n${err.stack ?? '(no stack)'}\n\nmethod: ${err.__capturedMethod}\nargs: ${JSON.stringify(err.__capturedArgs)}\n`)
  console.log(`\n[diagnose] stack written to release/diagnose-ocr-render-stack.txt`)
}
