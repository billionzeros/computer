// Package update provides a thin HTTP-triggerable layer over `anton computer update`.
//
// The CLI owns all update logic (clone, install, build, swap, restart, verify).
// The sidecar just checks for available updates and shells out to the CLI,
// streaming its stdout back to the caller.
package update

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const manifestURL = "https://raw.githubusercontent.com/billionzeros/computer/main/manifest.json"

// Manifest is the remote release manifest.
type Manifest struct {
	Version    string `json:"version"`
	GitHash    string `json:"gitHash"`
	Changelog  string `json:"changelog"`
	ReleaseURL string `json:"releaseUrl"`
}

// CheckResult holds the result of an update check.
type CheckResult struct {
	UpdateAvailable bool   `json:"updateAvailable"`
	CurrentVersion  string `json:"currentVersion"`
	LatestVersion   string `json:"latestVersion,omitempty"`
	Changelog       string `json:"changelog,omitempty"`
	ReleaseURL      string `json:"releaseUrl,omitempty"`
}

// FetchManifest downloads and parses the remote manifest.
func FetchManifest() (*Manifest, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(manifestURL)
	if err != nil {
		return nil, fmt.Errorf("fetch manifest: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("manifest returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read manifest: %w", err)
	}

	var m Manifest
	if err := json.Unmarshal(body, &m); err != nil {
		return nil, fmt.Errorf("parse manifest: %w", err)
	}
	return &m, nil
}

// GetAgentVersion reads the current agent version from its /health endpoint.
func GetAgentVersion(agentPort int) string {
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/health", agentPort))
	if err != nil {
		return "unknown"
	}
	defer resp.Body.Close()

	var health struct {
		Version string `json:"version"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
		return "unknown"
	}
	return health.Version
}

// Check compares the running agent version against the remote manifest.
func Check(agentPort int) (*CheckResult, error) {
	manifest, err := FetchManifest()
	if err != nil {
		return nil, err
	}

	current := GetAgentVersion(agentPort)
	available := SemverGt(manifest.Version, current)

	return &CheckResult{
		UpdateAvailable: available,
		CurrentVersion:  current,
		LatestVersion:   manifest.Version,
		Changelog:       manifest.Changelog,
		ReleaseURL:      manifest.ReleaseURL,
	}, nil
}

// SemverGt returns true if a > b (simple semver comparison).
func SemverGt(a, b string) bool {
	a = strings.TrimPrefix(a, "v")
	b = strings.TrimPrefix(b, "v")

	partsA := strings.Split(a, ".")
	partsB := strings.Split(b, ".")

	for i := 0; i < 3; i++ {
		var va, vb int
		if i < len(partsA) {
			fmt.Sscanf(partsA[i], "%d", &va)
		}
		if i < len(partsB) {
			fmt.Sscanf(partsB[i], "%d", &vb)
		}
		if va > vb {
			return true
		}
		if va < vb {
			return false
		}
	}
	return false
}
