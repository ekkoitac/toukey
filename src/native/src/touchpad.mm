#include <napi.h>
#include <IOKit/hid/IOHIDManager.h>
#include <IOKit/hid/IOHIDKeys.h>
#include <CoreFoundation/CoreFoundation.h>
#include <iostream>

// 触摸板监控类
class TouchpadMonitor : public Napi::ObjectWrap<TouchpadMonitor> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "TouchpadMonitor", {
      InstanceMethod("start", &TouchpadMonitor::Start),
      InstanceMethod("stop", &TouchpadMonitor::Stop),
      InstanceMethod("on", &TouchpadMonitor::On),
      InstanceMethod("removeListener", &TouchpadMonitor::RemoveListener),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("TouchpadMonitor", func);
    return exports;
  }

  TouchpadMonitor(const Napi::CallbackInfo& info) 
    : Napi::ObjectWrap<TouchpadMonitor>(info), 
      hidManager(nullptr), 
      isRunning(false),
      previousFingerCount(0) {}

  ~TouchpadMonitor() {
    StopMonitoring();
  }

private:
  static Napi::FunctionReference constructor;

  void Start(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (isRunning) {
      return;
    }

    // 创建 HID 管理器
    hidManager = IOHIDManagerCreate(kCFAllocatorDefault, kIOHIDOptionsTypeNone);
    if (!hidManager) {
      Napi::Error::New(env, "Failed to create HID manager").ThrowAsJavaScriptException();
      return;
    }

    // 设置设备匹配规则（触摸板）
    CFMutableDictionaryRef match = CFDictionaryCreateMutable(
      kCFAllocatorDefault, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks
    );

    int usagePage = kHIDPage_GenericDesktop;
    int usage = kHIDUsage_GD_Mouse;  // 触摸板通常作为鼠标设备
    
    CFDictionarySetValue(match, CFSTR(kIOHIDDeviceUsagePageKey), 
      CFNumberCreate(kCFAllocatorDefault, kCFNumberIntType, &usagePage));
    CFDictionarySetValue(match, CFSTR(kIOHIDDeviceUsageKey),
      CFNumberCreate(kCFAllocatorDefault, kCFNumberIntType, &usage));

    IOHIDManagerSetDeviceMatching(hidManager, match);
    CFRelease(match);

    // 设置回调
    IOHIDManagerRegisterInputValueCallback(hidManager, HandleInputValue, this);
    IOHIDManagerScheduleWithRunLoop(hidManager, CFRunLoopGetMain(), kCFRunLoopDefaultMode);
    
    IOReturn result = IOHIDManagerOpen(hidManager, kIOHIDOptionsTypeNone);
    if (result != kIOReturnSuccess) {
      Napi::Error::New(env, "Failed to open HID manager").ThrowAsJavaScriptException();
      return;
    }

    isRunning = true;
    std::cout << "Touchpad monitoring started" << std::endl;
  }

  void Stop(const Napi::CallbackInfo& info) {
    StopMonitoring();
  }

  void On(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsFunction()) {
      Napi::TypeError::New(env, "Expected (event, callback)").ThrowAsJavaScriptException();
      return;
    }

    std::string event = info[0].As<Napi::String>().Utf8Value();
    
    if (event == "touch") {
      // 创建线程安全函数
      tsfn = Napi::ThreadSafeFunction::New(
        env,
        info[1].As<Napi::Function>(),
        "TouchpadTouch",
        0,
        1
      );
    }
  }

  void RemoveListener(const Napi::CallbackInfo& info) {
    if (tsfn) {
      tsfn.Release();
      tsfn = nullptr;
    }
  }

  // 停止监控
  void StopMonitoring() {
    if (hidManager && isRunning) {
      IOHIDManagerClose(hidManager, kIOHIDOptionsTypeNone);
      IOHIDManagerUnscheduleFromRunLoop(hidManager, CFRunLoopGetMain(), kCFRunLoopDefaultMode);
      CFRelease(hidManager);
      hidManager = nullptr;
    }
    isRunning = false;
    std::cout << "Touchpad monitoring stopped" << std::endl;
  }

  // 静态回调函数
  static void HandleInputValue(void* context, IOReturn result, void* sender, IOHIDValueRef value) {
    TouchpadMonitor* self = static_cast<TouchpadMonitor*>(context);
    
    IOHIDElementRef element = IOHIDValueGetElement(value);
    int usage = IOHIDElementGetUsage(element);
    
    // 简化的触摸检测逻辑
    // 实际实现需要解析 HID 报告以获取准确的手指数量
    
    // 这里使用简化的模拟逻辑
    int fingerCount = self->DetectFingerCount(element, value);
    
    // 检测状态变化
    if (fingerCount == 1 && self->previousFingerCount == 0) {
      self->EmitTouchEvent("touch-start", fingerCount);
    } else if (fingerCount == 0 && self->previousFingerCount == 1) {
      self->EmitTouchEvent("touch-end", fingerCount);
    }
    
    self->previousFingerCount = fingerCount;
  }

  int DetectFingerCount(IOHIDElementRef element, IOHIDValueRef value) {
    // 简化的手指数量检测
    // 实际实现需要解析 HID 报告
    // 这里返回模拟值用于测试
    
    int usage = IOHIDElementGetUsage(element);
    int intValue = IOHIDValueGetIntegerValue(value);
    
    // 触摸通常有特定的 usage page/usage
    // 这里简化处理
    if (usage == 0x30 || usage == 0x31) {  // X, Y 坐标
      if (intValue > 0) {
        return 1;  // 假设单指
      }
    }
    
    return 0;
  }

  void EmitTouchEvent(const char* type, int fingerCount) {
    if (!tsfn) return;

    tsfn.NonBlockingCall([type, fingerCount](Napi::Env env, Napi::Function jsCallback) {
      Napi::Object event = Napi::Object::New(env);
      event.Set("type", type);
      event.Set("fingerCount", fingerCount);
      event.Set("timestamp", Napi::Date::New(env, std::chrono::system_clock::now().time_since_epoch().count() / 1000000));
      
      jsCallback.Call({event});
    });
  }

  IOHIDManagerRef hidManager;
  bool isRunning;
  int previousFingerCount;
  Napi::ThreadSafeFunction tsfn;
};

Napi::FunctionReference TouchpadMonitor::constructor;

// 初始化模块
Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  TouchpadMonitor::Init(env, exports);
  return exports;
}

NODE_API_MODULE(touchpad, InitAll)
