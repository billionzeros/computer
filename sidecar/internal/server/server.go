package server

import (
	"fmt"
	"log"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"

	"github.com/billionzeros/computer/sidecar/internal/config"
	"github.com/billionzeros/computer/sidecar/internal/handlers"
	"github.com/billionzeros/computer/sidecar/internal/middleware"
)

// Start creates and starts the sidecar Fiber server on localhost only.
func Start(cfg *config.Config) error {
	app := fiber.New(fiber.Config{
		DisableStartupMessage: true,
		AppName:               "anton-sidecar",
	})

	app.Use(recover.New())

	// Public endpoints — rate limited, no auth.
	app.Get("/health", middleware.RateLimit(60), handlers.Health)
	app.Get("/status", middleware.RateLimit(30), handlers.NewStatusHandler(cfg))

	// Protected endpoints — require Bearer token auth.
	protected := app.Group("/", middleware.BearerAuth(cfg.Token))
	protected.Get("/update/check", handlers.NewUpdateCheckHandler(cfg))
	protected.Post("/update/start", handlers.NewUpdateStartHandler(cfg))

	addr := fmt.Sprintf("0.0.0.0:%d", cfg.Port)
	log.Printf("anton-sidecar v%s starting on %s (agent_port=%d)",
		cfg.Version, addr, cfg.AgentPort)

	return app.Listen(addr)
}
