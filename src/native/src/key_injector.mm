#include <napi.h>
#include <ApplicationServices/ApplicationServices.h>
#include <CoreFoundation/CoreFoundation.h>
#include <map>
#include <string>
#include <unistd.h>

// 键码映射表
static std::map<std::string, CGKeyCode> keyCodeMap = {
  // 方向键
  {"up", (CGKeyCode)0x7E},
  {"down", (CGKeyCode)0x7D},
  {"left", (CGKeyCode)0x7B},
  {"right", (CGKeyCode)0x7C},
  
  // 功能键
  {"home", (CGKeyCode)0x73},
  {"end", (CGKeyCode)0x77},
  {"pageup", (CGKeyCode)0x74},
  {"pagedown", (CGKeyCode)0x79},
  
  // 常用键
  {"escape", (CGKeyCode)0x35},
  {"space", (CGKeyCode)0x31},
  {"return", (CGKeyCode)0x24},
  {"tab", (CGKeyCode)0x30},
  {"delete", (CGKeyCode)0x33},
  {"forwarddelete", (CGKeyCode)0x75},
  
  // 字母键
  {"a", (CGKeyCode)0x00}, {"b", (CGKeyCode)0x0B}, {"c", (CGKeyCode)0x08},
  {"d", (CGKeyCode)0x02}, {"e", (CGKeyCode)0x0E}, {"f", (CGKeyCode)0x03},
  {"g", (CGKeyCode)0x05}, {"h", (CGKeyCode)0x04}, {"i", (CGKeyCode)0x22},
  {"j", (CGKeyCode)0x26}, {"k", (CGKeyCode)0x28}, {"l", (CGKeyCode)0x25},
  {"m", (CGKeyCode)0x2E}, {"n", (CGKeyCode)0x2D}, {"o", (CGKeyCode)0x1F},
  {"p", (CGKeyCode)0x23}, {"q", (CGKeyCode)0x0C}, {"r", (CGKeyCode)0x0F},
  {"s", (CGKeyCode)0x01}, {"t", (CGKeyCode)0x11}, {"u", (CGKeyCode)0x20},
  {"v", (CGKeyCode)0x09}, {"w", (CGKeyCode)0x0D}, {"x", (CGKeyCode)0x07},
  {"y", (CGKeyCode)0x10}, {"z", (CGKeyCode)0x06}
};

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

    CGKeyCode keyCode = it->second;
    
    // 创建按下事件
    CGEventRef downEvent = CGEventCreateKeyboardEvent(nullptr, keyCode, true);
    CGEventPost(kCGSessionEventTap, downEvent);
    CFRelease(downEvent);
    
    // 短暂延迟
    usleep(10000);  // 10ms
    
    // 创建释放事件
    CGEventRef upEvent = CGEventCreateKeyboardEvent(nullptr, keyCode, false);
    CGEventPost(kCGSessionEventTap, upEvent);
    CFRelease(upEvent);
  }

  void InjectCombo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsArray() || !info[1].IsString()) {
      Napi::TypeError::New(env, "Expected (modifiers[], keyCode)").ThrowAsJavaScriptException();
      return;
    }

    // TODO: 实现组合键注入
    // 需要处理 modifier keys (cmd, opt, ctrl, shift)
    
    Napi::Error::New(env, "Combo injection not yet implemented").ThrowAsJavaScriptException();
  }
};

Napi::FunctionReference KeyInjector::constructor;

// 初始化模块
Napi::Object InitInjector(Napi::Env env, Napi::Object exports) {
  KeyInjector::Init(env, exports);
  return exports;
}

NODE_API_MODULE(keyinjector, InitInjector)
