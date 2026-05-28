// N-API entry point for the WIA scanner addon (Windows).
//
// Marshals wia::ListDevices() / wia::Acquire() across the N-API boundary.
//
// THREADING (brief requirement D + COM correctness):
//   - `acquire()` runs on a libuv worker thread via napi_create_async_work, so
//     a multi-minute ADF scan NEVER blocks the Electron main process event
//     loop. COM is initialized/uninitialized ON THAT WORKER THREAD inside
//     wia::Acquire (CoInitializeEx is per-thread).
//   - `listDevices()` also runs async (device enumeration can take ~1s while
//     WIA wakes the service); same async-work pattern.
//
// CONTRACT MAPPING:
//   - Success resolves the JS Promise with the value object.
//   - A typed failure resolves with `{ __wiaError: code, detail }` — the JS
//     handler maps that to its discriminated Result union. We resolve (not
//     reject) typed failures so the seam is "no exceptions across the bridge"
//     consistent with the rest of the project. Truly unexpected C++ exceptions
//     reject the Promise; the JS loader catches and maps to scanner_unavailable.

#ifdef _WIN32

#include <node_api.h>

#include <memory>
#include <string>
#include <vector>

#include "wia-com.h"

namespace {

// ---- small N-API helpers ---------------------------------------------------

napi_value MakeString(napi_env env, const std::string& s) {
  napi_value v;
  napi_create_string_utf8(env, s.c_str(), s.size(), &v);
  return v;
}

void SetProp(napi_env env, napi_value obj, const char* key, napi_value val) {
  napi_set_named_property(env, obj, key, val);
}

napi_value MakeError(napi_env env, const std::string& code, const std::string& detail) {
  napi_value obj;
  napi_create_object(env, &obj);
  SetProp(env, obj, "__wiaError", MakeString(env, code));
  SetProp(env, obj, "detail", MakeString(env, detail));
  return obj;
}

std::string GetStringArg(napi_env env, napi_value v) {
  size_t len = 0;
  if (napi_get_value_string_utf8(env, v, nullptr, 0, &len) != napi_ok) return std::string();
  std::string out(len, '\0');
  napi_get_value_string_utf8(env, v, &out[0], len + 1, &len);
  return out;
}

// ===========================================================================
// listDevices() async work
// ===========================================================================
struct ListWork {
  napi_async_work work = nullptr;
  napi_deferred deferred = nullptr;
  wia::ListResult result;
};

void ListExecute(napi_env, void* data) {
  auto* w = static_cast<ListWork*>(data);
  w->result = wia::ListDevices();  // owns its COM lifecycle on this worker thread
}

void ListComplete(napi_env env, napi_status status, void* data) {
  std::unique_ptr<ListWork> w(static_cast<ListWork*>(data));
  if (status != napi_ok) {
    napi_value err = MakeError(env, "addon_internal_error", "async work cancelled");
    napi_resolve_deferred(env, w->deferred, err);
  } else if (!w->result.ok) {
    napi_value err = MakeError(env, w->result.errorCode, w->result.errorDetail);
    napi_resolve_deferred(env, w->deferred, err);
  } else {
    napi_value arr;
    napi_create_array_with_length(env, w->result.devices.size(), &arr);
    for (size_t i = 0; i < w->result.devices.size(); ++i) {
      const auto& d = w->result.devices[i];
      napi_value obj;
      napi_create_object(env, &obj);
      SetProp(env, obj, "deviceId", MakeString(env, d.deviceId));
      SetProp(env, obj, "name", MakeString(env, d.name));
      SetProp(env, obj, "type", MakeString(env, d.type));
      SetProp(env, obj, "description", MakeString(env, d.description));
      napi_set_element(env, arr, static_cast<uint32_t>(i), obj);
    }
    napi_value out;
    napi_create_object(env, &out);
    SetProp(env, out, "devices", arr);
    napi_resolve_deferred(env, w->deferred, out);
  }
  napi_delete_async_work(env, w->work);
}

napi_value ListDevices(napi_env env, napi_callback_info /*info*/) {
  auto* w = new ListWork();
  napi_value promise;
  napi_create_promise(env, &w->deferred, &promise);
  napi_value name;
  napi_create_string_utf8(env, "wiaListDevices", NAPI_AUTO_LENGTH, &name);
  napi_create_async_work(env, nullptr, name, ListExecute, ListComplete, w, &w->work);
  napi_queue_async_work(env, w->work);
  return promise;
}

// ===========================================================================
// acquire(options) async work
// ===========================================================================
struct AcquireWork {
  napi_async_work work = nullptr;
  napi_deferred deferred = nullptr;
  wia::AcquireOptions opts;
  wia::AcquireResult result;
};

void AcquireExecute(napi_env, void* data) {
  auto* w = static_cast<AcquireWork*>(data);
  w->result = wia::Acquire(w->opts);  // COM lifecycle on this worker thread
}

void AcquireComplete(napi_env env, napi_status status, void* data) {
  std::unique_ptr<AcquireWork> w(static_cast<AcquireWork*>(data));
  if (status != napi_ok) {
    napi_resolve_deferred(env, w->deferred,
                          MakeError(env, "addon_internal_error", "async work cancelled"));
  } else if (!w->result.ok) {
    napi_resolve_deferred(env, w->deferred,
                          MakeError(env, w->result.errorCode, w->result.errorDetail));
  } else {
    napi_value pages;
    napi_create_array_with_length(env, w->result.images.size(), &pages);
    for (size_t i = 0; i < w->result.images.size(); ++i) {
      const auto& img = w->result.images[i];
      // Copy bytes into a Node Buffer (owned by V8 after this).
      void* bufData = nullptr;
      napi_value buf;
      napi_create_buffer_copy(env, img.bytes.size(),
                              img.bytes.empty() ? nullptr : img.bytes.data(), &bufData, &buf);
      napi_value obj;
      napi_create_object(env, &obj);
      SetProp(env, obj, "bytes", buf);
      SetProp(env, obj, "format", MakeString(env, img.format));
      napi_value pageIdx;
      napi_create_uint32(env, img.pageIndex, &pageIdx);
      SetProp(env, obj, "pageIndex", pageIdx);
      napi_set_element(env, pages, static_cast<uint32_t>(i), obj);
    }
    napi_value out;
    napi_create_object(env, &out);
    SetProp(env, out, "pages", pages);
    napi_resolve_deferred(env, w->deferred, out);
  }
  napi_delete_async_work(env, w->work);
}

wia::ColorMode ParseColorMode(const std::string& s) {
  if (s == "bw") return wia::ColorMode::Bw;
  if (s == "grayscale") return wia::ColorMode::Grayscale;
  return wia::ColorMode::Color;
}

wia::Source ParseSource(const std::string& s) {
  if (s == "feeder") return wia::Source::Feeder;
  if (s == "flatbed") return wia::Source::Flatbed;
  return wia::Source::Auto;
}

napi_value Acquire(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  auto* w = new AcquireWork();
  w->opts.resolutionDpi = 300;
  w->opts.colorMode = wia::ColorMode::Color;
  w->opts.source = wia::Source::Auto;

  if (argc >= 1) {
    napi_value optObj = argv[0];
    napi_valuetype t;
    napi_typeof(env, optObj, &t);
    if (t == napi_object) {
      napi_value v;
      bool has = false;
      napi_has_named_property(env, optObj, "deviceId", &has);
      if (has) {
        napi_get_named_property(env, optObj, "deviceId", &v);
        w->opts.deviceId = GetStringArg(env, v);
      }
      napi_has_named_property(env, optObj, "resolution", &has);
      if (has) {
        napi_get_named_property(env, optObj, "resolution", &v);
        int32_t dpi = 0;
        if (napi_get_value_int32(env, v, &dpi) == napi_ok && dpi > 0) {
          w->opts.resolutionDpi = static_cast<uint32_t>(dpi);
        }
      }
      napi_has_named_property(env, optObj, "colorMode", &has);
      if (has) {
        napi_get_named_property(env, optObj, "colorMode", &v);
        w->opts.colorMode = ParseColorMode(GetStringArg(env, v));
      }
      napi_has_named_property(env, optObj, "source", &has);
      if (has) {
        napi_get_named_property(env, optObj, "source", &v);
        w->opts.source = ParseSource(GetStringArg(env, v));
      }
    }
  }

  napi_value promise;
  napi_create_promise(env, &w->deferred, &promise);
  napi_value name;
  napi_create_string_utf8(env, "wiaAcquire", NAPI_AUTO_LENGTH, &name);
  napi_create_async_work(env, nullptr, name, AcquireExecute, AcquireComplete, w, &w->work);
  napi_queue_async_work(env, w->work);
  return promise;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_value fnList;
  napi_create_function(env, "listDevices", NAPI_AUTO_LENGTH, ListDevices, nullptr, &fnList);
  napi_set_named_property(env, exports, "listDevices", fnList);

  napi_value fnAcquire;
  napi_create_function(env, "acquire", NAPI_AUTO_LENGTH, Acquire, nullptr, &fnAcquire);
  napi_set_named_property(env, exports, "acquire", fnAcquire);

  napi_value platform;
  napi_create_string_utf8(env, "win32", NAPI_AUTO_LENGTH, &platform);
  napi_set_named_property(env, exports, "platform", platform);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

#endif  // _WIN32
