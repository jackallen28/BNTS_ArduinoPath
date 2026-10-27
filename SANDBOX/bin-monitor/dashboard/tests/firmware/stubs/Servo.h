#pragma once
// The fake records commands only; it does not verify servo pulses or mechanics.
#include <stdint.h>
class Servo {
 public:
  uint8_t attach(int pin) { pin_ = pin; attached_ = true; return 1; }
  void detach() { attached_ = false; }
  bool attached() const { return attached_; }
  void write(int angle) { angle_ = angle; }
  int read() const { return angle_; }
  int pin_ = -1, angle_ = 0;
  bool attached_ = false;
};
