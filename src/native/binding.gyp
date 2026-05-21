{
  "targets": [
    {
      "target_name": "touchpad",
      "sources": [
        "src/touchpad.mm",
        "src/utils.mm"
      ],
      "include_dirs": [
        "include",
        "<!@(node -e \"require('node-addon-api').include\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "conditions": [
        ["OS=='mac'", {
          "sources": [
            "src/touchpad.mm"
          ],
          "link_settings": {
            "libraries": [
              "-framework IOKit",
              "-framework CoreFoundation"
            ]
          },
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "OTHER_CPLUSPLUSFLAGS": [
              "-std=c++17",
              "-stdlib=libc++"
            ],
            "MACOSX_DEPLOYMENT_TARGET": "10.15"
          }
        }]
      ]
    },
    {
      "target_name": "keyinterceptor",
      "sources": [
        "src/key_interceptor.mm"
      ],
      "include_dirs": [
        "include",
        "<!@(node -e \"require('node-addon-api').include\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "conditions": [
        ["OS=='mac'", {
          "link_settings": {
            "libraries": [
              "-framework ApplicationServices",
              "-framework CoreFoundation"
            ]
          },
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "OTHER_CPLUSPLUSFLAGS": [
              "-std=c++17",
              "-stdlib=libc++"
            ],
            "MACOSX_DEPLOYMENT_TARGET": "10.15"
          }
        }]
      ]
    },
    {
      "target_name": "keyinjector",
      "sources": [
        "src/key_injector.mm"
      ],
      "include_dirs": [
        "include",
        "<!@(node -e \"require('node-addon-api').include\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "conditions": [
        ["OS=='mac'", {
          "link_settings": {
            "libraries": [
              "-framework ApplicationServices",
              "-framework CoreFoundation"
            ]
          },
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "OTHER_CPLUSPLUSFLAGS": [
              "-std=c++17",
              "-stdlib=libc++"
            ],
            "MACOSX_DEPLOYMENT_TARGET": "10.15"
          }
        }]
      ]
    }
  ]
}
