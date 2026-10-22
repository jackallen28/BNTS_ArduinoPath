// ArduinoPath: on ESP8266 boards, <WebServer.h> gives the ESP8266's web
// server under the ESP32's name, so one sketch runs on every ESP board.
#pragma once
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>

using WebServer = ESP8266WebServer;
