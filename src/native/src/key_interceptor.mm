#include <napi.h>
#include <ApplicationServices/ApplicationServices.h>
#include <CoreFoundation/CoreFoundation.h>
#include <dispatch/dispatch.h>
#include <mutex>
#include <unordered_set>
#include <chrono>
#include <iostream>

class KeyInterceptor : public Napi::ObjectWrap<KeyInterceptor> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "KeyInterceptor", {
      InstanceMethod("start", &KeyInterceptor::Start),
      InstanceMethod("stop", &KeyInterceptor::Stop),
      InstanceMethod("on", &KeyInterceptor::On),
      InstanceMethod("setInterceptFilter", &KeyInterceptor::SetInterceptFilter),
      InstanceMethod("updateInterceptState", &KeyInterceptor::UpdateInterceptState),
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
      isRunning(false),
      interceptActive(false) {}

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

    eventQueue = dispatch_queue_create("keyinterceptor.queue", DISPATCH_QUEUE_SERIAL);

    __block bool success = false;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);

    dispatch_async(eventQueue, ^{
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
        dispatch_semaphore_signal(sem);
        return;
      }

      runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0);
      CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, kCFRunLoopCommonModes);
      CGEventTapEnable(eventTap, true);

      success = true;
      isRunning = true;
      dispatch_semaphore_signal(sem);

      CFRunLoopRun();
    });

    dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);

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

  void UpdateInterceptState(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsBoolean() || !info[1].IsArray()) {
      Napi::TypeError::New(env, "Expected (active, keyCodes[])").ThrowAsJavaScriptException();
      return;
    }

    const bool active = info[0].As<Napi::Boolean>().Value();
    Napi::Array keyCodes = info[1].As<Napi::Array>();

    std::unordered_set<int> codes;
    codes.reserve(keyCodes.Length());
    for (uint32_t i = 0; i < keyCodes.Length(); i++) {
      Napi::Value value = keyCodes.Get(i);
      if (value.IsNumber()) {
        codes.insert(value.As<Napi::Number>().Int32Value());
      }
    }

    {
      std::lock_guard<std::mutex> lock(stateMutex_);
      interceptActive = active;
      mappedKeyCodes = std::move(codes);
    }
  }

  void StopMonitoring() {
    if (eventQueue && isRunning) {
      dispatch_sync(eventQueue, ^{
        if (eventTap) {
          CGEventTapEnable(eventTap, false);
        }
        if (runLoopSource) {
          CFRunLoopRemoveSource(CFRunLoopGetCurrent(), runLoopSource, kCFRunLoopCommonModes);
          CFRelease(runLoopSource);
          runLoopSource = nullptr;
        }
        if (eventTap) {
          CFMachPortInvalidate(eventTap);
          CFRelease(eventTap);
          eventTap = nullptr;
        }
        CFRunLoopStop(CFRunLoopGetCurrent());
      });
    }

    isRunning = false;
    eventQueue = nullptr;

    if (tsfn) {
      tsfn.Release();
      tsfn = nullptr;
    }
  }

  static CGEventRef EventTapCallback(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void* refcon) {
    KeyInterceptor* self = static_cast<KeyInterceptor*>(refcon);

    if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
      if (self->eventTap) {
        CGEventTapEnable(self->eventTap, true);
      }
      return event;
    }

    if (type != kCGEventKeyDown && type != kCGEventKeyUp) {
      return event;
    }

    int keyCode = static_cast<int>(CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode));
    bool isDown = (type == kCGEventKeyDown);

    if (self->ShouldIntercept(keyCode, isDown)) {
      if (isDown) {
        self->EmitKeyEvent(keyCode, true);
      }
      return NULL;
    }

    return event;
  }

  bool ShouldIntercept(int keyCode, bool isDown) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    if (!interceptActive) {
      return false;
    }
    return mappedKeyCodes.find(keyCode) != mappedKeyCodes.end();
  }

  void EmitKeyEvent(int keyCode, bool isDown) {
    if (!tsfn) return;

    tsfn.NonBlockingCall([keyCode, isDown](Napi::Env env, Napi::Function jsCallback) {
      Napi::Object event = Napi::Object::New(env);
      event.Set("keyCode", keyCode);
      event.Set("keyChar", "");
      event.Set("isDown", isDown);
      event.Set("timestamp", Napi::Number::New(env, static_cast<double>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::system_clock::now().time_since_epoch()
        ).count()
      )));

      jsCallback.Call({event});
    });
  }

  CFMachPortRef eventTap;
  CFRunLoopSourceRef runLoopSource;
  dispatch_queue_t eventQueue;
  bool isRunning;
  bool interceptActive;
  std::unordered_set<int> mappedKeyCodes;
  std::mutex stateMutex_;
  Napi::ThreadSafeFunction tsfn;
  Napi::FunctionReference filterCallback;
};

Napi::FunctionReference KeyInterceptor::constructor;

Napi::Object InitInterceptor(Napi::Env env, Napi::Object exports) {
  KeyInterceptor::Init(env, exports);
  return exports;
}

NODE_API_MODULE(keyinterceptor, InitInterceptor)
