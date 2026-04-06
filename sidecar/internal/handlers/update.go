package handlers

import (
	"bufio"
	"os/exec"
	"sync"

	"github.com/gofiber/fiber/v2"

	"github.com/OmGuptaIND/anton.computer/sidecar/internal/config"
	"github.com/OmGuptaIND/anton.computer/sidecar/internal/update"
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
			cmd := exec.Command("sudo", "anton", "computer", "update", "--yes", "--json")
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

			if err := cmd.Wait(); err != nil {
				w.WriteString("error: " + err.Error() + "\n")
				w.Flush()
			}
		})

		return nil
	}
}
