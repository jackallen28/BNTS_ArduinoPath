package content

import (
	"encoding/json"
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// analogRoles are read with analogRead, so they need an analog pin.
var analogRoles = []string{"POT_PIN", "LDR_PIN", "SOIL_PIN", "JOY_X_PIN", "JOY_Y_PIN"}

var i2cRe = regexp.MustCompile(`#include\s*<(Wire|Adafruit_SSD1306|LiquidCrystal_I2C)\.h>`)
var spiRe = regexp.MustCompile(`#include\s*<SPI\.h>`)

// TestProjectPins checks every project on every board it lists: each role
// the code uses has a pin, the pin exists, no two roles (or a role and a
// bus the code uses) share a pin, and analog sensors are on analog pins.
func TestProjectPins(t *testing.T) {
	c, problems := Load(os.DirFS("../../content"))
	if len(problems) > 0 {
		t.Fatal(problems)
	}
	for _, p := range c.Projects {
		var full struct {
			Steps []struct {
				Title   string `json:"title"`
				Starter string `json:"starter"`
				Demo    string `json:"demo"`
			} `json:"steps"`
		}
		json.Unmarshal(p.Raw, &full)
		boards := c.ProjectBoards(p.ProjectSummary)
		if len(boards) == 0 {
			t.Errorf("%s: no boards", p.ID)
		}
		for _, b := range boards {
			plan := PinPlan(p, b)
			var bus struct {
				I2C map[string]string `json:"i2c"`
				SPI map[string]string `json:"spi"`
			}
			json.Unmarshal(b.Raw, &bus)
			for _, s := range full.Steps {
				for _, code := range []string{s.Demo, s.Starter} {
					where := p.ID + " on " + b.ID + ", " + s.Title
					used := map[string]string{} // pin code → what uses it
					claim := func(pin, what string) {
						if other, ok := used[pin]; ok && other != what {
							t.Errorf("%s: %s and %s are both on pin %s", where, other, what, pin)
						}
						used[pin] = what
					}
					if i2cRe.MatchString(code) {
						claim(bus.I2C["sda"], "I2C SDA")
						claim(bus.I2C["scl"], "I2C SCL")
					}
					if spiRe.MatchString(code) {
						claim(bus.SPI["mosi"], "SPI MOSI")
						claim(bus.SPI["miso"], "SPI MISO")
						claim(bus.SPI["sck"], "SPI SCK")
					}
					for _, role := range RolesIn(code, plan) {
						pin, ok := b.Pin(plan[role])
						if !ok {
							t.Errorf("%s: %s is on %q, which isn't a pin on this board", where, role, plan[role])
							continue
						}
						claim(pin.Code, role)
						if slices.Contains(analogRoles, role) && !slices.Contains(pin.Modes, "analog") {
							t.Errorf("%s: %s needs an analog pin, but %s isn't one", where, role, pin.Code)
						}
					}
					if strings.Contains(code, "{{pins}}") {
						out := ExpandPins(p, b, code)
						if strings.Contains(out, "{{pins}}") {
							t.Errorf("%s: {{pins}} was left in", where)
						}
					}
				}
			}
		}
	}
}

func TestPinHeader(t *testing.T) {
	c, _ := Load(os.DirFS("../../content"))
	p, _ := c.Project("blink-traffic-lights")
	b, _ := c.Board("uno")
	got := ExpandPins(p, b, "{{pins}}\nvoid setup() { pinMode(LED_RED, OUTPUT); int x = ANALOG_MAX; }")
	for _, want := range []string{"// Pins for your Arduino Uno", "#define LED_RED 12\n", "#define ANALOG_MAX 1023\n"} {
		if !strings.Contains(got, want) {
			t.Errorf("header is missing %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "LED_YELLOW") {
		t.Errorf("header has a role the code doesn't use:\n%s", got)
	}
}
