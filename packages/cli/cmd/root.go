package cmd

import (
	"fmt"
	"os"

	"github.com/codeguard-ai/cli/internal/ui"
	"github.com/spf13/cobra"
)

var (
	version = "0.1.0"
	cfgFile string
)

var rootCmd = &cobra.Command{
	Use:   "codeguard",
	Short: "AI-powered security scanner for your codebase",
	Long: ui.Logo() + `
CodeGuard AI analyzes your code for security vulnerabilities,
best practice violations, and potential bugs using advanced AI.

Get started:
  codeguard scan           Scan current directory
  codeguard scan ./path    Scan specific path
  codeguard auth login     Authenticate with CodeGuard API`,
	Version: version,
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func init() {
	rootCmd.PersistentFlags().StringVar(&cfgFile, "config", "", "config file (default is $HOME/.codeguard.yaml)")
	rootCmd.SetVersionTemplate(ui.VersionTemplate(version))
}
