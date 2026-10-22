package main

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Source reads files from the Fritzing parts repository at one commit:
// from a local clone (-repo), else from a cache folder, else from
// raw.githubusercontent.com (and keeps a copy in the cache).
type Source struct {
	Commit string
	Repo   string // optional local checkout of fritzing-parts
	Cache  string // folder for downloaded files
	Client *http.Client
	Log    func(format string, args ...any)
}

const rawBase = "https://raw.githubusercontent.com/fritzing/fritzing-parts/"

// Read returns one file, by its path in the repository (e.g. "core/resistor.fzp").
func (s *Source) Read(path string) ([]byte, error) {
	if strings.Contains(path, "..") {
		return nil, fmt.Errorf("bad path %q", path)
	}
	if s.Repo != "" {
		data, err := os.ReadFile(filepath.Join(s.Repo, filepath.FromSlash(path)))
		if err == nil {
			return data, nil
		}
	}
	cached := ""
	if s.Cache != "" {
		cached = filepath.Join(s.Cache, s.Commit, filepath.FromSlash(path))
		if data, err := os.ReadFile(cached); err == nil {
			return data, nil
		}
	}
	client := s.Client
	if client == nil {
		client = &http.Client{Timeout: 60 * time.Second}
	}
	u := rawBase + s.Commit + "/" + (&url.URL{Path: path}).EscapedPath()
	if s.Log != nil {
		s.Log("fetch %s", path)
	}
	var data []byte
	var err error
	for try := 0; try < 3; try++ {
		data, err = get(client, u)
		if err == nil {
			break
		}
		time.Sleep(time.Duration(try+1) * time.Second)
	}
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	if cached != "" {
		if err := os.MkdirAll(filepath.Dir(cached), 0o755); err == nil {
			os.WriteFile(cached, data, 0o644)
		}
	}
	return data, nil
}

func get(client *http.Client, u string) ([]byte, error) {
	resp, err := client.Get(u)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %s", resp.Status)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 20<<20))
}

// svgPath turns an fzp image path ("breadboard/led.svg") into a repository
// path, given the folder the fzp lives in ("core", "contrib", ...).
func svgPath(fzpPath, image string) string {
	folder := strings.SplitN(fzpPath, "/", 2)[0]
	if folder == "obsolete" {
		folder = "obsolete"
	}
	return "svg/" + folder + "/" + image
}
