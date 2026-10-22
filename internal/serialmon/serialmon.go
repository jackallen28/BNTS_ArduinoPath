// Package serialmon is the Serial Monitor for real boards: it opens a
// serial port, shares what the board sends with every open Serial Monitor
// window, and sends what the student types.
package serialmon

import (
	"errors"
	"io"
	"sync"
	"time"

	"go.bug.st/serial"
)

// Opener opens a serial port (tests use a fake).
type Opener func(port string, baud int) (io.ReadWriteCloser, error)

// OpenPort opens a real serial port, 8N1, with DTR and RTS on (like the
// Arduino IDE: an Uno restarts its sketch, ESP boards keep running).
func OpenPort(port string, baud int) (io.ReadWriteCloser, error) {
	return serial.Open(port, &serial.Mode{BaudRate: baud, DataBits: 8, Parity: serial.NoParity, StopBits: serial.OneStopBit})
}

// Bauds are the speeds the Serial Monitor offers.
var Bauds = []int{300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400, 250000, 500000, 1000000}

// ValidBaud reports whether b is one of Bauds.
func ValidBaud(b int) bool {
	for _, v := range Bauds {
		if v == b {
			return true
		}
	}
	return false
}

// Event is something for a Serial Monitor window: data from the board, or
// the port closing (Err says why: unplugged, an upload starting...).
type Event struct {
	Data   []byte
	Closed bool
	Err    string
}

// Manager keeps the open ports.
type Manager struct {
	Open Opener

	mu       sync.Mutex
	sessions map[string]*session
}

// NewManager makes a Manager that opens real ports.
func NewManager() *Manager { return &Manager{Open: OpenPort} }

type session struct {
	port string
	baud int
	rw   io.ReadWriteCloser
	subs map[chan Event]struct{}
	done bool
}

// ErrBusy means another program has the port.
var ErrBusy = errors.New("the port is busy")

// Subscribe opens port at baud (or shares it if it's already open at that
// speed; a different speed reopens it) and returns its events. Call the
// returned function to stop; the port closes when nobody is watching.
func (m *Manager) Subscribe(port string, baud int) (<-chan Event, func(), error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.sessions == nil {
		m.sessions = map[string]*session{}
	}
	s := m.sessions[port]
	if s != nil && s.baud != baud {
		m.closeLocked(s, "The speed changed.")
		s = nil
	}
	if s == nil {
		rw, err := m.Open(port, baud)
		if err != nil {
			return nil, nil, err
		}
		s = &session{port: port, baud: baud, rw: rw, subs: map[chan Event]struct{}{}}
		m.sessions[port] = s
		go m.read(s)
	}
	ch := make(chan Event, 256)
	s.subs[ch] = struct{}{}
	return ch, func() { m.unsubscribe(s, ch) }, nil
}

func (m *Manager) unsubscribe(s *session, ch chan Event) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := s.subs[ch]; !ok {
		return
	}
	delete(s.subs, ch)
	close(ch)
	if len(s.subs) == 0 && !s.done {
		m.closeLocked(s, "")
	}
}

func (m *Manager) read(s *session) {
	buf := make([]byte, 4096)
	for {
		n, err := s.rw.Read(buf)
		if n > 0 {
			data := append([]byte(nil), buf[:n]...)
			m.mu.Lock()
			for ch := range s.subs {
				select {
				case ch <- Event{Data: data}:
				default: // a window that can't keep up misses some text
				}
			}
			m.mu.Unlock()
		}
		if err != nil {
			m.mu.Lock()
			if !s.done {
				m.closeLocked(s, "The board was unplugged, or the port closed.")
			}
			m.mu.Unlock()
			return
		}
	}
}

// closeLocked closes a session and tells its windows why.
func (m *Manager) closeLocked(s *session, why string) {
	s.done = true
	s.rw.Close()
	for ch := range s.subs {
		select {
		case ch <- Event{Closed: true, Err: why}:
		default:
		}
		close(ch)
	}
	s.subs = map[chan Event]struct{}{}
	if m.sessions[s.port] == s {
		delete(m.sessions, s.port)
	}
}

// Write sends text to an open port.
func (m *Manager) Write(port string, data []byte) error {
	m.mu.Lock()
	s := m.sessions[port]
	m.mu.Unlock()
	if s == nil {
		return errors.New("the Serial Monitor isn't open on that port")
	}
	_, err := s.rw.Write(data)
	return err
}

// Close closes a port (before an upload), telling its windows why. It
// waits a moment so the port is free when it returns.
func (m *Manager) Close(port, why string) {
	m.mu.Lock()
	s := m.sessions[port]
	if s != nil {
		m.closeLocked(s, why)
	}
	m.mu.Unlock()
	if s != nil {
		time.Sleep(200 * time.Millisecond)
	}
}

// IsOpen reports whether a port is open.
func (m *Manager) IsOpen(port string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sessions[port] != nil
}
