#include <napi.h>
#include <ApplicationServices/ApplicationServices.h>
#include <CoreFoundation/CoreFoundation.h>
#include <dispatch/dispatch.h>
#include <iostream>

class KeyInterceptor : public Napi::ObjectWrap<KeyInterceptor> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "KeyInterceptor", {
      InstanceMethod("start", &KeyInterceptor::Start),
      InstanceMethod("stop", &KeyInterceptor::Stop),
      InstanceMethod("on", &KeyInterceptor::On),
      InstanceMethod("setInterceptFilter", &KeyInterceptor::SetInterceptFilter),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("KeyInterceptor", func);
    return exports;
  }

  KeyInterceptor(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<KeyInterceptor>(info),
      eventTap(nullptr),
      runLoopSource(nullptr),
      eventQueue(nullptr),
      isRunning(false) {}

  ~KeyInterceptor() {
    StopMonitoring();
  }

private:
  static Napi::FunctionReference constructor;

  Napi::Value Start(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (isRunning) {
      return Napi::Boolean::New(env, true);
    }

    // 创建事件队列
    eventQueue = dispatch_queue_create("keyinterceptor.queue", DISPATCH_QUEUE_SERIAL);

    // 异步启动 CGEventTap
    __block bool success = false;
    dispatch_sync(eventQueue, ^{
      // 创建 CGEventTap
      CGEventMask eventMask = CGEventMaskBit(kCGEventKeyDown) | CGEventMaskBit(kCGEventKeyUp);
      
      eventTap = CGEventTapCreate(
        kCGSessionEventTap,
        kCGHeadInsertEventTap,
        kCGEventTapOptionDefault,
        eventMask,
        EventTapCallback,
        this
      );

      if (!eventTap) {
        std::cerr << "Failed to create event tap - check Accessibility permissions" << std::endl;
        return;
      }

      // 创建 run loop source
      runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0);
      CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, kCFRunLoopCommonModes);
      CGEventTapEnable(eventTap, true);
      
      success = true;
      
      // 启动 run loop
      CFRunLoopRun();
    });

    isRunning = success;
    return Napi::Boolean::New(env, success);
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

    if (event == "keydown" || event == "keyup") {
      tsfn = Napi::ThreadSafeFunction::New(
        env,
        info[1].As<Napi::Function>(),
        "KeyEvent",
        0,
        1
      );
    }
  }

  void SetInterceptFilter(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsFunction()) {
      Napi::TypeError::New(env, "Expected (filterCallback)").ThrowAsJavaScriptException();
      return;
    }

    filterCallback = Napi::Persistent(info[0].As<Napi::Function>());
  }

  void StopMonitoring() {
    if (isRunning) {
      if (eventTap) {
        CGEventTapEnable(eventTap, false);
      }
      if (runLoopSource) {
        CFRunLoopRemoveSource(CFRunLoopGetCurrent(), runLoopSource, kCFRunLoopCommonModes);
        CFRelease(runLoopSource);
        runLoopSource = nullptr;
      }
      if (eventTap) {
        CFRelease(eventTap);
        eventTap = nullptr;
      }
      isRunning = false;
    }

    if (tsfn) {
      tsfn.Release();
      tsfn = nullptr;
    }
  }

  // 事件回调
  static CGEventRef EventTapCallback(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void* refcon) {
    KeyInterceptor* self = static_cast<KeyInterceptor*>(refcon);
    
    // 获取按键码
    int64_t keyCode = CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
    
    // 转换为 JS 事件对象
    bool isDown = (type == kCGEventKeyDown);
    
    // 简化的过滤逻辑
    // 实际应该调用 JS filter 回调
    bool shouldIntercept = false;
    
    // 这里简化处理：如果有 filter 回调，应该异步询问 JS
    // 但为了性能，我们在原生层做快速预过滤
    
    // 检查是否需要拦截
    if (self->ShouldIntercept((int)keyCode, isDown)) {
      // 拦截：通知 JS 并阻止传播
      self->EmitKeyEvent((int)keyCode, isDown);
      return NULL;  // 阻止事件传播
    }
    
    return event;  // 放行
  }

  bool ShouldIntercept(int keyCode, bool isDown) {
    // 简化的拦截判断
    // 实际应该调用 JS 层 filter 回调
    // 这里先实现一个默认的测试逻辑
    return false;  // 默认放行，等待 JS 层配置
  }

  void EmitKeyEvent(int keyCode, bool isDown) {
    if (!tsfn) return;

    tsfn.NonBlockingCall([keyCode, isDown](Napi::Env env, Napi::Function jsCallback) {
      Napi::Object event = Napi::Object::New(env);
      event.Set("keyCode", keyCode);
      event.Set("keyChar", "");  // 需要转换为字符
      event.Set("isDown", isDown);
      event.Set("timestamp", Napi::Date::New(env, std::chrono::system_clock::now().time_since_epoch().count() / 1000000));

      jsCallback.Call({event});
    });
  }

  CFMachPortRef eventTap;
  CFRunLoopSourceRef runLoopSource;
  dispatch_queue_t eventQueue;
  bool isRunning;
  Napi::ThreadSafeFunction tsfn;
  Napi::FunctionReference filterCallback;
};

Napi::FunctionReference KeyInterceptor::constructor;

// 初始化模块
Napi::Object InitInterceptor(Napi::Env env, Napi::Object exports) {
  KeyInterceptor::Init(env, exports);
  return exports;
}

NODE_API_MODULE(keyinterceptor, InitInterceptor)
