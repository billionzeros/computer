package handlers

import (
	"github.com/gofiber/fiber/v2"

	"github.com/billionzeros/computer/sidecar/internal/checks"
	"github.com/billionzeros/computer/sidecar/internal/config"
)

type statusResponse struct {
	Status  string              `json:"status"`
	Agent   checks.AgentStatus  `json:"agent"`
	Caddy   checks.CaddyStatus  `json:"caddy"`
	System  checks.SystemStatus `json:"system"`
	Version string              `json:"version"`
}

// deriveStatus computes the top-level status from individual check results.
func deriveStatus(agent checks.AgentStatus, caddy checks.CaddyStatus) string {
	if agent.Healthy && caddy.Running {
		return "ready"
	}
	return "provisioning"
}

// NewStatusHandler creates a Fiber handler that runs all checks and returns full VM status.
func NewStatusHandler(cfg *config.Config) fiber.Handler {
	return func(c *fiber.Ctx) error {
		agent := checks.CheckAgent(cfg.AgentPort)
		caddy := checks.CheckCaddy()
		system := checks.CheckSystem()

		status := deriveStatus(agent, caddy)

		return c.JSON(statusResponse{
			Status:  status,
			Agent:   agent,
			Caddy:   caddy,
			System:  system,
			Version: cfg.Version,
		})
	}
}
