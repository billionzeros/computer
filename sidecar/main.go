package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/billionzeros/computer/sidecar/internal/config"
	"github.com/billionzeros/computer/sidecar/internal/server"
)

// Set via -ldflags at build time.
var version = "dev"

func main() {
	port := flag.Int("port", 0, "Override sidecar port (default: 9878 or SIDECAR_PORT env)")
	agentPort := flag.Int("agent-port", 0, "Override agent port (default: 9876 or AGENT_PORT env)")
	flag.Parse()

	// CLI flags override env vars.
	if *port > 0 {
		os.Setenv("SIDECAR_PORT", fmt.Sprintf("%d", *port))
	}
	if *agentPort > 0 {
		os.Setenv("AGENT_PORT", fmt.Sprintf("%d", *agentPort))
	}

	cfg, err := config.Load(version)
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	// Graceful shutdown on SIGINT/SIGTERM.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		log.Println("shutting down...")
		os.Exit(0)
	}()

	if err := server.Start(cfg); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
