#include <napi.h>
#include <CoreFoundation/CoreFoundation.h>
#include <dlfcn.h>
#include <iostream>
#include <vector>
#include <chrono>

// MultitouchSupport 类型定义
typedef struct {
  float x;
  float y;
} MTPoint;

typedef struct {
  float positionX;
  float positionY;
} MTVector;

typedef struct {
  int frame;
  double timestamp;
  int identifier;
  int state;
  int fingerIdentity;
  int size;
  float pressure;
  MTPoint position;
  MTVector velocity;
  float orientation;
  unsigned int active;
} MTContact;

typedef void* MTDeviceRef;
typedef int (*MTContactCallbackFunction)(
  MTDeviceRef device,
  MTContact* contacts,
  int numContacts,
  double timestamp,
  int frame
);

typedef MTDeviceRef (*MTDeviceCreateDefaultFn)();
typedef CFArrayRef (*MTDeviceCreateListFn)();
typedef void (*MTRegisterContactFrameCallbackFn)(MTDeviceRef, MTContactCallbackFunction, void*);
typedef void (*MTDeviceStartFn)(MTDeviceRef, int);
typedef void (*MTDeviceStopFn)(MTDeviceRef);

class TouchpadMonitor;
extern TouchpadMonitor* globalInstance;

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
      isRunning(false),
      previousFingerCount(0),
      multitouchSupportHandle(nullptr) {}

  ~TouchpadMonitor() {
    StopMonitoring();
  }

  void ProcessContacts(MTContact* contacts, int numContacts) {
    // 如果之前手指数量为 0，当前手指数量大于 0，触发 touch-start 并模拟单指以满足状态机过滤
    if (previousFingerCount == 0 && numContacts > 0) {
      EmitTouchEvent("touch-start", 1);
    }
    // 如果之前手指数量大于 0，当前手指数量为 0，触发 touch-end
    else if (previousFingerCount > 0 && numContacts == 0) {
      EmitTouchEvent("touch-end", 0);
    }
    previousFingerCount = numContacts;
  }

private:
  static Napi::FunctionReference constructor;
  bool isRunning;
  int previousFingerCount;
  Napi::ThreadSafeFunction tsfn;
  void* multitouchSupportHandle;
  std::vector<MTDeviceRef> activeDevices;

  // 动态库函数指针
  MTDeviceCreateDefaultFn MTDeviceCreateDefault = nullptr;
  MTDeviceCreateListFn MTDeviceCreateList = nullptr;
  MTRegisterContactFrameCallbackFn MTRegisterContactFrameCallback = nullptr;
  MTDeviceStartFn MTDeviceStart = nullptr;
  MTDeviceStopFn MTDeviceStop = nullptr;

  bool LoadMultitouchSupport() {
    if (multitouchSupportHandle) return true;

    multitouchSupportHandle = dlopen("/System/Library/PrivateFrameworks/MultitouchSupport.framework/MultitouchSupport", RTLD_LAZY);
    if (!multitouchSupportHandle) {
      std::cerr << "Failed to load MultitouchSupport: " << dlerror() << std::endl;
      return false;
    }

    MTDeviceCreateDefault = (MTDeviceCreateDefaultFn)dlsym(multitouchSupportHandle, "MTDeviceCreateDefault");
    MTDeviceCreateList = (MTDeviceCreateListFn)dlsym(multitouchSupportHandle, "MTDeviceCreateList");
    MTRegisterContactFrameCallback = (MTRegisterContactFrameCallbackFn)dlsym(multitouchSupportHandle, "MTRegisterContactFrameCallback");
    MTDeviceStart = (MTDeviceStartFn)dlsym(multitouchSupportHandle, "MTDeviceStart");
    MTDeviceStop = (MTDeviceStopFn)dlsym(multitouchSupportHandle, "MTDeviceStop");

    if (!MTDeviceCreateDefault || !MTDeviceCreateList || !MTRegisterContactFrameCallback || !MTDeviceStart || !MTDeviceStop) {
      std::cerr << "Failed to find all required MultitouchSupport symbols" << std::endl;
      dlclose(multitouchSupportHandle);
      multitouchSupportHandle = nullptr;
      return false;
    }

    return true;
  }

  void Start(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (isRunning) {
      return;
    }

    if (!LoadMultitouchSupport()) {
      Napi::Error::New(env, "Failed to load MultitouchSupport private framework").ThrowAsJavaScriptException();
      return;
    }

    // 设置全局实例以供静态回调函数使用
    globalInstance = this;

    CFArrayRef devices = MTDeviceCreateList();
    if (!devices) {
      MTDeviceRef defaultDevice = MTDeviceCreateDefault();
      if (defaultDevice) {
        MTRegisterContactFrameCallback(defaultDevice, HandleContactFrame, nullptr);
        MTDeviceStart(defaultDevice, 0);
        activeDevices.push_back(defaultDevice);
      } else {
        Napi::Error::New(env, "No multitouch devices found").ThrowAsJavaScriptException();
        return;
      }
    } else {
      CFIndex count = CFArrayGetCount(devices);
      for (CFIndex i = 0; i < count; ++i) {
        MTDeviceRef device = (MTDeviceRef)CFArrayGetValueAtIndex(devices, i);
        if (device) {
          MTRegisterContactFrameCallback(device, HandleContactFrame, nullptr);
          MTDeviceStart(device, 0);
          activeDevices.push_back(device);
        }
      }
      CFRelease(devices);
    }

    isRunning = true;
    std::cout << "Touchpad monitoring started using MultitouchSupport" << std::endl;
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

  void StopMonitoring() {
    if (isRunning) {
      for (MTDeviceRef device : activeDevices) {
        if (device) {
          MTDeviceStop(device);
        }
      }
      activeDevices.clear();
      isRunning = false;
      std::cout << "Touchpad monitoring stopped" << std::endl;
    }

    if (globalInstance == this) {
      globalInstance = nullptr;
    }

    if (multitouchSupportHandle) {
      dlclose(multitouchSupportHandle);
      multitouchSupportHandle = nullptr;
    }
  }

  static int HandleContactFrame(MTDeviceRef device, MTContact* contacts, int numContacts, double timestamp, int frame) {
    if (globalInstance) {
      globalInstance->ProcessContacts(contacts, numContacts);
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
};

Napi::FunctionReference TouchpadMonitor::constructor;
TouchpadMonitor* globalInstance = nullptr;

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  TouchpadMonitor::Init(env, exports);
  return exports;
}

NODE_API_MODULE(touchpad, InitAll)
