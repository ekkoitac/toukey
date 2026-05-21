#ifndef NATIVE_API_H
#define NATIVE_API_H

#include <napi.h>
#include <CoreFoundation/CoreFoundation.h>

// 触摸板监控类
class TouchpadMonitor : public Napi::ObjectWrap<TouchpadMonitor> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  TouchpadMonitor(const Napi::CallbackInfo& info);
  ~TouchpadMonitor();

private:
  static Napi::FunctionReference constructor;

  void Start(const Napi::CallbackInfo& info);
  void Stop(const Napi::CallbackInfo& info);
  void On(const Napi::CallbackInfo& info);
  void RemoveListener(const Napi::CallbackInfo& info);

  // 原生资源
  IOHIDManagerRef hidManager;
  CFRunLoopRef runLoop;
  bool isRunning;

  // 回调引用
  Napi::ThreadSafeFunction tsfn;
};

// 按键拦截类
class KeyInterceptor : public Napi::ObjectWrap<KeyInterceptor> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  KeyInterceptor(const Napi::CallbackInfo& info);
  ~KeyInterceptor();

private:
  static Napi::FunctionReference constructor;

  Napi::Value Start(const Napi::CallbackInfo& info);
  void Stop(const Napi::CallbackInfo& info);
  void On(const Napi::CallbackInfo& info);
  void SetInterceptFilter(const Napi::CallbackInfo& info);

  // 原生资源
  CFMachPortRef eventTap;
  CFRunLoopSourceRef runLoopSource;
  dispatch_queue_t eventQueue;
  bool isRunning;

  // 回调
  Napi::ThreadSafeFunction tsfn;
  Napi::FunctionReference filterCallback;
};

// 按键注入类
class KeyInjector : public Napi::ObjectWrap<KeyInjector> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  KeyInjector(const Napi::CallbackInfo& info);

private:
  static Napi::FunctionReference constructor;

  void InjectKey(const Napi::CallbackInfo& info);
  void InjectCombo(const Napi::CallbackInfo& info);
};

#endif // NATIVE_API_H
