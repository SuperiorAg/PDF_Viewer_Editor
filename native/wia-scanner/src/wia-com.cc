// WIA 2.0 COM logic — implementation.
//
// See wia-com.h for the refcount discipline contract. This file is the ONLY
// place that touches the WIA COM API. It is deliberately N-API-free.

#ifdef _WIN32

#include "wia-com.h"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <objbase.h>
#include <sti.h>   // StiDeviceType* enum (device-type taxonomy)
#include <wia.h>
#include <propvarutil.h>
#include <comdef.h>

#include <string>
#include <vector>

namespace wia {

namespace {

// ----------------------------------------------------------------------------
// RAII COM smart pointer — Release()s on scope exit on EVERY path (success,
// early-return, exception). This is what makes "no leaked COM refs" structural
// rather than a discipline you can forget. Equivalent to the OCR pool's
// finally-release rigor.
// ----------------------------------------------------------------------------
template <typename T>
class ComPtr {
 public:
  ComPtr() = default;
  ~ComPtr() { reset(); }
  ComPtr(const ComPtr&) = delete;
  ComPtr& operator=(const ComPtr&) = delete;

  T** put() {
    reset();
    return &p_;
  }
  T* get() const { return p_; }
  T* operator->() const { return p_; }
  explicit operator bool() const { return p_ != nullptr; }
  void reset() {
    if (p_) {
      p_->Release();
      p_ = nullptr;
    }
  }

 private:
  T* p_ = nullptr;
};

// Convert a wide BSTR/string to UTF-8.
std::string ToUtf8(const wchar_t* w) {
  if (!w) return std::string();
  int len = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
  if (len <= 0) return std::string();
  std::string out(static_cast<size_t>(len - 1), '\0');
  WideCharToMultiByte(CP_UTF8, 0, w, -1, &out[0], len, nullptr, nullptr);
  return out;
}

// Read one BSTR property from an IWiaPropertyStorage. Returns "" if absent.
std::string ReadStringProp(IWiaPropertyStorage* storage, PROPID propid) {
  if (!storage) return std::string();
  PROPSPEC spec;
  spec.ulKind = PRSPEC_PROPID;
  spec.propid = propid;
  PROPVARIANT pv;
  PropVariantInit(&pv);
  std::string result;
  if (SUCCEEDED(storage->ReadMultiple(1, &spec, &pv)) && pv.vt == VT_BSTR) {
    result = ToUtf8(pv.bstrVal);
  }
  PropVariantClear(&pv);  // frees the BSTR
  return result;
}

// Read one LONG property; returns fallback if absent.
LONG ReadLongProp(IWiaPropertyStorage* storage, PROPID propid, LONG fallback) {
  if (!storage) return fallback;
  PROPSPEC spec;
  spec.ulKind = PRSPEC_PROPID;
  spec.propid = propid;
  PROPVARIANT pv;
  PropVariantInit(&pv);
  LONG result = fallback;
  if (SUCCEEDED(storage->ReadMultiple(1, &spec, &pv))) {
    if (pv.vt == VT_I4) result = pv.lVal;
  }
  PropVariantClear(&pv);
  return result;
}

bool WriteLongProp(IWiaPropertyStorage* storage, PROPID propid, LONG value) {
  if (!storage) return false;
  PROPSPEC spec;
  spec.ulKind = PRSPEC_PROPID;
  spec.propid = propid;
  PROPVARIANT pv;
  PropVariantInit(&pv);
  pv.vt = VT_I4;
  pv.lVal = value;
  HRESULT hr = storage->WriteMultiple(1, &spec, &pv, WIA_DIP_FIRST);
  PropVariantClear(&pv);
  return SUCCEEDED(hr);
}

std::string DeviceTypeString(LONG devType) {
  // WIA_DEVICE_TYPE: StiDeviceTypeScanner == 1.
  switch (devType) {
    case StiDeviceTypeScanner:
      return "scanner";
    case StiDeviceTypeDigitalCamera:
      return "camera";
    case StiDeviceTypeStreamingVideo:
      return "video";
    default:
      return "unknown";
  }
}

}  // namespace

// ============================================================================
// ListDevices — IWiaDevMgr2::EnumDeviceInfo
// ============================================================================
ListResult ListDevices() {
  ListResult out;
  out.ok = false;

  HRESULT hrInit = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  bool didInit = SUCCEEDED(hrInit);
  // RPC_E_CHANGED_MODE means COM is already inited on this thread with a
  // different model — tolerate it (don't CoUninitialize what we didn't init).
  bool ownInit = (hrInit == S_OK);

  {
    ComPtr<IWiaDevMgr2> mgr;
    HRESULT hr = CoCreateInstance(CLSID_WiaDevMgr2, nullptr, CLSCTX_LOCAL_SERVER,
                                  IID_IWiaDevMgr2, reinterpret_cast<void**>(mgr.put()));
    if (FAILED(hr) || !mgr) {
      out.errorCode = "wia_service_unavailable";
      out.errorDetail = "CoCreateInstance(WiaDevMgr2) failed hr=" + std::to_string(hr);
      if (ownInit) CoUninitialize();
      return out;
    }

    ComPtr<IEnumWIA_DEV_INFO> pEnum;
    hr = mgr->EnumDeviceInfo(WIA_DEVINFO_ENUM_LOCAL, pEnum.put());
    if (FAILED(hr) || !pEnum) {
      out.errorCode = "enumeration_failed";
      out.errorDetail = "EnumDeviceInfo failed hr=" + std::to_string(hr);
      if (ownInit) CoUninitialize();
      return out;
    }

    for (;;) {
      IWiaPropertyStorage* rawStorage = nullptr;
      ULONG fetched = 0;
      HRESULT nextHr = pEnum->Next(1, &rawStorage, &fetched);
      if (nextHr != S_OK || fetched == 0 || !rawStorage) {
        if (rawStorage) rawStorage->Release();
        break;
      }
      // Wrap immediately so it Release()s on every path below.
      ComPtr<IWiaPropertyStorage> storage;
      *storage.put() = rawStorage;  // takes ownership of the +1 ref from Next()

      DeviceInfo info;
      info.deviceId = ReadStringProp(storage.get(), WIA_DIP_DEV_ID);
      info.name = ReadStringProp(storage.get(), WIA_DIP_DEV_NAME);
      info.description = ReadStringProp(storage.get(), WIA_DIP_DEV_DESC);
      LONG devType = ReadLongProp(storage.get(), WIA_DIP_DEV_TYPE, 0);
      // The low word of WIA_DIP_DEV_TYPE holds the STI device type; the high
      // word holds the sub-type. There is no GET_STIDEVICE_TYPE macro in all
      // SDK versions, so mask the low word ourselves.
      info.type = DeviceTypeString(static_cast<LONG>(devType & 0xFFFF));
      out.devices.push_back(std::move(info));
    }
    out.ok = true;
  }  // ComPtrs Release() here, before CoUninitialize.

  if (ownInit) CoUninitialize();
  return out;
}

// ============================================================================
// Acquire — IWiaDevMgr2::CreateDevice + item enumeration + IWiaTransfer
// ============================================================================
//
// IWiaTransfer streams to an IStream we provide. We register an
// IWiaTransferCallback to receive band/page data. For ADF (feeder), the
// transfer fires the callback once per fed page until the feeder empties.
//
// To keep this addon dependency-free we transfer to an in-memory IStream
// (CreateStreamOnHGlobal) and read the bytes back out. The WIA default
// transfer format for IWiaItem2 is typically BMP; we report the actual format
// from the item's WIA_IPA_FORMAT GUID so JS knows how to embed it.

namespace {

std::string FormatFromGuid(const GUID& g) {
  if (IsEqualGUID(g, WiaImgFmt_BMP)) return "bmp";
  if (IsEqualGUID(g, WiaImgFmt_PNG)) return "png";
  if (IsEqualGUID(g, WiaImgFmt_JPEG)) return "jpeg";
  if (IsEqualGUID(g, WiaImgFmt_TIFF)) return "tiff";
  return "bmp";  // WIA default download format for IWiaItem2
}

// IWiaTransferCallback that collects each transferred page into the result.
class TransferSink : public IWiaTransferCallback {
 public:
  explicit TransferSink(AcquireResult* out, const std::string& fmt)
      : out_(out), format_(fmt) {}

  // IUnknown
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (IsEqualIID(riid, IID_IUnknown) || IsEqualIID(riid, IID_IWiaTransferCallback)) {
      *ppv = static_cast<IWiaTransferCallback*>(this);
      AddRef();
      return S_OK;
    }
    *ppv = nullptr;
    return E_NOINTERFACE;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return ++ref_; }
  ULONG STDMETHODCALLTYPE Release() override {
    ULONG r = --ref_;
    if (r == 0) delete this;
    return r;
  }

  // IWiaTransferCallback
  HRESULT STDMETHODCALLTYPE TransferCallback(LONG lFlags,
                                             WiaTransferParams* pParams) override {
    (void)lFlags;
    (void)pParams;
    return S_OK;
  }

  HRESULT STDMETHODCALLTYPE GetNextStream(LONG /*lFlags*/, BSTR /*bstrItemName*/,
                                          BSTR /*bstrFullItemName*/,
                                          IStream** ppDestination) override {
    if (!ppDestination) return E_POINTER;
    // New page => new in-memory stream. We keep a pointer so we can drain it
    // when the next GetNextStream (or transfer completion) arrives.
    flushPending();
    IStream* s = nullptr;
    HRESULT hr = CreateStreamOnHGlobal(nullptr, TRUE, &s);
    if (FAILED(hr)) return hr;
    current_ = s;        // borrowed; we Release in flushPending()
    s->AddRef();         // one for *ppDestination, one for current_
    *ppDestination = s;
    return S_OK;
  }

  // Drain whatever is left at the very end of the transfer.
  void finish() { flushPending(); }

 private:
  void flushPending() {
    if (!current_) return;
    // Rewind + read all bytes into the result.
    LARGE_INTEGER zero;
    zero.QuadPart = 0;
    current_->Seek(zero, STREAM_SEEK_SET, nullptr);
    STATSTG stat;
    ZeroMemory(&stat, sizeof(stat));
    std::vector<uint8_t> buf;
    if (SUCCEEDED(current_->Stat(&stat, STATFLAG_NONAME))) {
      buf.resize(static_cast<size_t>(stat.cbSize.QuadPart));
    }
    if (!buf.empty()) {
      ULONG read = 0;
      current_->Read(buf.data(), static_cast<ULONG>(buf.size()), &read);
      buf.resize(read);
    }
    if (!buf.empty()) {
      ScannedImage img;
      img.bytes = std::move(buf);
      img.format = format_;
      img.pageIndex = pageCount_++;
      out_->images.push_back(std::move(img));
    }
    current_->Release();
    current_ = nullptr;
  }

  AcquireResult* out_;
  std::string format_;
  IStream* current_ = nullptr;
  uint32_t pageCount_ = 0;
  LONG ref_ = 1;
};

// Find the first scan item under the device root (the flatbed/feeder source).
HRESULT FindScanItem(IWiaItem2* root, ComPtr<IWiaItem2>& outItem) {
  ComPtr<IEnumWiaItem2> pEnum;
  HRESULT hr = root->EnumChildItems(nullptr, pEnum.put());
  if (FAILED(hr) || !pEnum) return FAILED(hr) ? hr : E_FAIL;
  for (;;) {
    IWiaItem2* rawChild = nullptr;
    ULONG fetched = 0;
    if (pEnum->Next(1, &rawChild, &fetched) != S_OK || fetched == 0 || !rawChild) {
      if (rawChild) rawChild->Release();
      break;
    }
    ComPtr<IWiaItem2> child;
    *child.put() = rawChild;
    LONG itemType = 0;
    if (SUCCEEDED(child->GetItemType(&itemType)) &&
        (itemType & WiaItemTypeTransfer) && (itemType & WiaItemTypeImage)) {
      *outItem.put() = child.get();
      outItem.get()->AddRef();
      return S_OK;
    }
  }
  // Fall back: the root itself may be transferable on simple devices.
  LONG rootType = 0;
  if (SUCCEEDED(root->GetItemType(&rootType)) && (rootType & WiaItemTypeTransfer)) {
    *outItem.put() = root;
    root->AddRef();
    return S_OK;
  }
  return E_FAIL;
}

}  // namespace

AcquireResult Acquire(const AcquireOptions& opts) {
  AcquireResult out;
  out.ok = false;

  HRESULT hrInit = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  bool ownInit = (hrInit == S_OK);

  {
    ComPtr<IWiaDevMgr2> mgr;
    HRESULT hr = CoCreateInstance(CLSID_WiaDevMgr2, nullptr, CLSCTX_LOCAL_SERVER,
                                  IID_IWiaDevMgr2, reinterpret_cast<void**>(mgr.put()));
    if (FAILED(hr) || !mgr) {
      out.errorCode = "wia_service_unavailable";
      out.errorDetail = "CoCreateInstance(WiaDevMgr2) failed hr=" + std::to_string(hr);
      if (ownInit) CoUninitialize();
      return out;
    }

    // Resolve deviceId. Empty => first enumerated device.
    std::string deviceId = opts.deviceId;
    if (deviceId.empty()) {
      ListResult list = ListDevices();  // its own COM init/uninit is fine
      if (!list.ok || list.devices.empty()) {
        out.errorCode = "no_device";
        out.errorDetail = "no WIA device available";
        if (ownInit) CoUninitialize();
        return out;
      }
      deviceId = list.devices.front().deviceId;
    }

    // CreateDevice needs a wide BSTR device id.
    int wlen = MultiByteToWideChar(CP_UTF8, 0, deviceId.c_str(), -1, nullptr, 0);
    std::wstring wid(wlen > 0 ? wlen - 1 : 0, L'\0');
    if (wlen > 0) MultiByteToWideChar(CP_UTF8, 0, deviceId.c_str(), -1, &wid[0], wlen);
    BSTR bstrId = SysAllocString(wid.c_str());

    ComPtr<IWiaItem2> device;
    hr = mgr->CreateDevice(0, bstrId, device.put());
    SysFreeString(bstrId);
    if (FAILED(hr) || !device) {
      out.errorCode = "device_open_failed";
      out.errorDetail = "CreateDevice failed hr=" + std::to_string(hr);
      if (ownInit) CoUninitialize();
      return out;
    }

    ComPtr<IWiaItem2> item;
    hr = FindScanItem(device.get(), item);
    if (FAILED(hr) || !item) {
      out.errorCode = "no_scan_item";
      out.errorDetail = "device has no transferable image item";
      if (ownInit) CoUninitialize();
      return out;
    }

    // Set acquisition properties on the item's property storage.
    ComPtr<IWiaPropertyStorage> props;
    if (SUCCEEDED(item.get()->QueryInterface(IID_IWiaPropertyStorage,
                                             reinterpret_cast<void**>(props.put())))) {
      if (opts.resolutionDpi > 0) {
        WriteLongProp(props.get(), WIA_IPS_XRES, static_cast<LONG>(opts.resolutionDpi));
        WriteLongProp(props.get(), WIA_IPS_YRES, static_cast<LONG>(opts.resolutionDpi));
      }
      // Feeder vs flatbed document handling.
      if (opts.source == Source::Feeder) {
        WriteLongProp(props.get(), WIA_IPS_DOCUMENT_HANDLING_SELECT, FEEDER);
      } else if (opts.source == Source::Flatbed) {
        WriteLongProp(props.get(), WIA_IPS_DOCUMENT_HANDLING_SELECT, FLATBED);
      }
      WriteLongProp(props.get(), WIA_IPA_DATATYPE,
                    opts.colorMode == ColorMode::Bw
                        ? WIA_DATA_THRESHOLD
                        : opts.colorMode == ColorMode::Grayscale ? WIA_DATA_GRAYSCALE
                                                                 : WIA_DATA_COLOR);
    }

    // Determine transfer format (default BMP for IWiaItem2).
    std::string fmt = "bmp";
    if (props) {
      // WIA_IPA_FORMAT is a GUID property; ReadMultiple into VT_CLSID.
      PROPSPEC spec;
      spec.ulKind = PRSPEC_PROPID;
      spec.propid = WIA_IPA_FORMAT;
      PROPVARIANT pv;
      PropVariantInit(&pv);
      if (SUCCEEDED(props->ReadMultiple(1, &spec, &pv)) && pv.vt == VT_CLSID && pv.puuid) {
        fmt = FormatFromGuid(*pv.puuid);
      }
      PropVariantClear(&pv);
    }

    ComPtr<IWiaTransfer> transfer;
    hr = item.get()->QueryInterface(IID_IWiaTransfer,
                                    reinterpret_cast<void**>(transfer.put()));
    if (FAILED(hr) || !transfer) {
      out.errorCode = "transfer_unsupported";
      out.errorDetail = "item has no IWiaTransfer hr=" + std::to_string(hr);
      if (ownInit) CoUninitialize();
      return out;
    }

    TransferSink* sink = new TransferSink(&out, fmt);
    hr = transfer.get()->Download(0, sink);
    sink->finish();      // drain the final page's stream
    sink->Release();     // drop our creation ref
    if (FAILED(hr)) {
      // WIA_ERROR_PAPER_EMPTY after some pages is a normal ADF end-of-feed.
      if (hr == WIA_ERROR_PAPER_EMPTY && !out.images.empty()) {
        out.ok = true;
      } else if (out.images.empty()) {
        out.errorCode = "acquisition_failed";
        out.errorDetail = "Download failed hr=" + std::to_string(hr);
        if (ownInit) CoUninitialize();
        return out;
      } else {
        out.ok = true;  // got at least one page before the error
      }
    } else {
      out.ok = true;
    }
  }  // all ComPtrs Release() here

  if (ownInit) CoUninitialize();
  return out;
}

}  // namespace wia

#endif  // _WIN32
