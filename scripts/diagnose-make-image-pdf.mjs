// Build a tiny PDF with an embedded JPEG image XObject — the kind of content
// that triggers pdf.js's image-decoding render path. Output: ./release/diagnose-image-pdf.pdf
import { writeFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { createCanvas } from '@napi-rs/canvas'

// Render a small image to JPEG bytes via @napi-rs/canvas (the same binding the
// OCR rasterizer uses), then embed it in a fresh PDF.
const c = createCanvas(200, 100)
const ctx = c.getContext('2d')
ctx.fillStyle = '#fbb'
ctx.fillRect(0, 0, 200, 100)
ctx.fillStyle = '#000'
ctx.font = '20px sans-serif'
ctx.fillText('HELLO OCR', 30, 55)
const jpegBuf = c.toBuffer('image/jpeg', 90)
console.log(`[make-pdf] generated JPEG bytes: ${jpegBuf.length}`)

const pdf = await PDFDocument.create()
const page = pdf.addPage([612, 792])
const jpeg = await pdf.embedJpg(new Uint8Array(jpegBuf.buffer, jpegBuf.byteOffset, jpegBuf.byteLength))
page.drawImage(jpeg, { x: 100, y: 600, width: 200, height: 100 })
page.drawText('Text content to OCR.', { x: 100, y: 500, size: 18 })

const out = await pdf.save()
writeFileSync('release/diagnose-image-pdf.pdf', out)
console.log(`[make-pdf] wrote release/diagnose-image-pdf.pdf (${out.length} bytes)`)
