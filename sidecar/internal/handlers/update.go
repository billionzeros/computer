package handlers

import (
	"bufio"
	"os/exec"
	"sync"

	"github.com/gofiber/fiber/v2"

	"github.com/billionzeros/computer/sidecar/internal/config"
	"github.com/billionzeros/computer/sidecar/internal/update"
)

var updateMu sync.Mutex
var updateRunning bool

// NewUpdateCheckHandler returns a handler that checks for available updates.
func NewUpdateCheckHandler(cfg *config.Config) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := update.Check(cfg.AgentPort)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": err.Error(),
			})
		}
		return c.JSON(result)
	}
}

// NewUpdateStartHandler returns a handler that runs `anton computer update`
// and streams its stdout back to the caller.
func NewUpdateStartHandler(cfg *config.Config) fiber.Handler {
	return func(c *fiber.Ctx) error {
		updateMu.Lock()
		if updateRunning {
			updateMu.Unlock()
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{
				"error": "update already in progress",
			})
		}
		updateRunning = true
		updateMu.Unlock()

		defer func() {
			updateMu.Lock()
			updateRunning = false
			updateMu.Unlock()
		}()

		c.Set("Content-Type", "text/plain; charset=utf-8")
		c.Set("Cache-Control", "no-cache")

		c.Context().SetBodyStreamWriter(func(w *bufio.Writer) {
			// Run the CLI in a transient systemd scope so it lives in its own
			// cgroup, independent of the sidecar's. This is critical: the CLI
			// will restart the sidecar mid-update; if the CLI were a child of
			// the sidecar's cgroup, systemd would kill it when it kills the
			// sidecar, leaving the agent stopped and the update half-applied.
			//
			// systemd-run --scope creates the new cgroup synchronously and
			// streams stdout back to us, so we keep the streaming progress UX.
			cmd := exec.Command(
				"systemd-run",
				"--scope",
				"--quiet",
				"--unit=anton-update",
				"--collect",
				"sudo", "anton", "computer", "update", "--yes", "--json",
			)
			cmd.Env = []string{
				"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/bin",
				"HOME=/home/anton",
			}

			stdout, err := cmd.StdoutPipe()
			if err != nil {
				w.WriteString("error: " + err.Error() + "\n")
				w.Flush()
				return
			}
			cmd.Stderr = cmd.Stdout // merge stderr into stdout

			if err := cmd.Start(); err != nil {
				w.WriteString("error: " + err.Error() + "\n")
				w.Flush()
				return
			}

			scanner := bufio.NewScanner(stdout)
			for scanner.Scan() {
				w.WriteString(scanner.Text() + "\n")
				w.Flush()
			}

			// We may not get to Wait() if the sidecar gets restarted by the
			// child CLI — that's expected and fine because the CLI continues
			// running in its own scope.
			_ = cmd.Wait()
		})

		return nil
	}
}
