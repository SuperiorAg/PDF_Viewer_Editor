{
  "targets": [
    {
      "target_name": "wia_scanner",
      "conditions": [
        [
          "OS=='win'",
          {
            "sources": [
              "src/addon.cc",
              "src/wia-com.cc"
            ],
            "include_dirs": [
              "src"
            ],
            "defines": [
              "WIN32_LEAN_AND_MEAN",
              "UNICODE",
              "_UNICODE",
              "NAPI_VERSION=8"
            ],
            "libraries": [
              "-lole32.lib",
              "-loleaut32.lib",
              "-lwiaguid.lib"
            ],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 1,
                "AdditionalOptions": [ "/std:c++17", "/EHsc" ]
              }
            }
          },
          {
            "comment": "Non-Windows: build an empty stub so `npm install` / electron-rebuild never fails on macOS/Linux. The JS loader treats a missing wia_scanner export as scanner_unavailable.",
            "sources": [ "src/stub-nonwin.cc" ],
            "defines": [ "NAPI_VERSION=8" ]
          }
        ]
      ]
    }
  ]
}
