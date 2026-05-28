# `native/wia-scanner` — Windows WIA scanner Node-API addon

Phase 5.1 (Wave 5.1, David). A custom **Node-API (N-API) C++ addon** that wraps
the Windows **WIA 2.0 COM API** (`IWiaDevMgr2`) to enumerate scanners and
acquire pages. Built because the Q-E survey (`docs/architecture-phase-5.md §7`)
found **zero** MIT/Apache-2.0/BSD WIA Node bindings — so we own the code (MIT).

> **Build state on the dev host (2026-05-28): (a) built + loaded + tested
> against a REAL scanner.** The addon enumerated `Xerox WIA -
> Huntingburg_CIO_C415` (`type: scanner`) via `IWiaDevMgr2::EnumDeviceInfo`
> through the compiled `.node`, under both the Node and Electron ABIs.

---

## What it does

| Export | Maps to | Returns |
|---|---|---|
| `listDevices()` | `IWiaDevMgr2::EnumDeviceInfo(WIA_DEVINFO_ENUM_LOCAL)` | `Promise<{ devices: [{deviceId, name, type, description}] }>` |
| `acquire(options)` | `CreateDevice` + item enum + `IWiaTransfer::Download` | `Promise<{ pages: [{bytes, format, pageIndex}] }>` |
| `platform` | — | `'win32'` (Windows) / `'unsupported'` (non-Windows stub) |

`acquire` options: `{ deviceId?, resolution?, colorMode?: 'bw'|'grayscale'|'color', source?: 'auto'|'flatbed'|'feeder' }`.
ADF (`source: 'feeder'`) yields one page per fed sheet until the feeder empties;
flatbed yields a single page.

Both functions run **off the main thread** via `napi_create_async_work`, so a
multi-minute ADF scan never blocks the Electron event loop. COM is initialized
/ uninitialized **on the worker thread** (`CoInitializeEx` is per-thread).

### Typed failures, never exceptions

A native failure resolves (does NOT reject) the Promise with
`{ __wiaError: <code>, detail }`. The JS loader (`src/main/pdf-ops/wia-scanner.ts`)
maps `__wiaError` to the `ScanError` union the handlers surface as a
discriminated `Result`. Codes: `wia_service_unavailable`, `no_device`,
`device_open_failed`, `no_scan_item`, `transfer_unsupported`,
`acquisition_failed`, `enumeration_failed`.

---

## Files

```
native/wia-scanner/
  binding.gyp        node-gyp config; Windows links ole32/oleaut32/wiaguid;
                     non-Windows compiles src/stub-nonwin.cc instead
  build.mjs          build helper (Node ABI / Electron ABI / --verify)
  src/
    addon.cc         N-API entry: marshals results, async-work threading
    wia-com.h        COM logic declarations (N-API-free; the audit surface)
    wia-com.cc       the ONLY file touching WIA COM; RAII ComPtr refcounting
    stub-nonwin.cc   non-Windows stub (exports platform:'unsupported')
  build/Release/wia_scanner.node   compiled artifact (gitignored)
```

---

## Building

```bash
# Node ABI (for `npm test` / local dev under plain Node):
node native/wia-scanner/build.mjs

# Build + load + call listDevices() against a real scanner:
node native/wia-scanner/build.mjs --verify

# Electron ABI (for packaging — though N-API makes this a no-op, see below):
node native/wia-scanner/build.mjs --electron
```

### N-API ABI stability — ONE build, not the better-sqlite3 two-ABI dance

**Important and verified:** because this addon is **pure N-API**
(`NAPI_VERSION=8`, no `nan` / `node-addon-api` / direct V8), it is **ABI-stable
across Node and Electron**. The same `.node` loads + works under Node 24 AND
Electron 30 with no rebuild. This is fundamentally different from
`better-sqlite3` (L-003), which is NOT N-API and requires the Electron-vs-Node
ABI swap. **There is no two-ABI problem for this addon.** A single
`node native/wia-scanner/build.mjs` produces a binary usable everywhere.

---

## Toolchain prerequisites (VERIFIED present on the dev host)

| Requirement | Status on dev host | How to install if missing |
|---|---|---|
| MSVC C++ compiler | VS 2017/2019/2022 Enterprise w/ VC tools | VS Build Tools workload **"Desktop development with C++"** |
| Windows SDK w/ WIA headers (`wia.h`, `wia_lh.h`, `sti.h`) + `wiaguid.lib` | present in every SDK 10.0.10240+ | VS installer component **"Windows 10/11 SDK"** |
| Python for node-gyp | 3.11 / 3.12 / 3.13 / 3.14 via `py` launcher | python.org; pick 3.12 (`py -3.12`) |
| node-gyp | use **node-gyp >= 10** (project-local 9.4.1 is too old) | `build.mjs` invokes `npx node-gyp@latest` |

### node-gyp / Python gotcha (DISTINCT from the L-003 lore)

The project-local `node-gyp@9.4.1` bundles an OLD gyp that does
`from distutils.version import StrictVersion`. **`distutils` was removed in
Python 3.12** (not just 3.14 as the better-sqlite3 lore implied), so node-gyp
9.4.1 fails to **configure** on this host regardless of which Python you point
it at. The fix baked into `build.mjs`: invoke **`node-gyp@latest`** (>= 10,
which dropped the distutils import) via `npx`. With that, `configure` + `build`
both succeed against Python 3.12. (Manually: `npx -y node-gyp@latest rebuild
--python "C:\Program Files\Python312\python.exe"` from this directory.)

---

## DIEGO HANDOFFS (packaging — `electron-builder.yml` / `package.json` are Diego's)

1. **No `node-addon-api` dependency needed.** The addon uses raw N-API from the
   Node headers — **nothing to add to `package.json`.** (If a future rewrite
   wants `node-addon-api` for ergonomics, it's a devDependency + a `<!(node -p
   "require('node-addon-api').include")>` include dir in `binding.gyp`. Not
   required now.)

2. **`electron-builder.yml` → `asarUnpack`.** The compiled `.node` must live
   OUTSIDE the asar so Electron can `dlopen` it. Add:

   ```yaml
   asarUnpack:
     - native/wia-scanner/build/Release/*.node
   ```

   The JS loader (`wia-scanner.ts`) already probes
   `resources/app.asar.unpacked/native/wia-scanner/build/Release/wia_scanner.node`
   first, then `resources/native/...`. Also add the addon to `files` /
   `extraResources` so the `native/` tree is included in the package.

3. **Build the addon in the packaging pipeline.** Add a script + a `prepackage`
   hook, e.g.:

   ```json
   "scripts": {
     "build:wia": "node native/wia-scanner/build.mjs",
     "prepackage:win": "npm run build:wia"
   }
   ```

   Because N-API is ABI-stable, `node native/wia-scanner/build.mjs` (Node ABI)
   is sufficient for the packaged Electron app — **no `--electron` needed.**
   (If you prefer belt-and-braces, `--electron` works too and produces an
   equivalent binary.)

4. **CI matrix.** The Windows runner can build the addon (VS Build Tools +
   Windows SDK + node-gyp@latest). **macOS/Linux runners compile the
   `stub-nonwin.cc` stub** (binding.gyp `conditions` guard) — so the addon never
   breaks a cross-platform `npm ci` / install-app-deps. The runtime degrades to
   `scanner_unavailable` on those platforms.

5. **`.gitignore`.** `native/wia-scanner/build/` is a build artifact — add it to
   `.gitignore` (it is not committed).

---

## RILEY HANDOFF (renderer — scan modal is hers)

The scan channels are now **LIVE** (contract updated in
`src/ipc/contracts.ts` §scan). Her Phase-5.1 placeholder ("coming in Phase 5.1")
can become a real **device-picker + scan UI**:

- `window.pdfApi.scan.listDevices()` → `{ devices: ScanDevice[] }` to populate a
  device dropdown. Empty `devices` = no scanner connected. Error
  `scanner_unavailable` = non-Windows / addon not built → show a disabled state
  with a tooltip (same affordance as before, but now data-driven).
- `window.pdfApi.scan.acquire({ deviceId, resolution, colorMode, source })` →
  `{ handle, displayName, pageCount, warnings }`. The composed PDF is already
  registered in the document store, so open it exactly like a `dialog:openPdf`
  result (route the returned `handle` into the existing open-document flow).
- A "scan → searchable PDF" option can chain into the existing OCR pipeline:
  after `scan.acquire`, call `ocr.runOnDocument({ handle, ... })` on the returned
  handle.

---

## COM-refcount discipline (Julian audit target)

All WIA COM lives in `wia-com.cc`, isolated behind the N-API-free `wia-com.h`.
Refcount safety is **structural**, not by-convention:

- A RAII `ComPtr<T>` `Release()`s on every scope exit (success, early-return,
  error). There is no manual `Release()` to forget.
- Every `PROPVARIANT` is `PropVariantClear()`d; every `BSTR` is
  `SysFreeString()`d; the in-memory `IStream`s are `Release()`d after draining.
- `CoInitializeEx` is matched 1:1 with `CoUninitialize` on the same (worker)
  thread, and only when WE performed the init (`RPC_E_CHANGED_MODE` tolerated).

**Manual verification (cannot be unit-tested):** run N acquisitions against a
real scanner and watch the process **handle count** in Task Manager / Process
Explorer — it must NOT grow across acquisitions. A growing handle count means a
leaked COM interface or unfreed `STGMEDIUM`.
