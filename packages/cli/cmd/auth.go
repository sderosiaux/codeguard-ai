package cmd

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"github.com/codeguard-ai/cli/internal/api"
	"github.com/codeguard-ai/cli/internal/config"
	"github.com/codeguard-ai/cli/internal/ui"
	"github.com/spf13/cobra"
)

var authCmd = &cobra.Command{
	Use:   "auth",
	Short: "Manage authentication",
	Long:  `Manage authentication with the CodeGuard API.`,
}

var loginCmd = &cobra.Command{
	Use:   "login",
	Short: "Authenticate with CodeGuard",
	Long: `Authenticate with the CodeGuard API using an API key.

You can get an API key from your account settings at:
https://codeguard-ai.vercel.app/app/settings`,
	RunE: runLogin,
}

var logoutCmd = &cobra.Command{
	Use:   "logout",
	Short: "Remove stored credentials",
	RunE:  runLogout,
}

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show authentication status",
	RunE:  runStatus,
}

func init() {
	rootCmd.AddCommand(authCmd)
	authCmd.AddCommand(loginCmd)
	authCmd.AddCommand(logoutCmd)
	authCmd.AddCommand(statusCmd)
}

func runLogin(cmd *cobra.Command, args []string) error {
	fmt.Println(ui.Logo())

	cfg, err := config.Load()
	if err != nil {
		cfg = &config.Config{APIURL: config.DefaultAPIURL}
	}

	// Prompt for API key
	fmt.Printf("Enter your API key: ")
	reader := bufio.NewReader(os.Stdin)
	apiKey, err := reader.ReadString('\n')
	if err != nil {
		return fmt.Errorf("failed to read input: %w", err)
	}
	apiKey = strings.TrimSpace(apiKey)

	if apiKey == "" {
		ui.Error("API key cannot be empty")
		return nil
	}

	// Validate API key format
	if !strings.HasPrefix(apiKey, "cg_") {
		ui.Error("Invalid API key format. API keys start with 'cg_'")
		return nil
	}

	// Validate API key with server
	fmt.Printf("%s⠋%s Validating credentials...\r", ui.Cyan, ui.Reset)
	client := api.NewClient(cfg.APIURL, apiKey)
	meResp, err := client.GetMe()
	if err != nil {
		fmt.Print(strings.Repeat(" ", 40) + "\r")
		ui.Error("Authentication failed: " + err.Error())
		return nil
	}

	// Save config
	cfg.APIKey = apiKey
	if err := config.Save(cfg); err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}

	fmt.Print(strings.Repeat(" ", 40) + "\r")
	ui.Success(fmt.Sprintf("Authenticated as %s (%s)", meResp.User.Name, meResp.User.Email))
	fmt.Println()
	ui.Info("You can now run: codeguard scan")
	return nil
}

func runLogout(cmd *cobra.Command, args []string) error {
	cfg, err := config.Load()
	if err != nil {
		ui.Warning("Not currently logged in")
		return nil
	}

	if cfg.APIKey == "" {
		ui.Warning("Not currently logged in")
		return nil
	}

	cfg.APIKey = ""
	if err := config.Save(cfg); err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}

	ui.Success("Logged out successfully")
	return nil
}

func runStatus(cmd *cobra.Command, args []string) error {
	cfg, err := config.Load()
	if err != nil {
		ui.Error("Not authenticated")
		return nil
	}

	if !cfg.IsAuthenticated() {
		ui.Warning("Not authenticated")
		fmt.Println()
		ui.Info("Run 'codeguard auth login' to authenticate")
		return nil
	}

	// Verify API key is still valid
	fmt.Printf("%s⠋%s Checking authentication...\r", ui.Cyan, ui.Reset)
	client := api.NewClient(cfg.APIURL, cfg.APIKey)
	meResp, err := client.GetMe()
	if err != nil {
		fmt.Print(strings.Repeat(" ", 40) + "\r")
		ui.Error("API key is no longer valid: " + err.Error())
		fmt.Println()
		ui.Info("Run 'codeguard auth login' to re-authenticate")
		return nil
	}

	// Get workspaces
	workspacesResp, err := client.GetWorkspaces()
	if err != nil {
		fmt.Print(strings.Repeat(" ", 40) + "\r")
		ui.Warning("Could not fetch workspaces: " + err.Error())
	}

	fmt.Print(strings.Repeat(" ", 40) + "\r")
	ui.Success("Authenticated")
	fmt.Printf("  User:      %s%s (%s)%s\n", ui.Dim, meResp.User.Name, meResp.User.Email, ui.Reset)
	fmt.Printf("  API URL:   %s%s%s\n", ui.Dim, cfg.APIURL, ui.Reset)

	// Mask API key
	masked := cfg.APIKey[:8] + "..." + cfg.APIKey[len(cfg.APIKey)-4:]
	fmt.Printf("  API Key:   %s%s%s\n", ui.Dim, masked, ui.Reset)

	// Show current workspace
	if workspacesResp != nil {
		for _, ws := range workspacesResp.Workspaces {
			if ws.ID == meResp.WorkspaceID {
				fmt.Printf("  Workspace: %s%s (%s)%s\n", ui.Dim, ws.Name, ws.Role, ui.Reset)
				break
			}
		}

		if len(workspacesResp.Workspaces) > 1 {
			fmt.Printf("\n  %sYou have access to %d workspaces%s\n", ui.Dim, len(workspacesResp.Workspaces), ui.Reset)
		}
	}

	return nil
}
