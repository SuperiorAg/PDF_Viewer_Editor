// WIA 2.0 COM logic — declarations.
//
// This header is intentionally N-API-free. The COM lifecycle discipline
// (CoInitializeEx per-thread / Release() on every interface / CoUninitialize)
// lives entirely here and in wia-com.cc so it can be audited in isolation
// (Julian's COM-refcount audit target). addon.cc only marshals these results
// across the N-API boundary.
//
// REFCOUNT DISCIPLINE (the COM equivalent of the OCR pool's worker lifecycle):
//   - Every interface pointer acquired (CoCreateInstance, EnumDeviceInfo->Next,
//     CreateDevice, EnumItems->Next, IWiaItem2::QueryInterface) is Release()d
//     on EVERY path including errors. We use a tiny RAII ComPtr<T> (wia-com.cc)
//     so there is no manual Release() to forget.
//   - Every PROPVARIANT is PropVariantClear()d; every BSTR is SysFreeString()d;
//     every STGMEDIUM is ReleaseStgMedium()d.
//   - CoInitializeEx is matched 1:1 with CoUninitialize on the SAME thread
//     (the async worker thread — see addon.cc). The main thread never touches
//     COM, so a scan never blocks the Electron event loop.

#pragma once

#ifdef _WIN32

#include <string>
#include <vector>
#include <cstdint>

namespace wia {

// ---- Result types (mirrored 1:1 into the JS contract in addon.cc) ----------

struct DeviceInfo {
  std::string deviceId;     // WIA_DIP_DEV_ID (stable handle)
  std::string name;         // WIA_DIP_DEV_NAME
  std::string description;  // WIA_DIP_DEV_DESC (may be empty)
  std::string type;         // "flatbed" | "feeder" | "scanner" | "unknown"
};

struct ScannedImage {
  std::vector<uint8_t> bytes;  // image bytes (format below)
  std::string format;          // "bmp" | "png" | "jpeg" | "tiff"
  uint32_t pageIndex;          // 0-based page within this acquisition
};

// colorMode -> WIA intent. bw=1bpp, grayscale, color.
enum class ColorMode { Bw, Grayscale, Color };

// source: flatbed = single page; feeder = ADF multi-page until empty.
enum class Source { Auto, Flatbed, Feeder };

struct AcquireOptions {
  std::string deviceId;   // empty => first device
  uint32_t resolutionDpi; // e.g. 300
  ColorMode colorMode;
  Source source;
};

// Outcome carries either a typed error code OR a payload. The error codes
// are the SAME strings the JS handler maps to its discriminated union, so the
// failure taxonomy is defined once (C++) and never re-derived in JS.
struct ListResult {
  bool ok;
  std::string errorCode;  // "" when ok
  std::string errorDetail;
  std::vector<DeviceInfo> devices;
};

struct AcquireResult {
  bool ok;
  std::string errorCode;  // "" when ok
  std::string errorDetail;
  std::vector<ScannedImage> images;
};

// ---- Entry points (called from the N-API async worker thread) --------------
//
// Each call owns its full COM lifecycle: CoInitializeEx at entry,
// CoUninitialize at exit, on the calling (worker) thread. NEVER call these on
// the main thread.

ListResult ListDevices();
AcquireResult Acquire(const AcquireOptions& opts);

}  // namespace wia

#endif  // _WIN32
