package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/codeguard-ai/cli/internal/api"
	"github.com/codeguard-ai/cli/internal/config"
	"github.com/codeguard-ai/cli/internal/scanner"
	"github.com/codeguard-ai/cli/internal/ui"
	"github.com/spf13/cobra"
)

var (
	outputFormat string
	showAll      bool
)

var scanCmd = &cobra.Command{
	Use:   "scan [path]",
	Short: "Scan a directory for security issues",
	Long: `Scan analyzes your source code for security vulnerabilities,
best practice violations, and potential bugs.

Examples:
  codeguard scan              # Scan current directory
  codeguard scan ./src        # Scan specific directory
  codeguard scan --format json    # Output as JSON`,
	Args: cobra.MaximumNArgs(1),
	RunE: runScan,
}

func init() {
	rootCmd.AddCommand(scanCmd)
	scanCmd.Flags().StringVarP(&outputFormat, "format", "f", "pretty", "Output format: pretty, json, sarif")
	scanCmd.Flags().BoolVarP(&showAll, "all", "a", false, "Show all issues including low severity")
}

func runScan(cmd *cobra.Command, args []string) error {
	// Determine path to scan
	scanPath := "."
	if len(args) > 0 {
		scanPath = args[0]
	}

	// Resolve absolute path
	absPath, err := filepath.Abs(scanPath)
	if err != nil {
		return fmt.Errorf("invalid path: %w", err)
	}

	// Verify path exists
	info, err := os.Stat(absPath)
	if err != nil {
		return fmt.Errorf("path not found: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("path must be a directory")
	}

	// Load config
	cfg, err := config.Load()
	if err != nil {
		ui.Warning("Could not load config: " + err.Error())
		cfg = &config.Config{APIURL: config.DefaultAPIURL}
	}

	fmt.Println(ui.Logo())
	ui.Info(fmt.Sprintf("Scanning %s%s%s", ui.Bold, absPath, ui.Reset))
	fmt.Println()

	// Start scanning files
	startTime := time.Now()

	fmt.Printf("%s⠋%s Collecting source files...\r", ui.Cyan, ui.Reset)
	s := scanner.NewScanner(absPath)
	result, err := s.Scan()
	if err != nil {
		return fmt.Errorf("scan failed: %w", err)
	}

	if len(result.Files) == 0 {
		ui.Warning("No source files found to scan")
		return nil
	}

	fmt.Printf("%s✓%s Found %d files to analyze\n", ui.BrightGreen, ui.Reset, len(result.Files))

	if result.SkippedFiles > 0 {
		ui.Warning(fmt.Sprintf("Skipped %d files (too large)", result.SkippedFiles))
	}

	// Send to API
	fmt.Printf("%s⠋%s Running AI security analysis...%s\r", ui.Cyan, ui.Reset, strings.Repeat(" ", 20))

	client := api.NewClient(cfg.APIURL, cfg.APIKey)
	scanResp, err := client.Scan(result.Files)
	if err != nil {
		ui.Error("Analysis failed: " + err.Error())
		return nil
	}

	elapsed := time.Since(startTime)
	fmt.Printf("%s✓%s Analysis complete in %.1fs\n\n", ui.BrightGreen, ui.Reset, elapsed.Seconds())

	// Display results
	if outputFormat == "json" {
		return outputJSON(scanResp)
	}

	return outputPretty(scanResp, absPath, showAll)
}

func outputPretty(resp *api.ScanResponse, path string, showAll bool) error {
	// Summary box
	grade := ui.GradeBadge(resp.Grade)

	// Count by severity
	counts := map[string]int{
		"critical": 0,
		"high":     0,
		"medium":   0,
		"low":      0,
	}
	for _, issue := range resp.Issues {
		counts[issue.Severity]++
	}

	summaryLines := []string{
		fmt.Sprintf("Grade: %s", grade),
		fmt.Sprintf("Files scanned: %d", resp.FilesScanned),
		"",
		fmt.Sprintf("%sCritical:%s %d", ui.BrightRed, ui.Reset, counts["critical"]),
		fmt.Sprintf("%sHigh:%s     %d", ui.Red, ui.Reset, counts["high"]),
		fmt.Sprintf("%sMedium:%s   %d", ui.Yellow, ui.Reset, counts["medium"]),
		fmt.Sprintf("%sLow:%s      %d", ui.Green, ui.Reset, counts["low"]),
	}

	fmt.Print(ui.Box("Security Report", strings.Join(summaryLines, "\n")))
	fmt.Println()

	if len(resp.Issues) == 0 {
		ui.Success("No security issues found!")
		return nil
	}

	// Filter issues
	issues := resp.Issues
	if !showAll {
		filtered := make([]api.Issue, 0)
		for _, issue := range issues {
			if issue.Severity != "low" {
				filtered = append(filtered, issue)
			}
		}
		issues = filtered
		if len(issues) < len(resp.Issues) {
			ui.Info(fmt.Sprintf("Showing %d issues (use --all to see %d low severity issues)", len(issues), len(resp.Issues)-len(issues)))
			fmt.Println()
		}
	}

	// Sort by severity
	severityOrder := map[string]int{"critical": 0, "high": 1, "medium": 2, "low": 3}
	sort.Slice(issues, func(i, j int) bool {
		return severityOrder[issues[i].Severity] < severityOrder[issues[j].Severity]
	})

	// Group by file
	byFile := make(map[string][]api.Issue)
	for _, issue := range issues {
		byFile[issue.FilePath] = append(byFile[issue.FilePath], issue)
	}

	// Print issues
	for file, fileIssues := range byFile {
		fmt.Printf("%s%s%s\n", ui.Bold, file, ui.Reset)
		fmt.Println(strings.Repeat("─", 60))

		for _, issue := range fileIssues {
			badge := ui.SeverityBadge(issue.Severity)
			location := ""
			if issue.LineStart > 0 {
				if issue.LineEnd > issue.LineStart {
					location = fmt.Sprintf(" (L%d-%d)", issue.LineStart, issue.LineEnd)
				} else {
					location = fmt.Sprintf(" (L%d)", issue.LineStart)
				}
			}

			fmt.Printf("  %s %s%s%s%s\n", badge, ui.Bold, issue.Title, ui.Reset, location)
			if issue.Description != "" {
				// Wrap description
				desc := wrapText(issue.Description, 56)
				for _, line := range strings.Split(desc, "\n") {
					fmt.Printf("      %s%s%s\n", ui.Dim, line, ui.Reset)
				}
			}
			if issue.Suggestion != "" {
				fmt.Printf("      %s→ %s%s\n", ui.Cyan, issue.Suggestion, ui.Reset)
			}
			fmt.Println()
		}
	}

	return nil
}

func outputJSON(resp *api.ScanResponse) error {
	// Simple JSON output for CI/CD integration
	fmt.Println("{")
	fmt.Printf("  \"grade\": \"%s\",\n", resp.Grade)
	fmt.Printf("  \"filesScanned\": %d,\n", resp.FilesScanned)
	fmt.Printf("  \"issueCount\": %d,\n", len(resp.Issues))
	fmt.Println("  \"issues\": [")

	for i, issue := range resp.Issues {
		fmt.Println("    {")
		fmt.Printf("      \"severity\": \"%s\",\n", issue.Severity)
		fmt.Printf("      \"title\": \"%s\",\n", escapeJSON(issue.Title))
		fmt.Printf("      \"file\": \"%s\",\n", issue.FilePath)
		fmt.Printf("      \"line\": %d,\n", issue.LineStart)
		fmt.Printf("      \"description\": \"%s\"\n", escapeJSON(issue.Description))
		if i < len(resp.Issues)-1 {
			fmt.Println("    },")
		} else {
			fmt.Println("    }")
		}
	}

	fmt.Println("  ]")
	fmt.Println("}")
	return nil
}

func escapeJSON(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "\"", "\\\"")
	s = strings.ReplaceAll(s, "\n", "\\n")
	s = strings.ReplaceAll(s, "\t", "\\t")
	return s
}

func wrapText(text string, width int) string {
	words := strings.Fields(text)
	if len(words) == 0 {
		return ""
	}

	var lines []string
	var currentLine strings.Builder

	for _, word := range words {
		if currentLine.Len() > 0 && currentLine.Len()+1+len(word) > width {
			lines = append(lines, currentLine.String())
			currentLine.Reset()
		}
		if currentLine.Len() > 0 {
			currentLine.WriteString(" ")
		}
		currentLine.WriteString(word)
	}

	if currentLine.Len() > 0 {
		lines = append(lines, currentLine.String())
	}

	return strings.Join(lines, "\n")
}
