#include <napi.h>
#include <ApplicationServices/ApplicationServices.h>
#include <CoreFoundation/CoreFoundation.h>
#include <algorithm>
#include <map>
#include <string>
#include <vector>
#include <unistd.h>

static constexpr int64_t kTokeySyntheticEventUserData = 0x544F4B45594D4150LL;

// 键码映射表
static std::map<std::string, CGKeyCode> keyCodeMap = {
  // 字母键
  {"a", (CGKeyCode)0x00}, {"b", (CGKeyCode)0x0B}, {"c", (CGKeyCode)0x08},
  {"d", (CGKeyCode)0x02}, {"e", (CGKeyCode)0x0E}, {"f", (CGKeyCode)0x03},
  {"g", (CGKeyCode)0x05}, {"h", (CGKeyCode)0x04}, {"i", (CGKeyCode)0x22},
  {"j", (CGKeyCode)0x26}, {"k", (CGKeyCode)0x28}, {"l", (CGKeyCode)0x25},
  {"m", (CGKeyCode)0x2E}, {"n", (CGKeyCode)0x2D}, {"o", (CGKeyCode)0x1F},
  {"p", (CGKeyCode)0x23}, {"q", (CGKeyCode)0x0C}, {"r", (CGKeyCode)0x0F},
  {"s", (CGKeyCode)0x01}, {"t", (CGKeyCode)0x11}, {"u", (CGKeyCode)0x20},
  {"v", (CGKeyCode)0x09}, {"w", (CGKeyCode)0x0D}, {"x", (CGKeyCode)0x07},
  {"y", (CGKeyCode)0x10}, {"z", (CGKeyCode)0x06},

  // 数字键
  {"1", (CGKeyCode)0x12}, {"2", (CGKeyCode)0x13}, {"3", (CGKeyCode)0x14},
  {"4", (CGKeyCode)0x15}, {"5", (CGKeyCode)0x17}, {"6", (CGKeyCode)0x16},
  {"7", (CGKeyCode)0x1A}, {"8", (CGKeyCode)0x1C}, {"9", (CGKeyCode)0x19},
  {"0", (CGKeyCode)0x1D},

  // 符号键
  {"minus", (CGKeyCode)0x1B},
  {"equal", (CGKeyCode)0x18},
  {"leftbracket", (CGKeyCode)0x21},
  {"rightbracket", (CGKeyCode)0x1E},
  {"backslash", (CGKeyCode)0x2A},
  {"semicolon", (CGKeyCode)0x29},
  {"quote", (CGKeyCode)0x27},
  {"grave", (CGKeyCode)0x32},
  {"comma", (CGKeyCode)0x2B},
  {"period", (CGKeyCode)0x2F},
  {"slash", (CGKeyCode)0x2C},

  // 导航和控制键
  {"up", (CGKeyCode)0x7E},
  {"down", (CGKeyCode)0x7D},
  {"left", (CGKeyCode)0x7B},
  {"right", (CGKeyCode)0x7C},
  {"home", (CGKeyCode)0x73},
  {"end", (CGKeyCode)0x77},
  {"pageup", (CGKeyCode)0x74},
  {"pagedown", (CGKeyCode)0x79},
  {"help", (CGKeyCode)0x72},
  {"escape", (CGKeyCode)0x35},
  {"space", (CGKeyCode)0x31},
  {"return", (CGKeyCode)0x24},
  {"tab", (CGKeyCode)0x30},
  {"delete", (CGKeyCode)0x33},
  {"forwarddelete", (CGKeyCode)0x75},
  {"capslock", (CGKeyCode)0x39},

  // 功能键
  {"f1", (CGKeyCode)0x7A}, {"f2", (CGKeyCode)0x78}, {"f3", (CGKeyCode)0x63},
  {"f4", (CGKeyCode)0x76}, {"f5", (CGKeyCode)0x60}, {"f6", (CGKeyCode)0x61},
  {"f7", (CGKeyCode)0x62}, {"f8", (CGKeyCode)0x64}, {"f9", (CGKeyCode)0x65},
  {"f10", (CGKeyCode)0x6D}, {"f11", (CGKeyCode)0x67}, {"f12", (CGKeyCode)0x6F},
  {"f13", (CGKeyCode)0x69}, {"f14", (CGKeyCode)0x6B}, {"f15", (CGKeyCode)0x71},
  {"f16", (CGKeyCode)0x6A}, {"f17", (CGKeyCode)0x40}, {"f18", (CGKeyCode)0x4F},
  {"f19", (CGKeyCode)0x50}, {"f20", (CGKeyCode)0x5A},

  // 修饰键
  {"command", (CGKeyCode)0x37},
  {"rightcommand", (CGKeyCode)0x36},
  {"shift", (CGKeyCode)0x38},
  {"rightshift", (CGKeyCode)0x3C},
  {"option", (CGKeyCode)0x3A},
  {"rightoption", (CGKeyCode)0x3D},
  {"control", (CGKeyCode)0x3B},
  {"rightcontrol", (CGKeyCode)0x3E},
  {"fn", (CGKeyCode)0x3F},

  // 数字小键盘
  {"keypad0", (CGKeyCode)0x52}, {"keypad1", (CGKeyCode)0x53},
  {"keypad2", (CGKeyCode)0x54}, {"keypad3", (CGKeyCode)0x55},
  {"keypad4", (CGKeyCode)0x56}, {"keypad5", (CGKeyCode)0x57},
  {"keypad6", (CGKeyCode)0x58}, {"keypad7", (CGKeyCode)0x59},
  {"keypad8", (CGKeyCode)0x5B}, {"keypad9", (CGKeyCode)0x5C},
  {"keypaddecimal", (CGKeyCode)0x41},
  {"keypadmultiply", (CGKeyCode)0x43},
  {"keypadplus", (CGKeyCode)0x45},
  {"keypadclear", (CGKeyCode)0x47},
  {"keypaddivide", (CGKeyCode)0x4B},
  {"keypadenter", (CGKeyCode)0x4C},
  {"keypadminus", (CGKeyCode)0x4E},
  {"keypadequals", (CGKeyCode)0x51}
};

static std::map<std::string, CGEventFlags> modifierFlagMap = {
  {"command", kCGEventFlagMaskCommand},
  {"shift", kCGEventFlagMaskShift},
  {"option", kCGEventFlagMaskAlternate},
  {"control", kCGEventFlagMaskControl},
  {"fn", kCGEventFlagMaskSecondaryFn}
};

static bool ReadModifierArray(Napi::Env env, Napi::Array input, std::vector<std::string>& output) {
  for (uint32_t i = 0; i < input.Length(); i++) {
    Napi::Value value = input.Get(i);
    if (!value.IsString()) {
      Napi::TypeError::New(env, "Modifier must be a string").ThrowAsJavaScriptException();
      return false;
    }

    std::string modifier = value.As<Napi::String>().Utf8Value();
    if (std::find(output.begin(), output.end(), modifier) != output.end()) {
      continue;
    }

    if (keyCodeMap.find(modifier) == keyCodeMap.end() ||
        modifierFlagMap.find(modifier) == modifierFlagMap.end()) {
      Napi::Error::New(env, "Unknown modifier key").ThrowAsJavaScriptException();
      return false;
    }

    output.push_back(modifier);
  }

  return true;
}

static void PostKeyboardEvent(CGKeyCode keyCode, bool isDown, CGEventFlags flags) {
  CGEventRef event = CGEventCreateKeyboardEvent(nullptr, keyCode, isDown);
  CGEventSetFlags(event, flags);
  CGEventSetIntegerValueField(event, kCGEventSourceUserData, kTokeySyntheticEventUserData);
  CGEventPost(kCGSessionEventTap, event);
  CFRelease(event);
}

class KeyInjector : public Napi::ObjectWrap<KeyInjector> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "KeyInjector", {
      InstanceMethod("injectKey", &KeyInjector::InjectKey),
      InstanceMethod("injectCombo", &KeyInjector::InjectCombo),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("KeyInjector", func);
    return exports;
  }

  KeyInjector(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<KeyInjector>(info) {}

private:
  static Napi::FunctionReference constructor;

  void InjectKey(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
      Napi::TypeError::New(env, "Expected (keyCode)").ThrowAsJavaScriptException();
      return;
    }

    std::string keyName = info[0].As<Napi::String>().Utf8Value();
    
    // 查找键码
    auto it = keyCodeMap.find(keyName);
    if (it == keyCodeMap.end()) {
      Napi::Error::New(env, "Unknown key code").ThrowAsJavaScriptException();
      return;
    }

    InjectSingleKey(it->second);
  }

  void InjectCombo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsArray() || !info[1].IsString() ||
        (info.Length() >= 3 && !info[2].IsArray())) {
      Napi::TypeError::New(env, "Expected (modifiers[], keyCode, preservedModifiers[]?)").ThrowAsJavaScriptException();
      return;
    }

    Napi::Array modifiersArray = info[0].As<Napi::Array>();
    std::string keyName = info[1].As<Napi::String>().Utf8Value();

    auto keyIt = keyCodeMap.find(keyName);
    if (keyIt == keyCodeMap.end()) {
      Napi::Error::New(env, "Unknown key code").ThrowAsJavaScriptException();
      return;
    }

    std::vector<std::string> modifiers;
    std::vector<std::string> preservedModifiers;
    std::vector<CGKeyCode> modifierCodes;
    std::vector<CGEventFlags> modifierFlags;

    if (!ReadModifierArray(env, modifiersArray, modifiers)) {
      return;
    }
    if (info.Length() >= 3) {
      Napi::Array preservedArray = info[2].As<Napi::Array>();
      if (!ReadModifierArray(env, preservedArray, preservedModifiers)) {
        return;
      }
    }

    CGEventFlags baseFlags = 0;
    CGEventFlags targetFlags = 0;

    for (const std::string& modifier : preservedModifiers) {
      baseFlags |= modifierFlagMap[modifier];
      if (std::find(modifiers.begin(), modifiers.end(), modifier) == modifiers.end()) {
        modifiers.push_back(modifier);
      }
    }

    for (const std::string& modifier : modifiers) {
      targetFlags |= modifierFlagMap[modifier];
      if (std::find(preservedModifiers.begin(), preservedModifiers.end(), modifier) != preservedModifiers.end()) {
        continue;
      }

      modifierCodes.push_back(keyCodeMap[modifier]);
      modifierFlags.push_back(modifierFlagMap[modifier]);
    }

    if (modifierCodes.empty()) {
      InjectSingleKey(keyIt->second, targetFlags);
      return;
    }

    CGEventFlags activeFlags = baseFlags;

    for (size_t i = 0; i < modifierCodes.size(); i++) {
      activeFlags |= modifierFlags[i];
      PostKeyboardEvent(modifierCodes[i], true, activeFlags);
      usleep(1000);
    }

    PostKeyboardEvent(keyIt->second, true, activeFlags);
    usleep(10000);
    PostKeyboardEvent(keyIt->second, false, activeFlags);

    for (size_t i = modifierCodes.size(); i > 0; i--) {
      activeFlags &= ~modifierFlags[i - 1];
      PostKeyboardEvent(modifierCodes[i - 1], false, activeFlags);
      usleep(1000);
    }
  }

  void InjectSingleKey(CGKeyCode keyCode, CGEventFlags flags = 0) {
    PostKeyboardEvent(keyCode, true, flags);
    usleep(10000);
    PostKeyboardEvent(keyCode, false, flags);
  }
};

Napi::FunctionReference KeyInjector::constructor;

// 初始化模块
Napi::Object InitInjector(Napi::Env env, Napi::Object exports) {
  KeyInjector::Init(env, exports);
  return exports;
}

NODE_API_MODULE(keyinjector, InitInjector)
