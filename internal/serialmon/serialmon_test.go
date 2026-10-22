package serialmon

import (
	"io"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakePort is a board: what it "sends" is written to toApp; what the app
// writes arrives in fromApp.
type fakePort struct {
	toAppR  *io.PipeReader
	toAppW  *io.PipeWriter
	mu      sync.Mutex
	fromApp strings.Builder
	closed  bool
}

func newFakePort() *fakePort {
	r, w := io.Pipe()
	return &fakePort{toAppR: r, toAppW: w}
}

func (p *fakePort) Read(b []byte) (int, error) { return p.toAppR.Read(b) }
func (p *fakePort) Write(b []byte) (int, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.fromApp.Write(b)
}
func (p *fakePort) Close() error {
	p.mu.Lock()
	p.closed = true
	p.mu.Unlock()
	return p.toAppR.Close()
}

func recv(t *testing.T, ch <-chan Event) Event {
	t.Helper()
	select {
	case e, ok := <-ch:
		if !ok {
			return Event{Closed: true}
		}
		return e
	case <-time.After(2 * time.Second):
		t.Fatal("no event")
	}
	return Event{}
}

func TestSharedPortWriteAndClose(t *testing.T) {
	ports := map[string]*fakePort{}
	opens := 0
	m := &Manager{Open: func(port string, baud int) (io.ReadWriteCloser, error) {
		opens++
		p := newFakePort()
		ports[port] = p
		return p, nil
	}}
	a, stopA, err := m.Subscribe("COM3", 9600)
	if err != nil {
		t.Fatal(err)
	}
	b, stopB, _ := m.Subscribe("COM3", 9600)
	if opens != 1 {
		t.Fatalf("opened %d times", opens)
	}
	go ports["COM3"].toAppW.Write([]byte("Hello!\n"))
	if e := recv(t, a); string(e.Data) != "Hello!\n" {
		t.Fatalf("a got %+v", e)
	}
	if e := recv(t, b); string(e.Data) != "Hello!\n" {
		t.Fatalf("b got %+v", e)
	}
	if err := m.Write("COM3", []byte("hi\n")); err != nil {
		t.Fatal(err)
	}
	if got := ports["COM3"].fromApp.String(); got != "hi\n" {
		t.Fatalf("board got %q", got)
	}
	stopA()
	if !m.IsOpen("COM3") {
		t.Fatal("closed while a window was still open")
	}
	stopB()
	if m.IsOpen("COM3") || !ports["COM3"].closed {
		t.Fatal("still open with no windows")
	}
	if err := m.Write("COM3", []byte("x")); err == nil {
		t.Fatal("wrote to a closed port")
	}
}

func TestCloseForUploadAndUnplug(t *testing.T) {
	var last *fakePort
	m := &Manager{Open: func(port string, baud int) (io.ReadWriteCloser, error) {
		last = newFakePort()
		return last, nil
	}}
	ch, stop, _ := m.Subscribe("COM4", 115200)
	defer stop()
	m.Close("COM4", "Uploading...")
	if e := recv(t, ch); !e.Closed || e.Err != "Uploading..." {
		t.Fatalf("got %+v", e)
	}
	if m.IsOpen("COM4") {
		t.Fatal("still open")
	}

	ch2, stop2, _ := m.Subscribe("COM4", 115200)
	defer stop2()
	last.toAppW.CloseWithError(io.ErrUnexpectedEOF) // unplugged
	if e := recv(t, ch2); !e.Closed || !strings.Contains(e.Err, "unplugged") {
		t.Fatalf("got %+v", e)
	}
}

func TestSpeedChangeReopens(t *testing.T) {
	opens := 0
	m := &Manager{Open: func(port string, baud int) (io.ReadWriteCloser, error) {
		opens++
		return newFakePort(), nil
	}}
	a, _, _ := m.Subscribe("COM5", 9600)
	_, stop, _ := m.Subscribe("COM5", 115200)
	defer stop()
	if opens != 2 {
		t.Fatalf("opens = %d", opens)
	}
	if e := recv(t, a); !e.Closed {
		t.Fatalf("the 9600 window wasn't told: %+v", e)
	}
	if !ValidBaud(9600) || ValidBaud(12345) {
		t.Fatal("ValidBaud")
	}
}
