// Non-Windows stub for the WIA scanner addon.
//
// WIA is a Windows-only API. On macOS/Linux we still want `npm install` and
// `electron-rebuild` to succeed (so a cross-platform CI matrix doesn't fail),
// so the binding.gyp compiles THIS file instead of the real COM code on
// non-Windows. The addon exports `platform: 'unsupported'` and NO
// listDevices/acquire functions — the JS loader (load-addon.ts) detects the
// missing functions and degrades gracefully to `scanner_unavailable`.

#ifndef _WIN32

#include <node_api.h>

namespace {

napi_value Init(napi_env env, napi_value exports) {
  napi_value platform;
  napi_create_string_utf8(env, "unsupported", NAPI_AUTO_LENGTH, &platform);
  napi_set_named_property(env, exports, "platform", platform);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

#endif  // !_WIN32
