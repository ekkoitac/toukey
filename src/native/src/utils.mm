#include <napi.h>
#include <iostream>

// 通用工具函数
namespace NativeUtils {

// 获取当前时间戳（毫秒）
uint64_t GetTimestamp() {
  auto now = std::chrono::system_clock::now();
  auto duration = now.time_since_epoch();
  return std::chrono::duration_cast<std::chrono::milliseconds>(duration).count();
}

// 日志函数
void Log(const char* message) {
  std::cout << "[Native] " << message << std::endl;
}

void LogError(const char* message) {
  std::cerr << "[Native Error] " << message << std::endl;
}

} // namespace NativeUtils
